/**
 * Processes neo4j-graph jobs: upserts relationship edges into the Neo4j
 * knowledge graph without blocking the API response.
 *
 * Uses MERGE so repeated delivery of the same job is idempotent.
 */

import type { Job } from 'bullmq';
import type { Logger } from '@voai/types';
import type { Neo4jClient } from '@voai/db';
import type { Neo4jGraphJobData } from './jobs.js';

export type { Neo4jClient };

export async function processNeo4jGraph(
  job: Job<Neo4jGraphJobData>,
  neo4j: Neo4jClient,
  log: Logger,
): Promise<void> {
  const { tenantId, edges } = job.data;
  log.info('neo4j-graph: processing', { jobId: job.id, tenantId, edgeCount: edges.length });

  const session = neo4j.session();
  try {
    for (const edge of edges) {
      await session.run(
        `MERGE (a:${edge.fromLabel} {id: $fromId, tenantId: $tenantId})
         MERGE (b:${edge.toLabel}  {id: $toId,   tenantId: $tenantId})
         MERGE (a)-[r:${edge.relationship}]->(b)
         ON CREATE SET r.createdAt = datetime()`,
        {
          fromId: edge.fromId,
          toId: edge.toId,
          tenantId,
        },
      );
    }
  } finally {
    await session.close();
  }

  log.info('neo4j-graph: done', { jobId: job.id, edgeCount: edges.length });
}
