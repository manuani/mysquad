/**
 * Expert profile CRUD and domain-tag management.
 *
 * All functions take a TenantContext and a TenantScopedClient (from
 * postgres.withTenant()), matching the DB access pattern established in
 * services/brain/src/brain.ts and services/ledger/src/ledger.ts.
 */

import type { TenantContext } from '@voai/auth-context';
import type { TenantScopedClient } from '@voai/db';
import { NotFoundError, ValidationError } from '@voai/errors';

export interface ExpertProfile {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly email: string;
  readonly bio: string | null;
  readonly linkedinUrl: string | null;
  readonly status: 'pending' | 'active' | 'paused' | 'retired';
  readonly hourlyRateUsdCents: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ExpertDomainTag {
  readonly id: string;
  readonly expertId: string;
  readonly domain: string;
  readonly confidence: number;
  readonly verified: boolean;
  readonly createdAt: string;
}

export interface ExpertWithTags extends ExpertProfile {
  readonly domainTags: readonly ExpertDomainTag[];
}

export interface CreateExpertInput {
  readonly name: string;
  readonly email: string;
  readonly bio?: string;
  readonly linkedinUrl?: string;
  readonly hourlyRateUsdCents?: number;
  readonly domains?: ReadonlyArray<{ domain: string; confidence?: number }>;
}

export interface UpdateExpertInput {
  readonly name?: string;
  readonly bio?: string;
  readonly linkedinUrl?: string;
  readonly status?: ExpertProfile['status'];
  readonly hourlyRateUsdCents?: number;
}

function rowToProfile(row: Record<string, unknown>): ExpertProfile {
  return {
    id: row['id'] as string,
    tenantId: row['tenant_id'] as string,
    name: row['name'] as string,
    email: row['email'] as string,
    bio: (row['bio'] as string | null) ?? null,
    linkedinUrl: (row['linkedin_url'] as string | null) ?? null,
    status: row['status'] as ExpertProfile['status'],
    hourlyRateUsdCents: row['hourly_rate_usd_cents'] as number,
    createdAt: (row['created_at'] as Date).toISOString(),
    updatedAt: (row['updated_at'] as Date).toISOString(),
  };
}

function rowToTag(row: Record<string, unknown>): ExpertDomainTag {
  return {
    id: row['id'] as string,
    expertId: row['expert_id'] as string,
    domain: row['domain'] as string,
    confidence: row['confidence'] as number,
    verified: row['verified'] as boolean,
    createdAt: (row['created_at'] as Date).toISOString(),
  };
}

export async function createExpert(
  tc: TenantContext,
  client: TenantScopedClient,
  input: CreateExpertInput,
): Promise<ExpertWithTags> {
  if (!input.name.trim()) throw new ValidationError('name is required');
  if (!input.email.trim()) throw new ValidationError('email is required');

  const { rows } = await client.query<Record<string, unknown>>(
    `INSERT INTO expert_profiles (tenant_id, name, email, bio, linkedin_url, hourly_rate_usd_cents)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      tc.tenantId,
      input.name.trim(),
      input.email.trim().toLowerCase(),
      input.bio ?? null,
      input.linkedinUrl ?? null,
      input.hourlyRateUsdCents ?? 0,
    ],
  );

  const profile = rowToProfile(rows[0]!);

  const domainTags: ExpertDomainTag[] = [];
  for (const d of input.domains ?? []) {
    const { rows: tagRows } = await client.query<Record<string, unknown>>(
      `INSERT INTO expert_domain_tags (expert_id, domain, confidence)
       VALUES ($1, $2, $3)
       ON CONFLICT (expert_id, domain) DO UPDATE SET confidence = EXCLUDED.confidence
       RETURNING *`,
      [profile.id, d.domain.trim().toLowerCase(), d.confidence ?? 0.5],
    );
    if (tagRows[0]) domainTags.push(rowToTag(tagRows[0]));
  }

  return { ...profile, domainTags };
}

export async function getExpert(
  _tc: TenantContext,
  client: TenantScopedClient,
  expertId: string,
): Promise<ExpertWithTags | null> {
  const { rows } = await client.query<Record<string, unknown>>(
    'SELECT * FROM expert_profiles WHERE id = $1',
    [expertId],
  );
  if (!rows[0]) return null;
  const profile = rowToProfile(rows[0]);

  const { rows: tagRows } = await client.query<Record<string, unknown>>(
    'SELECT * FROM expert_domain_tags WHERE expert_id = $1 ORDER BY confidence DESC',
    [expertId],
  );
  return { ...profile, domainTags: tagRows.map(rowToTag) };
}

export async function listExperts(
  tc: TenantContext,
  client: TenantScopedClient,
  opts: { status?: ExpertProfile['status']; domain?: string; limit?: number } = {},
): Promise<ExpertWithTags[]> {
  let sql = `
    SELECT DISTINCT ep.*
    FROM expert_profiles ep
  `;
  const params: unknown[] = [];

  if (opts.domain) {
    sql += `
      JOIN expert_domain_tags edt ON edt.expert_id = ep.id AND edt.domain = $${params.length + 1}
    `;
    params.push(opts.domain.toLowerCase());
  }

  sql += ` WHERE ep.tenant_id = $${params.length + 1}`;
  params.push(tc.tenantId);

  if (opts.status) {
    sql += ` AND ep.status = $${params.length + 1}`;
    params.push(opts.status);
  }

  sql += ` ORDER BY ep.name LIMIT $${params.length + 1}`;
  params.push(opts.limit ?? 50);

  const { rows } = await client.query<Record<string, unknown>>(sql, params);
  const profiles = rows.map(rowToProfile);

  if (profiles.length === 0) return [];
  const ids = profiles.map((p) => p.id);
  const { rows: tagRows } = await client.query<Record<string, unknown>>(
    `SELECT * FROM expert_domain_tags WHERE expert_id = ANY($1::uuid[]) ORDER BY confidence DESC`,
    [ids],
  );
  const tagsByExpert = new Map<string, ExpertDomainTag[]>();
  for (const row of tagRows) {
    const tag = rowToTag(row);
    const list = tagsByExpert.get(tag.expertId) ?? [];
    list.push(tag);
    tagsByExpert.set(tag.expertId, list);
  }

  return profiles.map((p) => ({ ...p, domainTags: tagsByExpert.get(p.id) ?? [] }));
}

export async function updateExpert(
  _tc: TenantContext,
  client: TenantScopedClient,
  expertId: string,
  input: UpdateExpertInput,
): Promise<ExpertProfile> {
  const setClauses: string[] = ['updated_at = now()'];
  const params: unknown[] = [];

  if (input.name !== undefined) { params.push(input.name.trim()); setClauses.push(`name = $${params.length}`); }
  if (input.bio !== undefined) { params.push(input.bio); setClauses.push(`bio = $${params.length}`); }
  if (input.linkedinUrl !== undefined) { params.push(input.linkedinUrl); setClauses.push(`linkedin_url = $${params.length}`); }
  if (input.status !== undefined) { params.push(input.status); setClauses.push(`status = $${params.length}`); }
  if (input.hourlyRateUsdCents !== undefined) { params.push(input.hourlyRateUsdCents); setClauses.push(`hourly_rate_usd_cents = $${params.length}`); }

  if (params.length === 0) throw new ValidationError('no fields to update');

  params.push(expertId);
  const { rows } = await client.query<Record<string, unknown>>(
    `UPDATE expert_profiles SET ${setClauses.join(', ')} WHERE id = $${params.length} RETURNING *`,
    params,
  );
  if (!rows[0]) throw new NotFoundError(`expert ${expertId} not found`);
  return rowToProfile(rows[0]);
}

export async function addExpertDomainTag(
  _tc: TenantContext,
  client: TenantScopedClient,
  expertId: string,
  domain: string,
  confidence = 0.5,
): Promise<ExpertDomainTag> {
  const { rows } = await client.query<Record<string, unknown>>(
    `INSERT INTO expert_domain_tags (expert_id, domain, confidence)
     VALUES ($1, $2, $3)
     ON CONFLICT (expert_id, domain) DO UPDATE SET confidence = EXCLUDED.confidence
     RETURNING *`,
    [expertId, domain.trim().toLowerCase(), confidence],
  );
  return rowToTag(rows[0]!);
}
