-- Migration 0008: marketplace experts schema
-- Expert profiles, domain expertise tags, availability windows, rate cards,
-- and the escalation events surfaced to founders in meeting sessions.
--
-- Row-level security mirrors the pattern established in 0001_identity_and_tenancy:
-- voai_app can only SELECT/INSERT/UPDATE rows matching the current app.tenant_id
-- setting; voai_admin (migrations role) bypasses RLS entirely.

-- ── expert_profiles ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS expert_profiles (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL,          -- marketplace tenant (could differ from founder tenant)
  name         TEXT NOT NULL,
  email        TEXT NOT NULL UNIQUE,
  bio          TEXT,
  linkedin_url TEXT,
  status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'active', 'paused', 'retired')),
  hourly_rate_usd_cents INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE expert_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY expert_profiles_tenant_isolation ON expert_profiles
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ── expert_domain_tags ──────────────────────────────────────────────────────────
-- Many-to-many: one expert can cover multiple domains/topics.
-- domain is a free-form slug (e.g. "saas_pricing", "series_a_fundraising").
-- confidence is 0.0–1.0: 1.0 = verified via credential; 0.5 = self-declared.
CREATE TABLE IF NOT EXISTS expert_domain_tags (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expert_id  UUID NOT NULL REFERENCES expert_profiles(id) ON DELETE CASCADE,
  domain     TEXT NOT NULL,
  confidence DOUBLE PRECISION NOT NULL DEFAULT 0.5
               CHECK (confidence BETWEEN 0.0 AND 1.0),
  verified   BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (expert_id, domain)
);

CREATE INDEX IF NOT EXISTS expert_domain_tags_domain_idx ON expert_domain_tags(domain);

-- ── expert_availability ──────────────────────────────────────────────────────────
-- Weekly recurring availability windows in UTC.
-- day_of_week: 0=Sunday … 6=Saturday
CREATE TABLE IF NOT EXISTS expert_availability (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expert_id     UUID NOT NULL REFERENCES expert_profiles(id) ON DELETE CASCADE,
  day_of_week   SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_utc_min SMALLINT NOT NULL CHECK (start_utc_min BETWEEN 0 AND 1439),  -- minutes since midnight
  end_utc_min   SMALLINT NOT NULL CHECK (end_utc_min BETWEEN 1 AND 1440),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── escalation_events ───────────────────────────────────────────────────────────
-- Recorded whenever an AI persona decides to recommend a real expert.
-- status lifecycle: suggested → accepted | dismissed
CREATE TABLE IF NOT EXISTS escalation_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  session_id      UUID NOT NULL,          -- meeting session that triggered escalation
  persona_name    TEXT NOT NULL,           -- which AI persona escalated
  topic           TEXT NOT NULL,           -- topic the persona couldn't address
  suggested_expert_id UUID REFERENCES expert_profiles(id),
  status          TEXT NOT NULL DEFAULT 'suggested'
                    CHECK (status IN ('suggested', 'accepted', 'dismissed')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE escalation_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY escalation_events_tenant_isolation ON escalation_events
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS escalation_events_session_idx ON escalation_events(session_id);
CREATE INDEX IF NOT EXISTS escalation_events_tenant_idx ON escalation_events(tenant_id);

-- ── expert_bookings ──────────────────────────────────────────────────────────────
-- Confirmed session bookings between founders and human experts.
-- Cal.com booking ID is null when Cal.com is not configured.
CREATE TABLE IF NOT EXISTS expert_bookings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expert_id         UUID NOT NULL REFERENCES expert_profiles(id),
  tenant_id         UUID NOT NULL,
  slot_start        TIMESTAMPTZ NOT NULL,
  slot_end          TIMESTAMPTZ NOT NULL,
  founder_email     TEXT NOT NULL,
  topic             TEXT NOT NULL,
  calcom_booking_id TEXT,
  status            TEXT NOT NULL DEFAULT 'confirmed'
                      CHECK (status IN ('confirmed', 'cancelled')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE expert_bookings ENABLE ROW LEVEL SECURITY;

CREATE POLICY expert_bookings_tenant_isolation ON expert_bookings
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS expert_bookings_expert_idx ON expert_bookings(expert_id);
CREATE INDEX IF NOT EXISTS expert_bookings_slot_idx ON expert_bookings(slot_start);
