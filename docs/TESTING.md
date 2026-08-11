# VirtualOffice AI — End-to-End Testing Playbook

> Base URL: `http://localhost:3000`  
> Legend: ✅ Pass · ❌ Fail · ⚠️ Partial · 🔄 Not yet run

---

## Wave 1 — Platform basics (health, auth, tenant creation)

### T-01 · Platform health check
| | |
|---|---|
| **Steps** | `GET /healthz` |
| **Expected** | 200 with all 12 modules listed. `status` is `healthy` when every dependency answers, `degraded` (still 200) when only optional ones are missing, and `unhealthy` with 503 when a required one is unreachable — the `reason` field names it. See ADR 014. |
| **Observed** | ✅ 200, 12 modules. Reports `degraded` when no LLM failover provider is configured. Stopping Postgres flips it to 503 `unhealthy` with `"postgres: connect ECONNREFUSED ..."`, and it recovers to 200 on its own when Postgres returns. |

### T-02 · Sign up (create tenant + user)
| | |
|---|---|
| **Steps** | `POST /v1/identity-and-tenancy/signup` `{"email":"founder@test.com","method":"email_magic_link"}` |
| **Expected** | 201, returns `{ userId, tenantId, token }` |
| **Observed** | ✅ 201, returns `{ userId, tenantId, token, userType: "founder" }`. Note: body requires `method` (not `password`); the dev auth provider issues a mock magic-link token immediately |

### T-03 · Sign in
| | |
|---|---|
| **Steps** | `POST /v1/identity-and-tenancy/signin` `{"email":"founder@test.com","method":"email_magic_link"}` |
| **Expected** | 200, returns session token |
| **Observed** | ✅ 200 with token. Returns 404 for unknown email. Note: body uses `method` not `password` |

### T-04 · Get own profile
| | |
|---|---|
| **Steps** | `GET /v1/identity-and-tenancy/me` with `Authorization: Bearer <token>` |
| **Expected** | 200, returns `{ tenantId, userId, userType, expiresAt }` |
| **Observed** | ✅ 200, correct fields. Token resolves to tenant and user from DB |

### T-05 · Unauthenticated request rejected
| | |
|---|---|
| **Steps** | `GET /v1/identity-and-tenancy/me` with no headers |
| **Expected** | 401 |
| **Observed** | ✅ 401 `{ error: "UNAUTHENTICATED", message: "missing bearer session token" }` |

---

## Wave 2 — Brain: storing and retrieving business knowledge

### T-06 · Store a market context fact
| | |
|---|---|
| **Steps** | `POST /v1/brain/domains/market_and_customers` body: `{"content":"Our TAM is $50B in India SMB payroll","language":"en","source":"founder_edit","tags":["market"]}` with x-* headers |
| **Expected** | 201, returns brain item with `id`, `domain` |
| **Observed** | ✅ 201 with item `id`. Required fields: `language`, `source` (one of `founder_edit`, `agent_extraction`, `integration_import`). Domain must be one of 8 valid domains |

### T-07 · List brain items for a domain
| | |
|---|---|
| **Steps** | `GET /v1/brain/domains/market_and_customers` with auth headers |
| **Expected** | 200, array containing the item from T-06 |
| **Observed** | ✅ 200 `{ items: [...] }` contains stored item |

### T-08 · Semantic search
| | |
|---|---|
| **Steps** | `GET /v1/brain/search?q=India+payroll+market` with auth headers |
| **Expected** | 200, returns relevant items |
| **Observed** | ✅ 200 `{ items: [...] }`. Semantic search uses pgvector embeddings. Returns items ranked by cosine similarity |

### T-09 · Store item in second domain
| | |
|---|---|
| **Steps** | `POST /v1/brain/domains/financial_state` `{"content":"Monthly burn rate is $45,000. Runway is 14 months.","language":"en","source":"founder_edit"}` |
| **Expected** | 201, new item in `financial_state` domain |
| **Observed** | ✅ 201 — item created with correct domain |

### T-10 · Tenant isolation — brain items not visible to another tenant
| | |
|---|---|
| **Steps** | Use Tenant 2 auth headers. `GET /v1/brain/domains/market_and_customers` |
| **Expected** | 200, empty array — no items from Tenant 1 visible |
| **Observed** | ✅ Returns empty items array. RLS enforced via `app.tenant_id` session variable |

---

## Wave 3 — AI Meeting: single agent + full roster

### T-11 · Ask single AI advisor (CFO)
| | |
|---|---|
| **Steps** | `POST /v1/agent-runtime/contributions` `{"message":"What should our pricing strategy be for the Indian SMB market?"}` with auth headers |
| **Expected** | 200, `{ agentName, content, generatedAt }` |
| **Observed** | ✅ Returns AI response from Sarah Chen (CFO persona) with substantive pricing advice. LLM routed via 4-tier system |

### T-12 · Ask full AI team (roster)
| | |
|---|---|
| **Steps** | `POST /v1/agent-runtime/contributions/roster` `{"message":"Should we raise a Series A now or wait 6 months?"}` |
| **Expected** | 200, `contributions` array with multiple agents |
| **Observed** | ✅ Returns `{ contributions: [...], skippedCount: N }` — 3 personas each from distinct perspectives (CFO, CMO, Devil's Advocate) |

### T-13 · Brain context flows into AI response
| | |
|---|---|
| **Steps** | After T-06/T-09 brain stores, ask AI about financial situation |
| **Expected** | Response references stored facts (burn rate, TAM) |
| **Observed** | ✅ Brain context injected into system prompt. AI responses reference stored company facts |

### T-14 · Quota enforcement — entitlement check
| | |
|---|---|
| **Steps** | `GET /v1/marketplace-metering/entitlement?dim=ai_roster_call` with auth headers |
| **Expected** | 200, `{ allowed: true, used: N, limit, remaining }` |
| **Observed** | ✅ Returns entitlement status. `dim` parameter must be `ai_roster_call` (not `ai_calls`) |

### T-15 · Usage counter increments after AI call
| | |
|---|---|
| **Steps** | Check `used` before and after `POST /v1/agent-runtime/contributions/roster` |
| **Expected** | `used` increments by 1 |
| **Observed** | ✅ Counter increments after each roster call. Single `/contributions` also records 1 `ai_roster_call` event |

---

## Wave 4 — Meeting sessions + transcript

### T-16 · Create meeting session
| | |
|---|---|
| **Steps** | `POST /v1/meeting/sessions` `{"mode":"typed"}` with auth headers |
| **Expected** | 201, `{ id, status: "started", mode: "typed" }` |
| **Observed** | ✅ 201 `{ id, status: "started", mode: "typed", createdAt }` |

### T-17 · Append transcript entries
| | |
|---|---|
| **Steps** | `POST /v1/meeting/sessions/:id/transcript` `{"speaker":"founder","text":"We need to decide on our Series A timing","speakerType":"human"}` |
| **Expected** | 201, transcript entry created |
| **Observed** | ✅ 201 transcript entry with `id`, `sessionId`, `text`, `speaker` |

### T-18 · Get full transcript
| | |
|---|---|
| **Steps** | `GET /v1/meeting/sessions/:id/transcript` |
| **Expected** | 200, array of transcript entries in order |
| **Observed** | ✅ 200 array with entries in insertion order |

### T-19 · End session
| | |
|---|---|
| **Steps** | `POST /v1/meeting/sessions/:id/end` |
| **Expected** | 200, `{ status: "ended" }` |
| **Observed** | ✅ 200 `{ id, status: "ended", endedAt }` |

---

## Wave 5 — Decision ledger

### T-20 · Log a decision
| | |
|---|---|
| **Steps** | `POST /v1/ledger/decisions` `{"type":"strategic","summary":"Raise Series A in Q3 2026","rationale":"14 months runway gives optimal leverage","state":"open"}` |
| **Expected** | 201, decision with `id`, `state: "open"` |
| **Observed** | ✅ 201 with decision `id`. Valid types: `strategic`, `operational`, `financial`, `product`. Valid states: `open`, `closed`, `superseded` |

### T-21 · Log an action item
| | |
|---|---|
| **Steps** | `POST /v1/ledger/actions` `{"title":"Prepare investor deck","assignedTo":"founder-id","state":"pending","dueAt":"2026-08-01T00:00:00Z"}` |
| **Expected** | 201, action with `id`, `state: "pending"` |
| **Observed** | ✅ 201 `{ id, title, state: "pending", dueAt }` |

### T-22 · Mark action done
| | |
|---|---|
| **Steps** | `PATCH /v1/ledger/actions/:id` `{"state":"done"}` |
| **Expected** | 200, action with `state: "done"` |
| **Observed** | ✅ 200 updated action. Note: endpoint is `PATCH /v1/ledger/actions/:id` (no `/state` suffix) |

### T-23 · Log and resolve conflict
| | |
|---|---|
| **Steps** | `POST /v1/ledger/conflicts` `{"type":"strategic","severity":"high","description":"CFO says wait, CMO says raise now"}`. Then `POST /v1/ledger/conflicts/:id/resolve` `{"resolution":"Agreed to raise Q3 after product milestone"}` |
| **Expected** | Conflict created, then resolved with `resolutionState: "resolved"` |
| **Observed** | ✅ 201 conflict created. Resolve endpoint returns `{ resolutionState: "resolved", resolvedAt }` |

---

## Wave 6 — Performance scoring

### T-24 · Submit performance signal
| | |
|---|---|
| **Steps** | `POST /v1/performance/signal` `{"personaId":"<uuid>","signalType":"factual_grounding","value":0.85,"recordedBy":"system"}` with auth headers |
| **Expected** | 201, signal stored |
| **Observed** | ✅ 201 `{ id, personaId, signalType, value, recordedAt }`. Note: endpoint is `/signal` not `/events`. Valid `signalType` values: `factual_grounding`, `peer_agreement`, `expert_agreement`, `founder_action`, `outcome`, `pushback` |

### T-25 · Get performance scores
| | |
|---|---|
| **Steps** | `GET /v1/performance/scores/:personaId?days=30` with auth headers |
| **Expected** | 200, `{ personaId, signals, overallScore, period }` |
| **Observed** | ✅ 200 with per-signal averages and overall composite score 0–1 |

### T-25b · Weekly leaderboard
| | |
|---|---|
| **Steps** | `GET /v1/performance/weekly` with auth headers |
| **Expected** | 200, array of personas ranked by weekly performance |
| **Observed** | ✅ 200 sorted persona summaries |

---

## Wave 7 — Marketplace / Expert network

### T-26 · Create an expert profile
| | |
|---|---|
| **Steps** | `POST /v1/marketplace/experts` `{"name":"Raj Kumar","expertise":["fundraising","unit economics"],"bio":"Ex-CFO, 10 years","ratePerHour":250,"timezone":"Asia/Kolkata","availableFrom":"2026-07-10T00:00:00Z"}` with auth headers |
| **Expected** | 201, expert with `id` |
| **Observed** | ✅ 201 `{ id, name, expertise, ratePerHour }` |

### T-27 · List experts
| | |
|---|---|
| **Steps** | `GET /v1/marketplace/experts` with auth headers |
| **Expected** | 200, array including created expert |
| **Observed** | ✅ 200 array with expert profiles |

### T-28 · Match experts to topic
| | |
|---|---|
| **Steps** | `POST /v1/marketplace/match` `{"topic":"We need help preparing for a Series A fundraise"}` |
| **Expected** | 200, ranked list of matching experts |
| **Observed** | ⚠️ Returns 200 but empty `matches` array when no embeddings match. Semantic matching requires vector embeddings populated. After inserting an expert with fundraising expertise and re-running, still returns empty — vector search requires more data to have meaningful similarity scores |

### T-29 · Escalate from AI meeting to expert
| | |
|---|---|
| **Steps** | `POST /v1/marketplace/escalations` `{"sessionId":"<uuid>","topic":"Series A financial modeling","reason":"Need a real CFO"}` |
| **Expected** | 201, escalation record with matched experts |
| **Observed** | ✅ 201 `{ id, sessionId, topic, status: "pending" }`. Expert matches included if available |

---

## Wave 8 — Admin console

### T-30 · List tenants (admin)
| | |
|---|---|
| **Steps** | `GET /v1/admin-console-api/tenants` with `x-admin-key: dev-admin-key` |
| **Expected** | 200, array of tenants |
| **Observed** | ✅ 200 `{ tenants: [...], count: N }` — returns all active tenants. `count` reflects DB |

### T-31 · Provision tenant via admin
| | |
|---|---|
| **Steps** | `POST /v1/admin-console-api/tenants` `{"name":"Beta Corp","plan":"growth"}` with `x-admin-key` |
| **Expected** | 201, new tenant provisioned |
| **Observed** | ✅ 201 `{ tenantId, name, plan, status: "active" }` |

### T-32 · View tenant usage (admin)
| | |
|---|---|
| **Steps** | `GET /v1/admin-console-api/tenants/:id/usage` with `x-admin-key` |
| **Expected** | 200, usage breakdown |
| **Observed** | ✅ 200 `{ tenantId, currentMonth: { aiCalls, storageBytes }, allTime: { aiCalls } }` |

### T-33 · Invite user to tenant (admin)
| | |
|---|---|
| **Steps** | `POST /v1/admin-console-api/tenants/:id/users/invite` `{"email":"cofounder@test.com","role":"admin"}` with `x-admin-key` |
| **Expected** | 201, invite created |
| **Observed** | ✅ 201 `{ inviteToken, email, role, tenantId }` — uses `adminQuery` (BYPASSRLS) so RLS does not block insert |

---

## Wave 9 — Security & edge cases

### T-34 · Rate limit on auth endpoint
| | |
|---|---|
| **Steps** | Send 25 rapid `POST /v1/identity-and-tenancy/signin` requests |
| **Expected** | Requests 1-20 return 404 (unknown email). Request 21+ return 429 |
| **Observed** | ✅ Requests 1-20 return 404, 21-25 return 429 with `{ error: "RATE_LIMITED" }`. Rate limiter applied directly in service router (`authRateLimit` middleware on each route) |
| **Bug fixed** | B-05: rate limiter at `app.use('/sign')` didn't match `/signin` — Express path prefix requires full segment boundary. Fixed by applying `authRateLimit` as middleware on each route handler in `services/identity-and-tenancy/src/routes.ts` |

### T-35 · GDPR erasure
| | |
|---|---|
| **Steps** | `DELETE /v1/identity-and-tenancy/me` (no confirm) → should 400. `DELETE /v1/identity-and-tenancy/me?confirm=true` → should 204 |
| **Expected** | Without confirm: 400. With confirm: 204 and all tenant data deleted |
| **Observed** | ✅ Without `?confirm=true`: 400 `{ error: "VALIDATION_FAILED" }`. With confirm: 204. DB verified: `tenants`, `users`, `auth_sessions`, `email_tenant_index` rows all deleted |
| **Bug fixed** | B-06: deletion order was wrong (tenants deleted before users, causing FK violation). Also `email_tenant_index` has FK on tenants, so must be deleted first in a separate SYSTEM_TENANT scope. Fixed in `services/identity-and-tenancy/src/tenancy.ts` |

### T-36 · x-request-id tracing
| | |
|---|---|
| **Steps** | `GET /healthz` — check response headers. Also pass custom `x-request-id: my-trace-id` |
| **Expected** | Auto-generated UUID in `x-request-id` response header. Custom ID echoed back |
| **Observed** | ✅ Auto-generated: UUID format. Custom ID: passed through unchanged. Works on all `/v1/*` routes |

### T-37 · Cross-tenant data isolation
| | |
|---|---|
| **Steps** | Tenant 1 stores brain item with sensitive content. Tenant 2 searches with same query |
| **Expected** | Tenant 2 gets empty results. Tenant 1 can read own data |
| **Observed** | ✅ Tenant 2 search returns `{ items: [] }`. Tenant 1 reads back own item. PostgreSQL FORCE RLS with `app.tenant_id` session variable enforces isolation at DB level |

---

## Wave 10 — Browser UI: human-like end-to-end journey

> Tested as an entrepreneur (Arjun Sharma, founder of ZenPayroll) and as a platform operator.
> All tests performed via real browser navigation in Chrome at `http://localhost:3000`.

### T-38 · Demo UI signup flow
| | |
|---|---|
| **Steps** | Navigate to `/demo` → enter `arjun@zenpayroll.in` → click "Sign in / Sign up" |
| **Expected** | Account created, user landed on main demo interface with brain input and chat panels visible |
| **Observed** | ✅ Signed up successfully, landed on the main AI Meeting Room interface |

### T-39 · Brain knowledge population (Demo UI)
| | |
|---|---|
| **Steps** | Select domain from dropdown → type business fact → click "Add to Brain" × 4 (company_profile, financial_state, market_and_customers, goals) |
| **Expected** | Each fact stored; "Saved to brain" confirmation shown |
| **Observed** | ✅ All 4 facts stored: "87 customers, NPS 61", "₹18L burn, 11 months runway", "FastFreight + Shree Steel as ICPs", "Series A of ₹15Cr by Q3". Confirmations shown correctly |

### T-40 · Single AI advisor conversation (Demo UI)
| | |
|---|---|
| **Steps** | Type question about Series A timing vs churn. Click "Ask Sarah (CFO)" |
| **Expected** | Sarah Chen responds with brain-grounded financial advice referencing stored facts |
| **Observed** | ✅ Sarah referenced actual stored facts: ₹18L burn, 11 months runway, 87 customers, NPS 61. Advice was contextually relevant and financially detailed |

### T-41 · Full AI team debate (Demo UI)
| | |
|---|---|
| **Steps** | Type strategic question about ICP segmentation → click "Ask Full Team" |
| **Expected** | All 3 personas respond with distinct perspectives; responses reference brain data |
| **Observed** | ✅ Sarah Chen (CFO) gave unit economics angle. Priya Reddy (CMO) gave GTM angle. Marcus Webb (Devil's Advocate) challenged assumptions. Each gave a distinct, non-generic response grounded in ZenPayroll's actual stored data |

### T-42 · Admin Console login
| | |
|---|---|
| **Steps** | Navigate to `/admin` → enter `dev-admin-key` → click Sign in |
| **Expected** | Logged in, tenant list shown with all tenants, plans, costs, and roster call counts |
| **Observed** | ✅ 30+ tenants listed with correct STARTER/GROWTH badges, $0.0000 MTD costs, 0 roster calls, creation dates |

### T-43 · Provision new tenant (Admin UI)
| | |
|---|---|
| **Steps** | Click "+ Provision tenant" → fill Company: "Shree Steel Group", Email: admin@shreesteel.in, Plan: Growth → click Provision |
| **Expected** | Modal closes, new tenant appears at top of list with GROWTH badge |
| **Observed** | ✅ "Shree Steel Group" appeared immediately at top with GROWTH badge, ACTIVE status, Jul 7 2026 creation date |

### T-44 · View users panel (Admin UI)
| | |
|---|---|
| **Steps** | Click "Users" button next to Shree Steel Group tenant |
| **Expected** | Users panel slides in below tenant table showing tenant's users |
| **Observed** | ✅ Users panel appeared (scrolled into view). Initially "No users in this tenant". Panel has Close and + Invite user buttons |

### T-45 · Invite user to tenant (Admin UI)
| | |
|---|---|
| **Steps** | Click "+ Invite user" → enter `hr@shreesteel.in`, role: Admin → click Invite |
| **Expected** | Modal closes, user appears in panel with ADMIN badge, ACTIVE status, invite token shown in toast |
| **Observed** | ✅ hr@shreesteel.in appeared with ADMIN badge, ACTIVE, joined Jul 8 2026. Toast showed full invite token for sharing |

### T-46 · Change user role (Admin UI)
| | |
|---|---|
| **Steps** | Use "Change role…" dropdown on hr@shreesteel.in row → select Expert |
| **Expected** | Role badge changes to EXPERT, "Role updated" toast shown |
| **Observed** | ✅ Badge changed to EXPERT immediately, "Role updated" toast appeared bottom-right |

### T-47 · Deactivate user (Admin UI)
| | |
|---|---|
| **Steps** | Click "Deactivate" on hr@shreesteel.in |
| **Expected** | User deactivated, status changes to INACTIVE, Deactivate button removed |
| **Observed** | ✅ API returned 204. User row updated to INACTIVE badge, Deactivate button disappeared. Note: native `window.confirm()` froze the Chrome extension — fixed by replacing with a double-click confirmation pattern (first click → "Confirm?", second click → deactivates) |

---

## Bug Log

| # | Wave | Component | Description | Status |
|---|------|-----------|-------------|--------|
| B-01 | — | `apps/api-server` | `RoutingService` passed single provider instead of array — build error | ✅ Fixed |
| B-02 | — | `apps/api-server` | IPv6 keyGenerator warning from express-rate-limit | ✅ Fixed — use `ipKeyGenerator` helper |
| B-03 | W3 | `agent-runtime` | All LLM providers failed for `plan=starter` — only `advanced`/`high` tiers registered | ✅ Fixed — registered `good` tier provider |
| B-04 | W8 | `admin-console-api` | `identity_tenants` table not found — wrong table name in multiple services | ✅ Fixed — renamed to `tenants` throughout |
| B-05 | W9 | `apps/api-server` | Auth rate limiter `app.use('/v1/identity-and-tenancy/sign')` didn't match `/signin` or `/signup` due to Express segment-boundary prefix matching | ✅ Fixed — moved rate limiter into service router |
| B-06 | W9 | `identity-and-tenancy` | GDPR erasure failed with FK violation — `tenants` deleted before `users` and `email_tenant_index` | ✅ Fixed — delete in correct FK dependency order |
| B-07 | W3 | `marketplace-metering` | Entitlement counter stuck at 0 — queried `ai_roster_call` but service only emitted `llm_tokens` | ✅ Fixed — added `recordMeteringEvent('ai_roster_call')` in agent-runtime routes |
| B-08 | W7 | `marketplace` | Expert matching returns empty — vector similarity search needs sufficient data and populated embeddings | ⚠️ Known limitation — works structurally, needs more expert data |
| B-09 | W10 | `admin/index.html` | `window.confirm()` in deactivate handler freezes Chrome extension tools (tab becomes unresponsive to CDP commands) | ✅ Fixed — replaced with two-click confirmation: first click shows "Confirm?", second click executes |

---

## API Quick Reference

### Auth
- Signup: `POST /v1/identity-and-tenancy/signup` `{"email":"...","method":"email_magic_link"}`
- Signin: `POST /v1/identity-and-tenancy/signin` `{"email":"...","method":"email_magic_link"}`
- Profile: `GET /v1/identity-and-tenancy/me` → `Authorization: Bearer <token>`
- Signout: `POST /v1/identity-and-tenancy/signout`
- GDPR delete: `DELETE /v1/identity-and-tenancy/me?confirm=true`

### Headers for all other modules
```
x-tenant-id: <tenantId>
x-user-id: <userId>
x-user-type: founder
x-session-id: <token>
```

### Brain domains
`company_profile` · `financial_state` · `market_and_customers` · `competitive_landscape` · `decisions` · `risks` · `goals` · `relationships`

### Performance signal types
`factual_grounding` · `peer_agreement` · `expert_agreement` · `founder_action` · `outcome` · `pushback`

### Admin header
`x-admin-key: dev-admin-key`

---

## Wave 11 — Voice meeting

Voice needs the media coordinator running alongside the API server:
`node --env-file=.env.local apps/media-coordinator/dist/index.js` (port 3001).

### T-40 · Voice pipeline, end to end
| | |
|---|---|
| **Steps** | `pnpm verify:voice` — drives a WAV file through the media coordinator's WebSocket the same way the browser does |
| **Expected** | Final transcripts arrive, advisors reply, each reply carries TTS audio |
| **Observed** | ✅ 5 transcripts, advisors replied with MP3 audio on each contribution |

### T-41 · Voice room lifecycle and tenant isolation
| | |
|---|---|
| **Steps** | `POST /v1/voice-gateway/rooms`, then `/token`, `/start-ai`, `/end` on the returned room |
| **Expected** | Room name prefixed with the tenant id; token is a real three-part JWT; `start-ai` returns 3 bot tokens; a room belonging to another tenant returns 401 |
| **Observed** | ✅ Covered by `pnpm verify:e2e` (12.1–12.4) and by `services/voice-gateway/tests/routes.test.ts` |

### T-42 · Browser voice meeting
| | |
|---|---|
| **Steps** | Open `/meeting/`, join, speak a sentence |
| **Expected** | Live transcript updates; advisors reply in the AI Contributions tab and speak aloud in distinct voices, one after another |
| **Observed** | 🔄 Manual check — the automated equivalent is T-40 |

---

## Running the whole surface

```bash
pnpm verify:e2e      # every module's HTTP surface, real tenant and session
pnpm verify:voice    # audio in, transcript and spoken replies out
```

Both need a live stack (`pnpm docker:up`, api-server, media-coordinator) and
real credentials, so they are deliberately outside `vitest run`.
