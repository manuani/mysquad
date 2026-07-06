/**
 * Processes brain-index jobs: stores the content item in Postgres/pgvector
 * without blocking the HTTP request that triggered the ingestion.
 *
 * On any non-retryable error the job is moved to the DLQ by BullMQ's
 * built-in failed-job handling (configured in the Worker constructor).
 */

import type { Job } from 'bullmq';
import type { PostgresClient } from '@voai/db';
import { createBrainContentItem } from '@voai/brain';
import type { BrainIndexJobData } from './jobs.js';
import type { Logger } from '@voai/types';
import type { TenantContext } from '@voai/auth-context';

export async function processBrainIndex(
  job: Job<BrainIndexJobData>,
  postgres: PostgresClient,
  log: Logger,
): Promise<void> {
  const { tenantId, userId, itemId, domain, content, language, source } = job.data;

  const tc: TenantContext = {
    tenantId,
    userId,
    userType: 'founder',
    sessionId: `job:${job.id ?? 'unknown'}`,
  };

  log.info('brain-index: processing', { jobId: job.id, tenantId, itemId, domain });

  await createBrainContentItem(tc, postgres, {
    domain: domain as import('@voai/brain').BrainDomain,
    content,
    language,
    source: source as import('@voai/brain').BrainSource,
  });

  void itemId; // carried for tracing but not passed to the store (DB generates its own UUID)

  log.info('brain-index: done', { jobId: job.id, itemId });
}
