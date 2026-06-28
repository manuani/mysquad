/**
 * The eight knowledge domains the brain stores per the Platform
 * Specification: Company profile, Financial state, Market and customers,
 * Competitive landscape, Decisions, Risks, Goals, Relationships.
 *
 * `BrainDomain` values match the CHECK constraint on
 * `brain_content_canonical.domain` in
 * packages/db/migrations/1750000000002_brain.sql exactly — keep these two
 * lists in sync if a domain is ever added or renamed.
 */
export const BRAIN_DOMAINS = [
  'company_profile',
  'financial_state',
  'market_and_customers',
  'competitive_landscape',
  'decisions',
  'risks',
  'goals',
  'relationships',
] as const;

export type BrainDomain = (typeof BRAIN_DOMAINS)[number];

export function isBrainDomain(value: unknown): value is BrainDomain {
  return typeof value === 'string' && (BRAIN_DOMAINS as readonly string[]).includes(value);
}

/**
 * Where a brain content item's value came from. Matches the CHECK
 * constraint on `brain_content_canonical.source` and
 * `brain_content_audit.source`. Per the transparency requirement, every
 * item and every audit entry records this.
 */
export const BRAIN_SOURCES = ['founder_edit', 'agent_extraction', 'integration_import'] as const;

export type BrainSource = (typeof BRAIN_SOURCES)[number];

export function isBrainSource(value: unknown): value is BrainSource {
  return typeof value === 'string' && (BRAIN_SOURCES as readonly string[]).includes(value);
}
