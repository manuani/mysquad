"""
Generate VirtualOffice AI — Product Tracker.xlsx
Run: python3 scripts/generate-tracker.py
"""
import openpyxl
from openpyxl.styles import (
    PatternFill, Font, Alignment, Border, Side, GradientFill
)
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.table import Table, TableStyleInfo
from datetime import date

# ─── Colour palette ────────────────────────────────────────────────────────────
C_DONE      = "1E4D2B"   # dark green  text on done rows
C_DONE_BG   = "D6ECD9"
C_ACTIVE_BG = "D0E8F7"
C_ACTIVE    = "0D2F4A"
C_PEND_BG   = "FFFBEC"
C_PEND      = "4A3A00"
C_DEFERRED  = "F0F0F0"
C_DEFER_TXT = "888888"

C_HDR_PHASE = "1F3B5C"   # phase header row
C_HDR_COL   = "2C5282"   # column header row
C_WHITE     = "FFFFFF"
C_BORDER    = "BBBBBB"

STATUS_STYLE = {
    "Done":      (C_DONE_BG,   C_DONE,    "✅ Done"),
    "Active":    (C_ACTIVE_BG, C_ACTIVE,  "▶ Active"),
    "Pending":   (C_PEND_BG,   C_PEND,    "○ Pending"),
    "Deferred":  (C_DEFERRED,  C_DEFER_TXT,"⏸ Deferred"),
}

thin = Side(style="thin", color=C_BORDER)
border = Border(left=thin, right=thin, top=thin, bottom=thin)

def hdr_fill(hex_color):
    return PatternFill("solid", fgColor=hex_color)

def row_fill(hex_color):
    return PatternFill("solid", fgColor=hex_color)

def phase_font():
    return Font(bold=True, color=C_WHITE, size=11)

def col_font():
    return Font(bold=True, color=C_WHITE, size=10)

def body_font(color="000000", bold=False, size=10):
    return Font(color=color, bold=bold, size=size)

def wrap(cell):
    cell.alignment = Alignment(wrap_text=True, vertical="top")

# ─── Data ──────────────────────────────────────────────────────────────────────
# Columns: Phase | Sprint | Feature | Sub-feature | Status | Owner | Notes
ROWS = [
    # ── PHASE 1 ──────────────────────────────────────────────────────────────
    ("PHASE", "Phase 1 — Foundation & Staging", "", "", "", "", ""),

    ("P1", "S1 — Core Architecture", "TypeScript Monorepo", "pnpm workspaces + Turborepo, 19 packages", "Done", "Engineering", ""),
    ("P1", "S1 — Core Architecture", "TypeScript Monorepo", "tsconfig references + noUncheckedIndexedAccess", "Done", "Engineering", ""),
    ("P1", "S1 — Core Architecture", "TypeScript Monorepo", "ESLint + Prettier + Husky pre-commit", "Done", "Engineering", ""),
    ("P1", "S1 — Core Architecture", "Multi-tenant Data Layer", "TenantContext explicit value type (ADR 007)", "Done", "Engineering", "No AsyncLocalStorage"),
    ("P1", "S1 — Core Architecture", "Multi-tenant Data Layer", "withTenant pattern — RLS via app.tenant_id", "Done", "Engineering", ""),
    ("P1", "S1 — Core Architecture", "Multi-tenant Data Layer", "Two-role Postgres: voai_admin (migrations) + voai_app (runtime)", "Done", "Engineering", ""),
    ("P1", "S1 — Core Architecture", "Multi-tenant Data Layer", "Row-Level Security FORCE on all tenant tables", "Done", "Engineering", ""),
    ("P1", "S1 — Core Architecture", "Multi-tenant Data Layer", "pgvector extension for brain embeddings", "Done", "Engineering", ""),
    ("P1", "S1 — Core Architecture", "Local Dev Stack", "Docker Compose: Postgres + pgvector + Redis + Neo4j", "Done", "Engineering", ""),
    ("P1", "S1 — Core Architecture", "Local Dev Stack", "DB migration runner (node-pg-migrate)", "Done", "Engineering", ""),
    ("P1", "S1 — Core Architecture", "Local Dev Stack", "Turborepo dev task with watch mode", "Done", "Engineering", ""),

    ("P1", "S2 — Core Services", "identity-and-tenancy", "Tenant creation + scoped DB bootstrap", "Done", "Engineering", ""),
    ("P1", "S2 — Core Services", "identity-and-tenancy", "User creation under tenant", "Done", "Engineering", ""),
    ("P1", "S2 — Core Services", "identity-and-tenancy", "Session creation + TenantContext assembly", "Done", "Engineering", ""),
    ("P1", "S2 — Core Services", "brain", "Memory storage (vector embeddings via pgvector)", "Done", "Engineering", ""),
    ("P1", "S2 — Core Services", "brain", "Semantic search: retrieve relevant prior context", "Done", "Engineering", ""),
    ("P1", "S2 — Core Services", "brain", "Neo4j graph: entity + relationship extraction", "Done", "Engineering", ""),
    ("P1", "S2 — Core Services", "brain", "Brain context injected into agent prompts across sessions", "Done", "Engineering", ""),
    ("P1", "S2 — Core Services", "ledger", "decisions table (type, summary, state)", "Done", "Engineering", ""),
    ("P1", "S2 — Core Services", "ledger", "actions table (assigned_to, state, due_at)", "Done", "Engineering", ""),
    ("P1", "S2 — Core Services", "ledger", "conflicts table (type, severity, resolution_state)", "Done", "Engineering", ""),
    ("P1", "S2 — Core Services", "ledger", "CRUD endpoints for all three journal types", "Done", "Engineering", ""),
    ("P1", "S2 — Core Services", "routing", "AnthropicProvider implementing LlmProvider interface", "Done", "Engineering", ""),
    ("P1", "S2 — Core Services", "routing", "RoutingService: single seam for all LLM calls", "Done", "Engineering", ""),
    ("P1", "S2 — Core Services", "routing", "Routing decision structured logging", "Done", "Engineering", ""),
    ("P1", "S2 — Core Services", "agent-runtime", "Single-agent contribution (generateContribution)", "Done", "Engineering", ""),
    ("P1", "S2 — Core Services", "agent-runtime", "Roster dispatch — fan-out to all personas in parallel", "Done", "Engineering", ""),
    ("P1", "S2 — Core Services", "agent-runtime", "Persona: Rajan Mehta (CEO / Strategic Advisor)", "Done", "Product", "Sarah Chen in code"),
    ("P1", "S2 — Core Services", "agent-runtime", "Persona: Priya Reddy (CMO)", "Done", "Product", ""),
    ("P1", "S2 — Core Services", "agent-runtime", "Persona: Marcus Webb (Devil's Advocate)", "Done", "Product", ""),
    ("P1", "S2 — Core Services", "agent-runtime", "Brain context injection per-turn", "Done", "Engineering", ""),
    ("P1", "S2 — Core Services", "agent-runtime", "Teammate awareness (no hallucinated names)", "Done", "Engineering", ""),
    ("P1", "S2 — Core Services", "meeting", "Session create / get / list endpoints", "Done", "Engineering", ""),
    ("P1", "S2 — Core Services", "Demo Web UI", "Thin React UI: send message, see 3 persona responses", "Done", "Product", ""),

    ("P1", "S3 — Wave 3 Services", "performance", "6-signal schema: factual_grounding, peer_agreement, expert_agreement, founder_action, outcome, pushback", "Done", "Engineering", ""),
    ("P1", "S3 — Wave 3 Services", "performance", "POST /signal — record a signal for a persona", "Done", "Engineering", ""),
    ("P1", "S3 — Wave 3 Services", "performance", "GET /scores/:personaId — aggregate by window (default 30d)", "Done", "Engineering", ""),
    ("P1", "S3 — Wave 3 Services", "performance", "GET /weekly — ranked weekly leaderboard", "Done", "Engineering", ""),
    ("P1", "S3 — Wave 3 Services", "notification", "notification_preferences table + RLS", "Done", "Engineering", ""),
    ("P1", "S3 — Wave 3 Services", "notification", "GET /briefing — Claude Haiku morning briefing (24h activity summary)", "Done", "Engineering", ""),
    ("P1", "S3 — Wave 3 Services", "notification", "GET/PUT /preferences — per-tenant briefing settings", "Done", "Engineering", ""),
    ("P1", "S3 — Wave 3 Services", "notification", "POST /alert — log high-risk or conflict alert", "Done", "Engineering", ""),

    ("P1", "S4 — AWS Staging", "Infrastructure", "ECR repository + IAM policy (AmazonEC2ContainerRegistryPowerUser)", "Done", "Infra", ""),
    ("P1", "S4 — AWS Staging", "Infrastructure", "ECS Fargate cluster + task definition (linux/amd64)", "Done", "Infra", "ADR 012: ECS over App Runner"),
    ("P1", "S4 — AWS Staging", "Infrastructure", "Application Load Balancer + target group + /healthz health check", "Done", "Infra", ""),
    ("P1", "S4 — AWS Staging", "Infrastructure", "RDS Postgres 16.9 (ap-south-1)", "Done", "Infra", "16.4 not available in region"),
    ("P1", "S4 — AWS Staging", "Infrastructure", "ElastiCache Redis", "Done", "Infra", ""),
    ("P1", "S4 — AWS Staging", "Infrastructure", "S3 object store bucket (voai-staging-objects)", "Done", "Infra", ""),
    ("P1", "S4 — AWS Staging", "Infrastructure", "Secrets Manager: DATABASE_URL, MIGRATIONS_DATABASE_URL, REDIS_URL, NEO4J, ANTHROPIC_API_KEY", "Done", "Infra", ""),
    ("P1", "S4 — AWS Staging", "Infrastructure", "VPC private subnets, security groups", "Done", "Infra", ""),
    ("P1", "S4 — AWS Staging", "Database", "voai_admin + voai_app roles created on RDS", "Done", "Engineering", ""),
    ("P1", "S4 — AWS Staging", "Database", "All 7 migrations applied (0000–0007)", "Done", "Engineering", "Includes performance + notification"),
    ("P1", "S4 — AWS Staging", "Database", "RLS policies active on staging RDS", "Done", "Engineering", ""),
    ("P1", "S4 — AWS Staging", "CI/CD", "GitHub Actions deploy-staging.yml", "Done", "Engineering", "Manual push currently; no GitHub remote yet"),
    ("P1", "S4 — AWS Staging", "CI/CD", "GitHub remote + repo secrets (AWS keys)", "Pending", "Engineering", "Blocking full CI auto-deploy"),

    # ── PHASE 2 ──────────────────────────────────────────────────────────────
    ("PHASE", "Phase 2 — Live Meeting Intelligence", "", "", "", "", ""),

    ("P2", "S5 — Response Gating", "agent-runtime", "checkShouldRespond() — Haiku gate, max 80 tokens, returns JSON {shouldRespond, relevanceScore, reason}", "Done", "Engineering", "Deployed sprint5 tag"),
    ("P2", "S5 — Response Gating", "agent-runtime", "generateRosterContributions — skip personas below 0.4 threshold", "Done", "Engineering", ""),
    ("P2", "S5 — Response Gating", "agent-runtime", "Fail-open: JSON parse error → shouldRespond=true", "Done", "Engineering", ""),
    ("P2", "S5 — Response Gating", "agent-runtime", "skipGate option for callers that need all-or-nothing dispatch", "Done", "Engineering", ""),
    ("P2", "S5 — Response Gating", "agent-runtime", "Response includes skipped + gateResult per entry", "Done", "Engineering", ""),
    ("P2", "S5 — Response Gating", "Tests", "Gate unit tests: skip on low score, fail-open on bad JSON, gateResult exposed", "Done", "Engineering", "22 tests total"),

    ("P2", "S6 — Proactive Observer Loop", "agent-runtime", "Background watcher: score conversation relevance every N turns per persona", "Pending", "Engineering", ""),
    ("P2", "S6 — Proactive Observer Loop", "agent-runtime", "raise-hand SSE event when persona relevance > threshold", "Pending", "Engineering", ""),
    ("P2", "S6 — Proactive Observer Loop", "meeting", "SSE endpoint: GET /v1/meeting/:sessionId/events", "Pending", "Engineering", ""),
    ("P2", "S6 — Proactive Observer Loop", "Demo UI", "Hand-raise indicator per persona in web UI", "Pending", "Product", ""),
    ("P2", "S6 — Proactive Observer Loop", "Demo UI", "Founder clicks indicator to pull in that persona's contribution", "Pending", "Product", ""),

    ("P2", "S7 — LLM Arbiter", "agent-runtime", "Arbiter: when ≥2 personas pass gate simultaneously, rank by (role relevance, silence penalty, perf score)", "Pending", "Engineering", ""),
    ("P2", "S7 — LLM Arbiter", "agent-runtime", "Ordered contribution queue — personas speak in ranked order, not parallel", "Pending", "Engineering", ""),
    ("P2", "S7 — LLM Arbiter", "agent-runtime", "Configurable max-speakers-per-turn limit", "Pending", "Engineering", ""),
    ("P2", "S7 — LLM Arbiter", "performance", "Silence penalty integration: use weekly score to boost quiet personas", "Pending", "Engineering", ""),

    ("P2", "S8 — Voice Pipeline", "Infrastructure", "LiveKit Cloud account + project", "Pending", "Infra", ""),
    ("P2", "S8 — Voice Pipeline", "Infrastructure", "LiveKit room-per-session provisioning", "Pending", "Infra", ""),
    ("P2", "S8 — Voice Pipeline", "Infrastructure", "Deepgram streaming STT account + API key in Secrets Manager", "Pending", "Infra", ""),
    ("P2", "S8 — Voice Pipeline", "Infrastructure", "ElevenLabs TTS account + voice IDs per persona", "Pending", "Infra", ""),
    ("P2", "S8 — Voice Pipeline", "media-coordinator", "Audio pipeline coordinator: receive STT transcript chunks", "Pending", "Engineering", "apps/media-coordinator stub exists"),
    ("P2", "S8 — Voice Pipeline", "media-coordinator", "Route transcript chunks to agent-runtime", "Pending", "Engineering", ""),
    ("P2", "S8 — Voice Pipeline", "media-coordinator", "Receive agent text response → send to ElevenLabs TTS", "Pending", "Engineering", ""),
    ("P2", "S8 — Voice Pipeline", "media-coordinator", "Play TTS audio back into LiveKit room track", "Pending", "Engineering", ""),
    ("P2", "S8 — Voice Pipeline", "meeting", "LiveKit token generation endpoint (founder joins audio room)", "Pending", "Engineering", ""),
    ("P2", "S8 — Voice Pipeline", "Demo UI", "LiveKit JS SDK: founder audio input + AI audio output", "Pending", "Product", ""),
    ("P2", "S8 — Voice Pipeline", "Demo UI", "Real-time transcript display (SSE stream)", "Pending", "Product", ""),
    ("P2", "S8 — Voice Pipeline", "Demo UI", "Persona voice labels (which voice is speaking)", "Pending", "Product", ""),

    # ── PHASE 3 ──────────────────────────────────────────────────────────────
    ("PHASE", "Phase 3 — Expert Network & Marketplace", "", "", "", "", ""),

    ("P3", "S9 — Expert Profiles & Matching", "marketplace", "Expert schema: domain tags, availability windows, rate card", "Pending", "Engineering", "services/marketplace stub exists"),
    ("P3", "S9 — Expert Profiles & Matching", "marketplace", "Expert onboarding flow (API + UI)", "Pending", "Product", ""),
    ("P3", "S9 — Expert Profiles & Matching", "marketplace", "Expert matching endpoint: given topic → ranked expert list", "Pending", "Engineering", ""),
    ("P3", "S9 — Expert Profiles & Matching", "agent-runtime", "Persona can trigger 'escalate to real expert' action", "Pending", "Engineering", ""),
    ("P3", "S9 — Expert Profiles & Matching", "agent-runtime", "Escalation event surfaced to founder in UI", "Pending", "Product", ""),
    ("P3", "S9 — Expert Profiles & Matching", "brain", "Expert domain knowledge indexed in Neo4j graph", "Pending", "Engineering", ""),

    ("P3", "S10 — Expert Session Scheduling", "scheduler", "scheduler app: cron-style job runner (apps/scheduler stub)", "Pending", "Engineering", ""),
    ("P3", "S10 — Expert Session Scheduling", "scheduler", "Morning briefing cron job (08:00 per tenant timezone)", "Pending", "Engineering", "notification service generates; scheduler triggers"),
    ("P3", "S10 — Expert Session Scheduling", "meeting", "Expert-join flow: invite expert to existing LiveKit room", "Pending", "Engineering", ""),
    ("P3", "S10 — Expert Session Scheduling", "meeting", "Calendar integration (Cal.com or Google Calendar)", "Pending", "Engineering", ""),
    ("P3", "S10 — Expert Session Scheduling", "Demo UI", "Expert availability picker + booking confirmation", "Pending", "Product", ""),
    ("P3", "S10 — Expert Session Scheduling", "Demo UI", "Expert joins same room as founder + AI panel (handoff UX)", "Pending", "Product", ""),

    ("P3", "S11 — Usage Metering & Billing", "marketplace-metering", "Token count per session stored in metering table", "Pending", "Engineering", "services/marketplace-metering stub exists"),
    ("P3", "S11 — Usage Metering & Billing", "marketplace-metering", "Expert-minute billing events", "Pending", "Engineering", ""),
    ("P3", "S11 — Usage Metering & Billing", "marketplace-metering", "Monthly summary report per tenant", "Pending", "Engineering", ""),
    ("P3", "S11 — Usage Metering & Billing", "Payments", "Stripe integration: subscription tiers for founders", "Pending", "Engineering", ""),
    ("P3", "S11 — Usage Metering & Billing", "Payments", "Stripe charge per expert session", "Pending", "Engineering", ""),
    ("P3", "S11 — Usage Metering & Billing", "Payments", "Expert payout (Stripe Connect or bank transfer)", "Pending", "Engineering", ""),
    ("P3", "S11 — Usage Metering & Billing", "routing", "Token routing: track per-tenant LLM spend via RoutingService", "Pending", "Engineering", "Routing decision log → metering"),

    ("P3", "S12 — Admin Console", "admin-console-api", "Tenant provisioning endpoint (services/admin-console-api stub)", "Pending", "Engineering", ""),
    ("P3", "S12 — Admin Console", "admin-console-api", "User management: invite, role assignment, deactivation", "Pending", "Engineering", ""),
    ("P3", "S12 — Admin Console", "admin-console-api", "Usage dashboard: decisions, expert spend, AI token cost per tenant", "Pending", "Engineering", ""),
    ("P3", "S12 — Admin Console", "admin-console-api", "Seat-based subscription tier enforcement in routing layer", "Pending", "Engineering", ""),
    ("P3", "S12 — Admin Console", "Admin UI", "Internal admin web app (separate from founder-facing demo UI)", "Pending", "Product", ""),

    # ── PHASE 4 DEFERRED ─────────────────────────────────────────────────────
    ("PHASE", "Phase 4 — Scale & Production Hardening (Deferred)", "", "", "", "", ""),

    ("P4", "S13 — CI / DevOps", "CI/CD", "GitHub remote: create repo, push code, configure branch protection", "Deferred", "Engineering", "Manual deploy works; unblocking after Phase 2"),
    ("P4", "S13 — CI / DevOps", "CI/CD", "GitHub Actions auto-deploy on push to main", "Deferred", "Engineering", "Workflow exists; needs AWS secrets in repo"),
    ("P4", "S13 — CI / DevOps", "CI/CD", "Terraform remote state — S3 backend migration (1 command; bucket exists)", "Deferred", "Infra", ""),
    ("P4", "S13 — CI / DevOps", "CI/CD", "Staging smoke test job in CI pipeline", "Deferred", "Engineering", ""),
    ("P4", "S13 — CI / DevOps", "IAM", "Narrow IAM policy (scoped policy replacing broad managed policies)", "Deferred", "Infra", "Before co-founder / contractor access"),

    ("P4", "S14 — Production Environment", "Infra", "prod VPC + separate RDS Multi-AZ instance", "Deferred", "Infra", ""),
    ("P4", "S14 — Production Environment", "Infra", "ECS desired-count 2 + ALB health-check tuning", "Deferred", "Infra", ""),
    ("P4", "S14 — Production Environment", "Infra", "Custom domain + ACM cert for ALB (HTTPS)", "Deferred", "Infra", ""),
    ("P4", "S14 — Production Environment", "Infra", "CloudFront CDN in front of ALB", "Deferred", "Infra", ""),
    ("P4", "S14 — Production Environment", "Infra", "WAF rules on ALB", "Deferred", "Infra", ""),

    ("P4", "S15 — Observability", "Monitoring", "CloudWatch dashboards: ECS CPU/mem, RDS connections, ALB latency", "Deferred", "Infra", ""),
    ("P4", "S15 — Observability", "Monitoring", "PagerDuty / SNS alerts on 5xx rate, task failures", "Deferred", "Infra", ""),
    ("P4", "S15 — Observability", "Monitoring", "Structured log search (CloudWatch Insights or Datadog)", "Deferred", "Infra", ""),
    ("P4", "S15 — Observability", "Monitoring", "Distributed trace IDs through routing + agent calls", "Deferred", "Engineering", ""),

    ("P4", "S16 — Multi-provider LLM Routing", "routing", "Four-tier LLM classification: Advanced / High / Good / OpenSource", "Deferred", "Engineering", "ADR — subscription-tier-driven routing"),
    ("P4", "S16 — Multi-provider LLM Routing", "routing", "OpenAI provider implementation", "Deferred", "Engineering", ""),
    ("P4", "S16 — Multi-provider LLM Routing", "routing", "Bedrock provider implementation", "Deferred", "Engineering", ""),
    ("P4", "S16 — Multi-provider LLM Routing", "routing", "Failover: if primary provider errors, retry on next tier", "Deferred", "Engineering", ""),
    ("P4", "S16 — Multi-provider LLM Routing", "routing", "Cost-per-call tracking per provider per tenant", "Deferred", "Engineering", ""),

    ("P4", "S17 — Background Workers", "worker", "worker app: BullMQ job queue over Redis (apps/worker stub)", "Deferred", "Engineering", ""),
    ("P4", "S17 — Background Workers", "worker", "Async brain indexing (don't block meeting response)", "Deferred", "Engineering", ""),
    ("P4", "S17 — Background Workers", "worker", "Async Neo4j graph updates", "Deferred", "Engineering", ""),
    ("P4", "S17 — Background Workers", "worker", "Dead-letter queue + retry with exponential backoff", "Deferred", "Engineering", ""),

    ("P4", "S18 — Security & Compliance", "Security", "HTTPS enforcement (redirect HTTP → HTTPS at ALB)", "Deferred", "Infra", ""),
    ("P4", "S18 — Security & Compliance", "Security", "Secrets rotation (Secrets Manager auto-rotate)", "Deferred", "Infra", ""),
    ("P4", "S18 — Security & Compliance", "Security", "Pen test / OWASP audit before public launch", "Deferred", "Engineering", ""),
    ("P4", "S18 — Security & Compliance", "Security", "GDPR data deletion endpoint (tenant offboarding)", "Deferred", "Engineering", ""),
    ("P4", "S18 — Security & Compliance", "Security", "Audit log: every data write recorded with actor + timestamp", "Deferred", "Engineering", ""),
]

# ─── Build workbook ────────────────────────────────────────────────────────────
wb = openpyxl.Workbook()
ws = wb.active
ws.title = "Product Tracker"

# ── Summary sheet ──────────────────────────────────────────────────────────────
ws_sum = wb.create_sheet("Summary", 0)
ws.title = "All Tasks"

# ─── Column widths ─────────────────────────────────────────────────────────────
COL_WIDTHS = [6, 28, 28, 58, 12, 12, 36]
COL_LABELS = ["Phase", "Sprint", "Feature / Service", "Sub-feature / Task", "Status", "Owner", "Notes"]

for i, (w, label) in enumerate(zip(COL_WIDTHS, COL_LABELS), 1):
    ws.column_dimensions[get_column_letter(i)].width = w

# ─── Column header row ─────────────────────────────────────────────────────────
ws.freeze_panes = "A3"

# Row 1: title bar
ws.merge_cells("A1:G1")
title_cell = ws["A1"]
title_cell.value = f"VirtualOffice AI — Product Tracker   (generated {date.today()})"
title_cell.font = Font(bold=True, color=C_WHITE, size=13)
title_cell.fill = hdr_fill(C_HDR_PHASE)
title_cell.alignment = Alignment(horizontal="center", vertical="center")
ws.row_dimensions[1].height = 28

# Row 2: column headers
for i, label in enumerate(COL_LABELS, 1):
    cell = ws.cell(row=2, column=i, value=label)
    cell.font = col_font()
    cell.fill = hdr_fill(C_HDR_COL)
    cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    cell.border = border
ws.row_dimensions[2].height = 20

# ─── Data rows ─────────────────────────────────────────────────────────────────
ROW_OFFSET = 3
counts = {"Done": 0, "Active": 0, "Pending": 0, "Deferred": 0}

for r_idx, row_data in enumerate(ROWS, ROW_OFFSET):
    phase_tag, sprint, feature, subtask, status, owner, notes = row_data

    if phase_tag == "PHASE":
        # Phase separator row
        ws.merge_cells(f"A{r_idx}:G{r_idx}")
        cell = ws.cell(row=r_idx, column=1, value=sprint)
        cell.font = Font(bold=True, color=C_WHITE, size=11)
        cell.fill = hdr_fill(C_HDR_PHASE)
        cell.alignment = Alignment(horizontal="left", vertical="center", indent=1)
        cell.border = border
        ws.row_dimensions[r_idx].height = 22
        continue

    # Normal data row
    bg, fg, status_label = STATUS_STYLE.get(status, (C_PEND_BG, C_PEND, status))
    fill = row_fill(bg)

    vals = [phase_tag, sprint, feature, subtask, status_label, owner, notes]
    for c_idx, val in enumerate(vals, 1):
        cell = ws.cell(row=r_idx, column=c_idx, value=val)
        cell.font = body_font(color=fg, bold=(c_idx == 4))
        cell.fill = fill
        cell.border = border
        cell.alignment = Alignment(wrap_text=True, vertical="top")

    ws.row_dimensions[r_idx].height = 30
    if status in counts:
        counts[status] += 1

# ─── Summary sheet ─────────────────────────────────────────────────────────────
ws_sum.column_dimensions["A"].width = 22
ws_sum.column_dimensions["B"].width = 12
ws_sum.column_dimensions["C"].width = 40

ws_sum.merge_cells("A1:C1")
s = ws_sum["A1"]
s.value = "VirtualOffice AI — Tracker Summary"
s.font = Font(bold=True, color=C_WHITE, size=13)
s.fill = hdr_fill(C_HDR_PHASE)
s.alignment = Alignment(horizontal="center", vertical="center")
ws_sum.row_dimensions[1].height = 28

headers = ["Status", "Count", "Description"]
for i, h in enumerate(headers, 1):
    c = ws_sum.cell(row=2, column=i, value=h)
    c.font = col_font()
    c.fill = hdr_fill(C_HDR_COL)
    c.alignment = Alignment(horizontal="center")
    c.border = border

summary_data = [
    ("✅ Done",     counts["Done"],     "Shipped and deployed to staging"),
    ("▶ Active",   counts["Active"],   "Currently in progress"),
    ("○ Pending",  counts["Pending"],  "Defined, not yet started"),
    ("⏸ Deferred", counts["Deferred"], "Phase 4 — after Phase 3 ships"),
]
total = sum(counts.values())

for i, (st, cnt, desc) in enumerate(summary_data, 3):
    bg, fg, _ = STATUS_STYLE.get(st.split()[-1], (C_PEND_BG, C_PEND, ""))
    # match by last word
    matched = None
    for k in STATUS_STYLE:
        if k in st:
            matched = STATUS_STYLE[k]
            break
    bg_c, fg_c = (matched[0], matched[1]) if matched else (C_PEND_BG, C_PEND)

    ws_sum.cell(row=i, column=1, value=st).font = body_font(color=fg_c, bold=True)
    ws_sum.cell(row=i, column=2, value=cnt).font = body_font(color=fg_c, bold=True)
    ws_sum.cell(row=i, column=3, value=desc).font = body_font(color=fg_c)
    for col in range(1, 4):
        ws_sum.cell(row=i, column=col).fill = row_fill(bg_c)
        ws_sum.cell(row=i, column=col).border = border
        ws_sum.cell(row=i, column=col).alignment = Alignment(vertical="top", wrap_text=True)
    ws_sum.row_dimensions[i].height = 22

# Total row
ws_sum.cell(row=7, column=1, value="TOTAL").font = Font(bold=True, size=11)
ws_sum.cell(row=7, column=2, value=total).font = Font(bold=True, size=11)
ws_sum.cell(row=7, column=3, value="All tracked tasks").font = Font(size=10)
for col in range(1, 4):
    ws_sum.cell(row=7, column=col).border = border
    ws_sum.cell(row=7, column=col).alignment = Alignment(vertical="top")

# Completion % row
pct = round(counts["Done"] / total * 100) if total else 0
ws_sum.cell(row=8, column=1, value="Completion").font = Font(bold=True)
ws_sum.cell(row=8, column=2, value=f"{pct}%").font = Font(bold=True, color=C_DONE)
ws_sum.cell(row=8, column=2).fill = row_fill(C_DONE_BG)
for col in range(1, 4):
    ws_sum.cell(row=8, column=col).border = border

# Notes section
ws_sum.cell(row=10, column=1, value="Immediate Blockers").font = Font(bold=True, color="AA0000")
ws_sum.cell(row=11, column=1, value="GitHub repo creation").font = body_font()
ws_sum.cell(row=11, column=2, value="Pending").font = body_font(color="AA0000")
ws_sum.cell(row=11, column=3, value="Needed for CI auto-deploy; add AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY as repo secrets").font = body_font()
ws_sum.cell(row=12, column=1, value="Terraform remote state").font = body_font()
ws_sum.cell(row=12, column=2, value="Deferred").font = body_font(color=C_DEFER_TXT)
ws_sum.cell(row=12, column=3, value="S3 bucket already provisioned; run 'terraform init -migrate-state' when ready").font = body_font()
for r in [11, 12]:
    for c in range(1, 4):
        ws_sum.cell(row=r, column=c).border = border
        ws_sum.cell(row=r, column=c).alignment = Alignment(wrap_text=True, vertical="top")
    ws_sum.row_dimensions[r].height = 30

# Put Summary first
wb.active = ws_sum

out_path = "/Users/muralis/projects/mysquad/VoAI-Product-Tracker.xlsx"
wb.save(out_path)
print(f"Saved → {out_path}")
print(f"Totals: Done={counts['Done']}, Active={counts['Active']}, Pending={counts['Pending']}, Deferred={counts['Deferred']}, Total={total}")
