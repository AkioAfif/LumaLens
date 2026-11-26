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

const BUCKET = 'lumalens-shots-542230';

beforeEach(() => {
  ddbMock.reset();
  process.env.LUMALENS_KEY = KEY;
  process.env.TABLE_NAME = 'LumaLensReports';
  process.env.BUCKET_NAME = BUCKET;
  // Presigning is done locally (no S3 call), but the signer needs a region and some credentials.
  process.env.AWS_REGION = 'us-east-1';
  process.env.AWS_ACCESS_KEY_ID = 'AKIATESTTESTTESTTEST';
  process.env.AWS_SECRET_ACCESS_KEY = 'test-secret';
  delete process.env.AWS_SESSION_TOKEN;
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

  it('200 setting screenshotKey and logKey alone', async () => {
    const keys = { screenshotKey: `screenshots/${ID}.png`, logKey: `logs/${ID}.txt` };
    ddbMock.on(UpdateCommand).resolves({ Attributes: { id: ID, ...keys } });
    const res = await handler(event('PUT', `/bugs/${ID}`, { body: keys }));
    expect(res.statusCode).toBe(200);
    expect(parse(res.body)).toMatchObject(keys);

    const input = ddbMock.commandCalls(UpdateCommand)[0]!.args[0].input;
    expect(input.UpdateExpression).toBe(
      'SET #screenshotKey = :screenshotKey, #logKey = :logKey, #updatedAt = :updatedAt',
    );
    expect(input.ExpressionAttributeValues).toMatchObject({
      ':screenshotKey': keys.screenshotKey,
      ':logKey': keys.logKey,
    });
  });

  it.each([
    ['screenshotKey outside screenshots/', { screenshotKey: `logs/${ID}.txt` }],
    ['logKey outside logs/', { logKey: `../${ID}.txt` }],
    ['screenshotKey over 200 chars', { screenshotKey: `screenshots/${'x'.repeat(190)}` }],
    ['non-string logKey', { logKey: 42 }],
  ])('400 validation_failed on %s', async (_label, body) => {
    const res = await handler(event('PUT', `/bugs/${ID}`, { body }));
    expect(res.statusCode).toBe(400);
    expect(parse(res.body).error).toBe('validation_failed');
    expect(ddbMock.calls()).toHaveLength(0);
  });
});

describe('POST /uploads', () => {
  it('401 without x-lumalens-key', async () => {
    const res = await handler(event('POST', '/uploads', { key: null, body: { bugId: ID, kind: 'screenshot' } }));
    expect(res.statusCode).toBe(401);
    expect(ddbMock.calls()).toHaveLength(0);
  });

  it.each([
    ['missing kind', { bugId: ID }],
    ['bad kind', { bugId: ID, kind: 'video' }],
    ['non-uuid bugId', { bugId: '../etc/passwd', kind: 'log' }],
    ['unknown field', { bugId: ID, kind: 'log', key: 'logs/evil.txt' }],
  ])('400 validation_failed on %s', async (_label, body) => {
    const res = await handler(event('POST', '/uploads', { body }));
    expect(res.statusCode).toBe(400);
    expect(parse(res.body).error).toBe('validation_failed');
    expect(ddbMock.calls()).toHaveLength(0);
  });

  it('400 invalid_json on malformed body', async () => {
    const res = await handler(event('POST', '/uploads', { rawBody: '{' }));
    expect(res.statusCode).toBe(400);
    expect(parse(res.body)).toEqual({ error: 'invalid_json' });
  });

  it('404 not_found when the bug does not exist', async () => {
    ddbMock.on(GetCommand).resolves({});
    const res = await handler(event('POST', '/uploads', { body: { bugId: ID, kind: 'screenshot' } }));
    expect(res.statusCode).toBe(404);
    expect(parse(res.body)).toEqual({ error: 'not_found' });
    expect(ddbMock.commandCalls(GetCommand)[0]!.args[0].input.Key).toEqual({ id: ID });
  });

  it.each([
    ['screenshot', `screenshots/${ID}.png`, 'image/png'],
    ['log', `logs/${ID}.txt`, 'text/plain'],
  ])('201 with a presigned PUT URL for a %s', async (kind, key, contentType) => {
    ddbMock.on(GetCommand).resolves({ Item: { id: ID } });
    const res = await handler(event('POST', '/uploads', { body: { bugId: ID, kind } }));
    expect(res.statusCode).toBe(201);
    const body = parse(res.body);
    expect(body).toMatchObject({ key, contentType, expiresIn: 300 });
    expect(Object.keys(body).sort()).toEqual(['contentType', 'expiresIn', 'key', 'uploadUrl']);

    const url = new URL(body.uploadUrl);
    expect(url.protocol).toBe('https:');
    expect(url.hostname).toContain(BUCKET);
    expect(url.pathname).toContain(key);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    // Content-Type is a signed header, so a PUT with any other type is rejected by S3.
    expect(url.searchParams.get('X-Amz-SignedHeaders')?.split(';')).toContain('content-type');
    // No precomputed body checksum (it would be the empty-body CRC32 and break the real PUT).
    expect([...url.searchParams.keys()].some((k) => k.toLowerCase().startsWith('x-amz-checksum'))).toBe(false);
  });

  it('500 internal_error and logs when BUCKET_NAME is missing', async () => {
    delete process.env.BUCKET_NAME;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    ddbMock.on(GetCommand).resolves({ Item: { id: ID } });
    const res = await handler(event('POST', '/uploads', { body: { bugId: ID, kind: 'log' } }));
    expect(res.statusCode).toBe(500);
    expect(parse(res.body)).toEqual({ error: 'internal_error' });
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('BUCKET_NAME'));
  });

  it('404 on GET /uploads', async () => {
    const res = await handler(event('GET', '/uploads'));
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
