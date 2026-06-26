/**
 * Database clients — Postgres (with pgvector), Neo4j, Redis, object store.
 *
 * The platform uses five stores per Strategic Vision and System
 * Architecture §4.1:
 *   - Postgres (with pgvector) — structured business state and semantic memory
 *   - Neo4j AuraDB — relationship graph
 *   - Redis — hot cache for real-time contradiction checks (P95 < 1s requirement)
 *   - Object store (S3/GCS-compatible, §4.2.4) — recordings, documents, exports
 *
 * (Vector storage is pgvector, inside Postgres — not a fifth client.)
 *
 * Concrete client wiring (pg.Pool, neo4j-driver, ioredis,
 * @aws-sdk/client-s3) lands in Sprint 1.1.2 (Local development
 * environment). This file currently exposes the type-level contract so
 * other modules can compile against it.
 */

export interface DatabaseClients {
  readonly postgres: PostgresClient;
  readonly neo4j: Neo4jClient;
  readonly redis: RedisClient;
  readonly objectStore: ObjectStoreClient;
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

/**
 * S3/GCS-compatible object store (System Architecture §4.2.4) for
 * recordings, uploaded documents, and async exports (brain JSON, ledger
 * CSV, brain-summary PDF).
 *
 * Keys are tenant-prefixed per §4.2.4: `{tenantId}/{sessionId}/...`. Use
 * `tenantObjectKey` to build them consistently rather than concatenating
 * strings at each call site — every key built this way is automatically
 * scoped to one tenant's prefix, which is what the bucket policy and any
 * cross-tenant audit tooling key off.
 */
export interface ObjectStoreClient {
  getObject(key: string): Promise<{ body: Uint8Array; contentType: string }>;
  putObject(key: string, body: Uint8Array | Buffer, contentType: string): Promise<void>;
  deleteObject(key: string): Promise<void>;
  presignGetUrl(key: string, expiresInSeconds: number): Promise<string>;
  presignPutUrl(key: string, expiresInSeconds: number, contentType: string): Promise<string>;
}

/**
 * Builds a tenant-prefixed object key: `{tenantId}/{sessionId}/{path}`.
 * `sessionId` is optional for tenant-scoped artifacts that are not tied to
 * a single meeting session (e.g. an export or an uploaded onboarding
 * document) — in that case the key is `{tenantId}/{path}`.
 */
export function tenantObjectKey(tenantId: string, path: string, sessionId?: string): string {
  return sessionId ? `${tenantId}/${sessionId}/${path}` : `${tenantId}/${path}`;
}

export interface DatabaseConfig {
  readonly databaseUrl: string;
  readonly neo4jUri: string;
  readonly neo4jUser: string;
  readonly neo4jPassword: string;
  readonly redisUrl: string;
  readonly objectStoreBucket: string;
  readonly objectStoreEndpoint?: string;
}

/**
 * Construct database clients. v1 implementation TBD in Sprint 1.1.2.
 */
export function createDatabaseClients(_config: DatabaseConfig): DatabaseClients {
  throw new Error('Not yet implemented — see Sprint 1.1.2');
}
