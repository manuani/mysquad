-- Up Migration
--
-- How this founder wants their team to behave.
--
-- Marcus was originally a Devil's Advocate, and the role name alone drove the
-- behaviour: every reply opened with an objection. Rewriting him as Chief of
-- Staff fixed that conversation but swapped one constant for another — a
-- founder in a fundraise wants harder scrutiny than one exploring an idea, and
-- different founders want different amounts of it from the same person.
--
-- Settings hang off the company profile rather than the account: the same
-- founder wants a different register for a board-facing business than for an
-- early experiment. Nullable throughout, so a profile that has never been
-- configured behaves exactly as before.

ALTER TABLE company_profiles
  ADD COLUMN IF NOT EXISTS challenge_level TEXT
    CHECK (challenge_level IN ('light', 'balanced', 'hard')),
  ADD COLUMN IF NOT EXISTS reply_length TEXT
    CHECK (reply_length IN ('brief', 'standard', 'thorough')),
  ADD COLUMN IF NOT EXISTS formality TEXT
    CHECK (formality IN ('casual', 'neutral', 'formal')),
  /** Free text the founder adds, appended after the named settings. */
  ADD COLUMN IF NOT EXISTS team_instructions TEXT;

-- Down Migration

ALTER TABLE company_profiles
  DROP COLUMN IF EXISTS team_instructions,
  DROP COLUMN IF EXISTS formality,
  DROP COLUMN IF EXISTS reply_length,
  DROP COLUMN IF EXISTS challenge_level;
