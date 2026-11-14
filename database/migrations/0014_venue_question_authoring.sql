-- Question authoring for venues (ADR-0028 §6): hand-written questions and drafts generated from a
-- document. Drafts are not questions: they never reach the bank until the owner approves them, and then
-- they go through the venue import pipeline (ADR-0025) like any upload.
-- Forward-only; never edit an applied migration.

-- Where an upload came from: a file, the manual form, or approved AI drafts (with the source document's hash).
ALTER TABLE venue_question_uploads
  ADD COLUMN origin text NOT NULL DEFAULT 'FILE' CHECK (origin IN ('FILE', 'MANUAL', 'AI')),
  ADD COLUMN source_file_hash text CHECK (source_file_hash IS NULL OR source_file_hash ~ '^[0-9a-f]{64}$');

-- One generation run: the cost journal behind the per-venue daily quota. No document text, no reply.
CREATE TABLE venue_authoring_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES venues (id) ON DELETE CASCADE,
  account_id uuid REFERENCES accounts (id) ON DELETE SET NULL,
  at timestamptz NOT NULL,
  source_file_hash text NOT NULL CHECK (source_file_hash ~ '^[0-9a-f]{64}$'),
  source_file_name text NOT NULL CHECK (char_length(source_file_name) <= 120),
  input_chars integer NOT NULL CHECK (input_chars >= 0),
  input_tokens integer NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens integer NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  drafts integer NOT NULL DEFAULT 0 CHECK (drafts >= 0),
  discarded integer NOT NULL DEFAULT 0 CHECK (discarded >= 0),
  status text NOT NULL CHECK (status IN ('OK', 'FAILED', 'EMPTY'))
);
CREATE INDEX venue_authoring_runs_venue_idx ON venue_authoring_runs (venue_id, at DESC);

CREATE TABLE venue_question_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES venues (id) ON DELETE CASCADE,
  run_id uuid REFERENCES venue_authoring_runs (id) ON DELETE SET NULL,
  created_by uuid REFERENCES accounts (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  source_file_hash text NOT NULL CHECK (source_file_hash ~ '^[0-9a-f]{64}$'),
  source_file_name text NOT NULL CHECK (char_length(source_file_name) <= 120),
  -- {category, difficulty, question, options[4], correctIndex, explanation, sourceQuote, page}; validated on every write
  payload jsonb NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK (state IN ('DRAFT', 'APPROVED')),
  question_id uuid REFERENCES questions (id) ON DELETE SET NULL,
  upload_id uuid REFERENCES venue_question_uploads (id) ON DELETE SET NULL,
  approved_at timestamptz,
  approved_by uuid REFERENCES accounts (id) ON DELETE SET NULL,
  CONSTRAINT venue_question_drafts_approved_consistency CHECK ((state = 'APPROVED') = (approved_at IS NOT NULL))
);
CREATE INDEX venue_question_drafts_venue_idx ON venue_question_drafts (venue_id, state, expires_at);
