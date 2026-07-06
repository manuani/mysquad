import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BrainIndexJobData, Neo4jGraphJobData } from '../src/jobs.js';
import { QUEUE_BRAIN_INDEX, QUEUE_NEO4J_GRAPH, QUEUE_DLQ } from '../src/jobs.js';

// Captured worker processor callbacks
let brainProcessor: ((job: unknown) => Promise<void>) | undefined;
let neo4jProcessor: ((job: unknown) => Promise<void>) | undefined;
const brainFailedListeners: Array<(job: unknown, err: Error) => void> = [];
const neo4jFailedListeners: Array<(job: unknown, err: Error) => void> = [];

const mockDlqAdd = vi.fn().mockResolvedValue(undefined);
const mockDlqClose = vi.fn().mockResolvedValue(undefined);
const mockWorkerClose = vi.fn().mockResolvedValue(undefined);

vi.mock('bullmq', () => {
  class MockWorker {
    private listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
    constructor(
      public readonly queueName: string,
      public readonly processor: (job: unknown) => Promise<void>,
      _opts: unknown,
    ) {
      if (queueName === QUEUE_BRAIN_INDEX) brainProcessor = processor;
      if (queueName === QUEUE_NEO4J_GRAPH) neo4jProcessor = processor;
    }
    on(event: string, listener: (...args: unknown[]) => void) {
      if (this.queueName === QUEUE_BRAIN_INDEX && event === 'failed') brainFailedListeners.push(listener as never);
      if (this.queueName === QUEUE_NEO4J_GRAPH && event === 'failed') neo4jFailedListeners.push(listener as never);
    }
    close = mockWorkerClose;
  }
  class MockQueue {
    add = mockDlqAdd;
    close = mockDlqClose;
  }
  return { Worker: MockWorker, Queue: MockQueue };
});

// Mock processors
const mockProcessBrainIndex = vi.fn().mockResolvedValue(undefined);
const mockProcessNeo4jGraph = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/brain-index-processor.js', () => ({ processBrainIndex: mockProcessBrainIndex }));
vi.mock('../src/neo4j-graph-processor.js', () => ({ processNeo4jGraph: mockProcessNeo4jGraph }));

const { startWorkers } = await import('../src/worker.js');

const fakeOpts = {
  connection: {} as import('ioredis').default,
  postgres: {} as import('@voai/db').PostgresClient,
  neo4j: {} as import('@voai/db').Neo4jClient,
  log: {
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  },
};

describe('startWorkers', () => {
  beforeEach(() => {
    mockProcessBrainIndex.mockClear();
    mockProcessNeo4jGraph.mockClear();
    mockDlqAdd.mockClear();
  });

  it('routes brain-index jobs to processBrainIndex', async () => {
    startWorkers(fakeOpts);
    const fakeJob = { id: 'j1', data: { version: 1, tenantId: 't' } as BrainIndexJobData };
    await brainProcessor!(fakeJob);
    expect(mockProcessBrainIndex).toHaveBeenCalledOnce();
  });

  it('routes neo4j-graph jobs to processNeo4jGraph', async () => {
    startWorkers(fakeOpts);
    const fakeJob = { id: 'j2', data: { version: 1, tenantId: 't' } as Neo4jGraphJobData };
    await neo4jProcessor!(fakeJob);
    expect(mockProcessNeo4jGraph).toHaveBeenCalledOnce();
  });

  it('forwards to DLQ after max retries', async () => {
    startWorkers(fakeOpts);
    const deadJob = { id: 'j3', attemptsMade: 5, queueName: QUEUE_BRAIN_INDEX, name: 'brain-index', data: {} };
    brainFailedListeners[brainFailedListeners.length - 1]!(deadJob, new Error('permanent failure'));
    await Promise.resolve(); // let forwardToDlq fire
    expect(mockDlqAdd).toHaveBeenCalledWith(
      'brain-index',
      expect.objectContaining({ originalQueue: QUEUE_BRAIN_INDEX, error: expect.stringContaining('permanent failure') }),
      expect.anything(),
    );
  });

  it('does not forward to DLQ on first attempt failure', async () => {
    startWorkers(fakeOpts);
    const earlyFailJob = { id: 'j4', attemptsMade: 1, queueName: QUEUE_BRAIN_INDEX, name: 'brain-index', data: {} };
    brainFailedListeners[brainFailedListeners.length - 1]!(earlyFailJob, new Error('transient'));
    await Promise.resolve();
    expect(mockDlqAdd).not.toHaveBeenCalled();
  });

  it('close() shuts down all workers and DLQ queue', async () => {
    const { close } = startWorkers(fakeOpts);
    await close();
    expect(mockWorkerClose).toHaveBeenCalled();
    expect(mockDlqClose).toHaveBeenCalled();
  });
});
