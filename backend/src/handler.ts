import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  ScanCommand,
  UpdateCommand,
  type ScanCommandInput,
} from '@aws-sdk/lib-dynamodb';
import type { ZodType } from 'zod';
import {
  badRequest,
  created,
  internalError,
  noContent,
  notFound,
  ok,
  unauthorized,
  type HttpResponse,
} from './http.js';
import { BugReportCreate, BugReportUpdate, ListQuery } from './validation.js';

/** Minimal subset of the payload v2.0 event (sent by both Lambda Function URLs and API Gateway HTTP APIs) that we use. */
export interface HttpApiEvent {
  rawPath?: string;
  headers?: Record<string, string | undefined>;
  queryStringParameters?: Record<string, string | undefined>;
  body?: string;
  isBase64Encoded?: boolean;
  requestContext?: { http?: { method?: string }; stage?: string };
}

const LIST_CAP = 500;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

const tableName = (): string => {
  const name = process.env.TABLE_NAME;
  if (!name) throw new Error('TABLE_NAME env var is not set');
  return name;
};

class InvalidJson extends Error {}

class ValidationFailed extends Error {
  constructor(readonly issues: unknown[]) {
    super('validation_failed');
  }
}

function validate<T>(schema: ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new ValidationFailed(result.error.issues);
  return result.data;
}

/**
 * Constant-time API key check. Both sides are hashed first so the compared
 * buffers always have equal length (timingSafeEqual requires it) and the key
 * length is not leaked. Fails closed if LUMALENS_KEY is not configured.
 */
function isAuthorized(event: HttpApiEvent): boolean {
  const expected = process.env.LUMALENS_KEY;
  const provided = event.headers?.['x-lumalens-key'];
  if (!expected || !provided) return false;
  const digest = (v: string) => createHash('sha256').update(v, 'utf8').digest();
  return timingSafeEqual(digest(provided), digest(expected));
}

function parseBody(event: HttpApiEvent): unknown {
  const raw = event.isBase64Encoded && event.body
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : (event.body ?? '');
  try {
    return JSON.parse(raw);
  } catch {
    throw new InvalidJson();
  }
}

function isConditionalCheckFailed(err: unknown): boolean {
  return err instanceof Error && err.name === 'ConditionalCheckFailedException';
}

/** Path relative to the stage (handles both $default and named stages). */
function routePath(event: HttpApiEvent): string {
  let path = event.rawPath ?? '/';
  const stage = event.requestContext?.stage;
  if (stage && stage !== '$default' && (path === `/${stage}` || path.startsWith(`/${stage}/`))) {
    path = path.slice(stage.length + 1) || '/';
  }
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

// ---- CRUD ----------------------------------------------------------------

async function createBug(input: BugReportCreate): Promise<HttpResponse> {
  const now = new Date().toISOString();
  const item = { ...input, id: randomUUID(), createdAt: now, updatedAt: now };
  await ddb.send(new PutCommand({
    TableName: tableName(),
    Item: item,
    ConditionExpression: 'attribute_not_exists(id)',
  }));
  return created(item);
}

async function listBugs(filters: ListQuery): Promise<HttpResponse> {
  const clauses: string[] = [];
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  if (filters.status !== undefined) {
    clauses.push('#status = :status');
    names['#status'] = 'status';
    values[':status'] = filters.status;
  }
  if (filters.buildVersion !== undefined) {
    clauses.push('#buildVersion = :buildVersion');
    names['#buildVersion'] = 'buildVersion';
    values[':buildVersion'] = filters.buildVersion;
  }

  const base: ScanCommandInput = { TableName: tableName() };
  if (clauses.length > 0) {
    base.FilterExpression = clauses.join(' AND ');
    base.ExpressionAttributeNames = names;
    base.ExpressionAttributeValues = values;
  }

  const items: Record<string, unknown>[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const page = await ddb.send(new ScanCommand({ ...base, ExclusiveStartKey: startKey }));
    items.push(...(page.Items ?? []));
    startKey = page.LastEvaluatedKey;
  } while (startKey && items.length < LIST_CAP);

  const capped = items.slice(0, LIST_CAP);
  capped.sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
  return ok({ items: capped, count: capped.length });
}

async function getBug(id: string): Promise<HttpResponse> {
  const res = await ddb.send(new GetCommand({ TableName: tableName(), Key: { id } }));
  return res.Item ? ok(res.Item) : notFound();
}

async function updateBug(id: string, changes: BugReportUpdate): Promise<HttpResponse> {
  const fields = { ...changes, updatedAt: new Date().toISOString() };
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  const sets = Object.entries(fields).map(([key, value]) => {
    names[`#${key}`] = key;
    values[`:${key}`] = value;
    return `#${key} = :${key}`;
  });
  try {
    const res = await ddb.send(new UpdateCommand({
      TableName: tableName(),
      Key: { id },
      UpdateExpression: `SET ${sets.join(', ')}`,
      ConditionExpression: 'attribute_exists(id)',
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ReturnValues: 'ALL_NEW',
    }));
    return ok(res.Attributes);
  } catch (err) {
    if (isConditionalCheckFailed(err)) return notFound();
    throw err;
  }
}

async function deleteBug(id: string): Promise<HttpResponse> {
  try {
    await ddb.send(new DeleteCommand({
      TableName: tableName(),
      Key: { id },
      ConditionExpression: 'attribute_exists(id)',
    }));
    return noContent();
  } catch (err) {
    if (isConditionalCheckFailed(err)) return notFound();
    throw err;
  }
}

// ---- Router --------------------------------------------------------------

async function route(event: HttpApiEvent): Promise<HttpResponse> {
  const method = (event.requestContext?.http?.method ?? 'GET').toUpperCase();
  const path = routePath(event);

  if (path === '/bugs') {
    if (method === 'POST') return createBug(validate(BugReportCreate, parseBody(event)));
    if (method === 'GET') {
      const q = event.queryStringParameters ?? {};
      return listBugs(validate(ListQuery, { status: q.status, buildVersion: q.buildVersion }));
    }
    return notFound();
  }

  const match = /^\/bugs\/([^/]+)$/.exec(path);
  if (match?.[1]) {
    const id = decodeURIComponent(match[1]);
    if (method === 'GET') return getBug(id);
    if (method === 'PUT') return updateBug(id, validate(BugReportUpdate, parseBody(event)));
    if (method === 'DELETE') return deleteBug(id);
  }
  return notFound();
}

export async function handler(event: HttpApiEvent): Promise<HttpResponse> {
  try {
    if (!isAuthorized(event)) return unauthorized();
    return await route(event);
  } catch (err) {
    if (err instanceof InvalidJson) return badRequest('invalid_json');
    if (err instanceof ValidationFailed) return badRequest('validation_failed', err.issues);
    console.error('Unhandled error', err);
    return internalError();
  }
}
