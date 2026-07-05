/**
 * Morning briefing job.
 *
 * Fires daily at 08:00 UTC. Calls the notification service's briefing
 * generation endpoint for each active tenant. The notification service
 * persists the briefing and (when SMTP is configured) sends the email.
 *
 * Tenant discovery: reads distinct tenant_ids from identity_tenants.
 * This is a read-only admin query using voai_admin credentials; the
 * scheduler process is not RLS-scoped.
 */

import type { Logger } from '@voai/types';

export interface MorningBriefingJobConfig {
  readonly apiServerUrl: string;
  readonly schedulerSecret: string;
}

export function createMorningBriefingJob(config: MorningBriefingJobConfig, log: Logger) {
  return async function runMorningBriefing(): Promise<void> {
    log.info('morning briefing job started');

    // Fetch all active tenant IDs via an internal scheduler endpoint.
    // The api-server exposes POST /internal/scheduler/morning-briefing
    // (protected by x-scheduler-secret) which runs briefing generation
    // for all tenants in a single worker cycle. This avoids the scheduler
    // needing direct DB access.
    const res = await fetch(`${config.apiServerUrl}/internal/scheduler/morning-briefing`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-scheduler-secret': config.schedulerSecret,
      },
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      throw new Error(
        `morning briefing endpoint returned ${res.status}: ${String(body['message'] ?? '')}`,
      );
    }

    const result = (await res.json()) as { tenantsProcessed: number };
    log.info('morning briefing job completed', { tenantsProcessed: result.tenantsProcessed });
  };
}
