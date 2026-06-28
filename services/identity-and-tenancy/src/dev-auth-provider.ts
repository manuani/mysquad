/**
 * DevAuthProvider — NOT production auth.
 *
 * Implements the `AuthProvider` interface (auth-provider.ts) without
 * calling any real OAuth provider. No real WorkOS account/credentials are
 * available in this environment (Deliverable 1.2.1 scope note), so this
 * exercises the same contract a `WorkosAuthProvider` will implement later:
 * accepts an email and a claimed sign-in method, creates/finds a
 * tenant+user via `@voai/db`, and issues a session token recorded in the
 * `auth_sessions` table (packages/db/migrations/1750000000001_identity_and_tenancy.sql).
 *
 * What this deliberately does NOT do, because it is not the real thing:
 *   - No OAuth redirect/callback flow, no Apple/Google/Microsoft token
 *     verification, no magic-link email delivery.
 *   - `method` is trusted as given by the caller, not verified against an
 *     identity provider.
 *   - Session tokens are random bytes hashed with SHA-256, not a signed
 *     JWT — adequate for a single-process dev/test environment, not for
 *     production key rotation or cross-service verification.
 *
 * The next session's work (once WorkOS credentials exist) is a
 * `WorkosAuthProvider` that implements the same `AuthProvider` interface;
 * `routes.ts` and everything downstream of `AuthProvider` does not change.
 */

import { createHash, randomBytes } from 'node:crypto';
import type { PostgresClient } from '@voai/db';
import { ConflictError, NotFoundError } from '@voai/errors';
import type { AuthProvider, AuthResult, SignInMethod } from './auth-provider.js';
import { createTenantWithFounder, findUserByEmailAcrossTenants, SYSTEM_TENANT } from './tenancy.js';

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface AuthSessionSqlRow {
  id: string;
  tenant_id: string;
  user_id: string;
  expires_at: string;
  revoked_at: string | null;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function issueRawToken(): string {
  return randomBytes(32).toString('hex');
}

export class DevAuthProvider implements AuthProvider {
  constructor(private readonly postgres: PostgresClient) {}

  async signUp(email: string, method: SignInMethod): Promise<AuthResult> {
    const existing = await findUserByEmailAcrossTenants(this.postgres, email);
    if (existing) {
      throw new ConflictError(`a user already exists for ${email}`, { email });
    }

    const tenantName = `${email}'s workspace`;
    const { tenant, user } = await createTenantWithFounder(this.postgres, tenantName, email);

    return this.issueSession(tenant.id, user.id, user.userType, method);
  }

  async signIn(email: string, method: SignInMethod): Promise<AuthResult> {
    const existing = await findUserByEmailAcrossTenants(this.postgres, email);
    if (!existing) {
      throw new NotFoundError(`no user found for ${email}`, { email });
    }
    const { tenant, user } = existing;
    return this.issueSession(tenant.id, user.id, user.userType, method);
  }

  /**
   * Two-step lookup, not one: `auth_sessions` has FORCE RLS keyed on
   * `tenant_id = current_setting('app.tenant_id')`. Querying it scoped to
   * `SYSTEM_TENANT` returns zero rows for every real session — confirmed
   * broken end to end against the live stack. `auth_session_tenant_index`
   * (no RLS, maps token_hash -> tenant_id only) resolves the tenant first;
   * the real session row is then fetched scoped to that tenant, where RLS
   * correctly allows it through.
   */
  async resolveSession(sessionToken: string): Promise<AuthResult | null> {
    const tokenHash = hashToken(sessionToken);

    const indexRow = await this.postgres.withTenant(SYSTEM_TENANT, async (client) => {
      const result = await client.query<{ tenant_id: string; expires_at: string }>(
        'select tenant_id, expires_at from auth_session_tenant_index where token_hash = $1',
        [tokenHash],
      );
      return result.rows[0] ?? null;
    });
    if (!indexRow) return null;
    if (new Date(indexRow.expires_at).getTime() <= Date.now()) return null;

    return this.postgres.withTenant(indexRow.tenant_id, async (client) => {
      const result = await client.query<AuthSessionSqlRow>(
        `select id, tenant_id, user_id, expires_at, revoked_at
         from auth_sessions
         where token_hash = $1`,
        [tokenHash],
      );
      const row = result.rows[0];
      if (!row) return null;
      if (row.revoked_at) return null;
      if (new Date(row.expires_at).getTime() <= Date.now()) return null;

      const userResult = await client.query<{ user_type: 'founder' | 'admin' | 'expert' }>(
        'select user_type from users where id = $1',
        [row.user_id],
      );
      const userRow = userResult.rows[0];
      if (!userRow) return null;

      return {
        sessionToken,
        tenantId: row.tenant_id,
        userId: row.user_id,
        userType: userRow.user_type,
        expiresAt: row.expires_at,
      };
    });
  }

  async signOut(sessionToken: string): Promise<void> {
    const tokenHash = hashToken(sessionToken);

    const indexRow = await this.postgres.withTenant(SYSTEM_TENANT, async (client) => {
      const result = await client.query<{ tenant_id: string }>(
        'select tenant_id from auth_session_tenant_index where token_hash = $1',
        [tokenHash],
      );
      return result.rows[0] ?? null;
    });
    if (!indexRow) return;

    await this.postgres.withTenant(indexRow.tenant_id, async (client) => {
      await client.query('update auth_sessions set revoked_at = now() where token_hash = $1 and revoked_at is null', [
        tokenHash,
      ]);
    });
  }

  private async issueSession(
    tenantId: string,
    userId: string,
    userType: 'founder' | 'admin' | 'expert',
    method: SignInMethod,
  ): Promise<AuthResult> {
    const sessionToken = issueRawToken();
    const tokenHash = hashToken(sessionToken);
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();

    await this.postgres.withTenant(tenantId, async (client) => {
      await client.query(
        `insert into auth_sessions (tenant_id, user_id, token_hash, sign_in_method, expires_at)
         values ($1, $2, $3, $4, $5)`,
        [tenantId, userId, tokenHash, method, expiresAt],
      );
    });

    // Mirrors the index write in tenancy.ts's createTenantWithFounder: the
    // non-RLS auth_session_tenant_index is what makes resolveSession/signOut
    // able to discover this session's tenant before they're allowed to see
    // anything in the RLS-protected auth_sessions table.
    await this.postgres.withTenant(SYSTEM_TENANT, async (client) => {
      await client.query(
        'insert into auth_session_tenant_index (token_hash, tenant_id, expires_at) values ($1, $2, $3)',
        [tokenHash, tenantId, expiresAt],
      );
    });

    return { sessionToken, tenantId, userId, userType, expiresAt };
  }
}
