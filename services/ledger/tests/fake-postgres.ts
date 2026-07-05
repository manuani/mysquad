/**
 * In-memory fake standing in for Postgres, scoped to exactly the queries
 * actions.ts / decisions.ts / conflicts.ts issue. Mirrors the pattern in
 * services/identity-and-tenancy/tests/dev-auth-provider.test.ts: exercises
 * the `withTenant`-only access pattern (ADR 007) without a live database.
 * The RLS guarantee itself is covered by
 * packages/db/tests/integration/tenant-boundary.test.ts.
 */
import type { PostgresClient, TenantScopedClient } from '@voai/db';

let counter = 0;
const nextId = () => `id-${++counter}`;

export interface FakeDecisionRow {
  id: string;
  tenant_id: string;
  meeting_id: string | null;
  decision_type: string;
  summary: string;
  rationale: string | null;
  stakes_level: string;
  state: string;
  confirmed_by: string | null;
  confirmed_at: string | null;
  superseded_by: string | null;
  supersession_reason: string | null;
  outcome: string | null;
  outcome_logged_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface FakeActionRow {
  id: string;
  tenant_id: string;
  decision_id: string | null;
  assigned_to: string;
  state: string;
  due_at: string | null;
  blocked_reason: string | null;
  snoozed_until: string | null;
  delegated_to_expert_id: string | null;
  completed_at: string | null;
  outcome: string | null;
  created_at: string;
  updated_at: string;
}

export interface FakeConflictRow {
  id: string;
  tenant_id: string;
  conflict_type: string;
  source_a_type: string;
  source_a_id: string;
  source_b_type: string;
  source_b_id: string;
  detected_at: string;
  severity: string;
  resolution_state: string;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
}

export function createFakePostgres() {
  const decisions: FakeDecisionRow[] = [];
  const actions: FakeActionRow[] = [];
  const conflicts: FakeConflictRow[] = [];

  const client: TenantScopedClient = {
    async query<T = unknown>(text: string, params: unknown[] = []) {
      const sql = text.trim().toLowerCase();

      // --- decisions ---
      if (sql.startsWith('insert into decisions')) {
        const now = new Date().toISOString();
        const row: FakeDecisionRow = {
          id: nextId(),
          tenant_id: params[0] as string,
          meeting_id: (params[1] as string | null) ?? null,
          decision_type: params[2] as string,
          summary: params[3] as string,
          rationale: (params[4] as string | null) ?? null,
          stakes_level: params[5] as string,
          state: params[6] as string,
          confirmed_by: (params[7] as string | null) ?? null,
          confirmed_at: (params[8] as string | null) ?? null,
          superseded_by: null,
          supersession_reason: null,
          outcome: null,
          outcome_logged_at: null,
          created_at: now,
          updated_at: now,
        };
        decisions.push(row);
        return { rows: [row] as T[] };
      }

      if (sql.startsWith('select * from decisions where id')) {
        const row = decisions.find((d) => d.id === params[0]);
        return { rows: (row ? [row] : []) as T[] };
      }

      if (sql.startsWith('select * from decisions order by created_at')) {
        return {
          rows: [...decisions].sort((a, b) =>
            b.created_at.localeCompare(a.created_at),
          ) as unknown as T[],
        };
      }

      if (sql.startsWith("update decisions set state = 'active'")) {
        const row = decisions.find((d) => d.id === params[0]);
        if (row) {
          row.state = 'active';
          row.confirmed_by = params[1] as string;
          row.confirmed_at = new Date().toISOString();
          row.updated_at = new Date().toISOString();
        }
        return { rows: (row ? [row] : []) as T[] };
      }

      if (sql.startsWith("update decisions set state = 'abandoned'")) {
        const row = decisions.find((d) => d.id === params[0]);
        if (row) {
          row.state = 'abandoned';
          row.supersession_reason = (params[1] as string | null) ?? null;
          row.updated_at = new Date().toISOString();
        }
        return { rows: (row ? [row] : []) as T[] };
      }

      if (sql.startsWith('update decisions set outcome')) {
        const row = decisions.find((d) => d.id === params[0]);
        if (row) {
          row.outcome = params[1] as string;
          row.outcome_logged_at = new Date().toISOString();
          row.updated_at = new Date().toISOString();
        }
        return { rows: (row ? [row] : []) as T[] };
      }

      if (sql.startsWith("update decisions set state = 'superseded'")) {
        const row = decisions.find((d) => d.id === params[0]);
        if (row) {
          row.state = 'superseded';
          row.superseded_by = params[1] as string;
          row.supersession_reason = (params[2] as string | null) ?? null;
          row.updated_at = new Date().toISOString();
        }
        return { rows: (row ? [row] : []) as T[] };
      }

      if (sql.startsWith('update decisions set supersession_reason')) {
        const row = decisions.find((d) => d.id === params[0]);
        if (row) {
          row.supersession_reason = (params[1] as string | null) ?? null;
          row.updated_at = new Date().toISOString();
        }
        return { rows: (row ? [row] : []) as T[] };
      }

      if (
        sql.includes('from decisions') &&
        sql.includes("state = 'active'") &&
        sql.includes('outcome is null')
      ) {
        const rows = decisions.filter(
          (d) => d.state === 'active' && d.outcome === null && d.confirmed_at !== null,
        );
        return { rows: rows as unknown as T[] };
      }

      // --- actions ---
      if (sql.startsWith('insert into actions')) {
        const now = new Date().toISOString();
        const row: FakeActionRow = {
          id: nextId(),
          tenant_id: params[0] as string,
          decision_id: (params[1] as string | null) ?? null,
          assigned_to: params[2] as string,
          state: 'pending',
          due_at: (params[3] as string | null) ?? null,
          blocked_reason: null,
          snoozed_until: null,
          delegated_to_expert_id: null,
          completed_at: null,
          outcome: null,
          created_at: now,
          updated_at: now,
        };
        actions.push(row);
        return { rows: [row] as T[] };
      }

      if (sql.startsWith('select * from actions where id')) {
        const row = actions.find((a) => a.id === params[0]);
        return { rows: (row ? [row] : []) as T[] };
      }

      if (sql.startsWith('select * from actions order by created_at')) {
        return {
          rows: [...actions].sort((a, b) =>
            b.created_at.localeCompare(a.created_at),
          ) as unknown as T[],
        };
      }

      if (sql.startsWith('update actions set')) {
        const row = actions.find((a) => a.id === params[0]);
        if (row) {
          row.state = params[1] as string;
          row.blocked_reason = (params[2] as string | null) ?? null;
          row.snoozed_until = (params[3] as string | null) ?? null;
          row.delegated_to_expert_id = (params[4] as string | null) ?? null;
          row.completed_at = (params[5] as string | null) ?? null;
          row.outcome = (params[6] as string | null) ?? row.outcome;
          row.updated_at = new Date().toISOString();
        }
        return { rows: (row ? [row] : []) as T[] };
      }

      if (sql.includes('from actions where state in')) {
        const rows = actions.filter((a) => a.state === 'pending' || a.state === 'in_progress');
        return { rows: rows as unknown as T[] };
      }

      // --- conflicts ---
      if (sql.startsWith('insert into conflicts')) {
        const now = new Date().toISOString();
        const row: FakeConflictRow = {
          id: nextId(),
          tenant_id: params[0] as string,
          conflict_type: params[1] as string,
          source_a_type: params[2] as string,
          source_a_id: params[3] as string,
          source_b_type: params[4] as string,
          source_b_id: params[5] as string,
          detected_at: now,
          severity: params[6] as string,
          resolution_state: 'detected',
          resolved_by: null,
          resolved_at: null,
          resolution_note: null,
        };
        conflicts.push(row);
        return { rows: [row] as T[] };
      }

      if (sql.startsWith('select * from conflicts where id')) {
        const row = conflicts.find((c) => c.id === params[0]);
        return { rows: (row ? [row] : []) as T[] };
      }

      if (sql.startsWith('select * from conflicts where resolution_state')) {
        const rows = conflicts.filter((c) => c.resolution_state !== 'resolved');
        return { rows: rows as unknown as T[] };
      }

      if (sql.startsWith("update conflicts set resolution_state = 'acknowledged'")) {
        const row = conflicts.find((c) => c.id === params[0]);
        if (row) row.resolution_state = 'acknowledged';
        return { rows: (row ? [row] : []) as T[] };
      }

      if (sql.startsWith("update conflicts set resolution_state = 'resolved'")) {
        const row = conflicts.find((c) => c.id === params[0]);
        if (row) {
          row.resolution_state = 'resolved';
          row.resolved_by = params[1] as string;
          row.resolved_at = new Date().toISOString();
          row.resolution_note = params[2] as string;
        }
        return { rows: (row ? [row] : []) as T[] };
      }

      throw new Error(`fake postgres: unhandled query: ${text}`);
    },
  };

  const postgres: PostgresClient = {
    async withTenant<T>(_tenantId: string, fn: (c: TenantScopedClient) => Promise<T>): Promise<T> {
      return fn(client);
    },
  };

  return { postgres, decisions, actions, conflicts };
}
