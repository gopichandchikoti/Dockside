import { HTTP_STATUS_FOR_CODE, type ApiErrorBody, type ErrorCode } from '@dockside/shared';
import type { ZodError } from 'zod';

export interface ErrorDetail {
  path: string;
  message: string;
}

export class AppError extends Error {
  /** Fastify and its plugins read `statusCode` from thrown errors. */
  readonly statusCode: number;

  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: ErrorDetail[],
  ) {
    super(message);
    this.name = 'AppError';
    this.statusCode = HTTP_STATUS_FOR_CODE[code];
  }
}

export const errors = {
  badRequest: (message: string, details?: ErrorDetail[]) => new AppError('bad_request', message, details),
  unauthenticated: () => new AppError('unauthenticated', 'Sign in to continue.'),
  forbidden: () => new AppError('forbidden', 'Your role does not allow this action.'),
  notFound: (what: string) => new AppError('not_found', `${what} was not found.`),
  conflict: (message: string) => new AppError('conflict', message),
  disabled: (message: string) => new AppError('feature_disabled', message),
  upstream: (message: string) => new AppError('upstream_unavailable', message),
};

export function zodDetails(error: ZodError): ErrorDetail[] {
  return error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
}

export function toErrorBody(error: AppError, requestId: string): ApiErrorBody {
  const body: ApiErrorBody = { error: { code: error.code, message: error.message, requestId } };
  if (error.details) body.error.details = error.details;
  return body;
}

export function parseWith<T>(
  schema: { safeParse(input: unknown): { success: true; data: T } | { success: false; error: ZodError } },
  input: unknown,
): T {
  const result = schema.safeParse(input);
  if (!result.success) throw errors.badRequest('The request was not valid.', zodDetails(result.error));
  return result.data;
}
