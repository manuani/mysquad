/**
 * Tenant and user context.
 *
 * Per System Architecture §8.1.1 layer 2: "The context is propagated through
 * async work via explicit context parameters; no implicit globals." This
 * package defines the value type and threads it explicitly — it does not
 * carry context through any implicit side channel (no AsyncLocalStorage, no
 * module-level mutable state).
 *
 * The API gateway extracts a TenantContext from the session token at the top
 * of every request and passes it explicitly into every handler and every
 * internal service call from there. Background jobs extract it from the job
 * payload. There is no "current context" to read from ambient state — if a
 * function needs it, it appears in that function's parameter list.
 *
 * See docs/adr/007-explicit-tenant-context.md for the decision record
 * superseding ADR 006 (AsyncLocalStorage), which violated this mandate.
 */

export interface TenantContext {
  readonly tenantId: string;
  readonly userId: string;
  readonly userType: 'founder' | 'admin' | 'expert';
  readonly sessionId: string;
}

export class MissingTenantContextError extends Error {
  constructor(detail: string) {
    super(`Missing or invalid tenant context: ${detail}`);
    this.name = 'MissingTenantContextError';
  }
}

/**
 * Builds a TenantContext from raw fields, validating presence of every
 * required field. Use this at the one boundary per request/job where the
 * context is constructed (gateway middleware, job runner) — everywhere else
 * receives the already-validated value as a parameter.
 */
export function buildTenantContext(fields: {
  tenantId?: string | null;
  userId?: string | null;
  userType?: string | null;
  sessionId?: string | null;
}): TenantContext {
  const { tenantId, userId, userType, sessionId } = fields;
  if (!tenantId) throw new MissingTenantContextError('tenantId');
  if (!userId) throw new MissingTenantContextError('userId');
  if (!sessionId) throw new MissingTenantContextError('sessionId');
  if (userType !== 'founder' && userType !== 'admin' && userType !== 'expert') {
    throw new MissingTenantContextError(`userType must be founder|admin|expert, got ${String(userType)}`);
  }
  return { tenantId, userId, userType, sessionId };
}
