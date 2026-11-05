import { ApiErrorSchema, type ErrorCode } from '@dockside/shared';
import type { ZodType } from 'zod';

export type ClientErrorCode = ErrorCode | 'network' | 'invalid_response';

export class ApiError extends Error {
  public readonly requestId?: string | undefined;
  public readonly details?: { path: string; message: string }[] | undefined;
  constructor(
    public readonly code: ClientErrorCode,
    message: string,
    public readonly status: number,
    metadata: { requestId?: string | undefined; details?: { path: string; message: string }[] | undefined } = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.requestId = metadata.requestId;
    this.details = metadata.details;
  }
}

let csrfToken: string | null = null;
let onUnauthenticated: (() => void) | null = null;

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

export function setUnauthenticatedHandler(handler: (() => void) | null): void {
  onUnauthenticated = handler;
}

interface RequestOptions<T> {
  body?: unknown;
  schema?: ZodType<T>;
  signal?: AbortSignal;
}

async function toApiError(res: Response): Promise<ApiError> {
  const parsed = ApiErrorSchema.safeParse(await res.json().catch(() => null));
  if (parsed.success) {
    const { code, message, requestId, details } = parsed.data.error;
    return new ApiError(code, message, res.status, { requestId, details });
  }
  return new ApiError('internal', `The server returned an unexpected ${res.status} response.`, res.status);
}

function requestInit<T>(method: string, options: RequestOptions<T>): RequestInit {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (csrfToken && method !== 'GET') headers['x-csrf-token'] = csrfToken;

  const init: RequestInit = { method, headers, credentials: 'same-origin' };
  if (options.body !== undefined) init.body = JSON.stringify(options.body);
  if (options.signal) init.signal = options.signal;
  return init;
}

async function sendRequest(path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(path, init);
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiError('network', 'Cannot reach the Dockside server. Check your connection.', 0);
  }
}

export async function apiRequest<T = void>(method: string, path: string, options: RequestOptions<T> = {}): Promise<T> {
  const res = await sendRequest(path, requestInit(method, options));

  if (!res.ok) {
    const error = await toApiError(res);
    if (error.code === 'unauthenticated' && path !== '/api/v1/login') onUnauthenticated?.();
    throw error;
  }
  if (res.status === 204) return undefined as T;

  const json: unknown = await res.json().catch(() => null);
  if (!options.schema) return json as T;
  const checked = options.schema.safeParse(json);
  if (!checked.success)
    throw new ApiError('invalid_response', 'The server sent data in an unexpected shape.', res.status);
  return checked.data;
}

export const api = {
  get: <T>(path: string, schema?: ZodType<T>, signal?: AbortSignal) => {
    const options: RequestOptions<T> = {};
    if (schema) options.schema = schema;
    if (signal) options.signal = signal;
    return apiRequest<T>('GET', path, options);
  },
  post: <T = void>(path: string, body?: unknown, schema?: ZodType<T>) => {
    const options: RequestOptions<T> = { body };
    if (schema) options.schema = schema;
    return apiRequest<T>('POST', path, options);
  },
  patch: <T = void>(path: string, body: unknown, schema?: ZodType<T>) => {
    const options: RequestOptions<T> = { body };
    if (schema) options.schema = schema;
    return apiRequest<T>('PATCH', path, options);
  },
  delete: (path: string) => apiRequest<void>('DELETE', path),
};

export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    const detail = error.details?.map((d) => d.message).join(' ');
    return detail ? `${error.message} ${detail}` : error.message;
  }
  return error instanceof Error ? error.message : 'Something went wrong.';
}
