import neo4j from 'neo4j-driver';
import type { Neo4jClient, Neo4jSession } from './index.js';

/**
 * Real `Neo4jClient` backed by `neo4j-driver`.
 *
 * Per System Architecture §4.2.3, each tenant has its own logical database
 * within the Neo4j cluster (or per-tenant labels/constraints below the
 * per-tenant-database limit). That tenant-scoping decision is made by the
 * caller when opening a session — this wrapper exposes the driver's
 * `session()` directly so callers can pass `{ database: tenantDatabaseName }`
 * or equivalent; it does not hardcode a single shared database.
 */
export function createNeo4jClient(
  uri: string,
  user: string,
  password: string,
): { client: Neo4jClient; close: () => Promise<void> } {
  const driver = neo4j.driver(uri, neo4j.auth.basic(user, password));

  const client: Neo4jClient = {
    session(): Neo4jSession {
      const session = driver.session();
      return {
        run: (cypher: string, params?: Record<string, unknown>) => session.run(cypher, params),
        close: () => session.close(),
      };
    },
  };

  return { client, close: () => driver.close() };
}
