-- Question bank core (ADR-0014). Audit history, reports and usage tables follow in a later migration.

CREATE TABLE categories (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9-]{1,40}$'),
  label_tr text NOT NULL,
  label_en text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true,
  -- eligible for the weekly rotating free category
  free_rotation boolean NOT NULL DEFAULT true,
  source_required boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id text UNIQUE,
  language text NOT NULL CHECK (language IN ('tr', 'en')),
  category_id text NOT NULL REFERENCES categories (id),
  subcategory text,
  topic text,
  difficulty text NOT NULL CHECK (difficulty IN ('EASY', 'MEDIUM', 'HARD', 'EXPERT')),
  text text NOT NULL CHECK (char_length(text) BETWEEN 10 AND 400),
  explanation text CHECK (explanation IS NULL OR char_length(explanation) <= 600),
  pool text NOT NULL DEFAULT 'EVERGREEN' CHECK (pool IN ('EVERGREEN', 'CURRENT')),
  expires_at timestamptz,
  last_verified_at timestamptz,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN (
    'DRAFT', 'GENERATED', 'NORMALIZED', 'DUPLICATE_CHECK', 'FACT_CHECK', 'ANSWER_CHECK',
    'AMBIGUITY_CHECK', 'LANGUAGE_QA', 'DIFFICULTY_CALIBRATION', 'GAMEPLAY_REVIEW',
    'APPROVED', 'ACTIVE', 'REVIEW', 'RETIRED', 'REJECTED')),
  verification_status text NOT NULL DEFAULT 'UNVERIFIED' CHECK (verification_status IN ('UNVERIFIED', 'VERIFIED', 'DISPUTED')),
  author_type text NOT NULL CHECK (author_type IN ('HUMAN', 'AI_ASSISTED', 'AI_DRAFT', 'DEV_SEED')),
  is_dev_seed boolean NOT NULL DEFAULT false,
  quality_score numeric(4, 2),
  ambiguity_score numeric(4, 2),
  difficulty_score numeric(4, 2),
  gameplay_score numeric(4, 2),
  lexical_fingerprint text NOT NULL,
  minhash integer[],
  semantic_fingerprint text,
  semantic_provider text,
  usage_count integer NOT NULL DEFAULT 0,
  answer_count bigint NOT NULL DEFAULT 0,
  correct_answer_count bigint NOT NULL DEFAULT 0,
  total_answer_ms bigint NOT NULL DEFAULT 0,
  report_count integer NOT NULL DEFAULT 0,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz,
  retire_reason text,
  CONSTRAINT questions_dev_seed_flag CHECK (is_dev_seed = (author_type = 'DEV_SEED')),
  CONSTRAINT questions_current_needs_expiry CHECK (pool <> 'CURRENT' OR expires_at IS NOT NULL)
);
CREATE UNIQUE INDEX questions_fingerprint_unique ON questions (language, lexical_fingerprint);
CREATE INDEX questions_deck_idx ON questions (language, difficulty, category_id) WHERE status = 'ACTIVE';
CREATE INDEX questions_status_idx ON questions (status, updated_at DESC);
CREATE INDEX questions_text_trgm ON questions USING gin (text gin_trgm_ops);

CREATE TABLE question_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL REFERENCES questions (id) ON DELETE CASCADE,
  position smallint NOT NULL CHECK (position BETWEEN 0 AND 5),
  text text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 160),
  is_correct boolean NOT NULL DEFAULT false,
  UNIQUE (question_id, position)
);
-- At most one correct option per question; "exactly one" is enforced when a question leaves DRAFT.
CREATE UNIQUE INDEX question_options_one_correct ON question_options (question_id) WHERE is_correct;

CREATE TABLE question_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL REFERENCES questions (id) ON DELETE CASCADE,
  url text NOT NULL CHECK (url ~ '^https?://'),
  title text,
  retrieved_at timestamptz,
  UNIQUE (question_id, url)
);

CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER questions_touch BEFORE UPDATE ON questions FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
