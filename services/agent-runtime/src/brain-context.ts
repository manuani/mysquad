/**
 * Fetches relevant brain content for a tenant, formatted for inclusion in
 * a persona's system prompt — this is the continuity mechanism (see
 * `agent-runtime.ts`'s `assembleSystemPrompt`).
 *
 * Calls `@voai/brain`'s typed exports (`searchBrainContent`,
 * `listBrainContentByDomain`) — never reaches into brain's internal
 * files, per CLAUDE.md "Module boundaries are real."
 */

import type { TenantContext } from '@voai/auth-context';
import type { PostgresClient } from '@voai/db';
import {
  BRAIN_DOMAINS,
  listBrainContentByDomain,
  searchBrainContent,
  type BrainContentItem,
} from '@voai/brain';

const MAX_ITEMS = 5;
const MAX_KEYWORDS = 5;

// Short, common words that don't help match brain content — not
// exhaustive, just enough to keep keyword search from wasting calls on
// "what", "the", "our", etc.
const STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'do',
  'does',
  'did',
  'doing',
  'have',
  'has',
  'had',
  'having',
  'what',
  'when',
  'where',
  'which',
  'who',
  'whom',
  'why',
  'how',
  'this',
  'that',
  'these',
  'those',
  'and',
  'but',
  'or',
  'if',
  'then',
  'our',
  'your',
  'their',
  'his',
  'her',
  'its',
  'we',
  'you',
  'they',
  'should',
  'would',
  'could',
  'will',
  'can',
  'about',
  'with',
  'for',
]);

/**
 * `searchBrainContent`'s ILIKE is a literal substring match — passing
 * a full natural-language message to it directly would essentially never
 * match real content (the odds of a brain item containing the founder's
 * exact sentence are ~zero). Extract a few distinctive keywords instead
 * and search per-keyword, which has a real chance of matching.
 */
function extractKeywords(message: string): string[] {
  const words = message
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
  return Array.from(new Set(words)).slice(0, MAX_KEYWORDS);
}

function byRecencyDesc(a: BrainContentItem, b: BrainContentItem): number {
  return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
}

function formatItem(item: { domain: string; content: string }): string {
  return `[${item.domain}] ${item.content}`;
}

/**
 * Tries keyword search against the founder's message first (the most
 * relevant context, if any matches). Falls back to the most recently
 * updated items across all domains if nothing matches — a brand-new
 * tenant or an unmatched query still gets *some* business context rather
 * than none, which is closer to what a real colleague would do (lead
 * with what they know, even if it's not a perfect match).
 */
export async function fetchBrainContextForMessage(
  tenantContext: TenantContext,
  postgres: PostgresClient,
  message: string,
): Promise<string[]> {
  const keywords = extractKeywords(message);

  if (keywords.length > 0) {
    const matches = (
      await Promise.all(
        keywords.map((kw) => searchBrainContent(tenantContext, postgres, kw).catch(() => [])),
      )
    ).flat();

    if (matches.length > 0) {
      const deduped = Array.from(new Map(matches.map((m) => [m.id, m])).values());
      deduped.sort(byRecencyDesc);
      return deduped.slice(0, MAX_ITEMS).map(formatItem);
    }
  }

  const recent = (
    await Promise.all(
      BRAIN_DOMAINS.map((domain) => listBrainContentByDomain(tenantContext, postgres, domain)),
    )
  ).flat();
  recent.sort(byRecencyDesc);
  return recent.slice(0, MAX_ITEMS).map(formatItem);
}
