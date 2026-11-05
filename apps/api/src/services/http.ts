import { HttpUrlSchema } from '@dockside/shared';
import { errors } from '../errors';

export async function boundedRequest(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    maxBytes?: number;
    timeoutMs?: number;
  } = {},
): Promise<{ body: Buffer; status: number }> {
  const parsed = HttpUrlSchema.safeParse(url);
  if (!parsed.success) throw errors.badRequest('Invalid network destination.');
  const response = await fetch(parsed.data, {
    method: options.method ?? 'GET',
    headers: options.headers ?? {},
    ...(options.body === undefined ? {} : { body: options.body }),
    redirect: 'error',
    signal: AbortSignal.timeout(options.timeoutMs ?? 5000),
  });
  const max = options.maxBytes ?? 5 * 1024 * 1024;
  return { body: await readBody(response, max), status: response.status };
}
async function readBody(response: Response, max: number): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      const value: unknown = item.value;
      if (!(value instanceof Uint8Array)) throw errors.upstream('Invalid upstream body.');
      size += value.byteLength;
      if (size > max) throw errors.upstream('Upstream response exceeded the byte limit.');
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks);
}
