/**
 * Expert matching — given a topic string, return experts ranked by domain fit.
 *
 * Ranking algorithm (v1 — keyword/domain overlap, no embeddings):
 *   1. Tokenise the topic into lowercase words
 *   2. For each expert, compute a relevance score:
 *        score = Σ(tag.confidence × overlap(tag.domain, topicWords)) / numTags
 *      where overlap = fraction of domain slug tokens appearing in topicWords
 *   3. Sort descending; return top-k (default 5) active experts
 *
 * Phase 4 replaces step 2 with an embedding similarity search via Neo4j
 * vector index — this gives a working endpoint today without requiring a
 * vector store to be deployed.
 */

import type { TenantContext } from '@voai/auth-context';
import type { TenantScopedClient } from '@voai/db';
import { listExperts, type ExpertWithTags } from './experts.js';

export interface MatchedExpert {
  readonly expert: ExpertWithTags;
  readonly relevanceScore: number;
  readonly matchedDomains: readonly string[];
}

function tokenise(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2), // drop stopwords / short tokens
  );
}

function domainOverlap(domain: string, topicTokens: Set<string>): number {
  const domainTokens = tokenise(domain.replace(/_/g, ' '));
  if (domainTokens.size === 0) return 0;
  let hits = 0;
  for (const t of domainTokens) {
    if (topicTokens.has(t)) hits++;
  }
  return hits / domainTokens.size;
}

export function scoreExpert(expert: ExpertWithTags, topicTokens: Set<string>): number {
  if (expert.domainTags.length === 0) return 0;
  const total = expert.domainTags.reduce((sum, tag) => {
    const overlap = domainOverlap(tag.domain, topicTokens);
    return sum + tag.confidence * overlap;
  }, 0);
  return total / expert.domainTags.length;
}

export function matchedDomains(expert: ExpertWithTags, topicTokens: Set<string>): string[] {
  return expert.domainTags
    .filter((tag) => domainOverlap(tag.domain, topicTokens) > 0)
    .map((tag) => tag.domain);
}

export async function matchExperts(
  tc: TenantContext,
  client: TenantScopedClient,
  topic: string,
  topK = 5,
): Promise<MatchedExpert[]> {
  const topicTokens = tokenise(topic);

  const experts = await listExperts(tc, client, { status: 'active' });

  const scored = experts
    .map((expert) => ({
      expert,
      relevanceScore: scoreExpert(expert, topicTokens),
      matchedDomains: matchedDomains(expert, topicTokens),
    }))
    .filter((r) => r.relevanceScore > 0)
    .sort(
      (a, b) => b.relevanceScore - a.relevanceScore || a.expert.name.localeCompare(b.expert.name),
    )
    .slice(0, topK);

  return scored;
}
