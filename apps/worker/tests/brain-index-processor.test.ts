import { describe, it, expect, vi } from 'vitest';
import type { Job } from 'bullmq';
import type { PostgresClient, TenantScopedClient } from '@voai/db';
import type { Logger } from '@voai/types';
import type { BrainIndexJobData } from '../src/jobs.js';

// Mock the brain module before importing the processor
vi.mock('@voai/brain', () => ({
  createBrainContentItem: vi.fn().mockResolvedValue({ id: 'generated-id' }),
}));

const { processBrainIndex } = await import('../src/brain-index-processor.js');
const { createBrainContentItem } = await import('@voai/brain');

function makeJob(data: BrainIndexJobData): Job<BrainIndexJobData> {
  return { id: 'job-1', data, queueName: 'brain-index', attemptsMade: 0 } as unknown as Job<BrainIndexJobData>;
}

function makePostgres(): PostgresClient {
  const fakeClient: TenantScopedClient = {
    query: vi.fn().mockResolvedValue({ rows: [] }),
  };
  return {
    withTenant: vi.fn(async (_tid, fn) => fn(fakeClient)),
    adminQuery: vi.fn().mockResolvedValue([]),
    close: vi.fn(),
  } as unknown as PostgresClient;
}

const log: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn().mockReturnThis(),
};

describe('processBrainIndex', () => {
  it('calls createBrainContentItem with correct args', async () => {
    const job = makeJob({
      version: 1,
      tenantId: 'tenant-abc',
      userId: 'user-123',
      itemId: 'item-xyz',
      domain: 'market_context',
      content: 'some content',
      language: 'en',
      source: 'manual',
    });

    await processBrainIndex(job, makePostgres(), log);

    expect(createBrainContentItem).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-abc', userId: 'user-123' }),
      expect.anything(),
      expect.objectContaining({ domain: 'market_context', content: 'some content', language: 'en', source: 'manual' }),
    );
  });

  it('propagates errors from createBrainContentItem so BullMQ can retry', async () => {
    vi.mocked(createBrainContentItem).mockRejectedValueOnce(new Error('db down'));

    const job = makeJob({
      version: 1,
      tenantId: 't',
      userId: 'u',
      itemId: 'i',
      domain: 'team_dynamics',
      content: 'x',
      language: 'en',
      source: 'api',
    });

    await expect(processBrainIndex(job, makePostgres(), log)).rejects.toThrow('db down');
  });
});
