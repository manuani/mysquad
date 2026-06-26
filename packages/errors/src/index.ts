/**
 * Typed error hierarchy for the platform.
 *
 * Every thrown error in service code should be one of these types (or a subclass).
 * The API gateway maps these to HTTP responses; the audit log keys on the `code`
 * field; and tests assert on type rather than message.
 */

export type ErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_FAILED'
  | 'CONFLICT'
  | 'TENANT_VIOLATION'
  | 'PROVIDER_UNAVAILABLE'
  | 'RATE_LIMITED'
  | 'INTERNAL';

export class PlatformError extends Error {
  public readonly code: ErrorCode;
  public readonly httpStatus: number;
  public readonly details?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    httpStatus: number,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}

export class UnauthenticatedError extends PlatformError {
  constructor(message = 'Authentication required', details?: Record<string, unknown>) {
    super('UNAUTHENTICATED', 401, message, details);
  }
}

export class ForbiddenError extends PlatformError {
  constructor(message = 'Forbidden', details?: Record<string, unknown>) {
    super('FORBIDDEN', 403, message, details);
  }
}

export class NotFoundError extends PlatformError {
  constructor(message = 'Not found', details?: Record<string, unknown>) {
    super('NOT_FOUND', 404, message, details);
  }
}

export class ValidationError extends PlatformError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('VALIDATION_FAILED', 400, message, details);
  }
}

export class ConflictError extends PlatformError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('CONFLICT', 409, message, details);
  }
}

/**
 * Thrown when a request would cross tenant boundaries. This is the primary
 * defense against the multi-tenant isolation failures that Sprint 1.2.2
 * boundary tests must catch. Always logged at error level even when caught.
 */
export class TenantViolationError extends PlatformError {
  constructor(message = 'Cross-tenant access denied', details?: Record<string, unknown>) {
    super('TENANT_VIOLATION', 403, message, details);
  }
}

export class ProviderUnavailableError extends PlatformError {
  constructor(provider: string, details?: Record<string, unknown>) {
    super('PROVIDER_UNAVAILABLE', 503, `Provider ${provider} unavailable`, details);
  }
}

export class RateLimitedError extends PlatformError {
  constructor(message = 'Rate limit exceeded', details?: Record<string, unknown>) {
    super('RATE_LIMITED', 429, message, details);
  }
}

export function isPlatformError(err: unknown): err is PlatformError {
  return err instanceof PlatformError;
}
