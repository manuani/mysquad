/**
 * Full-surface smoke test against a running stack.
 *
 * Walks the real HTTP surface a client uses — signup, the AI roster, meetings,
 * brain, ledger, entitlements, and the voice gateway — asserting each module
 * answers correctly with a real tenant and session.
 *
 * This is a live-stack check, not a unit test: it needs the data stack up
 * (`pnpm docker:up`), api-server on :3000, and real ANTHROPIC_API_KEY /
 * LIVEKIT_* credentials, so it is deliberately kept out of `vitest run`.
 *
 * Usage:
 *   node scripts/verify-platform-e2e.mjs
 *
 * Exits 0 only when every check passes.
 *
 * For the audio path specifically (Deepgram STT -> advisors -> ElevenLabs TTS),
 * see apps/media-coordinator/scripts/verify-voice-pipeline.mjs.
 */
const API = process.env.API_URL ?? 'http://localhost:3000';
const results = [];
let H = {};

const ok = (n, pass, detail = '') => {
  results.push({ n, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${n}${detail ? '  — ' + detail : ''}`);
};

async function call(method, path, body, headers = H) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

const email = `e2e-${Date.now()}@example.com`;

// ── 1. Identity & tenancy ────────────────────────────────────────────────
const signup = await call('POST', '/v1/identity-and-tenancy/signup',
  { email, method: 'email_magic_link' }, {});
ok('1.1 signup', signup.status === 201, `status ${signup.status}`);

const a = signup.json ?? {};
H = {
  'x-tenant-id': a.tenantId,
  'x-user-id': a.userId,
  'x-user-type': a.userType ?? 'founder',
  'x-session-id': a.sessionToken,
};
const sessionToken = a.sessionToken;

const signin = await call('POST', '/v1/identity-and-tenancy/signin', { email, method: 'email_magic_link' }, {});
ok('1.2 signin', signin.status === 200 && !!signin.json?.sessionToken, `status ${signin.status}`);

const me = await call('GET', '/v1/identity-and-tenancy/me', null, { ...H, authorization: `Bearer ${sessionToken}` });
ok('1.4 me', me.status === 200, `status ${me.status}`);

// ── 2. Agent runtime (the core product) ──────────────────────────────────
const single = await call('POST', '/v1/agent-runtime/contributions',
  { message: 'What is our runway if we burn 40k a month with 240k in the bank?' });
const singleText = single.json?.contribution?.content ?? single.json?.content;
ok('2.1 single advisor', single.status === 200 && !!singleText,
  `status ${single.status}${singleText ? `, ${singleText.length} chars` : ''}`);

const roster = await call('POST', '/v1/agent-runtime/contributions/roster',
  { message: 'Should we cut marketing spend or raise a bridge round?' });
const replied = roster.json?.contributions?.filter((c) => !c.skipped) ?? [];
ok('2.2 full roster', roster.status === 200 && replied.length >= 2,
  `status ${roster.status}, ${replied.length} advisors: ${replied.map((c) => c.agentName).join(', ')}`);

// ── 3. Meeting sessions ──────────────────────────────────────────────────
const mtg = await call('POST', '/v1/meeting/sessions', { mode: 'typed' });
const mtgId = mtg.json?.id ?? mtg.json?.sessionId;
ok('3.1 create meeting', mtg.status === 201 && !!mtgId, `status ${mtg.status}`);

if (mtgId) {
  const tr = await call('POST', `/v1/meeting/sessions/${mtgId}/transcript`,
    { speakerType: 'founder', speakerName: 'E2E Founder', content: 'We need to decide on the bridge round.' });
  ok('3.5 append transcript', tr.status === 201 || tr.status === 200, `status ${tr.status}`);

  const got = await call('GET', `/v1/meeting/sessions/${mtgId}/transcript`);
  ok('3.6 read transcript', got.status === 200, `status ${got.status}`);

  const ended = await call('POST', `/v1/meeting/sessions/${mtgId}/end`, {});
  ok('3.4 end meeting', ended.status === 200, `status ${ended.status}`);
}

// ── 4. Brain (persistent business knowledge) ─────────────────────────────
const brainWrite = await call('POST', '/v1/brain/domains/financial_state',
  { language: 'en', content: 'Monthly burn is 40000 USD with 240000 in the bank.', source: 'founder_edit' });
ok('4.1 write brain domain', brainWrite.status === 200 || brainWrite.status === 201, `status ${brainWrite.status}`);

const brainRead = await call('GET', '/v1/brain/domains/financial_state');
ok('4.2 read brain domain', brainRead.status === 200, `status ${brainRead.status}`);

// ── 5. Decision ledger ───────────────────────────────────────────────────
const dec = await call('POST', '/v1/ledger/decisions',
  { decisionType: 'financial', summary: 'Raise a bridge round to extend runway', stakesLevel: 'high' });
ok('5.1 record decision', dec.status === 201 || dec.status === 200, `status ${dec.status}`);

const active = await call('GET', '/v1/ledger/currently-active');
ok('5.2 list active decisions', active.status === 200, `status ${active.status}`);

// ── 8. Metering & entitlements (exercises the fixed seats query) ─────────
const entSeats = await call('GET', '/v1/marketplace-metering/entitlement?dim=seats');
ok('8.1 entitlement: seats', entSeats.status === 200,
  `status ${entSeats.status} ${JSON.stringify(entSeats.json ?? {}).slice(0, 120)}`);

const entCalls = await call('GET', '/v1/marketplace-metering/entitlement?dim=roster_calls_per_month');
ok('8.2 entitlement: roster calls', entCalls.status === 200,
  `status ${entCalls.status} ${JSON.stringify(entCalls.json ?? {}).slice(0, 120)}`);

const usage = await call('GET', '/v1/marketplace-metering/usage');
ok('8.3 usage', usage.status === 200, `status ${usage.status}`);

// ── 12. Voice gateway ────────────────────────────────────────────────────
const room = await call('POST', '/v1/voice-gateway/rooms', { title: 'E2E voice room' });
const roomName = room.json?.roomName;
ok('12.1 create voice room', room.status === 201 && !!roomName, `status ${room.status} ${roomName ?? ''}`);

if (roomName) {
  const tok = await call('POST', `/v1/voice-gateway/rooms/${roomName}/token`, { displayName: 'E2E' });
  const jwtLooksReal = typeof tok.json?.token === 'string' && tok.json.token.split('.').length === 3;
  ok('12.2 participant token is a real JWT', tok.status === 200 && jwtLooksReal,
    `status ${tok.status}${tok.json?.token ? `, token ${String(tok.json.token).length} chars` : ''}`);

  const ai = await call('POST', `/v1/voice-gateway/rooms/${roomName}/start-ai`, { sessionToken });
  ok('12.3 start AI bots', ai.status === 201 && ai.json?.botTokens?.length === 3,
    `status ${ai.status}, ${ai.json?.botTokens?.length ?? 0} bots`);

  const end = await call('POST', `/v1/voice-gateway/rooms/${roomName}/end`,
    { voiceSessionId: ai.json?.voiceSessionId });
  ok('12.4 end voice room', end.status === 200, `status ${end.status}`);
}

const passed = results.filter((r) => r.pass).length;
console.log(`\n=== ${passed}/${results.length} passed ===`);
if (passed < results.length) {
  console.log('failures:');
  results.filter((r) => !r.pass).forEach((r) => console.log('  -', r.n, r.detail));
}
process.exit(passed === results.length ? 0 : 1);
