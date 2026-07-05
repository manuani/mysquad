/**
 * CRUD persistence for brain content items.
 *
 * Every function here takes `tenantContext: TenantContext` (per ADR 007)
 * as its first parameter and goes through `postgres.withTenant` — never a
 * raw query (packages/db README). Row-level security
 * (packages/db/migrations/1750000000002_brain.sql) enforces the tenant
 * boundary underneath this; this module never constructs cross-tenant
 * queries, but the policy is the actual backstop.
 *
 * Update and delete both write an audit row (before/after values, source,
 * actor, timestamp) per the platform's transparency requirement that
 * founders can see full history of every brain item. Delete is a soft
 * delete (`deleted_at` tombstone) rather than a hard DELETE, so the audit
 * trail's `item_id` foreign key always has a row to join back to — see the
 * migration's comment on `brain_content_canonical.deleted_at`.
 */

import type { TenantContext } from '@voai/auth-context';
import type { PostgresClient } from '@voai/db';
import { NotFoundError, ValidationError } from '@voai/errors';
import type { BrainDomain, BrainSource } from './domains.js';

export interface BrainContentItem {
  readonly id: string;
  readonly tenantId: string;
  readonly domain: BrainDomain;
  readonly language: string;
  readonly content: string;
  readonly contentEn: string | null;
  readonly source: BrainSource;
  readonly deletedAt: string | null;
  readonly ingestedAt: string;
  readonly updatedAt: string;
}

export interface BrainAuditEntry {
  readonly id: string;
  readonly itemId: string;
  readonly changedAt: string;
  readonly changedBy: string | null;
  readonly changeType: 'create' | 'update' | 'delete';
  readonly source: BrainSource;
  readonly beforeValue: Record<string, unknown> | null;
  readonly afterValue: Record<string, unknown> | null;
}

interface ContentSqlRow {
  id: string;
  tenant_id: string;
  domain: BrainDomain;
  language: string;
  content: string;
  content_en: string | null;
  source: BrainSource;
  deleted_at: string | null;
  ingested_at: string;
  updated_at: string;
}

interface AuditSqlRow {
  id: string;
  item_id: string;
  changed_at: string;
  changed_by: string | null;
  change_type: 'create' | 'update' | 'delete';
  source: BrainSource;
  before_value: Record<string, unknown> | null;
  after_value: Record<string, unknown> | null;
}

function toItem(row: ContentSqlRow): BrainContentItem {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    domain: row.domain,
    language: row.language,
    content: row.content,
    contentEn: row.content_en,
    source: row.source,
    deletedAt: row.deleted_at,
    ingestedAt: row.ingested_at,
    updatedAt: row.updated_at,
  };
}

function toAuditEntry(row: AuditSqlRow): BrainAuditEntry {
  return {
    id: row.id,
    itemId: row.item_id,
    changedAt: row.changed_at,
    changedBy: row.changed_by,
    changeType: row.change_type,
    source: row.source,
    beforeValue: row.before_value,
    afterValue: row.after_value,
  };
}

const CONTENT_COLUMNS =
  'id, tenant_id, domain, language, content, content_en, source, deleted_at, ingested_at, updated_at';

export interface CreateBrainContentInput {
  readonly domain: BrainDomain;
  readonly language: string;
  readonly content: string;
  readonly contentEn?: string | null;
  readonly source: BrainSource;
}

/**
 * Creates a new brain content item and records the initial audit entry
 * (change_type = 'create', before_value = null).
 */
export async function createBrainContentItem(
  tenantContext: TenantContext,
  postgres: PostgresClient,
  input: CreateBrainContentInput,
): Promise<BrainContentItem> {
  if (input.content.trim().length === 0) {
    throw new ValidationError('content is required');
  }
  if (input.language.trim().length === 0) {
    throw new ValidationError('language is required');
  }

  return postgres.withTenant(tenantContext.tenantId, async (client) => {
    const insertResult = await client.query<ContentSqlRow>(
      `insert into brain_content_canonical (tenant_id, domain, language, content, content_en, source)
       values ($1, $2, $3, $4, $5, $6)
       returning ${CONTENT_COLUMNS}`,
      [
        tenantContext.tenantId,
        input.domain,
        input.language,
        input.content,
        input.contentEn ?? null,
        input.source,
      ],
    );
    const row = insertResult.rows[0];
    if (!row) {
      throw new Error('failed to create brain content item');
    }
    const item = toItem(row);

    await client.query(
      `insert into brain_content_audit (tenant_id, item_id, changed_by, change_type, source, before_value, after_value)
       values ($1, $2, $3, 'create', $4, null, $5)`,
      [tenantContext.tenantId, item.id, tenantContext.userId, input.source, JSON.stringify(item)],
    );

    return item;
  });
}

/**
 * Lists non-deleted items for one domain, newest first.
 */
export async function listBrainContentByDomain(
  tenantContext: TenantContext,
  postgres: PostgresClient,
  domain: BrainDomain,
): Promise<BrainContentItem[]> {
  return postgres.withTenant(tenantContext.tenantId, async (client) => {
    const result = await client.query<ContentSqlRow>(
      `select ${CONTENT_COLUMNS} from brain_content_canonical
       where domain = $1 and deleted_at is null
       order by updated_at desc`,
      [domain],
    );
    return result.rows.map(toItem);
  });
}

/**
 * Fetches a single non-deleted item by id, or null if it doesn't exist
 * (or belongs to another tenant — RLS makes that indistinguishable from
 * not existing, which is the correct behavior per §8.1.1).
 */
export async function getBrainContentItem(
  tenantContext: TenantContext,
  postgres: PostgresClient,
  id: string,
): Promise<BrainContentItem | null> {
  return postgres.withTenant(tenantContext.tenantId, async (client) => {
    const result = await client.query<ContentSqlRow>(
      `select ${CONTENT_COLUMNS} from brain_content_canonical where id = $1 and deleted_at is null`,
      [id],
    );
    const row = result.rows[0];
    return row ? toItem(row) : null;
  });
}

export interface UpdateBrainContentInput {
  readonly content?: string;
  readonly contentEn?: string | null;
  readonly source: BrainSource;
}

/**
 * Updates a brain content item and records an audit entry with the full
 * before/after row values. Per the platform spec, the canonical record is
 * conceptually immutable (updates "create new rows" at the architecture
 * level) — v1 simplifies this to an in-place update of the mutable fields
 * plus an audit trail that preserves every prior value, which gives
 * founders the same "see what changed and when" guarantee without a
 * separate versioned-rows table. Revisit if a future requirement needs to
 * query historical canonical content directly rather than through the
 * audit log.
 */
export async function updateBrainContentItem(
  tenantContext: TenantContext,
  postgres: PostgresClient,
  id: string,
  input: UpdateBrainContentInput,
): Promise<BrainContentItem> {
  if (input.content !== undefined && input.content.trim().length === 0) {
    throw new ValidationError('content cannot be empty');
  }

  return postgres.withTenant(tenantContext.tenantId, async (client) => {
    const existingResult = await client.query<ContentSqlRow>(
      `select ${CONTENT_COLUMNS} from brain_content_canonical where id = $1 and deleted_at is null`,
      [id],
    );
    const existingRow = existingResult.rows[0];
    if (!existingRow) {
      throw new NotFoundError(`brain content item ${id} not found`);
    }
    const before = toItem(existingRow);

    const nextContent = input.content ?? before.content;
    const nextContentEn = input.contentEn !== undefined ? input.contentEn : before.contentEn;

    const updateResult = await client.query<ContentSqlRow>(
      `update brain_content_canonical
       set content = $1, content_en = $2, source = $3, updated_at = now()
       where id = $4 and deleted_at is null
       returning ${CONTENT_COLUMNS}`,
      [nextContent, nextContentEn, input.source, id],
    );
    const updatedRow = updateResult.rows[0];
    if (!updatedRow) {
      throw new NotFoundError(`brain content item ${id} not found`);
    }
    const after = toItem(updatedRow);

    await client.query(
      `insert into brain_content_audit (tenant_id, item_id, changed_by, change_type, source, before_value, after_value)
       values ($1, $2, $3, 'update', $4, $5, $6)`,
      [
        tenantContext.tenantId,
        id,
        tenantContext.userId,
        input.source,
        JSON.stringify(before),
        JSON.stringify(after),
      ],
    );

    return after;
  });
}

/**
 * Soft-deletes a brain content item (sets `deleted_at`) and records an
 * audit entry. See the migration's comment on why this is a tombstone
 * rather than a hard DELETE.
 */
export async function deleteBrainContentItem(
  tenantContext: TenantContext,
  postgres: PostgresClient,
  id: string,
  source: BrainSource,
): Promise<void> {
  return postgres.withTenant(tenantContext.tenantId, async (client) => {
    const existingResult = await client.query<ContentSqlRow>(
      `select ${CONTENT_COLUMNS} from brain_content_canonical where id = $1 and deleted_at is null`,
      [id],
    );
    const existingRow = existingResult.rows[0];
    if (!existingRow) {
      throw new NotFoundError(`brain content item ${id} not found`);
    }
    const before = toItem(existingRow);

    await client.query(
      `update brain_content_canonical set deleted_at = now(), updated_at = now() where id = $1`,
      [id],
    );

    await client.query(
      `insert into brain_content_audit (tenant_id, item_id, changed_by, change_type, source, before_value, after_value)
       values ($1, $2, $3, 'delete', $4, $5, null)`,
      [tenantContext.tenantId, id, tenantContext.userId, source, JSON.stringify(before)],
    );
  });
}

/**
 * Returns the full audit history for one item, oldest first, so a founder
 * can see the chronological sequence of changes.
 */
export async function getBrainContentHistory(
  tenantContext: TenantContext,
  postgres: PostgresClient,
  itemId: string,
): Promise<BrainAuditEntry[]> {
  return postgres.withTenant(tenantContext.tenantId, async (client) => {
    const result = await client.query<AuditSqlRow>(
      `select id, item_id, changed_at, changed_by, change_type, source, before_value, after_value
       from brain_content_audit
       where item_id = $1
       order by changed_at asc`,
      [itemId],
    );
    return result.rows.map(toAuditEntry);
  });
}

/**
 * Simple ILIKE-based search over `content`/`content_en` across all
 * domains for the tenant. v1 stub — see services/brain/README.md for why
 * this is not real vector similarity search yet (the `embedding` column
 * exists in the schema for that future work but is unused here).
 */
export async function searchBrainContent(
  tenantContext: TenantContext,
  postgres: PostgresClient,
  query: string,
): Promise<BrainContentItem[]> {
  if (query.trim().length === 0) {
    throw new ValidationError('q is required');
  }
  const likePattern = `%${query}%`;
  return postgres.withTenant(tenantContext.tenantId, async (client) => {
    const result = await client.query<ContentSqlRow>(
      `select ${CONTENT_COLUMNS} from brain_content_canonical
       where deleted_at is null and (content ilike $1 or content_en ilike $1)
       order by updated_at desc`,
      [likePattern],
    );
    return result.rows.map(toItem);
  });
}
