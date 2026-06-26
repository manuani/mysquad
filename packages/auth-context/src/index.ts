/**
 * Tenant and user context propagation.
 *
 * Uses Node's AsyncLocalStorage to carry the active tenant and user through
 * async call chains without threading parameters everywhere. Every database
 * query, event publish, and outbound call reads tenantId from this context;
 * code that reaches around it is the failure mode that Sprint 1.2.2 boundary
 * tests must catch.
 *
 * The API gateway populates the context from the session token at the top of
 * every request. Background jobs (extraction, metering, evaluation) populate
 * it from the job payload before doing any work.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

export interface AuthContext {
  readonly tenantId: string;
  readonly userId: string;
  readonly userType: 'founder' | 'admin' | 'expert';
  readonly sessionId: string;
}

const storage = new AsyncLocalStorage<AuthContext>();

export function withAuthContext<T>(ctx: AuthContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function currentAuthContext(): AuthContext | undefined {
  return storage.getStore();
}

/**
 * Throws TenantViolationError if no auth context is present. Use this at the
 * top of any function that touches tenant-scoped data.
 */
export function requireAuthContext(): AuthContext {
  const ctx = storage.getStore();
  if (!ctx) {
    throw new Error('No auth context — refusing to access tenant-scoped resources');
  }
  return ctx;
}
