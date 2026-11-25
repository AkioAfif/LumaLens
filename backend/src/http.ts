export interface HttpResponse {
  statusCode: number;
  headers?: Record<string, string>;
  body?: string;
}

const JSON_HEADERS = { 'content-type': 'application/json' };

export function json(statusCode: number, payload: unknown): HttpResponse {
  return { statusCode, headers: { ...JSON_HEADERS }, body: JSON.stringify(payload) };
}

export const ok = (payload: unknown) => json(200, payload);
export const created = (payload: unknown) => json(201, payload);
export const noContent = (): HttpResponse => ({ statusCode: 204, body: '' });

export function error(statusCode: number, code: string, details?: unknown): HttpResponse {
  return json(statusCode, details === undefined ? { error: code } : { error: code, details });
}

export const badRequest = (code: string, details?: unknown) => error(400, code, details);
export const unauthorized = () => error(401, 'unauthorized');
export const notFound = () => error(404, 'not_found');
export const internalError = () => error(500, 'internal_error');
