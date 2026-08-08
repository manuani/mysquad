import pg from 'pg';
import type { PostgresClient, TenantScopedClient } from './index.js';

const { Pool } = pg;

/**
 * Real `PostgresClient` backed by `pg.Pool`.
 *
 * `withTenant` implements System Architecture §8.1.1 layer 3 exactly:
 * acquire a connection, set `app.tenant_id` for the duration of one
 * transaction, run the callback, commit (or roll back on error), release
 * the connection back to the pool.
 *
 * `SET LOCAL app.tenant_id = $1` is not valid — `SET` does not accept
 * query parameters. `select set_config('app.tenant_id', $1, true)` is the
 * parameterized equivalent: the third argument (`true`) makes it
 * transaction-local, same as `SET LOCAL`, and the tenant id is bound as a
 * real parameter rather than interpolated into the SQL text.
 */
export function createPostgresClient(databaseUrl: string): {
  client: PostgresClient;
  close: () => Promise<void>;
} {
  // RDS and other managed Postgres services use AWS/cloud-provider CA chains
  // that Node's TLS stack doesn't trust by default. Accept their certs without
  // CA verification — traffic stays private inside the VPC, so this is safe.
  const ssl = databaseUrl.includes('rds.amazonaws.com') ? { rejectUnauthorized: false } : undefined;
  const pool = new Pool({ connectionString: databaseUrl, ssl });
  // Separate pool for cross-tenant admin queries — uses BYPASSRLS superuser.
  // Falls back to the app pool if not configured (dev environments where
  // voai_app is also superuser or RLS is not enforced for the user role).
  const adminUrl = process.env['ADMIN_DATABASE_URL'] ?? process.env['MIGRATIONS_DATABASE_URL'] ?? databaseUrl;
  const adminSsl = adminUrl.includes('rds.amazonaws.com') ? { rejectUnauthorized: false } : undefined;
  const adminPool = new Pool({ connectionString: adminUrl, ssl: adminSsl });

  const client: PostgresClient = {
    async withTenant<T>(
      tenantId: string,
      fn: (scoped: TenantScopedClient) => Promise<T>,
    ): Promise<T> {
      const conn = await pool.connect();
      try {
        await conn.query('BEGIN');
        await conn.query("select set_config('app.tenant_id', $1, true)", [tenantId]);

        const scoped: TenantScopedClient = {
          query: async <R = unknown>(text: string, params?: unknown[]) => {
            const result = await conn.query(text, params as unknown[]);
            return { rows: result.rows as R[] };
          },
        };

        const result = await fn(scoped);
        await conn.query('COMMIT');
        return result;
      } catch (err) {
        await conn.query('ROLLBACK').catch(() => {
          // Connection may already be broken; ROLLBACK failing here is not
          // the error we want to surface — the original `err` is.
        });
        throw err;
      } finally {
        conn.release();
      }
    },

    async adminQuery<R = unknown>(text: string, params?: unknown[]): Promise<R[]> {
      const result = await adminPool.query(text, params as unknown[]);
      return result.rows as R[];
    },
  };

  return { client, close: () => Promise.all([pool.end(), adminPool.end()]).then(() => undefined) };
}
