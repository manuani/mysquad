import { describe, it, expect, vi } from 'vitest';
import type { Job } from 'bullmq';
import type { Logger } from '@voai/types';
import type { Neo4jGraphJobData } from '../src/jobs.js';
import { processNeo4jGraph } from '../src/neo4j-graph-processor.js';
import type { Neo4jClient } from '@voai/db';

function makeJob(data: Neo4jGraphJobData): Job<Neo4jGraphJobData> {
  return { id: 'job-neo4j-1', data, queueName: 'neo4j-graph', attemptsMade: 0 } as unknown as Job<Neo4jGraphJobData>;
}

const log: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn().mockReturnThis(),
};

describe('processNeo4jGraph', () => {
  it('runs one MERGE per edge', async () => {
    const runMock = vi.fn().mockResolvedValue({});
    const closeMock = vi.fn().mockResolvedValue(undefined);
    const neo4j: Neo4jClient = { session: () => ({ run: runMock, close: closeMock }) };

    const job = makeJob({
      version: 1,
      tenantId: 'tenant-1',
      userId: 'user-1',
      itemId: 'item-1',
      domain: 'team_dynamics',
      edges: [
        { fromLabel: 'Person', fromId: 'p1', toLabel: 'Team', toId: 't1', relationship: 'MEMBER_OF' },
        { fromLabel: 'Person', fromId: 'p2', toLabel: 'Team', toId: 't1', relationship: 'MEMBER_OF' },
      ],
    });

    await processNeo4jGraph(job, neo4j, log);

    expect(runMock).toHaveBeenCalledTimes(2);
    expect(closeMock).toHaveBeenCalledOnce();
    expect(runMock).toHaveBeenCalledWith(
      expect.stringContaining('MERGE'),
      expect.objectContaining({ tenantId: 'tenant-1', fromId: 'p1', toId: 't1' }),
    );
  });

  it('closes the session even if run throws', async () => {
    const closeMock = vi.fn().mockResolvedValue(undefined);
    const neo4j: Neo4jClient = {
      session: () => ({
        run: vi.fn().mockRejectedValue(new Error('neo4j down')),
        close: closeMock,
      }),
    };

    const job = makeJob({
      version: 1,
      tenantId: 't',
      userId: 'u',
      itemId: 'i',
      domain: 'market_context',
      edges: [{ fromLabel: 'A', fromId: '1', toLabel: 'B', toId: '2', relationship: 'REL' }],
    });

    await expect(processNeo4jGraph(job, neo4j, log)).rejects.toThrow('neo4j down');
    expect(closeMock).toHaveBeenCalledOnce();
  });
});
