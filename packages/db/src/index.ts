/**
 * Database clients — Postgres (with pgvector), Neo4j, Redis.
 *
 * The platform uses three stores per Strategic Vision and Architecture:
 *   - Postgres (with pgvector) — structured business state and semantic memory
 *   - Neo4j AuraDB — relationship graph
 *   - Redis — hot cache for real-time contradiction checks (P95 < 1s requirement)
 *
 * Concrete client wiring (pg.Pool, neo4j-driver, ioredis) lands in Sprint 1.1.2
 * (Local development environment). This file currently exposes the type-level
 * contract so other modules can compile against it.
 */

export interface DatabaseClients {
  readonly postgres: PostgresClient;
  readonly neo4j: Neo4jClient;
  readonly redis: RedisClient;
  readonly close: () => Promise<void>;
}

/**
 * Postgres access is only available inside `withTenant`. There is no raw
 * `query` method on `PostgresClient` — per System Architecture §8.1.1 layer
 * 3, the database connection acquired for a request must have its
 * session-level `app.tenant_id` setting applied immediately on acquisition,
 * before any query runs. Exposing a bare `query` method would make it
 * possible to issue a query against a connection that never had
 * `app.tenant_id` set, which is exactly the bypass layer 3 exists to close
 * (verification backlog Issue 6).
 *
 * `withTenant` acquires a pool connection, runs `SET LOCAL app.tenant_id =
 * $1`, runs `fn` with a `TenantScopedClient` bound to that connection, then
 * releases the connection — `SET LOCAL` is transaction-scoped so the setting
 * never leaks to the next connection borrower.
 */
export interface PostgresClient {
  withTenant<T>(tenantId: string, fn: (client: TenantScopedClient) => Promise<T>): Promise<T>;
}

/**
 * Only obtainable inside a `withTenant` callback. Row-level security
 * policies (layer 4) read `current_setting('app.tenant_id')`, which this
 * client's underlying connection has set for the duration of the callback.
 */
export interface TenantScopedClient {
  query<T = unknown>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface Neo4jClient {
  // neo4j-driver Driver surface — pinned in Sprint 1.1.2
  session(): Neo4jSession;
}

export interface Neo4jSession {
  run(cypher: string, params?: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}

export interface RedisClient {
  // ioredis surface — pinned in Sprint 1.1.2
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode?: 'EX', ttlSeconds?: number): Promise<unknown>;
  del(key: string): Promise<number>;
}

export interface DatabaseConfig {
  readonly databaseUrl: string;
  readonly neo4jUri: string;
  readonly neo4jUser: string;
  readonly neo4jPassword: string;
  readonly redisUrl: string;
}

/**
 * Construct database clients. v1 implementation TBD in Sprint 1.1.2.
 */
export function createDatabaseClients(_config: DatabaseConfig): DatabaseClients {
  throw new Error('Not yet implemented — see Sprint 1.1.2');
}
