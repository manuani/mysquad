import type { TenantContext } from '@voai/auth-context';
import type { PostgresClient } from '@voai/db';

export type AuditOutcome = 'success' | 'failure';
export type AuditActorType = 'founder' | 'admin' | 'expert' | 'system' | 'webhook';

export interface AuditEvent {
  tenantId?: string;
  actorId?: string;
  actorType?: AuditActorType;
  action: string;
  resource?: string;
  resourceId?: string;
  outcome: AuditOutcome;
  payload?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Writes one row to audit_log. Fire-and-forget safe — errors are swallowed
 * and logged to stderr so a logging failure never breaks a user-facing
 * request. Never throws.
 */
export async function recordAuditEvent(
  postgres: PostgresClient,
  event: AuditEvent,
  tc?: TenantContext,
): Promise<void> {
  const tenantId = event.tenantId ?? tc?.tenantId;
  const actorId = event.actorId ?? tc?.userId;
  // Use SYSTEM_TENANT scope for cross-tenant or pre-auth events
  const scopeId = tenantId ?? '00000000-0000-0000-0000-000000000000';

  try {
    await postgres.withTenant(scopeId, async (client) => {
      await client.query(
        `INSERT INTO audit_log
           (tenant_id, actor_id, actor_type, action, resource, resource_id,
            outcome, payload, ip_address, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          tenantId ?? null,
          actorId ?? null,
          event.actorType ?? null,
          event.action,
          event.resource ?? null,
          event.resourceId ?? null,
          event.outcome,
          event.payload ? JSON.stringify(event.payload) : null,
          event.ipAddress ?? null,
          event.userAgent ?? null,
        ],
      );
    });
  } catch (err) {
    // Audit failure must never surface to the caller
    console.error('[audit] failed to write audit event', {
      action: event.action,
      err: String(err),
    });
  }
}
