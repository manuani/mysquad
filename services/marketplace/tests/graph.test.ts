import { describe, expect, it, vi } from 'vitest';
import { indexExpertDomains, graphMatchExperts, removeExpertFromGraph } from '../src/graph.js';
import type { ExpertWithTags } from '../src/experts.js';

const TC = { tenantId: 'ten-1', userId: 'u-1', userType: 'founder' as const, sessionId: null };

const EXPERT: ExpertWithTags = {
  id: 'exp-1',
  tenantId: 'ten-1',
  name: 'Alice Fintech',
  email: 'alice@x.com',
  bio: 'Payments expert',
  linkedinUrl: null,
  status: 'active',
  hourlyRateUsdCents: 20000,
  createdAt: new Date().toISOString(),
  domainTags: [
    { id: 'tag-1', expertId: 'exp-1', domain: 'fintech', confidence: 0.9, createdAt: new Date().toISOString() },
    { id: 'tag-2', expertId: 'exp-1', domain: 'payments', confidence: 0.8, createdAt: new Date().toISOString() },
  ],
};

function makeSession(runFn = vi.fn().mockResolvedValue({ records: [] })) {
  return { run: runFn, close: vi.fn().mockResolvedValue(undefined) };
}

function makeNeo4j(session = makeSession()) {
  return { session: () => session };
}

describe('indexExpertDomains', () => {
  it('is a no-op when neo4j is null', async () => {
    await expect(indexExpertDomains(TC, { neo4j: null }, EXPERT)).resolves.toBeUndefined();
  });

  it('merges Expert node and HAS_DOMAIN relationships for each tag', async () => {
    const runFn = vi.fn().mockResolvedValue({});
    const session = makeSession(runFn);
    await indexExpertDomains(TC, { neo4j: makeNeo4j(session) as never }, EXPERT);
    // 1 MERGE Expert + 2 MERGE Domain calls = 3 total
    expect(runFn).toHaveBeenCalledTimes(3);
    expect(runFn.mock.calls[0]![0]).toContain('MERGE (e:Expert');
    expect(runFn.mock.calls[1]![0]).toContain('MERGE (d:Domain');
    expect(session.close).toHaveBeenCalled();
  });
});

describe('graphMatchExperts', () => {
  it('returns empty array when neo4j is null', async () => {
    const result = await graphMatchExperts(TC, { neo4j: null }, ['fintech']);
    expect(result).toEqual([]);
  });

  it('returns empty array when topicTokens is empty', async () => {
    const neo4j = makeNeo4j();
    const result = await graphMatchExperts(TC, { neo4j: neo4j as never }, []);
    expect(result).toEqual([]);
  });

  it('maps records to expertId + graphScore', async () => {
    const fakeRecords = [
      { get: (k: string) => k === 'expertId' ? 'exp-1' : 1.7 },
    ];
    const session = makeSession(vi.fn().mockResolvedValue({ records: fakeRecords }));
    const result = await graphMatchExperts(TC, { neo4j: makeNeo4j(session) as never }, ['fintech'], 5);
    expect(result).toEqual([{ expertId: 'exp-1', graphScore: 1.7 }]);
  });
});

describe('removeExpertFromGraph', () => {
  it('is a no-op when neo4j is null', async () => {
    await expect(removeExpertFromGraph({ neo4j: null }, 'exp-1')).resolves.toBeUndefined();
  });

  it('runs DETACH DELETE for the given expert id', async () => {
    const runFn = vi.fn().mockResolvedValue({});
    const session = makeSession(runFn);
    await removeExpertFromGraph({ neo4j: makeNeo4j(session) as never }, 'exp-1');
    expect(runFn).toHaveBeenCalledWith(expect.stringContaining('DETACH DELETE'), { expertId: 'exp-1' });
    expect(session.close).toHaveBeenCalled();
  });
});
