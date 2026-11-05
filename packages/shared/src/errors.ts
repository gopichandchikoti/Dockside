import { z } from 'zod';

export const ERROR_CODES = [
  'bad_request',
  'unauthenticated',
  'forbidden',
  'not_found',
  'conflict',
  'rate_limited',
  'csrf_failed',
  'setup_closed',
  'setup_unavailable',
  'feature_disabled',
  'upstream_unavailable',
  'internal',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES),
    message: z.string(),
    requestId: z.string().optional(),
    details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  }),
});

export type ApiErrorBody = z.infer<typeof ApiErrorSchema>;

export const HTTP_STATUS_FOR_CODE: Record<ErrorCode, number> = {
  bad_request: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  csrf_failed: 403,
  setup_closed: 409,
  setup_unavailable: 503,
  feature_disabled: 403,
  upstream_unavailable: 502,
  internal: 500,
};
