/**
 * Notification Service — unit tests
 *
 * Tests:
 * 1. preferences upsert returns defaults when no row exists
 * 2. briefing calls Anthropic with correctly structured prompt
 * 3. preferences update only touches provided fields
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TenantContext } from '@voai/auth-context';
import type { PostgresClient, TenantScopedClient } from '@voai/db';
import type { NotificationPreferences, PreferencesRow } from '../src/types.js';
import { handleGetBriefing, handleGetPreferences, handleUpdatePreferences } from '../src/index.js';

// ---------------------------------------------------------------------------
// Mock @anthropic-ai/sdk
// ---------------------------------------------------------------------------

vi.mock('@anthropic-ai/sdk', () => {
  const mockCreate = vi.fn();
  const MockAnthropic = vi.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  }));
  (MockAnthropic as unknown as { _mockCreate: typeof mockCreate })._mockCreate = mockCreate;
  return { default: MockAnthropic };
});

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const TENANT_CONTEXT: TenantContext = {
  tenantId: 'aaaaaaaa-0000-0000-0000-000000000001',
  userId: 'bbbbbbbb-0000-0000-0000-000000000002',
  userType: 'founder',
  sessionId: 'cccccccc-0000-0000-0000-000000000003',
};

function makeDefaultPreferencesRow(tenantId: string): PreferencesRow {
  return {
    id: 'dddddddd-0000-0000-0000-000000000004',
    tenant_id: tenantId,
    morning_briefing_enabled: true,
    briefing_hour: 8,
    briefing_timezone: 'Asia/Kolkata',
    alert_on_high_risk: true,
    alert_on_conflict: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function makeMockPostgres(queryFn: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>): PostgresClient {
  return {
    withTenant: async <T>(_tenantId: string, fn: (client: TenantScopedClient) => Promise<T>) => {
      const client: TenantScopedClient = {
        query: queryFn as <U>(text: string, params?: unknown[]) => Promise<{ rows: U[] }>,
      };
      return fn(client);
    },
  };
}

// ---------------------------------------------------------------------------
// 1. Preferences upsert returns defaults when no row exists
// ---------------------------------------------------------------------------

describe('handleGetPreferences', () => {
  it('returns default preferences on first call (upsert creates row)', async () => {
    const defaultRow = makeDefaultPreferencesRow(TENANT_CONTEXT.tenantId);
    const queryFn = vi.fn().mockResolvedValue({ rows: [defaultRow] });
    const postgres = makeMockPostgres(queryFn);

    const result: NotificationPreferences = await handleGetPreferences(TENANT_CONTEXT, postgres);

    // Verify the upsert SQL was called
    expect(queryFn).toHaveBeenCalledOnce();
    const [sql] = queryFn.mock.calls[0]!;
    expect(sql).toContain('INSERT INTO notification_preferences');
    expect(sql).toContain('ON CONFLICT');

    // Verify defaults come through correctly
    expect(result.morningBriefingEnabled).toBe(true);
    expect(result.briefingHour).toBe(8);
    expect(result.briefingTimezone).toBe('Asia/Kolkata');
    expect(result.alertOnHighRisk).toBe(true);
    expect(result.alertOnConflict).toBe(true);
    expect(result.tenantId).toBe(TENANT_CONTEXT.tenantId);
  });
});

// ---------------------------------------------------------------------------
// 2. Briefing calls Anthropic with correctly structured prompt
// ---------------------------------------------------------------------------

describe('handleGetBriefing', () => {
  it('calls Anthropic with activity data and returns briefing shape', async () => {
    const decisions = [
      { id: 'dec-1', decision_type: 'strategic', summary: 'Pivot to B2B', state: 'active', created_at: new Date().toISOString() },
    ];
    const actions = [
      { id: 'act-1', assigned_to: 'founder', state: 'pending', due_at: null, created_at: new Date().toISOString() },
    ];
    const conflicts: never[] = [];

    const queryFn = vi.fn()
      .mockResolvedValueOnce({ rows: decisions })   // decisions query
      .mockResolvedValueOnce({ rows: actions })     // actions query
      .mockResolvedValueOnce({ rows: conflicts });  // conflicts query

    const postgres = makeMockPostgres(queryFn);

    // Import the mock and grab the mockCreate function
    const AnthropicModule = await import('@anthropic-ai/sdk');
    const MockAnthropic = AnthropicModule.default as unknown as {
      _mockCreate: ReturnType<typeof vi.fn>;
      new (...args: unknown[]): { messages: { create: ReturnType<typeof vi.fn> } };
    };
    const mockCreate = MockAnthropic._mockCreate;
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: '• Pivot decision logged\n• One pending action for founder' }],
    });

    const anthropic = new (AnthropicModule.default as unknown as new (opts: { apiKey: string | undefined }) => { messages: { create: typeof mockCreate } })({ apiKey: 'test-key' });

    const briefing = await handleGetBriefing(TENANT_CONTEXT, postgres, anthropic as unknown as import('@anthropic-ai/sdk').default);

    // Shape checks
    expect(briefing).toHaveProperty('generatedAt');
    expect(briefing).toHaveProperty('periodStart');
    expect(briefing).toHaveProperty('periodEnd');
    expect(briefing.activity.decisions).toHaveLength(1);
    expect(briefing.activity.actions).toHaveLength(1);
    expect(briefing.activity.conflicts).toHaveLength(0);
    expect(briefing.summary).toContain('Pivot');

    // Anthropic call verification
    expect(mockCreate).toHaveBeenCalledOnce();
    const call = mockCreate.mock.calls[0]![0];
    expect(call.model).toBe('claude-haiku-4-5-20251001');
    expect(call.messages[0].role).toBe('user');
    const promptText = call.messages[0].content[0].text as string;
    expect(promptText).toContain('morning briefing assistant');
    expect(promptText).toContain('24 hours');
    // Activity data should be serialised into the prompt
    expect(promptText).toContain('Pivot to B2B');
  });
});

// ---------------------------------------------------------------------------
// 3. Preferences update only touches provided fields
// ---------------------------------------------------------------------------

describe('handleUpdatePreferences', () => {
  it('only includes provided fields in the UPDATE SET clause', async () => {
    const updatedRow: PreferencesRow = {
      ...makeDefaultPreferencesRow(TENANT_CONTEXT.tenantId),
      briefing_hour: 9,
    };

    const queryFn = vi.fn().mockResolvedValue({ rows: [updatedRow] });
    const postgres = makeMockPostgres(queryFn);

    const result = await handleUpdatePreferences(
      TENANT_CONTEXT,
      postgres,
      { briefingHour: 9 }, // only briefingHour provided
    );

    expect(queryFn).toHaveBeenCalledOnce();
    const [sql, params] = queryFn.mock.calls[0]!;

    // Should include briefing_hour
    expect(sql).toContain('briefing_hour');
    // Should NOT include other columns (only updated_at + briefing_hour)
    expect(sql).not.toContain('morning_briefing_enabled');
    expect(sql).not.toContain('briefing_timezone');
    expect(sql).not.toContain('alert_on_high_risk');
    expect(sql).not.toContain('alert_on_conflict');

    // Params: [tenantId, 9]
    expect(params).toContain(TENANT_CONTEXT.tenantId);
    expect(params).toContain(9);

    expect(result.briefingHour).toBe(9);
  });

  it('updates multiple fields when multiple are provided', async () => {
    const updatedRow: PreferencesRow = {
      ...makeDefaultPreferencesRow(TENANT_CONTEXT.tenantId),
      morning_briefing_enabled: false,
      alert_on_conflict: false,
    };

    const queryFn = vi.fn().mockResolvedValue({ rows: [updatedRow] });
    const postgres = makeMockPostgres(queryFn);

    await handleUpdatePreferences(
      TENANT_CONTEXT,
      postgres,
      { morningBriefingEnabled: false, alertOnConflict: false },
    );

    const [sql] = queryFn.mock.calls[0]!;
    expect(sql).toContain('morning_briefing_enabled');
    expect(sql).toContain('alert_on_conflict');
    expect(sql).not.toContain('briefing_hour');
    expect(sql).not.toContain('briefing_timezone');
    expect(sql).not.toContain('alert_on_high_risk');
  });
});
