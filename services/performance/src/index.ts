/**
 * Performance Service
 *
 * Captures the six performance signals per contribution (factual grounding,
 * peer agreement, expert agreement, founder action, outcome, pushback).
 * Drives the weekly evaluation cycle.
 *
 * Sprint reference: Phase 5, Sprint 5.3
 *
 * Routes mount at /v1/performance (api-server uses the module name).
 */

import express, { type Request, type Response } from 'express';
import type { ModuleContext, ModuleDefinition, ModuleHandle } from '@voai/types';
import type { PostgresClient, TenantScopedClient } from '@voai/db';
import type { TenantContext } from '@voai/auth-context';
import {
  SIGNAL_TYPES,
  isSignalType,
  isRecordedBy,
  type RecordSignalBody,
  type RecordSignalResponse,
  type ScoresResponse,
  type SignalAggregate,
  type SignalType,
  type WeeklyPersonaSummary,
} from './types.js';

// ---------------------------------------------------------------------------
// Data-access helpers
// ---------------------------------------------------------------------------

interface SignalRow {
  id: string;
  persona_id: string;
  signal_type: string;
  value: number;
  recorded_at: string;
}

interface AggRow {
  signal_type: string;
  avg_value: number;
  cnt: string;
}

interface WeeklyRow {
  persona_id: string;
  signal_type: string;
  cnt: string;
  avg_value: number;
}

async function insertSignal(
  postgres: PostgresClient,
  tenantContext: TenantContext,
  body: RecordSignalBody,
): Promise<SignalRow> {
  return postgres.withTenant(tenantContext.tenantId, async (client: TenantScopedClient) => {
    const result = await client.query<SignalRow>(
      `INSERT INTO performance_signals
         (tenant_id, session_id, transcript_entry_id, persona_id,
          signal_type, value, recorded_by, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, persona_id, signal_type, value, recorded_at`,
      [
        tenantContext.tenantId,
        body.sessionId ?? null,
        body.transcriptEntryId ?? null,
        body.personaId,
        body.signalType,
        body.value,
        body.recordedBy,
        body.notes ?? null,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error('INSERT INTO performance_signals returned no row');
    return row;
  });
}

async function aggregateScores(
  postgres: PostgresClient,
  tenantContext: TenantContext,
  personaId: string,
  days: number,
): Promise<AggRow[]> {
  return postgres.withTenant(tenantContext.tenantId, async (client: TenantScopedClient) => {
    const result = await client.query<AggRow>(
      `SELECT signal_type,
              AVG(value)::float AS avg_value,
              COUNT(*)::text    AS cnt
       FROM performance_signals
       WHERE tenant_id  = $1
         AND persona_id = $2
         AND recorded_at >= NOW() - ($3 || ' days')::interval
       GROUP BY signal_type`,
      [tenantContext.tenantId, personaId, days],
    );
    return result.rows;
  });
}

async function weeklyAggregates(
  postgres: PostgresClient,
  tenantContext: TenantContext,
): Promise<WeeklyRow[]> {
  return postgres.withTenant(tenantContext.tenantId, async (client: TenantScopedClient) => {
    const result = await client.query<WeeklyRow>(
      `SELECT persona_id,
              signal_type,
              COUNT(*)::text  AS cnt,
              AVG(value)::float AS avg_value
       FROM performance_signals
       WHERE tenant_id  = $1
         AND recorded_at >= NOW() - INTERVAL '7 days'
       GROUP BY persona_id, signal_type`,
      [tenantContext.tenantId],
    );
    return result.rows;
  });
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function extractTenantContext(req: Request): TenantContext | null {
  // The api-server gateway attaches the validated TenantContext to the request.
  // Cast via unknown to avoid a direct dependency on an untyped property.
  const tc = (req as unknown as { tenantContext?: TenantContext }).tenantContext;
  return tc ?? null;
}

// ---------------------------------------------------------------------------
// Router builder
// ---------------------------------------------------------------------------

function buildPerformanceRouter(postgres: PostgresClient): express.Router {
  const router = express.Router();

  // GET /healthz
  router.get('/healthz', (_req: Request, res: Response) => {
    res.json({ module: 'performance', status: 'healthy' });
  });

  // POST /signal
  router.post('/signal', async (req: Request, res: Response) => {
    const tenantContext = extractTenantContext(req);
    if (!tenantContext) {
      res.status(401).json({ error: 'Missing tenant context' });
      return;
    }

    const body = req.body as Partial<RecordSignalBody>;

    if (!body.personaId || typeof body.personaId !== 'string') {
      res.status(400).json({ error: 'personaId is required' });
      return;
    }
    if (!isSignalType(body.signalType)) {
      res.status(400).json({
        error: `signalType must be one of: ${SIGNAL_TYPES.join(', ')}`,
      });
      return;
    }
    if (typeof body.value !== 'number' || body.value < 0 || body.value > 1) {
      res.status(400).json({ error: 'value must be a number between 0 and 1 inclusive' });
      return;
    }
    if (!isRecordedBy(body.recordedBy)) {
      res.status(400).json({ error: 'recordedBy must be one of: system, founder, expert' });
      return;
    }

    const validBody: RecordSignalBody = {
      sessionId: body.sessionId,
      transcriptEntryId: body.transcriptEntryId,
      personaId: body.personaId,
      signalType: body.signalType,
      value: body.value,
      recordedBy: body.recordedBy,
      notes: body.notes,
    };

    const row = await insertSignal(postgres, tenantContext, validBody);

    const response: RecordSignalResponse = {
      id: row.id,
      personaId: row.persona_id,
      signalType: row.signal_type as SignalType,
      value: row.value,
      recordedAt: row.recorded_at,
    };
    res.status(201).json(response);
  });

  // GET /scores/:personaId
  router.get('/scores/:personaId', async (req: Request, res: Response) => {
    const tenantContext = extractTenantContext(req);
    if (!tenantContext) {
      res.status(401).json({ error: 'Missing tenant context' });
      return;
    }

    const personaId = req.params['personaId'];
    if (!personaId) {
      res.status(400).json({ error: 'personaId param is required' });
      return;
    }
    const daysParam = req.query['days'];
    const days = daysParam !== undefined ? parseInt(String(daysParam), 10) : 30;

    if (isNaN(days) || days <= 0) {
      res.status(400).json({ error: 'days must be a positive integer' });
      return;
    }

    const to = new Date();
    const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);

    const rows = await aggregateScores(postgres, tenantContext, personaId, days);

    const signals: Partial<Record<SignalType, SignalAggregate>> = {};
    for (const row of rows) {
      if (isSignalType(row.signal_type)) {
        signals[row.signal_type] = {
          avg: Math.round(row.avg_value * 1000) / 1000,
          count: parseInt(row.cnt, 10),
        };
      }
    }

    const aggregates = Object.values(signals) as SignalAggregate[];
    const overallScore =
      aggregates.length > 0
        ? Math.round((aggregates.reduce((sum, s) => sum + s.avg, 0) / aggregates.length) * 1000) /
          1000
        : 0;

    const response: ScoresResponse = {
      personaId,
      period: {
        days,
        from: from.toISOString(),
        to: to.toISOString(),
      },
      signals,
      overallScore,
    };
    res.json(response);
  });

  // GET /weekly
  router.get('/weekly', async (req: Request, res: Response) => {
    const tenantContext = extractTenantContext(req);
    if (!tenantContext) {
      res.status(401).json({ error: 'Missing tenant context' });
      return;
    }

    const rows = await weeklyAggregates(postgres, tenantContext);

    // Group by persona
    const byPersona = new Map<
      string,
      { signalAvgs: Partial<Record<SignalType, number>>; signalCounts: Partial<Record<SignalType, number>> }
    >();

    for (const row of rows) {
      if (!isSignalType(row.signal_type)) continue;

      let entry = byPersona.get(row.persona_id);
      if (!entry) {
        entry = { signalAvgs: {}, signalCounts: {} };
        byPersona.set(row.persona_id, entry);
      }
      entry.signalAvgs[row.signal_type] = row.avg_value;
      entry.signalCounts[row.signal_type] = parseInt(row.cnt, 10);
    }

    const summaries: WeeklyPersonaSummary[] = [];
    for (const [personaId, { signalAvgs, signalCounts }] of byPersona) {
      const avgs = Object.values(signalAvgs) as number[];
      const overallScore =
        avgs.length > 0
          ? Math.round((avgs.reduce((sum, v) => sum + v, 0) / avgs.length) * 1000) / 1000
          : 0;
      summaries.push({ personaId, overallScore, signalCounts });
    }

    summaries.sort((a, b) => b.overallScore - a.overallScore);

    res.json(summaries);
  });

  return router;
}

// ---------------------------------------------------------------------------
// Module definition
// ---------------------------------------------------------------------------

export { SIGNAL_TYPES, isSignalType, isRecordedBy } from './types.js';
export type {
  RecordSignalBody,
  RecordSignalResponse,
  ScoresResponse,
  SignalAggregate,
  SignalType,
  WeeklyPersonaSummary,
} from './types.js';

export const performanceModule: ModuleDefinition = {
  name: 'performance',
  async register(ctx: ModuleContext): Promise<ModuleHandle> {
    const log = ctx.logger.child({ module: 'performance' });
    const postgres = ctx.db.postgres as PostgresClient;

    const router = buildPerformanceRouter(postgres);

    log.info('module registered');

    return {
      name: 'performance',
      router,
      health: async () => ({ status: 'healthy' }),
      shutdown: async () => {
        log.info('module shutdown');
      },
    };
  },
};

export default performanceModule;
