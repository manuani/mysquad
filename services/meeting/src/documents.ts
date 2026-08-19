/**
 * Documents handed to the team — before a meeting or during one.
 *
 * The pre-meeting agenda (`brief.ts`) is one per session, replaced on
 * re-upload, and read as standing context every turn. This is the other shape:
 * several things, handed over at points in time, each of which the team learns
 * when it arrives rather than having always known.
 *
 * Keeping the arrival position matters more than it sounds. A deck shared at
 * turn ten, presented to the advisors as though they had it from the start,
 * makes their earlier answers look negligent and misrepresents what they knew.
 */

import type { TenantContext } from '@voai/auth-context';
import type { PostgresClient } from '@voai/db';
import { NotFoundError, ValidationError } from '@voai/errors';
import { extractText, type DocumentKind } from './extract-text.js';

export interface MeetingDocument {
  readonly id: string;
  readonly filename: string | null;
  readonly kind: string;
  readonly title: string | null;
  readonly content: string;
  readonly sections: number | null;
  /** Transcript position it arrived at; null when supplied before the meeting. */
  readonly sharedAfterSequence: number | null;
  readonly createdAt: string;
}

export interface ShareDocumentInput {
  readonly sessionId: string;
  /** Base64 file contents. Omit when sharing pasted text. */
  readonly fileBase64?: string;
  readonly filename?: string;
  /** Text pasted rather than attached — a link, a figure, part of an email. */
  readonly text?: string;
  readonly title?: string;
}

/**
 * Per document, not per meeting. Several documents are inlined into each turn's
 * prompt alongside the agenda and the conversation, so a single large one would
 * crowd out everything else the advisors need.
 */
export const MAX_DOCUMENT_CHARS = 20_000;

interface DocumentSqlRow {
  id: string;
  filename: string | null;
  kind: string;
  title: string | null;
  content: string;
  sections: number | null;
  shared_after_sequence: number | null;
  created_at: Date;
}

function toDocument(row: DocumentSqlRow): MeetingDocument {
  return {
    id: row.id,
    filename: row.filename,
    kind: row.kind,
    title: row.title,
    content: row.content,
    sections: row.sections,
    sharedAfterSequence: row.shared_after_sequence,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

const COLUMNS =
  'id, filename, kind, title, content, sections, shared_after_sequence, created_at';

export async function shareDocument(
  tenantContext: TenantContext,
  postgres: PostgresClient,
  input: ShareDocumentInput,
): Promise<MeetingDocument> {
  if (!input.sessionId || !/^[0-9a-f-]{36}$/i.test(input.sessionId)) {
    throw new ValidationError(`sessionId must be a session UUID, got: ${String(input.sessionId)}`);
  }

  let content: string;
  let kind: DocumentKind | 'pasted';
  let sections: number | null = null;
  let filename: string | null = null;

  if (input.fileBase64) {
    if (!input.filename) throw new ValidationError('filename is required when sharing a file');
    const extracted = await extractText(input.filename, Buffer.from(input.fileBase64, 'base64'));
    content = extracted.text;
    kind = extracted.kind;
    sections = extracted.sections;
    filename = input.filename;
  } else {
    content = input.text?.trim() ?? '';
    kind = 'pasted';
    if (!content) throw new ValidationError('provide a file or some text to share');
  }

  if (content.length > MAX_DOCUMENT_CHARS) {
    throw new ValidationError(
      `extracted text is ${content.length} characters; the maximum is ${MAX_DOCUMENT_CHARS}. ` +
        'Share the relevant section rather than the whole document.',
    );
  }

  return postgres.withTenant(tenantContext.tenantId, async (client) => {
    const session = await client.query<{ id: string }>('SELECT id FROM sessions WHERE id = $1', [
      input.sessionId,
    ]);
    if (session.rows.length === 0) {
      throw new NotFoundError(`session ${input.sessionId} not found`);
    }

    // Where the conversation had got to. Read inside the same transaction as
    // the insert so a turn landing concurrently cannot place the document
    // before something that was already said.
    const position = await client.query<{ max: number | null }>(
      'SELECT MAX(sequence_number) AS max FROM transcript_entries WHERE session_id = $1',
      [input.sessionId],
    );
    const sharedAfter = position.rows[0]?.max ?? null;

    const result = await client.query<DocumentSqlRow>(
      `INSERT INTO meeting_documents
         (tenant_id, session_id, filename, kind, title, content, sections, shared_after_sequence, shared_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING ${COLUMNS}`,
      [
        tenantContext.tenantId,
        input.sessionId,
        filename,
        kind,
        input.title?.trim() || filename || null,
        content,
        sections,
        sharedAfter,
        tenantContext.userId,
      ],
    );
    return toDocument(result.rows[0]!);
  });
}

export async function listDocuments(
  tenantContext: TenantContext,
  postgres: PostgresClient,
  sessionId: string,
): Promise<MeetingDocument[]> {
  return postgres.withTenant(tenantContext.tenantId, async (client) => {
    const result = await client.query<DocumentSqlRow>(
      `SELECT ${COLUMNS} FROM meeting_documents WHERE session_id = $1 ORDER BY created_at ASC`,
      [sessionId],
    );
    return result.rows.map(toDocument);
  });
}

export async function deleteDocument(
  tenantContext: TenantContext,
  postgres: PostgresClient,
  documentId: string,
): Promise<boolean> {
  return postgres.withTenant(tenantContext.tenantId, async (client) => {
    const result = await client.query<{ id: string }>(
      'DELETE FROM meeting_documents WHERE id = $1 RETURNING id',
      [documentId],
    );
    return result.rows.length > 0;
  });
}
