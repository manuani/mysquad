/**
 * Admin user management.
 *
 * Operates across all tenants without RLS — uses adminQuery exclusively.
 * Protected at the router level by x-admin-key middleware.
 */

import type { PostgresClient } from '@voai/db';

export type UserRole = 'founder' | 'admin' | 'expert';

export interface UserSummary {
  readonly userId: string;
  readonly tenantId: string;
  readonly tenantName: string;
  readonly email: string;
  readonly role: UserRole;
  readonly active: boolean;
  readonly createdAt: string;
}

export interface UserListResult {
  readonly users: UserSummary[];
  readonly total: number;
}

export async function listUsersInTenant(
  postgres: PostgresClient,
  tenantId: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<UserListResult> {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;

  const rows = await postgres.adminQuery<Record<string, unknown>>(
    `SELECT
       u.id         AS user_id,
       u.tenant_id,
       t.name       AS tenant_name,
       u.email,
       u.user_type  AS role,
       u.active,
       u.created_at
     FROM users u
     JOIN tenants t ON t.id = u.tenant_id
     WHERE u.tenant_id = $1
     ORDER BY u.created_at DESC
     LIMIT $2 OFFSET $3`,
    [tenantId, limit, offset],
  );

  const countRows = await postgres.adminQuery<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM users WHERE tenant_id = $1',
    [tenantId],
  );

  return {
    users: rows.map(toUserSummary),
    total: parseInt(countRows[0]?.['count'] ?? '0', 10),
  };
}

function toUserSummary(row: Record<string, unknown>): UserSummary {
  return {
    userId: row['user_id'] as string,
    tenantId: row['tenant_id'] as string,
    tenantName: row['tenant_name'] as string,
    email: row['email'] as string,
    role: row['role'] as UserRole,
    active: row['active'] as boolean,
    createdAt: (row['created_at'] as Date).toISOString(),
  };
}

export interface InviteUserInput {
  readonly tenantId: string;
  readonly email: string;
  readonly role: UserRole;
}

/**
 * Creates a new user in the given tenant. In production this would also
 * trigger a magic-link invitation email; for now it inserts the row and
 * returns an invite token the caller can distribute out-of-band.
 */
export async function inviteUser(
  postgres: PostgresClient,
  input: InviteUserInput,
): Promise<{ userId: string; email: string; role: UserRole; inviteToken: string }> {
  const rows = await postgres.adminQuery<Record<string, unknown>>(
    `INSERT INTO users (tenant_id, email, user_type)
     VALUES ($1, $2, $3)
     ON CONFLICT (tenant_id, email) DO UPDATE
       SET user_type = EXCLUDED.user_type,
           active    = true
     RETURNING id, email, user_type`,
    [input.tenantId, input.email.toLowerCase(), input.role],
  );
  const row = rows[0]!;
  // Deterministic invite token — in production swap for a signed JWT or
  // a Secrets-Manager-stored random token sent via email.
  const inviteToken = Buffer.from(`${row['id']}:${input.tenantId}:invite`).toString('base64url');
  return {
    userId: row['id'] as string,
    email: row['email'] as string,
    role: row['user_type'] as UserRole,
    inviteToken,
  };
}

export async function changeUserRole(
  postgres: PostgresClient,
  tenantId: string,
  userId: string,
  role: UserRole,
): Promise<UserSummary | null> {
  const rows = await postgres.adminQuery<Record<string, unknown>>(
    `UPDATE users SET user_type = $1
     WHERE id = $2 AND tenant_id = $3
     RETURNING id AS user_id, tenant_id, '' AS tenant_name, email, user_type AS role,
               active, created_at`,
    [role, userId, tenantId],
  );
  if (!rows[0]) return null;
  return toUserSummary({ ...rows[0], tenant_name: '' });
}

export async function deactivateUser(
  postgres: PostgresClient,
  tenantId: string,
  userId: string,
): Promise<boolean> {
  // Revoke all active auth sessions immediately
  await postgres.adminQuery(
    `UPDATE auth_sessions SET revoked_at = now()
     WHERE user_id = $1 AND tenant_id = $2 AND revoked_at IS NULL`,
    [userId, tenantId],
  );

  const rows = await postgres.adminQuery<{ id: string }>(
    `UPDATE users SET active = false
     WHERE id = $1 AND tenant_id = $2
     RETURNING id`,
    [userId, tenantId],
  );
  return rows.length > 0;
}
