import { describe, expect, it } from 'vitest';
import {
  ConflictError,
  ForbiddenError,
  isPlatformError,
  NotFoundError,
  PlatformError,
  ProviderUnavailableError,
  RateLimitedError,
  TenantViolationError,
  UnauthenticatedError,
  ValidationError,
} from '../src/index.js';

describe('error hierarchy', () => {
  it('all subclasses are instanceof PlatformError and have correct httpStatus', () => {
    const cases: Array<[PlatformError, number, string]> = [
      [new UnauthenticatedError(), 401, 'UNAUTHENTICATED'],
      [new ForbiddenError(), 403, 'FORBIDDEN'],
      [new NotFoundError(), 404, 'NOT_FOUND'],
      [new ValidationError('bad'), 400, 'VALIDATION_FAILED'],
      [new ConflictError('clash'), 409, 'CONFLICT'],
      [new TenantViolationError(), 403, 'TENANT_VIOLATION'],
      [new ProviderUnavailableError('anthropic'), 503, 'PROVIDER_UNAVAILABLE'],
      [new RateLimitedError(), 429, 'RATE_LIMITED'],
    ];
    for (const [err, status, code] of cases) {
      expect(err).toBeInstanceOf(PlatformError);
      expect(err.httpStatus).toBe(status);
      expect(err.code).toBe(code);
      expect(isPlatformError(err)).toBe(true);
    }
  });

  it('isPlatformError returns false for plain Error', () => {
    expect(isPlatformError(new Error('plain'))).toBe(false);
    expect(isPlatformError('string')).toBe(false);
    expect(isPlatformError(null)).toBe(false);
  });
});
