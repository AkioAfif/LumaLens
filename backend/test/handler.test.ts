import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handler, type HttpApiEvent } from '../src/handler.js';

const KEY = 'test-key';
const ID = '11111111-2222-4333-8444-555555555555';
const ddbMock = mockClient(DynamoDBDocumentClient);

const validCreate = {
  title: 'Player falls through floor',
  severity: 'high',
  engine: 'unity',
  runContext: 'build',
  buildVersion: '0.3.1',
  platform: 'windows',
};

function event(
  method: string,
  path: string,
  opts: { body?: unknown; rawBody?: string; base64?: boolean; key?: string | null; query?: Record<string, string> } = {},
): HttpApiEvent {
  const headers: Record<string, string> = {};
  if (opts.key !== null) headers['x-lumalens-key'] = opts.key ?? KEY;
  let body = opts.rawBody ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body));
  if (opts.base64 && body !== undefined) body = Buffer.from(body, 'utf8').toString('base64');
  return {
    rawPath: path,
    headers,
    queryStringParameters: opts.query,
    body,
    isBase64Encoded: opts.base64 ?? false,
    requestContext: { http: { method }, stage: '$default' },
  };
}

const conditionalFailed = () =>
  new ConditionalCheckFailedException({ message: 'The conditional request failed', $metadata: {} });

const parse = (body: string | undefined) => JSON.parse(body ?? '');

beforeEach(() => {
  ddbMock.reset();
  process.env.LUMALENS_KEY = KEY;
  process.env.TABLE_NAME = 'LumaLensReports';
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('auth', () => {
  it('401 when x-lumalens-key is missing', async () => {
    const res = await handler(event('GET', '/bugs', { key: null }));
    expect(res.statusCode).toBe(401);
    expect(parse(res.body)).toEqual({ error: 'unauthorized' });
    expect(ddbMock.calls()).toHaveLength(0);
  });

  it('401 when x-lumalens-key is wrong', async () => {
    const res = await handler(event('GET', '/bugs', { key: 'nope' }));
    expect(res.statusCode).toBe(401);
    expect(ddbMock.calls()).toHaveLength(0);
  });
});

describe('request parsing and validation', () => {
  it('400 invalid_json on malformed body', async () => {
    const res = await handler(event('POST', '/bugs', { rawBody: '{"title":' }));
    expect(res.statusCode).toBe(400);
    expect(parse(res.body)).toEqual({ error: 'invalid_json' });
  });

  it('400 validation_failed on unknown field', async () => {
    const res = await handler(event('POST', '/bugs', { body: { ...validCreate, hacker: true } }));
    expect(res.statusCode).toBe(400);
    const body = parse(res.body);
    expect(body.error).toBe('validation_failed');
    expect(body.details[0].code).toBe('unrecognized_keys');
  });

  it('400 validation_failed on client-sent id', async () => {
    const res = await handler(event('POST', '/bugs', { body: { ...validCreate, id: ID } }));
    expect(res.statusCode).toBe(400);
    expect(parse(res.body).error).toBe('validation_failed');
  });

  it('400 validation_failed on bad enum', async () => {
    const res = await handler(event('POST', '/bugs', { body: { ...validCreate, severity: 'apocalyptic' } }));
    expect(res.statusCode).toBe(400);
    const body = parse(res.body);
    expect(body.error).toBe('validation_failed');
    expect(body.details[0].path).toEqual(['severity']);
  });

  it('400 validation_failed when title is longer than 120 chars', async () => {
    const res = await handler(event('POST', '/bugs', { body: { ...validCreate, title: 'x'.repeat(121) } }));
    expect(res.statusCode).toBe(400);
    const body = parse(res.body);
    expect(body.error).toBe('validation_failed');
    expect(body.details[0].path).toEqual(['title']);
  });

  it('400 validation_failed on bad list filter', async () => {
    const res = await handler(event('GET', '/bugs', { query: { status: 'closed' } }));
    expect(res.statusCode).toBe(400);
    expect(parse(res.body).error).toBe('validation_failed');
    expect(ddbMock.calls()).toHaveLength(0);
  });

  it('400 validation_failed on PUT with a non-updatable field', async () => {
    const res = await handler(event('PUT', `/bugs/${ID}`, { body: { title: 'renamed' } }));
    expect(res.statusCode).toBe(400);
    expect(parse(res.body).error).toBe('validation_failed');
  });

  it('400 validation_failed on empty PUT body', async () => {
    const res = await handler(event('PUT', `/bugs/${ID}`, { body: {} }));
    expect(res.statusCode).toBe(400);
    expect(parse(res.body).error).toBe('validation_failed');
  });
});

describe('POST /bugs', () => {
  it('201 with server-set fields and defaults', async () => {
    ddbMock.on(PutCommand).resolves({});
    const res = await handler(event('POST', '/bugs', { body: validCreate }));
    expect(res.statusCode).toBe(201);
    expect(res.headers?.['content-type']).toBe('application/json');
    const item = parse(res.body);
    expect(item).toMatchObject({ ...validCreate, status: 'open', source: 'manual' });
    expect(item.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(item.createdAt).toBe(item.updatedAt);
    expect(new Date(item.createdAt).toISOString()).toBe(item.createdAt);

    const put = ddbMock.commandCalls(PutCommand)[0]!.args[0].input;
    expect(put.TableName).toBe('LumaLensReports');
    expect(put.ConditionExpression).toBe('attribute_not_exists(id)');
    expect(put.Item).toEqual(item);
  });

  it('accepts a base64-encoded body', async () => {
    ddbMock.on(PutCommand).resolves({});
    const res = await handler(event('POST', '/bugs', { body: validCreate, base64: true }));
    expect(res.statusCode).toBe(201);
  });
});

describe('GET /bugs', () => {
  it('200 with filter, pagination and newest-first sort', async () => {
    ddbMock
      .on(ScanCommand)
      .resolvesOnce({ Items: [{ id: 'a', createdAt: '2026-01-01T00:00:00.000Z' }], LastEvaluatedKey: { id: 'a' } })
      .resolvesOnce({ Items: [{ id: 'b', createdAt: '2026-02-01T00:00:00.000Z' }] });

    const res = await handler(event('GET', '/bugs', { query: { status: 'open', buildVersion: '0.3.1' } }));
    expect(res.statusCode).toBe(200);
    const body = parse(res.body);
    expect(body.count).toBe(2);
    expect(body.items.map((i: { id: string }) => i.id)).toEqual(['b', 'a']);

    const scans = ddbMock.commandCalls(ScanCommand);
    expect(scans).toHaveLength(2);
    const first = scans[0]!.args[0].input;
    expect(first.FilterExpression).toBe('#status = :status AND #buildVersion = :buildVersion');
    expect(first.ExpressionAttributeValues).toEqual({ ':status': 'open', ':buildVersion': '0.3.1' });
    expect(scans[1]!.args[0].input.ExclusiveStartKey).toEqual({ id: 'a' });
  });
});

describe('GET /bugs/{id}', () => {
  it('200 when found', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { id: ID, title: 't' } });
    const res = await handler(event('GET', `/bugs/${ID}`));
    expect(res.statusCode).toBe(200);
    expect(parse(res.body).id).toBe(ID);
  });

  it('404 when missing', async () => {
    ddbMock.on(GetCommand).resolves({});
    const res = await handler(event('GET', `/bugs/${ID}`));
    expect(res.statusCode).toBe(404);
    expect(parse(res.body)).toEqual({ error: 'not_found' });
  });
});

describe('PUT /bugs/{id}', () => {
  it('200 with the updated item', async () => {
    ddbMock.on(UpdateCommand).resolves({ Attributes: { id: ID, status: 'fixed' } });
    const res = await handler(event('PUT', `/bugs/${ID}`, { body: { status: 'fixed' } }));
    expect(res.statusCode).toBe(200);
    expect(parse(res.body)).toEqual({ id: ID, status: 'fixed' });

    const input = ddbMock.commandCalls(UpdateCommand)[0]!.args[0].input;
    expect(input.ConditionExpression).toBe('attribute_exists(id)');
    expect(input.ReturnValues).toBe('ALL_NEW');
    expect(input.UpdateExpression).toBe('SET #status = :status, #updatedAt = :updatedAt');
  });

  it('404 when missing', async () => {
    ddbMock.on(UpdateCommand).rejects(conditionalFailed());
    const res = await handler(event('PUT', `/bugs/${ID}`, { body: { severity: 'crash' } }));
    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /bugs/{id}', () => {
  it('204 with empty body', async () => {
    ddbMock.on(DeleteCommand).resolves({});
    const res = await handler(event('DELETE', `/bugs/${ID}`));
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    expect(ddbMock.commandCalls(DeleteCommand)[0]!.args[0].input.ConditionExpression).toBe('attribute_exists(id)');
  });

  it('404 when missing', async () => {
    ddbMock.on(DeleteCommand).rejects(conditionalFailed());
    const res = await handler(event('DELETE', `/bugs/${ID}`));
    expect(res.statusCode).toBe(404);
  });
});

describe('routing and errors', () => {
  it('404 on unknown route', async () => {
    const res = await handler(event('GET', '/nope'));
    expect(res.statusCode).toBe(404);
    expect(parse(res.body)).toEqual({ error: 'not_found' });
  });

  it('404 on unsupported method for a known path', async () => {
    const res = await handler(event('PATCH', '/bugs'));
    expect(res.statusCode).toBe(404);
  });

  it('500 internal_error and logs the real error', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    ddbMock.on(GetCommand).rejects(new Error('boom'));
    const res = await handler(event('GET', `/bugs/${ID}`));
    expect(res.statusCode).toBe(500);
    expect(parse(res.body)).toEqual({ error: 'internal_error' });
    expect(spy).toHaveBeenCalled();
  });
});
