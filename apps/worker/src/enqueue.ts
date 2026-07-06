/**
 * Thin helpers for enqueuing jobs from the API server.
 *
 * The API server calls these instead of importing BullMQ directly, so
 * BullMQ remains a single dependency here rather than spread across the
 * monolith.
 */

import { Queue } from 'bullmq';
import type IORedis from 'ioredis';
import {
  QUEUE_BRAIN_INDEX,
  QUEUE_NEO4J_GRAPH,
  type BrainIndexJobData,
  type Neo4jGraphJobData,
} from './jobs.js';

let brainQueue: Queue<BrainIndexJobData> | undefined;
let neo4jQueue: Queue<Neo4jGraphJobData> | undefined;

function getBrainQueue(connection: IORedis): Queue<BrainIndexJobData> {
  brainQueue ??= new Queue(QUEUE_BRAIN_INDEX, { connection });
  return brainQueue;
}

function getNeo4jQueue(connection: IORedis): Queue<Neo4jGraphJobData> {
  neo4jQueue ??= new Queue(QUEUE_NEO4J_GRAPH, { connection });
  return neo4jQueue;
}

export async function enqueueBrainIndex(
  connection: IORedis,
  data: Omit<BrainIndexJobData, 'version'>,
): Promise<void> {
  await getBrainQueue(connection).add(QUEUE_BRAIN_INDEX, { version: 1, ...data });
}

export async function enqueueNeo4jGraph(
  connection: IORedis,
  data: Omit<Neo4jGraphJobData, 'version'>,
): Promise<void> {
  await getNeo4jQueue(connection).add(QUEUE_NEO4J_GRAPH, { version: 1, ...data });
}
