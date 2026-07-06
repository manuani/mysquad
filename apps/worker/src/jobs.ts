/**
 * Job type definitions for the BullMQ worker.
 *
 * Every job payload is versioned so future schema changes can be handled
 * gracefully in the processor without breaking in-flight jobs.
 */

export type BrainIndexJobData = {
  readonly version: 1;
  readonly tenantId: string;
  readonly userId: string;
  readonly itemId: string;
  readonly domain: string;
  readonly content: string;
  readonly language: string;
  readonly source: string;
};

export type Neo4jGraphJobData = {
  readonly version: 1;
  readonly tenantId: string;
  readonly userId: string;
  readonly itemId: string;
  readonly domain: string;
  /** Relationship edges to upsert into the graph. */
  readonly edges: ReadonlyArray<{
    readonly fromLabel: string;
    readonly fromId: string;
    readonly toLabel: string;
    readonly toId: string;
    readonly relationship: string;
  }>;
};

export type JobData = BrainIndexJobData | Neo4jGraphJobData;

export const QUEUE_BRAIN_INDEX = 'brain-index' as const;
export const QUEUE_NEO4J_GRAPH = 'neo4j-graph' as const;
export const QUEUE_DLQ = 'dead-letter' as const;

export type QueueName = typeof QUEUE_BRAIN_INDEX | typeof QUEUE_NEO4J_GRAPH | typeof QUEUE_DLQ;
