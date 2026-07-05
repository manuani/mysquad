import { describe, expect, it } from 'vitest';
import { scoreExpert, matchExperts, matchedDomains } from '../src/matching.js';
import type { ExpertWithTags } from '../src/experts.js';
import type { TenantContext } from '@voai/auth-context';

const TC: TenantContext = {
  tenantId: 'tenant-1',
  userId: 'user-1',
  userType: 'founder',
  sessionId: 'sess-1',
};

function makeExpert(overrides: Partial<ExpertWithTags> = {}): ExpertWithTags {
  return {
    id: 'exp-1',
    tenantId: 'tenant-1',
    name: 'Alice Expert',
    email: 'alice@example.com',
    bio: null,
    linkedinUrl: null,
    status: 'active',
    hourlyRateUsdCents: 30000,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    domainTags: [],
    ...overrides,
  };
}

describe('scoreExpert', () => {
  it('returns 0 for expert with no domain tags', () => {
    const score = scoreExpert(makeExpert({ domainTags: [] }), new Set(['saas', 'pricing']));
    expect(score).toBe(0);
  });

  it('returns > 0 when topic overlaps domain slug', () => {
    const expert = makeExpert({
      domainTags: [
        {
          id: 'tag-1',
          expertId: 'exp-1',
          domain: 'saas_pricing',
          confidence: 1.0,
          verified: true,
          createdAt: '',
        },
      ],
    });
    expect(scoreExpert(expert, new Set(['saas', 'pricing']))).toBeGreaterThan(0);
  });

  it('higher confidence amplifies the score', () => {
    const make = (confidence: number) =>
      makeExpert({
        domainTags: [
          {
            id: 't',
            expertId: 'exp-1',
            domain: 'fundraising',
            confidence,
            verified: false,
            createdAt: '',
          },
        ],
      });
    expect(scoreExpert(make(0.9), new Set(['fundraising']))).toBeGreaterThan(
      scoreExpert(make(0.3), new Set(['fundraising'])),
    );
  });

  it('returns 0 when no topic tokens overlap any tag', () => {
    const expert = makeExpert({
      domainTags: [
        {
          id: 't',
          expertId: 'exp-1',
          domain: 'legal_compliance',
          confidence: 1.0,
          verified: false,
          createdAt: '',
        },
      ],
    });
    expect(scoreExpert(expert, new Set(['saas', 'pricing']))).toBe(0);
  });
});

describe('matchedDomains', () => {
  it('returns only domains with token overlap', () => {
    const expert = makeExpert({
      domainTags: [
        {
          id: '1',
          expertId: 'exp-1',
          domain: 'saas_pricing',
          confidence: 0.9,
          verified: false,
          createdAt: '',
        },
        {
          id: '2',
          expertId: 'exp-1',
          domain: 'legal_compliance',
          confidence: 0.8,
          verified: false,
          createdAt: '',
        },
      ],
    });
    const result = matchedDomains(expert, new Set(['saas', 'pricing']));
    expect(result).toContain('saas_pricing');
    expect(result).not.toContain('legal_compliance');
  });
});

describe('matchExperts', () => {
  function makeTag(id: string, expertId: string, domain: string) {
    return { id, expertId, domain, confidence: 0.8, verified: false, createdAt: '' };
  }

  function buildFakeClient(experts: ExpertWithTags[]) {
    return {
      async query(_sql: string, params: unknown[]) {
        // Distinguish between the two queries in listExperts:
        // 1. Profile query (params includes tenantId as string)
        // 2. Tags batch query (params includes array of UUIDs)
        if (Array.isArray(params[0])) {
          // Tags query — params[0] is the array of expert IDs
          return {
            rows: experts.flatMap((e) =>
              e.domainTags.map((t) => ({
                id: t.id,
                expert_id: t.expertId,
                domain: t.domain,
                confidence: t.confidence,
                verified: t.verified,
                created_at: new Date(),
              })),
            ),
          };
        }
        return {
          rows: experts.map((e) => ({
            id: e.id,
            tenant_id: e.tenantId,
            name: e.name,
            email: e.email,
            bio: null,
            linkedin_url: null,
            status: e.status,
            hourly_rate_usd_cents: e.hourlyRateUsdCents,
            created_at: new Date(),
            updated_at: new Date(),
          })),
        };
      },
    };
  }

  it('returns matches sorted by relevance score descending', async () => {
    const experts: ExpertWithTags[] = [
      makeExpert({
        id: 'low',
        name: 'Bob',
        domainTags: [makeTag('t1', 'low', 'legal_compliance')],
      }),
      makeExpert({
        id: 'high',
        name: 'Alice',
        domainTags: [makeTag('t2', 'high', 'saas_pricing')],
      }),
    ];
    const matches = await matchExperts(
      TC,
      buildFakeClient(experts) as never,
      'saas pricing strategy',
      5,
    );
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]!.expert.id).toBe('high');
    for (let i = 1; i < matches.length; i++) {
      expect(matches[i - 1]!.relevanceScore).toBeGreaterThanOrEqual(matches[i]!.relevanceScore);
    }
  });

  it('returns empty array when no experts match', async () => {
    const fakeClient = {
      async query() {
        return { rows: [] };
      },
    };
    const matches = await matchExperts(TC, fakeClient as never, 'quantum computing', 5);
    expect(matches).toHaveLength(0);
  });

  it('respects topK limit', async () => {
    const experts: ExpertWithTags[] = ['e1', 'e2', 'e3'].map((id) =>
      makeExpert({ id, name: id, domainTags: [makeTag(`t-${id}`, id, 'saas_pricing')] }),
    );
    const matches = await matchExperts(TC, buildFakeClient(experts) as never, 'saas pricing', 2);
    expect(matches).toHaveLength(2);
  });

  it('excludes experts with relevance score of 0', async () => {
    const experts: ExpertWithTags[] = [
      makeExpert({
        id: 'no-match',
        name: 'Dave',
        domainTags: [makeTag('t', 'no-match', 'legal_compliance')],
      }),
    ];
    const matches = await matchExperts(
      TC,
      buildFakeClient(experts) as never,
      'financial modeling',
      5,
    );
    expect(matches).toHaveLength(0);
  });
});
