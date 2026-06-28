/**
 * In-memory fake standing in for Postgres, scoped to exactly the queries
 * sessions.ts / transcript.ts issue. Mirrors
 * services/ledger/tests/fake-postgres.ts: exercises the `withTenant`-only
 * access pattern (ADR 007) without a live database. The RLS guarantee
 * itself is covered by packages/db/tests/integration/tenant-boundary.test.ts
 * and by the live curl exercise against Docker Postgres.
 */
import type { PostgresClient, TenantScopedClient } from '@voai/db';

let counter = 0;
const nextId = () => `id-${++counter}`;

export interface FakeSessionRow {
  id: string;
  tenant_id: string;
  started_by: string;
  status: string;
  mode: string;
  ended_at: string | null;
  created_at: string;
}

export interface FakeTranscriptEntryRow {
  id: string;
  tenant_id: string;
  session_id: string;
  sequence_number: number;
  speaker_type: string;
  speaker_name: string;
  content: string;
  created_at: string;
}

export function createFakePostgres() {
  const sessions: FakeSessionRow[] = [];
  const transcriptEntries: FakeTranscriptEntryRow[] = [];

  const client: TenantScopedClient = {
    async query<T = unknown>(text: string, params: unknown[] = []) {
      const sql = text.trim().toLowerCase();

      // --- sessions ---
      if (sql.startsWith('insert into sessions')) {
        const now = new Date().toISOString();
        const row: FakeSessionRow = {
          id: nextId(),
          tenant_id: params[0] as string,
          started_by: params[1] as string,
          status: 'started',
          mode: params[2] as string,
          ended_at: null,
          created_at: now,
        };
        sessions.push(row);
        return { rows: [row] as T[] };
      }

      if (sql.startsWith('select * from sessions where id')) {
        const row = sessions.find((s) => s.id === params[0]);
        return { rows: (row ? [row] : []) as T[] };
      }

      if (sql.startsWith("update sessions set status = 'active' where id")) {
        const row = sessions.find((s) => s.id === params[0]);
        if (row) row.status = 'active';
        return { rows: (row ? [row] : []) as T[] };
      }

      if (sql.startsWith("update sessions set status = 'ended'")) {
        const row = sessions.find((s) => s.id === params[0]);
        if (row) {
          row.status = 'ended';
          row.ended_at = new Date().toISOString();
        }
        return { rows: (row ? [row] : []) as T[] };
      }

      // --- transcript_entries ---
      if (sql.startsWith('select coalesce(max(sequence_number)')) {
        const sessionId = params[0] as string;
        const max = transcriptEntries
          .filter((e) => e.session_id === sessionId)
          .reduce((acc, e) => Math.max(acc, e.sequence_number), 0);
        return { rows: [{ next_seq: max + 1 }] as unknown as T[] };
      }

      if (sql.startsWith('insert into transcript_entries')) {
        const now = new Date().toISOString();
        const row: FakeTranscriptEntryRow = {
          id: nextId(),
          tenant_id: params[0] as string,
          session_id: params[1] as string,
          sequence_number: params[2] as number,
          speaker_type: params[3] as string,
          speaker_name: params[4] as string,
          content: params[5] as string,
          created_at: now,
        };
        transcriptEntries.push(row);
        return { rows: [row] as T[] };
      }

      if (sql.startsWith('select * from transcript_entries where session_id')) {
        const sessionId = params[0] as string;
        const rows = transcriptEntries
          .filter((e) => e.session_id === sessionId)
          .sort((a, b) => a.sequence_number - b.sequence_number);
        return { rows: rows as unknown as T[] };
      }

      throw new Error(`fake postgres: unhandled query: ${text}`);
    },
  };

  const postgres: PostgresClient = {
    async withTenant<T>(_tenantId: string, fn: (c: TenantScopedClient) => Promise<T>): Promise<T> {
      return fn(client);
    },
  };

  return { postgres, sessions, transcriptEntries };
}
