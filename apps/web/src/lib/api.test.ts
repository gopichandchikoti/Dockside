import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiError, api, describeError, setCsrfToken, setUnauthenticatedHandler } from './api';

function respond(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  setCsrfToken(null);
  setUnauthenticatedHandler(null);
});

describe('apiRequest', () => {
  it('sends the CSRF token on writes but not on reads', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respond(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    setCsrfToken('tok-123');
    await api.get('/api/v1/x');
    await api.post('/api/v1/x', { a: 1 });
    const [getInit, postInit] = fetchMock.mock.calls.map(
      (c) => c[1] as RequestInit & { headers: Record<string, string> },
    );
    expect(getInit?.headers['x-csrf-token']).toBeUndefined();
    expect(postInit?.headers['x-csrf-token']).toBe('tok-123');
    expect(postInit?.headers['content-type']).toBe('application/json');
    expect(postInit?.credentials).toBe('same-origin');
  });

  it('parses structured server errors including validation details', async () => {
    const body = {
      error: {
        code: 'bad_request',
        message: 'The request was not valid.',
        requestId: 'r1',
        details: [{ path: 'a', message: 'Too short.' }],
      },
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond(400, body)));
    const error = await api.post('/api/v1/x', {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'bad_request', status: 400, requestId: 'r1' });
    expect(describeError(error)).toBe('The request was not valid. Too short.');
  });

  it('maps unreadable error bodies to a generic internal error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>oops</html>', { status: 502 })));
    await expect(api.get('/api/v1/x')).rejects.toMatchObject({ code: 'internal', status: 502 });
  });

  it('reports network failures distinctly', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(api.get('/api/v1/x')).rejects.toMatchObject({ code: 'network', status: 0 });
  });

  it('rethrows aborts untouched', async () => {
    const abort = new DOMException('aborted', 'AbortError');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abort));
    await expect(api.get('/api/v1/x')).rejects.toBe(abort);
  });

  it('rejects responses that do not match the expected schema', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond(200, { n: 'not-a-number' })));
    await expect(api.get('/api/v1/x', z.object({ n: z.number() }))).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('returns validated data and handles 204', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(respond(200, { n: 4 }))
        .mockResolvedValueOnce(respond(204)),
    );
    await expect(api.get('/api/v1/x', z.object({ n: z.number() }))).resolves.toEqual({ n: 4 });
    await expect(api.delete('/api/v1/x')).resolves.toBeUndefined();
  });

  it('fires the unauthenticated handler except for the login endpoint', async () => {
    const handler = vi.fn();
    setUnauthenticatedHandler(handler);
    const body = { error: { code: 'unauthenticated', message: 'Sign in to continue.' } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond(401, body)));
    await api.get('/api/v1/hosts').catch(() => undefined);
    expect(handler).toHaveBeenCalledTimes(1);
    await api.post('/api/v1/login', {}).catch(() => undefined);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('describes non-API errors', () => {
    expect(describeError(new Error('boom'))).toBe('boom');
    expect(describeError('weird')).toBe('Something went wrong.');
  });
});
