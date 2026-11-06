-- Venue question sets (ADR-0025): a café uploads its own questions. They belong to the venue
-- (`owner_venue_id`), are served only in rooms of that venue's metered session, and never reach the
-- public pool. Also the per-venue play history that keeps a regular crowd from seeing repeats.
-- Forward-only; never edit an applied migration.

-- ───────────── ownership ─────────────

ALTER TABLE categories
  ADD COLUMN owner_venue_id uuid REFERENCES venues (id) ON DELETE CASCADE;
CREATE INDEX categories_owner_venue_idx ON categories (owner_venue_id) WHERE owner_venue_id IS NOT NULL;
-- a venue category is never part of the weekly free rotation and needs no sources
ALTER TABLE categories
  ADD CONSTRAINT categories_venue_flags CHECK (owner_venue_id IS NULL OR (free_rotation = false));

-- One upload = one file the owner sent (the journal of what came in, also the unit of "remove this upload").
CREATE TABLE venue_question_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES venues (id) ON DELETE CASCADE,
  uploaded_by uuid REFERENCES accounts (id) ON DELETE SET NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  file_name text NOT NULL CHECK (char_length(file_name) <= 120),
  -- SHA-256 (hex) of the bytes as sent; the same file twice is the same upload
  file_hash text NOT NULL CHECK (file_hash ~ '^[0-9a-f]{64}$'),
  format text NOT NULL CHECK (format IN ('CSV', 'JSONL')),
  bytes integer NOT NULL CHECK (bytes >= 0),
  rows_total integer NOT NULL CHECK (rows_total >= 0),
  rows_imported integer NOT NULL CHECK (rows_imported >= 0),
  rows_review integer NOT NULL DEFAULT 0 CHECK (rows_review >= 0),
  rows_rejected integer NOT NULL DEFAULT 0 CHECK (rows_rejected >= 0),
  rows_invalid integer NOT NULL DEFAULT 0 CHECK (rows_invalid >= 0),
  rows_duplicate integer NOT NULL DEFAULT 0 CHECK (rows_duplicate >= 0),
  -- imported rows per category id, for the counts the owner and admins see
  by_category jsonb NOT NULL DEFAULT '{}'::jsonb,
  state text NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE', 'RETIRED')),
  retired_at timestamptz,
  retired_by uuid REFERENCES accounts (id) ON DELETE SET NULL,
  CONSTRAINT venue_question_uploads_retired_consistency CHECK ((state = 'RETIRED') = (retired_at IS NOT NULL))
);
-- Idempotent re-upload: while an upload is live, its exact bytes cannot be imported again.
CREATE UNIQUE INDEX venue_question_uploads_live_hash
  ON venue_question_uploads (venue_id, file_hash) WHERE state = 'ACTIVE';
CREATE INDEX venue_question_uploads_venue_idx ON venue_question_uploads (venue_id, uploaded_at DESC);

ALTER TABLE questions
  ADD COLUMN owner_venue_id uuid REFERENCES venues (id) ON DELETE CASCADE,
  ADD COLUMN venue_upload_id uuid REFERENCES venue_question_uploads (id) ON DELETE SET NULL;

ALTER TABLE questions DROP CONSTRAINT questions_pool_check;
ALTER TABLE questions
  ADD CONSTRAINT questions_pool_check CHECK (pool IN ('EVERGREEN', 'CURRENT', 'VENUE')),
  -- a venue question is exactly a question with an owner venue, and has no external id
  ADD CONSTRAINT questions_venue_pool CHECK ((pool = 'VENUE') = (owner_venue_id IS NOT NULL)),
  ADD CONSTRAINT questions_venue_no_external_id CHECK (owner_venue_id IS NULL OR external_id IS NULL);

CREATE INDEX questions_owner_venue_idx ON questions (owner_venue_id, status) WHERE owner_venue_id IS NOT NULL;
CREATE INDEX questions_venue_upload_idx ON questions (venue_upload_id) WHERE venue_upload_id IS NOT NULL;

-- Duplicate protection is per owner: global rows are unique among themselves, a venue's live rows among
-- themselves. Two venues may hold the same text and neither can tell (no side channel through a unique error).
DROP INDEX questions_fingerprint_unique;
CREATE UNIQUE INDEX questions_fingerprint_unique ON questions (language, lexical_fingerprint)
  WHERE owner_venue_id IS NULL;
CREATE UNIQUE INDEX questions_venue_fingerprint_unique ON questions (owner_venue_id, language, lexical_fingerprint)
  WHERE owner_venue_id IS NOT NULL AND status <> 'RETIRED';

-- ───────────── the guard: owner-attested rows ─────────────

-- Same function as migration 0004 with one addition: a row with an owner venue may be APPROVED/ACTIVE on
-- a PASS heuristic audit of its current revision (nobody can fact-check a café's house questions, and the
-- rows are served only at that café). Every global row keeps the ARBITER + fact-check rule.
CREATE OR REPLACE FUNCTION questions_guard() RETURNS trigger AS $$
DECLARE
  latest question_audits%ROWTYPE;
  option_count integer;
  correct_count integer;
  content_changed boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.revision_txid := txid_current();
  ELSE
    content_changed :=
      NEW.text IS DISTINCT FROM OLD.text
      OR NEW.explanation IS DISTINCT FROM OLD.explanation
      OR NEW.difficulty IS DISTINCT FROM OLD.difficulty
      OR NEW.category_id IS DISTINCT FROM OLD.category_id
      OR NEW.language IS DISTINCT FROM OLD.language
      OR NEW.pool IS DISTINCT FROM OLD.pool;
    IF content_changed AND OLD.status IN ('APPROVED', 'ACTIVE') AND NEW.status = OLD.status
       AND NOT OLD.is_dev_seed THEN
      RAISE EXCEPTION 'content of an % question is frozen; move it to REVIEW first', OLD.status
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF content_changed AND NEW.revision_txid IS DISTINCT FROM txid_current() THEN
      NEW.revision := OLD.revision + 1;
      NEW.revision_txid := txid_current();
    END IF;
  END IF;

  IF NEW.status IN ('APPROVED', 'ACTIVE') AND NOT NEW.is_dev_seed
     AND (TG_OP = 'INSERT'
          OR OLD.status IS DISTINCT FROM NEW.status
          OR content_changed
          OR OLD.is_dev_seed) THEN
    IF NEW.owner_venue_id IS NOT NULL THEN
      SELECT * INTO latest FROM question_audits
        WHERE question_id = NEW.id AND pass = 'HEURISTIC' AND question_revision = NEW.revision
        ORDER BY id DESC LIMIT 1;
      IF NOT FOUND OR latest.status <> 'PASS' THEN
        RAISE EXCEPTION 'question % cannot become % without a passing audit for revision %',
          NEW.id, NEW.status, NEW.revision USING ERRCODE = 'integrity_constraint_violation';
      END IF;
    ELSE
      SELECT * INTO latest FROM question_audits
        WHERE question_id = NEW.id AND pass = 'ARBITER' AND question_revision = NEW.revision
        ORDER BY id DESC LIMIT 1;
      IF NOT FOUND OR latest.status <> 'PASS' OR latest.dimensions ->> 'factCheck' IS DISTINCT FROM 'PASS' THEN
        RAISE EXCEPTION 'question % cannot become % without a passing audit for revision %',
          NEW.id, NEW.status, NEW.revision USING ERRCODE = 'integrity_constraint_violation';
      END IF;
    END IF;
    SELECT count(*), count(*) FILTER (WHERE is_correct) INTO option_count, correct_count
      FROM question_options WHERE question_id = NEW.id;
    IF option_count < 2 OR option_count > 6 OR correct_count <> 1 THEN
      RAISE EXCEPTION 'question % needs 2-6 options with exactly one correct (has % / %)',
        NEW.id, option_count, correct_count USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ───────────── audit log of content changes ─────────────

CREATE TABLE venue_content_events (
  id bigserial PRIMARY KEY,
  venue_id uuid NOT NULL REFERENCES venues (id) ON DELETE CASCADE,
  upload_id uuid REFERENCES venue_question_uploads (id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('IMPORT', 'RETIRE_UPLOAD', 'RETIRE_QUESTION', 'ADMIN_RETIRE_UPLOAD', 'ADMIN_RETIRE_QUESTION')),
  actor_account_id uuid REFERENCES accounts (id) ON DELETE SET NULL,
  at timestamptz NOT NULL DEFAULT now(),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX venue_content_events_venue_idx ON venue_content_events (venue_id, at DESC);
CREATE TRIGGER venue_content_events_no_update BEFORE UPDATE ON venue_content_events
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ───────────── what this venue played recently ─────────────

CREATE TABLE venue_question_history (
  venue_id uuid NOT NULL REFERENCES venues (id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES questions (id) ON DELETE CASCADE,
  played_at timestamptz NOT NULL,
  PRIMARY KEY (venue_id, question_id)
);
CREATE INDEX venue_question_history_recent_idx ON venue_question_history (venue_id, played_at DESC);
