import { beforeEach, describe, expect, it } from 'vitest';
import type { PostgresClient, TenantScopedClient } from '@voai/db';
import { ConflictError, NotFoundError } from '@voai/errors';
import { DevAuthProvider } from '../src/dev-auth-provider.js';

/**
 * In-memory fake standing in for Postgres, scoped to exactly the queries
 * dev-auth-provider.ts and tenancy.ts issue. This exercises the
 * `withTenant`-only access pattern (ADR 007 / packages/db README) without
 * a live database — the integration-level RLS guarantee itself is already
 * covered by packages/db/tests/integration/tenant-boundary.test.ts.
 */
function createFakePostgres(): PostgresClient {
  const tenants: { id: string; name: string; created_at: string }[] = [];
  const users: {
    id: string;
    tenant_id: string;
    email: string;
    user_type: 'founder' | 'admin' | 'expert';
    created_at: string;
  }[] = [];
  const authSessions: {
    id: string;
    tenant_id: string;
    user_id: string;
    token_hash: string;
    sign_in_method: string;
    expires_at: string;
    revoked_at: string | null;
  }[] = [];
  let counter = 0;
  const nextId = () => `id-${++counter}`;

  const client: TenantScopedClient = {
    async query<T = unknown>(text: string, params: unknown[] = []) {
      const sql = text.trim().toLowerCase();

      if (sql.startsWith('insert into tenants')) {
        const row = { id: nextId(), name: params[0] as string, created_at: new Date().toISOString() };
        tenants.push(row);
        return { rows: [row] as T[] };
      }

      if (sql.startsWith('insert into users')) {
        const row = {
          id: nextId(),
          tenant_id: params[0] as string,
          email: params[1] as string,
          user_type: 'founder' as const,
          created_at: new Date().toISOString(),
        };
        users.push(row);
        return { rows: [row] as T[] };
      }

      if (sql.startsWith('select id, tenant_id, email, user_type, created_at from users where email')) {
        const row = users.find((u) => u.email === params[0]);
        return { rows: (row ? [row] : []) as T[] };
      }

      if (sql.startsWith('select id, tenant_id, email, user_type, created_at from users where id')) {
        const row = users.find((u) => u.id === params[0]);
        return { rows: (row ? [row] : []) as T[] };
      }

      if (sql.startsWith('select id, name, created_at from tenants where id')) {
        const row = tenants.find((t) => t.id === params[0]);
        return { rows: (row ? [row] : []) as T[] };
      }

      if (sql.startsWith('insert into auth_sessions')) {
        const row = {
          id: nextId(),
          tenant_id: params[0] as string,
          user_id: params[1] as string,
          token_hash: params[2] as string,
          sign_in_method: params[3] as string,
          expires_at: params[4] as string,
          revoked_at: null,
        };
        authSessions.push(row);
        return { rows: [] as T[] };
      }

      if (sql.startsWith('select id, tenant_id, user_id, expires_at, revoked_at')) {
        const row = authSessions.find((s) => s.token_hash === params[0]);
        return { rows: (row ? [row] : []) as T[] };
      }

      if (sql.startsWith('select user_type from users where id')) {
        const row = users.find((u) => u.id === params[0]);
        return { rows: (row ? [{ user_type: row.user_type }] : []) as T[] };
      }

      if (sql.startsWith('update auth_sessions set revoked_at')) {
        const row = authSessions.find((s) => s.token_hash === params[0]);
        if (row) row.revoked_at = new Date().toISOString();
        return { rows: [] as T[] };
      }

      throw new Error(`fake postgres: unhandled query: ${text}`);
    },
  };

  return {
    async withTenant<T>(_tenantId: string, fn: (c: TenantScopedClient) => Promise<T>): Promise<T> {
      return fn(client);
    },
  };
}

describe('DevAuthProvider', () => {
  let provider: DevAuthProvider;

  beforeEach(() => {
    provider = new DevAuthProvider(createFakePostgres());
  });

  it('signUp creates a tenant and founder user and issues a session token', async () => {
    const result = await provider.signUp('founder@example.com', 'email_magic_link');

    expect(result.sessionToken).toBeTruthy();
    expect(result.userType).toBe('founder');
    expect(result.tenantId).toBeTruthy();
    expect(result.userId).toBeTruthy();
    expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('signUp rejects a duplicate email with ConflictError', async () => {
    await provider.signUp('dup@example.com', 'google');
    await expect(provider.signUp('dup@example.com', 'google')).rejects.toBeInstanceOf(ConflictError);
  });

  it('signIn resolves an existing user and issues a fresh session token', async () => {
    const signUpResult = await provider.signUp('signin@example.com', 'apple');
    const signInResult = await provider.signIn('signin@example.com', 'apple');

    expect(signInResult.tenantId).toBe(signUpResult.tenantId);
    expect(signInResult.userId).toBe(signUpResult.userId);
    expect(signInResult.sessionToken).not.toBe(signUpResult.sessionToken);
  });

  it('signIn throws NotFoundError for an unknown email', async () => {
    await expect(provider.signIn('nobody@example.com', 'microsoft')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('resolveSession returns the session for a valid token', async () => {
    const signUpResult = await provider.signUp('resolve@example.com', 'email_magic_link');
    const resolved = await provider.resolveSession(signUpResult.sessionToken);

    expect(resolved).not.toBeNull();
    expect(resolved?.tenantId).toBe(signUpResult.tenantId);
    expect(resolved?.userId).toBe(signUpResult.userId);
  });

  it('resolveSession returns null for an unknown token', async () => {
    const resolved = await provider.resolveSession('not-a-real-token');
    expect(resolved).toBeNull();
  });

  it('signOut revokes the session so resolveSession subsequently returns null', async () => {
    const signUpResult = await provider.signUp('signout@example.com', 'google');
    await provider.signOut(signUpResult.sessionToken);

    const resolved = await provider.resolveSession(signUpResult.sessionToken);
    expect(resolved).toBeNull();
  });

  it('signOut is idempotent', async () => {
    const signUpResult = await provider.signUp('idempotent@example.com', 'google');
    await provider.signOut(signUpResult.sessionToken);
    await expect(provider.signOut(signUpResult.sessionToken)).resolves.not.toThrow();
  });
});
