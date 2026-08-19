/**
 * Company profiles — the businesses a founder runs inside one account.
 *
 * A tenant used to be a company: `tenants` carries the name alongside plan and
 * status, and signup created exactly one. A founder with two ventures had to
 * choose between mixing both into one brain, where advisors would reason about
 * the wrong company's runway, or keeping two logins.
 *
 * The tenant is now the account — billing, plan, users, entitlements — and a
 * company profile is a business within it. Everything describing a business
 * hangs off the profile: the brain, meetings, the ledger. What the advisors
 * know follows automatically, because it is all derived from those.
 *
 * Lives in identity-and-tenancy because a profile is part of who the founder
 * is operating as, which every other module reads rather than owns.
 */

import type { TenantContext } from '@voai/auth-context';
import type { PostgresClient } from '@voai/db';
import { NotFoundError, ValidationError } from '@voai/errors';

export interface CompanyProfile {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly industry: string | null;
  readonly isDefault: boolean;
  readonly createdAt: string;
}

export interface CreateProfileInput {
  readonly name: string;
  readonly description?: string;
  readonly industry?: string;
  /** Makes this the profile opened on sign-in, demoting whichever held it. */
  readonly isDefault?: boolean;
}

export interface UpdateProfileInput {
  readonly name?: string;
  readonly description?: string;
  readonly industry?: string;
  readonly isDefault?: boolean;
}

const MAX_NAME_CHARS = 120;

interface ProfileSqlRow {
  id: string;
  name: string;
  description: string | null;
  industry: string | null;
  is_default: boolean;
  created_at: Date;
}

function toProfile(row: ProfileSqlRow): CompanyProfile {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    industry: row.industry,
    isDefault: row.is_default,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

const SELECT_COLUMNS = 'id, name, description, industry, is_default, created_at';

export async function listProfiles(
  tenantContext: TenantContext,
  postgres: PostgresClient,
): Promise<CompanyProfile[]> {
  return postgres.withTenant(tenantContext.tenantId, async (client) => {
    const result = await client.query<ProfileSqlRow>(
      `SELECT ${SELECT_COLUMNS} FROM company_profiles ORDER BY is_default DESC, name ASC`,
    );
    return result.rows.map(toProfile);
  });
}

export async function getProfile(
  tenantContext: TenantContext,
  postgres: PostgresClient,
  profileId: string,
): Promise<CompanyProfile | null> {
  return postgres.withTenant(tenantContext.tenantId, async (client) => {
    const result = await client.query<ProfileSqlRow>(
      `SELECT ${SELECT_COLUMNS} FROM company_profiles WHERE id = $1`,
      [profileId],
    );
    return result.rows.length > 0 ? toProfile(result.rows[0]!) : null;
  });
}

/**
 * The profile to open when the founder signs in. Falls back to any profile
 * rather than none: a founder who has deleted their default still has
 * companies, and returning nothing would strand them on an empty picker.
 */
export async function getDefaultProfile(
  tenantContext: TenantContext,
  postgres: PostgresClient,
): Promise<CompanyProfile | null> {
  return postgres.withTenant(tenantContext.tenantId, async (client) => {
    const result = await client.query<ProfileSqlRow>(
      `SELECT ${SELECT_COLUMNS} FROM company_profiles
        ORDER BY is_default DESC, created_at ASC
        LIMIT 1`,
    );
    return result.rows.length > 0 ? toProfile(result.rows[0]!) : null;
  });
}

export async function createProfile(
  tenantContext: TenantContext,
  postgres: PostgresClient,
  input: CreateProfileInput,
): Promise<CompanyProfile> {
  const name = input.name?.trim();
  if (!name) throw new ValidationError('name is required');
  if (name.length > MAX_NAME_CHARS) {
    throw new ValidationError(`name must be ${MAX_NAME_CHARS} characters or fewer`);
  }

  return postgres.withTenant(tenantContext.tenantId, async (client) => {
    // The first profile is the default whatever the caller asked for —
    // an account with companies but no default opens onto nothing.
    const existing = await client.query<{ n: string }>(
      'SELECT COUNT(*) AS n FROM company_profiles',
    );
    const isFirst = Number.parseInt(existing.rows[0]?.n ?? '0', 10) === 0;
    const shouldDefault = isFirst || input.isDefault === true;

    // Demote the incumbent first: the partial unique index permits only one
    // default per tenant, so this would otherwise fail rather than switch.
    if (shouldDefault) {
      await client.query('UPDATE company_profiles SET is_default = false WHERE is_default');
    }

    const result = await client.query<ProfileSqlRow>(
      `INSERT INTO company_profiles (tenant_id, name, description, industry, is_default, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${SELECT_COLUMNS}`,
      [
        tenantContext.tenantId,
        name,
        input.description?.trim() || null,
        input.industry?.trim() || null,
        shouldDefault,
        tenantContext.userId,
      ],
    );
    return toProfile(result.rows[0]!);
  });
}

export async function updateProfile(
  tenantContext: TenantContext,
  postgres: PostgresClient,
  profileId: string,
  input: UpdateProfileInput,
): Promise<CompanyProfile> {
  const name = input.name?.trim();
  if (input.name !== undefined && !name) throw new ValidationError('name cannot be empty');

  return postgres.withTenant(tenantContext.tenantId, async (client) => {
    if (input.isDefault === true) {
      await client.query(
        'UPDATE company_profiles SET is_default = false WHERE is_default AND id <> $1',
        [profileId],
      );
    }

    const result = await client.query<ProfileSqlRow>(
      `UPDATE company_profiles
          SET name        = COALESCE($2, name),
              description = COALESCE($3, description),
              industry    = COALESCE($4, industry),
              is_default  = COALESCE($5, is_default),
              updated_at  = now()
        WHERE id = $1
      RETURNING ${SELECT_COLUMNS}`,
      [
        profileId,
        name ?? null,
        input.description?.trim() ?? null,
        input.industry?.trim() ?? null,
        input.isDefault ?? null,
      ],
    );

    if (result.rows.length === 0) throw new NotFoundError(`company profile ${profileId} not found`);
    return toProfile(result.rows[0]!);
  });
}

/**
 * Confirms a profile belongs to the caller's tenant.
 *
 * Every module that scopes by profile calls this before trusting an id from a
 * request. Row-level security already prevents reading another tenant's rows,
 * but an unchecked id would otherwise be written onto new records, quietly
 * attaching this tenant's data to a profile they do not own.
 */
export async function assertProfileBelongsToTenant(
  tenantContext: TenantContext,
  postgres: PostgresClient,
  profileId: string,
): Promise<void> {
  const profile = await getProfile(tenantContext, postgres, profileId);
  if (!profile) throw new NotFoundError(`company profile ${profileId} not found`);
}
