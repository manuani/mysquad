/**
 * BullMQ Worker setup.
 *
 * Each queue gets its own Worker instance. Failed jobs after all retries
 * are forwarded to the DLQ queue so they can be inspected and replayed
 * without being silently dropped.
 *
 * Retry strategy: exponential backoff starting at 1 s, doubling up to
 * 5 retries (max ~16 s between attempts). Jobs that exhaust retries land
 * in the DLQ.
 */

import { Worker, Queue, type Job } from 'bullmq';
import type { PostgresClient, Neo4jClient } from '@voai/db';
import type { Logger } from '@voai/types';
import type { default as IORedis } from 'ioredis';
import { processBrainIndex } from './brain-index-processor.js';
import { processNeo4jGraph } from './neo4j-graph-processor.js';
import type { BrainIndexJobData, Neo4jGraphJobData } from './jobs.js';
import { QUEUE_BRAIN_INDEX, QUEUE_NEO4J_GRAPH, QUEUE_DLQ } from './jobs.js';

const RETRY_ATTEMPTS = 5;

function backoffMs(attemptsMade: number): number {
  return Math.min(1000 * Math.pow(2, attemptsMade - 1), 30_000);
}

export function startWorkers(opts: {
  connection: IORedis;
  postgres: PostgresClient;
  neo4j: Neo4jClient;
  log: Logger;
}): { close(): Promise<void> } {
  const { connection, postgres, neo4j, log } = opts;

  const dlqQueue = new Queue(QUEUE_DLQ, { connection });

  async function forwardToDlq(job: Job, err: Error): Promise<void> {
    await dlqQueue.add(
      job.name,
      { originalQueue: job.queueName, payload: job.data, error: String(err), failedAt: new Date().toISOString() },
      { removeOnComplete: false },
    );
    log.warn('job moved to DLQ', { jobId: job.id, queue: job.queueName, error: String(err) });
  }

  const workerOpts = {
    connection,
    attempts: RETRY_ATTEMPTS,
    backoff: { type: 'custom' as const },
  };

  const brainWorker = new Worker<BrainIndexJobData>(
    QUEUE_BRAIN_INDEX,
    async (job) => {
      await processBrainIndex(job, postgres, log.child({ worker: QUEUE_BRAIN_INDEX }));
    },
    {
      ...workerOpts,
      settings: { backoffStrategy: backoffMs },
    },
  );

  const neo4jWorker = new Worker<Neo4jGraphJobData>(
    QUEUE_NEO4J_GRAPH,
    async (job) => {
      await processNeo4jGraph(job, neo4j, log.child({ worker: QUEUE_NEO4J_GRAPH }));
    },
    {
      ...workerOpts,
      settings: { backoffStrategy: backoffMs },
    },
  );

  brainWorker.on('failed', (job, err) => {
    if (job && job.attemptsMade >= RETRY_ATTEMPTS) {
      void forwardToDlq(job, err);
    }
  });

  neo4jWorker.on('failed', (job, err) => {
    if (job && job.attemptsMade >= RETRY_ATTEMPTS) {
      void forwardToDlq(job, err);
    }
  });

  brainWorker.on('error', (err) => log.error('brain worker error', { err: String(err) }));
  neo4jWorker.on('error', (err) => log.error('neo4j worker error', { err: String(err) }));

  log.info('workers started', { queues: [QUEUE_BRAIN_INDEX, QUEUE_NEO4J_GRAPH, QUEUE_DLQ] });

  return {
    async close() {
      await Promise.all([brainWorker.close(), neo4jWorker.close(), dlqQueue.close()]);
      log.info('workers closed');
    },
  };
}
