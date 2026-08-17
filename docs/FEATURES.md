# VirtualOffice AI — Feature Reference

> End-user and operator features across all modules. All API calls go to `http://localhost:3000` (dev) or the staging ALB URL.

---

## 1. Identity & Tenancy

**Who uses it:** Every user — founders signing up, admins managing access.

| # | Feature | Endpoint |
|---|---------|----------|
| 1.1 | Sign up — create account + tenant | `POST /v1/identity-and-tenancy/signup` |
| 1.2 | Sign in — get session token | `POST /v1/identity-and-tenancy/signin` |
| 1.3 | Sign out — invalidate session | `POST /v1/identity-and-tenancy/signout` |
| 1.4 | View own profile | `GET /v1/identity-and-tenancy/me` |
| 1.5 | Delete account (GDPR erasure) | `DELETE /v1/identity-and-tenancy/me?confirm=true` |

**Headers required for authenticated calls:** `x-tenant-id`, `x-user-id`, `x-user-type: founder`, `x-session-id`

---

## 2. AI Meeting Room (Agent Runtime)

**Who uses it:** Founders — the core product. Ask your AI team anything.

| # | Feature | Endpoint |
|---|---------|----------|
| 2.1 | Ask a single AI advisor (Sarah Chen, CFO) | `POST /v1/agent-runtime/contributions` |
| 2.2 | Ask the full AI team (Sarah CFO + Priya CMO + Marcus Chief of Staff) in parallel | `POST /v1/agent-runtime/contributions/roster` |
| 2.3 | Escalate topic to a real human expert | `POST /v1/agent-runtime/escalate` |
| 2.4 | View escalation history | `GET /v1/agent-runtime/escalations` |
| 2.5 | Update escalation status | `PATCH /v1/agent-runtime/escalations/:id` |

**Request body:** `{ "message": "What is our burn rate?", "sessionId": "optional-session-id" }`

**AI Personas:**
- **Sarah Chen** — CFO/Financial Advisor. Finance, runway, unit economics.
- **Priya Reddy** — CMO/Marketing Strategist. GTM, brand, customer acquisition.
- **Marcus Webb** — Chief of Staff. Whether the plan holds together: sequencing, dependencies, the real constraint. Challenges assumptions when the plan warrants it, after giving his own read.

---

## 3. Meeting Sessions

**Who uses it:** Founders running structured AI-assisted meetings.

| # | Feature | Endpoint |
|---|---------|----------|
| 3.1 | Start a meeting session | `POST /v1/meeting/sessions` |
| 3.2 | Get session details | `GET /v1/meeting/sessions/:id` |
| 3.3 | Activate session (move to active) | `POST /v1/meeting/sessions/:id/end` |
| 3.4 | End session | `POST /v1/meeting/sessions/:id/end` |
| 3.5 | Append transcript entry | `POST /v1/meeting/sessions/:id/transcript` |
| 3.6 | Get full transcript | `GET /v1/meeting/sessions/:id/transcript` |
| 3.7 | Subscribe to live session events (SSE) | `GET /v1/meeting/sessions/:id/events` |
| 3.8 | Upload an agenda or brief for a meeting | `PUT /v1/meeting/sessions/:id/brief` |
| 3.9 | Read the brief | `GET /v1/meeting/sessions/:id/brief` |
| 3.10 | Remove the brief | `DELETE /v1/meeting/sessions/:id/brief` |

**Meeting briefs.** An agenda the founder supplies before the meeting so
advisors arrive knowing the subject. Body: `{ content, title?, sourceFilename? }`,
up to 15,000 characters. One per session — re-uploading replaces it.

Advisors read it on every turn, so they open with a view rather than with
"what are you building?". Measured on the same question, without a brief:
*"I need to understand what problem this solves and who's paying for it."*
With one: *"You've got 240,000 dollars and you're burning 40,000 a month, so
you're sitting at roughly six months."*

In the voice UI it is the agenda box on the join screen; `.txt` and `.md`
attachments are read in the browser, anything else is pasted. Pass
`meetingSessionId` on a roster call to have the advisors read it.

---

## 4. Brain — Persistent Business Knowledge

**Who uses it:** Founders — the AI team remembers everything across sessions.

| # | Feature | Endpoint |
|---|---------|----------|
| 4.1 | Store a business fact (any of 8 domains) | `POST /v1/brain/domains/:domain` |
| 4.2 | List brain items for a domain | `GET /v1/brain/domains/:domain` |
| 4.3 | Semantic search across all brain content | `GET /v1/brain/search?q=...` |
| 4.4 | Get single brain item + history | `GET /v1/brain/items/:id` |
| 4.5 | Update a brain item | `PATCH /v1/brain/items/:id` |
| 4.6 | Delete (soft) a brain item | `DELETE /v1/brain/items/:id` |
| 4.7 | Get change history for an item | `GET /v1/brain/items/:id/history` |

**8 Knowledge Domains:** `company_profile` · `financial_state` · `market_and_customers` · `competitive_landscape` · `decisions` · `risks` · `goals` · `relationships`

**Required body fields:** `content` (string), `language` (e.g. `"en"`), `source` (one of `founder_edit`, `agent_extraction`, `integration_import`). Optional: `tags[]`

---

## 5. Decision Ledger

**Who uses it:** Founders tracking decisions, actions, and conflicts from AI sessions.

| # | Feature | Endpoint |
|---|---------|----------|
| 5.1 | Log a decision | `POST /v1/ledger/decisions` |
| 5.2 | List decisions | `GET /v1/ledger/decisions` *(via router)* |
| 5.3 | Record an action item | `POST /v1/ledger/actions` |
| 5.4 | Update action state (pending→done) | `PATCH /v1/ledger/actions/:id` |
| 5.5 | Log a conflict | `POST /v1/ledger/conflicts` |
| 5.6 | Resolve a conflict | `POST /v1/ledger/conflicts/:id/resolve` |
| 5.7 | Supersede a decision | `PATCH /v1/ledger/decisions/:id/supersede` |

---

## 6. Performance Scoring

**Who uses it:** Founders reviewing their company's health score.

| # | Feature | Endpoint |
|---|---------|----------|
| 6.1 | Record a performance signal | `POST /v1/performance/signal` |
| 6.2 | Get scores for a persona (last N days) | `GET /v1/performance/scores/:personaId?days=30` |
| 6.3 | Weekly leaderboard across all personas | `GET /v1/performance/weekly` |

**6 Signal Types:** `factual_grounding` · `peer_agreement` · `expert_agreement` · `founder_action` · `outcome` · `pushback`

**Signal values:** 0.0–1.0 (float). `recordedBy`: `system`, `founder`, or `expert`

---

## 7. Marketplace — Expert Network

**Who uses it:** Founders needing a real human expert (lawyer, CFO, CMO, etc.).

| # | Feature | Endpoint |
|---|---------|----------|
| 7.1 | Browse/list experts | `GET /v1/marketplace/experts` |
| 7.2 | Get expert profile | `GET /v1/marketplace/experts/:id` |
| 7.3 | Match experts to a topic (AI-ranked) | `POST /v1/marketplace/match` |
| 7.4 | Check expert availability | `GET /v1/marketplace/experts/:id/availability` |
| 7.5 | Get booking slots | `GET /v1/marketplace/experts/:id/slots` |
| 7.6 | Book a session | `POST /v1/marketplace/experts/:id/book` |
| 7.7 | Register as an expert | `POST /v1/marketplace/experts` |

---

## 8. Usage Metering & Entitlements

**Who uses it:** Founders monitoring their plan usage; billing events.

| # | Feature | Endpoint |
|---|---------|----------|
| 8.1 | Check plan entitlement / quota remaining | `GET /v1/marketplace-metering/entitlement?dim=ai_roster_call` |
| 8.2 | View usage summary | `GET /v1/marketplace-metering/usage` |

**Plan tiers:** `starter` (100 AI calls/mo) · `growth` (1 000/mo) · `enterprise` (unlimited)

---

## 9. Notifications — Morning Briefing

**Who uses it:** Founders — daily AI-generated briefing based on their business data.

| # | Feature | Endpoint |
|---|---------|----------|
| 9.1 | Generate morning briefing | `POST /v1/notification/complete` |

---

## 10. Admin Console

**Who uses it:** Platform operators (internal team).

| # | Feature | Endpoint |
|---|---------|----------|
| 10.1 | List all tenants | `GET /v1/admin-console-api/tenants` |
| 10.2 | Provision new tenant | `POST /v1/admin-console-api/tenants` |
| 10.3 | View tenant usage | `GET /v1/admin-console-api/tenants/:id/usage` |
| 10.4 | List users in tenant | `GET /v1/admin-console-api/tenants/:id/users` |
| 10.5 | Invite user to tenant | `POST /v1/admin-console-api/tenants/:id/users/invite` |
| 10.6 | Change user role | `PATCH /v1/admin-console-api/tenants/:id/users/:uid/role` |
| 10.7 | Deactivate user | `DELETE /v1/admin-console-api/tenants/:id/users/:uid` |
| 10.8 | Admin Web UI | `GET /admin` (browser) |

**Auth:** `x-admin-key` header (set via `ADMIN_API_KEY` env var)

---

## 11. Voice Meeting (Voice Gateway + Media Coordinator)

**Who uses it:** Founders who want to *talk* to their AI team instead of typing.

| # | Feature | Endpoint |
|---|---------|----------|
| 11.1 | Create a voice room | `POST /v1/voice-gateway/rooms` |
| 11.2 | Get a participant token (human joins) | `POST /v1/voice-gateway/rooms/:name/token` |
| 11.3 | Start the AI advisors in the room | `POST /v1/voice-gateway/rooms/:name/start-ai` |
| 11.4 | End the room | `POST /v1/voice-gateway/rooms/:name/end` |
| 11.5 | Voice Meeting Web UI | `GET /meeting` (browser) |
| 11.6 | Type a message mid-meeting | text frame on the media-coordinator WebSocket |

**Speaking and typing are interchangeable.** The meeting has a message box
beside the mic. Both go to the advisors over the same WebSocket — binary frames
are audio, text frames (`{"type":"message","text":"..."}`) are typed input —
so a meeting moves between the two without reconnecting.

Typing is not a fallback for a broken mic. It is the better input when a
product name keeps being misheard, when a figure has to be exact, or when you
are somewhere you cannot talk. Advisors still reply aloud, since you are in a
voice meeting. Typing while an advisor is speaking interrupts them, exactly as
speaking over them does.

**Tenant isolation:** room names are prefixed with the tenant id; joining,
starting AI in, or ending a room whose prefix doesn't match the caller's tenant
returns 401.

**How the audio flows:**

1. The browser captures the mic with `MediaRecorder` (WebM/Opus, 250 ms slices)
   and streams it to the media-coordinator over a WebSocket.
2. The media-coordinator pipes that to **Deepgram** for streaming transcription.
3. Each final utterance goes to `agent-runtime`, which returns advisor
   contributions.
4. Each contribution is synthesised by **ElevenLabs** in that persona's voice and
   sent back over the same WebSocket, where the browser plays it.

Transcript and advisor replies stream back on that socket as JSON frames, so the
UI updates live.

**Runs on a separate port:** the media-coordinator is its own process on `:3001`
(`node apps/media-coordinator/dist/index.js`) because real-time audio scales
differently from HTTP traffic.

**Required env:** `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`,
`DEEPGRAM_API_KEY`, `ELEVENLABS_API_KEY`. The ElevenLabs key needs the
`text_to_speech` permission. Without these, `/healthz` reports
`voiceReady: false` and STT/TTS degrade to no-ops rather than failing the room.

**Per-persona voices:** configured in
`apps/media-coordinator/src/voice-personas.ts`, overridable with
`VOICE_ID_SARAH`, `VOICE_ID_PRIYA`, `VOICE_ID_MARCUS`.

**Verify it end to end:**

```bash
node apps/media-coordinator/scripts/verify-voice-pipeline.mjs
```

---

## 12. Platform Infrastructure

| # | Feature | Endpoint |
|---|---------|----------|
| 12.1 | Health check (all modules) | `GET /healthz` |
| 12.7 | Per-module health check | `GET /v1/:module/healthz` |
| 12.2 | Demo Web UI | `GET /demo` (browser) |
| 12.3 | Admin Web UI | `GET /admin` (browser) |
| 12.4 | Rate limiting | Built-in — 1000/15min global, 20/15min auth, 100/min metering |
| 12.5 | Audit log | Automatic — every write recorded with actor + timestamp |
| 12.6 | Distributed trace IDs | `x-request-id` header on every response |

**Health check semantics** — `/healthz` probes real dependencies rather than
returning a constant, so it can actually fail:

| Status | HTTP | Meaning |
|--------|------|---------|
| `healthy` | 200 | Every dependency answered |
| `degraded` | 200 | Reduced capability, still serving — e.g. no LLM failover configured, or Neo4j down so expert *matching* is unavailable while listing still works |
| `unhealthy` | 503 | A required dependency is unreachable; the response `reason` names which one |

`degraded` stays 200 deliberately: a load balancer should not pull a task out of
rotation over a missing optional dependency. Probes are capped at 2s each, so a
store that accepts connections but never answers fails the check instead of
hanging it.
