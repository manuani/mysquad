/**
 * Metering event recording.
 *
 * Called by agent-runtime (after roster calls) and marketplace (after expert
 * session completion) to record billable usage. Admin console reads the
 * monthly_usage_rollup table for dashboards.
 */

import type { TenantContext } from '@voai/auth-context';
import type { TenantScopedClient } from '@voai/db';

export type MeteringEventType = 'llm_tokens' | 'expert_minutes' | 'ai_roster_call';

export interface MeteringEvent {
  readonly id: string;
  readonly tenantId: string;
  readonly sessionId: string | null;
  readonly eventType: MeteringEventType;
  readonly quantity: number;
  readonly model: string | null;
  readonly unitCostMicro: number;
  readonly totalCostMicro: number;
  readonly metadata: Record<string, unknown> | null;
  readonly recordedAt: string;
}

export interface RecordMeteringEventInput {
  readonly sessionId?: string;
  readonly eventType: MeteringEventType;
  readonly quantity: number;
  readonly model?: string;
  readonly unitCostMicro?: number;
  readonly metadata?: Record<string, unknown>;
}

/** Cost in USD × 10^-6 per token for known Claude models. */
const MODEL_INPUT_COST: Record<string, number> = {
  'claude-haiku-4-5-20251001': 1, // $0.000001 / input token ≈ $1/1M
  'claude-sonnet-4-6': 3,
  'claude-opus-4-8': 15,
};
const MODEL_OUTPUT_COST: Record<string, number> = {
  'claude-haiku-4-5-20251001': 5,
  'claude-sonnet-4-6': 15,
  'claude-opus-4-8': 75,
};

export function estimateCostMicro(
  model: string,
  inputTokens: number,
  outputTokens: number,
): { inputCost: number; outputCost: number; totalCost: number } {
  const inp = MODEL_INPUT_COST[model] ?? 3;
  const out = MODEL_OUTPUT_COST[model] ?? 15;
  const inputCost = Math.round(inputTokens * inp);
  const outputCost = Math.round(outputTokens * out);
  return { inputCost, outputCost, totalCost: inputCost + outputCost };
}

function rowToEvent(row: Record<string, unknown>): MeteringEvent {
  return {
    id: row['id'] as string,
    tenantId: row['tenant_id'] as string,
    sessionId: (row['session_id'] as string | null) ?? null,
    eventType: row['event_type'] as MeteringEventType,
    quantity: row['quantity'] as number,
    model: (row['model'] as string | null) ?? null,
    unitCostMicro: row['unit_cost_micro'] as number,
    totalCostMicro: row['total_cost_micro'] as number,
    metadata: (row['metadata'] as Record<string, unknown> | null) ?? null,
    recordedAt: (row['recorded_at'] as Date).toISOString(),
  };
}

export async function recordMeteringEvent(
  tc: TenantContext,
  client: TenantScopedClient,
  input: RecordMeteringEventInput,
): Promise<MeteringEvent> {
  const unitCost = input.unitCostMicro ?? 0;
  const totalCost = Math.round(input.quantity * unitCost);

  const { rows } = await client.query<Record<string, unknown>>(
    `INSERT INTO metering_events
       (tenant_id, session_id, event_type, quantity, model, unit_cost_micro, total_cost_micro, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      tc.tenantId,
      input.sessionId ?? null,
      input.eventType,
      input.quantity,
      input.model ?? null,
      unitCost,
      totalCost,
      input.metadata ? JSON.stringify(input.metadata) : null,
    ],
  );
  return rowToEvent(rows[0]!);
}

export interface UsageSummary {
  readonly tenantId: string;
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
  readonly totalRosterCalls: number;
  readonly totalExpertMinutes: number;
  readonly totalCostMicro: number;
  readonly periodStart: string;
  readonly periodEnd: string;
}

export async function getTenantUsageSummary(
  tc: TenantContext,
  client: TenantScopedClient,
  from: Date,
  to: Date,
): Promise<UsageSummary> {
  const { rows } = await client.query<Record<string, unknown>>(
    `SELECT
       SUM(CASE WHEN event_type = 'llm_tokens' AND metadata->>'tokenType' = 'input'  THEN quantity ELSE 0 END) AS input_tokens,
       SUM(CASE WHEN event_type = 'llm_tokens' AND metadata->>'tokenType' = 'output' THEN quantity ELSE 0 END) AS output_tokens,
       SUM(CASE WHEN event_type = 'ai_roster_call'  THEN quantity ELSE 0 END) AS roster_calls,
       SUM(CASE WHEN event_type = 'expert_minutes'  THEN quantity ELSE 0 END) AS expert_minutes,
       COALESCE(SUM(total_cost_micro), 0)                                      AS total_cost_micro
     FROM metering_events
     WHERE tenant_id = $1 AND recorded_at BETWEEN $2 AND $3`,
    [tc.tenantId, from.toISOString(), to.toISOString()],
  );

  const row = rows[0] ?? {};
  return {
    tenantId: tc.tenantId,
    totalInputTokens: Number(row['input_tokens'] ?? 0),
    totalOutputTokens: Number(row['output_tokens'] ?? 0),
    totalRosterCalls: Number(row['roster_calls'] ?? 0),
    totalExpertMinutes: Number(row['expert_minutes'] ?? 0),
    totalCostMicro: Number(row['total_cost_micro'] ?? 0),
    periodStart: from.toISOString(),
    periodEnd: to.toISOString(),
  };
}
