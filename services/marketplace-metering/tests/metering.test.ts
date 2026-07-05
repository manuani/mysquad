import { describe, expect, it } from 'vitest';
import { estimateCostMicro, recordMeteringEvent } from '../src/metering.js';
import type { TenantContext } from '@voai/auth-context';

const TC: TenantContext = {
  tenantId: 'tenant-1',
  userId: 'user-1',
  userType: 'founder',
  sessionId: 'sess-1',
};

const BASE_ROW = {
  id: 'evt-uuid',
  tenant_id: 'tenant-1',
  session_id: null,
  event_type: 'llm_tokens',
  quantity: 100,
  model: 'claude-haiku-4-5-20251001',
  unit_cost_micro: 1,
  total_cost_micro: 100,
  metadata: null,
  recorded_at: new Date(),
};

function makeClient(row: Record<string, unknown>) {
  return {
    async query(_sql: string, _params: unknown[]) {
      return { rows: [row] };
    },
  };
}

describe('estimateCostMicro', () => {
  it('returns 0 cost for 0 tokens', () => {
    const { totalCost } = estimateCostMicro('claude-haiku-4-5-20251001', 0, 0);
    expect(totalCost).toBe(0);
  });

  it('uses known haiku pricing', () => {
    // Haiku: 1 micro per input token, 5 micro per output token
    const { inputCost, outputCost, totalCost } = estimateCostMicro(
      'claude-haiku-4-5-20251001',
      1000,
      200,
    );
    expect(inputCost).toBe(1000);
    expect(outputCost).toBe(1000);
    expect(totalCost).toBe(2000);
  });

  it('uses sonnet pricing for known model', () => {
    // Sonnet: 3 micro per input token, 15 micro per output token
    const { inputCost, outputCost } = estimateCostMicro('claude-sonnet-4-6', 100, 100);
    expect(inputCost).toBe(300);
    expect(outputCost).toBe(1500);
  });

  it('falls back to sonnet pricing for unknown model', () => {
    const { inputCost } = estimateCostMicro('unknown-model', 100, 0);
    expect(inputCost).toBe(300); // defaults to sonnet input rate
  });

  it('output cost is always more expensive than input per token (all known models)', () => {
    for (const model of ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6', 'claude-opus-4-8']) {
      const { inputCost, outputCost } = estimateCostMicro(model, 100, 100);
      expect(outputCost).toBeGreaterThan(inputCost);
    }
  });
});

describe('recordMeteringEvent', () => {
  it('persists a llm_tokens event and returns it', async () => {
    const client = makeClient(BASE_ROW);
    const event = await recordMeteringEvent(TC, client as never, {
      eventType: 'llm_tokens',
      quantity: 100,
      model: 'claude-haiku-4-5-20251001',
      unitCostMicro: 1,
    });
    expect(event.id).toBe('evt-uuid');
    expect(event.eventType).toBe('llm_tokens');
    expect(event.quantity).toBe(100);
  });

  it('persists an expert_minutes event', async () => {
    const client = makeClient({ ...BASE_ROW, event_type: 'expert_minutes', quantity: 30 });
    const event = await recordMeteringEvent(TC, client as never, {
      eventType: 'expert_minutes',
      quantity: 30,
    });
    expect(event.eventType).toBe('expert_minutes');
    expect(event.quantity).toBe(30);
  });

  it('includes sessionId when provided', async () => {
    let capturedParams: unknown[] = [];
    const client = {
      async query(_sql: string, params: unknown[]) {
        capturedParams = params;
        return { rows: [{ ...BASE_ROW, session_id: 'sess-abc' }] };
      },
    };
    await recordMeteringEvent(TC, client as never, {
      eventType: 'ai_roster_call',
      quantity: 1,
      sessionId: 'sess-abc',
    });
    expect(capturedParams[1]).toBe('sess-abc');
  });
});
