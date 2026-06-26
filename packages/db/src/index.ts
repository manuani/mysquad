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

export interface PostgresClient {
  // pg.Pool surface — pinned in Sprint 1.1.2
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
