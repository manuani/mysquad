/**
 * Notification Service
 *
 * Morning briefings (AI-generated via Claude Haiku), notification preferences,
 * and event-driven alerts. Scheduled briefings summarise the past 24 h of
 * decisions, actions, and conflicts for the founder.
 *
 * Sprint reference: Phase 4
 * Router mounts at: /v1/notification
 */

import Anthropic from '@anthropic-ai/sdk';
import express, { type Request, type Response } from 'express';
import type { TenantContext } from '@voai/auth-context';
import type { PostgresClient, TenantScopedClient } from '@voai/db';
import type { ModuleContext, ModuleDefinition, ModuleHandle } from '@voai/types';
import type {
  ActionRow,
  AlertInput,
  ConflictRow,
  DecisionRow,
  MorningBriefing,
  NotificationPreferences,
  PreferencesRow,
  UpdatePreferencesInput,
} from './types.js';

// ---------------------------------------------------------------------------
// Helpers — map DB rows to camelCase response shapes
// ---------------------------------------------------------------------------

function rowToPreferences(row: PreferencesRow): NotificationPreferences {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    morningBriefingEnabled: row.morning_briefing_enabled,
    briefingHour: row.briefing_hour,
    briefingTimezone: row.briefing_timezone,
    alertOnHighRisk: row.alert_on_high_risk,
    alertOnConflict: row.alert_on_conflict,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Data-access functions — all take TenantContext as first param
// ---------------------------------------------------------------------------

async function getOrCreatePreferences(
  tenantContext: TenantContext,
  postgres: PostgresClient,
): Promise<NotificationPreferences> {
  return postgres.withTenant(tenantContext.tenantId, async (client: TenantScopedClient) => {
    const result = await client.query<PreferencesRow>(
      `INSERT INTO notification_preferences (tenant_id)
       VALUES ($1)
       ON CONFLICT (tenant_id) DO UPDATE SET updated_at = updated_at
       RETURNING *`,
      [tenantContext.tenantId],
    );
    const row = result.rows[0];
    if (!row) throw new Error('INSERT INTO notification_preferences returned no row');
    return rowToPreferences(row);
  });
}

async function updatePreferences(
  tenantContext: TenantContext,
  postgres: PostgresClient,
  input: UpdatePreferencesInput,
): Promise<NotificationPreferences> {
  return postgres.withTenant(tenantContext.tenantId, async (client: TenantScopedClient) => {
    // Build SET clause dynamically from provided fields only
    const setClauses: string[] = ['updated_at = now()'];
    const params: unknown[] = [tenantContext.tenantId];
    let idx = 2;

    if (input.morningBriefingEnabled !== undefined) {
      setClauses.push(`morning_briefing_enabled = $${idx++}`);
      params.push(input.morningBriefingEnabled);
    }
    if (input.briefingHour !== undefined) {
      setClauses.push(`briefing_hour = $${idx++}`);
      params.push(input.briefingHour);
    }
    if (input.briefingTimezone !== undefined) {
      setClauses.push(`briefing_timezone = $${idx++}`);
      params.push(input.briefingTimezone);
    }
    if (input.alertOnHighRisk !== undefined) {
      setClauses.push(`alert_on_high_risk = $${idx++}`);
      params.push(input.alertOnHighRisk);
    }
    if (input.alertOnConflict !== undefined) {
      setClauses.push(`alert_on_conflict = $${idx++}`);
      params.push(input.alertOnConflict);
    }

    const result = await client.query<PreferencesRow>(
      `UPDATE notification_preferences
       SET ${setClauses.join(', ')}
       WHERE tenant_id = $1
       RETURNING *`,
      params,
    );

    if (result.rows.length === 0) {
      // No row yet — create defaults then apply
      await client.query(
        `INSERT INTO notification_preferences (tenant_id) VALUES ($1) ON CONFLICT DO NOTHING`,
        [tenantContext.tenantId],
      );
      const retry = await client.query<PreferencesRow>(
        `UPDATE notification_preferences
         SET ${setClauses.join(', ')}
         WHERE tenant_id = $1
         RETURNING *`,
        params,
      );
      const retryRow = retry.rows[0];
      if (!retryRow) throw new Error('UPDATE notification_preferences returned no row after insert');
      return rowToPreferences(retryRow);
    }

    const row = result.rows[0];
    if (!row) throw new Error('UPDATE notification_preferences returned no row');
    return rowToPreferences(row);
  });
}

async function fetchActivity(
  tenantContext: TenantContext,
  postgres: PostgresClient,
): Promise<{ decisions: DecisionRow[]; actions: ActionRow[]; conflicts: ConflictRow[] }> {
  return postgres.withTenant(tenantContext.tenantId, async (client: TenantScopedClient) => {
    const [decisionsResult, actionsResult, conflictsResult] = await Promise.all([
      client.query<DecisionRow>(
        `SELECT id, decision_type, summary, state, created_at
         FROM decisions
         WHERE created_at > now() - interval '24 hours'
         ORDER BY created_at DESC
         LIMIT 20`,
      ),
      client.query<ActionRow>(
        `SELECT id, assigned_to, state, due_at, created_at
         FROM actions
         WHERE created_at > now() - interval '24 hours'
         ORDER BY created_at DESC
         LIMIT 20`,
      ),
      client.query<ConflictRow>(
        `SELECT id, conflict_type, severity, resolution_state, created_at
         FROM conflicts
         WHERE created_at > now() - interval '24 hours'
         ORDER BY created_at DESC
         LIMIT 10`,
      ),
    ]);

    return {
      decisions: decisionsResult.rows,
      actions: actionsResult.rows,
      conflicts: conflictsResult.rows,
    };
  });
}

// ---------------------------------------------------------------------------
// Anthropic briefing generation
// ---------------------------------------------------------------------------

async function generateBriefingSummary(
  activity: { decisions: DecisionRow[]; actions: ActionRow[]; conflicts: ConflictRow[] },
  anthropic: Anthropic,
): Promise<string> {
  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              'You are the VirtualOffice AI morning briefing assistant. Summarise the following activity from the past 24 hours for the founder. Be concise — 3-5 bullet points maximum. Focus on what needs their attention today.\n\n' +
              JSON.stringify(activity, null, 2),
          },
        ],
      },
    ],
  });

  for (const block of response.content) {
    if (block.type === 'text') return block.text;
  }
  return 'No summary available.';
}

// ---------------------------------------------------------------------------
// Route handlers — extracted so they can be tested
// ---------------------------------------------------------------------------

export async function handleGetBriefing(
  tenantContext: TenantContext,
  postgres: PostgresClient,
  anthropic: Anthropic,
): Promise<MorningBriefing> {
  const now = new Date();
  const periodEnd = now.toISOString();
  const periodStart = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  const activity = await fetchActivity(tenantContext, postgres);
  const summary = await generateBriefingSummary(activity, anthropic);

  return {
    generatedAt: now.toISOString(),
    periodStart,
    periodEnd,
    summary,
    activity,
  };
}

export async function handleGetPreferences(
  tenantContext: TenantContext,
  postgres: PostgresClient,
): Promise<NotificationPreferences> {
  return getOrCreatePreferences(tenantContext, postgres);
}

export async function handleUpdatePreferences(
  tenantContext: TenantContext,
  postgres: PostgresClient,
  input: UpdatePreferencesInput,
): Promise<NotificationPreferences> {
  return updatePreferences(tenantContext, postgres, input);
}

// ---------------------------------------------------------------------------
// TenantContext extraction from request headers
// ---------------------------------------------------------------------------

function extractTenantContext(req: Request): TenantContext {
  const tenantId = req.headers['x-tenant-id'] as string;
  const userId = req.headers['x-user-id'] as string;
  const userType = req.headers['x-user-type'] as string;
  const sessionId = req.headers['x-session-id'] as string;

  if (!tenantId || !userId || !sessionId) {
    throw new Error('Missing required tenant context headers');
  }

  const validUserTypes = ['founder', 'admin', 'expert'] as const;
  type UserType = (typeof validUserTypes)[number];
  const safeUserType: UserType = validUserTypes.includes(userType as UserType)
    ? (userType as UserType)
    : 'founder';

  return { tenantId, userId, userType: safeUserType, sessionId };
}

// ---------------------------------------------------------------------------
// Module definition
// ---------------------------------------------------------------------------

export const notificationModule: ModuleDefinition = {
  name: 'notification',
  async register(ctx: ModuleContext): Promise<ModuleHandle> {
    const log = ctx.logger.child({ module: 'notification' });
    const postgres = ctx.db.postgres as PostgresClient;

    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    const router = express.Router();

    // GET /healthz
    router.get('/healthz', (_req: Request, res: Response) => {
      res.json({ module: 'notification', status: 'healthy' });
    });

    // GET /briefing
    router.get('/briefing', async (req: Request, res: Response) => {
      try {
        const tenantContext = extractTenantContext(req);
        const briefing = await handleGetBriefing(tenantContext, postgres, anthropic);
        res.json(briefing);
      } catch (err) {
        log.error('briefing generation failed', { error: String(err) });
        res.status(500).json({ error: 'Failed to generate briefing' });
      }
    });

    // GET /preferences
    router.get('/preferences', async (req: Request, res: Response) => {
      try {
        const tenantContext = extractTenantContext(req);
        const prefs = await handleGetPreferences(tenantContext, postgres);
        res.json(prefs);
      } catch (err) {
        log.error('get preferences failed', { error: String(err) });
        res.status(500).json({ error: 'Failed to retrieve preferences' });
      }
    });

    // PUT /preferences
    router.put('/preferences', async (req: Request, res: Response) => {
      try {
        const tenantContext = extractTenantContext(req);
        const input: UpdatePreferencesInput = req.body as UpdatePreferencesInput;
        const prefs = await handleUpdatePreferences(tenantContext, postgres, input);
        res.json(prefs);
      } catch (err) {
        log.error('update preferences failed', { error: String(err) });
        res.status(500).json({ error: 'Failed to update preferences' });
      }
    });

    // POST /alert
    router.post('/alert', async (req: Request, res: Response) => {
      try {
        const tenantContext = extractTenantContext(req);
        const alert: AlertInput = req.body as AlertInput;

        log.info('alert queued', {
          tenantId: tenantContext.tenantId,
          alertType: alert.alertType,
          entityId: alert.entityId,
          entityType: alert.entityType,
          summary: alert.summary,
        });

        res.json({ queued: true });
      } catch (err) {
        log.error('alert failed', { error: String(err) });
        res.status(500).json({ error: 'Failed to queue alert' });
      }
    });

    log.info('module registered');

    return {
      name: 'notification',
      router,
      health: async () => ({ status: 'healthy' }),
      shutdown: async () => {
        log.info('module shutdown');
      },
    };
  },
};

export default notificationModule;
