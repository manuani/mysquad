/**
 * Neo4j graph indexing for expert domain knowledge.
 *
 * Maintains a graph of Expert nodes linked to Domain nodes via HAS_DOMAIN
 * relationships. This enables graph-aware queries (e.g. "experts who share
 * domain knowledge with the startup's problem space") in Phase 4 when
 * vector similarity replaces token-overlap in matching.ts.
 *
 * Schema:
 *   (:Expert {id, tenantId, name})
 *   (:Domain {name})
 *   (:Expert)-[:HAS_DOMAIN {confidence: float}]->(:Domain)
 *
 * All writes are idempotent (MERGE) so re-indexing is safe.
 * Gracefully degrades to no-op when neo4jClient is absent (unit tests).
 */

import type { Neo4jClient } from '@voai/db';
import type { TenantContext } from '@voai/auth-context';
import type { ExpertWithTags } from './experts.js';

export interface GraphClient {
  readonly neo4j: Neo4jClient | null;
}

/**
 * Index (or re-index) an expert's domain tags into Neo4j.
 * Called after createExpert / addExpertDomainTag.
 */
export async function indexExpertDomains(
  tc: TenantContext,
  graphClient: GraphClient,
  expert: ExpertWithTags,
): Promise<void> {
  if (!graphClient.neo4j) return;

  const session = graphClient.neo4j.session();
  try {
    // Upsert Expert node
    await session.run(
      `MERGE (e:Expert {id: $id})
       SET e.tenantId = $tenantId, e.name = $name`,
      { id: expert.id, tenantId: tc.tenantId, name: expert.name },
    );

    // Upsert each Domain node and HAS_DOMAIN relationship
    for (const tag of expert.domainTags) {
      await session.run(
        `MERGE (d:Domain {name: $domain})
         WITH d
         MATCH (e:Expert {id: $expertId})
         MERGE (e)-[r:HAS_DOMAIN]->(d)
         SET r.confidence = $confidence`,
        { domain: tag.domain, expertId: expert.id, confidence: tag.confidence },
      );
    }
  } finally {
    await session.close();
  }
}

/**
 * Find experts who share domain nodes with the given topic tokens.
 * Returns expert IDs ranked by sum of confidence across matching domains.
 * Used as a graph-backed complement to token-overlap scoring in matching.ts.
 */
export async function graphMatchExperts(
  tc: TenantContext,
  graphClient: GraphClient,
  topicTokens: string[],
  topK = 5,
): Promise<Array<{ expertId: string; graphScore: number }>> {
  if (!graphClient.neo4j || topicTokens.length === 0) return [];

  const session = graphClient.neo4j.session();
  try {
    const result = (await session.run(
      `UNWIND $tokens AS tok
       MATCH (d:Domain) WHERE toLower(d.name) CONTAINS toLower(tok)
       MATCH (e:Expert {tenantId: $tenantId})-[r:HAS_DOMAIN]->(d)
       RETURN e.id AS expertId, SUM(r.confidence) AS graphScore
       ORDER BY graphScore DESC
       LIMIT $topK`,
      { tokens: topicTokens, tenantId: tc.tenantId, topK: topK },
    )) as { records: Array<{ get(key: string): unknown }> };
    return result.records.map((rec) => ({
      expertId: rec.get('expertId') as string,
      graphScore: (rec.get('graphScore') as number) ?? 0,
    }));
  } finally {
    await session.close();
  }
}

/**
 * Remove an expert's nodes and relationships from the graph.
 * Called when an expert is deleted (future endpoint).
 */
export async function removeExpertFromGraph(
  graphClient: GraphClient,
  expertId: string,
): Promise<void> {
  if (!graphClient.neo4j) return;

  const session = graphClient.neo4j.session();
  try {
    await session.run(`MATCH (e:Expert {id: $expertId}) DETACH DELETE e`, { expertId });
  } finally {
    await session.close();
  }
}
