-- Personal quizzes: Blind Quiz and Custom Quiz (ADR-0015). Forward-only; never edit an applied migration.
--
-- A Blind Quiz is about people who answer privately. Their answers are sealed (AES-256-GCM, key id and
-- AAD stored with the ciphertext) and are only ever opened by the vault module: the quiz creator's API
-- never returns them. Everything here is hard-deleted by the retention rules of ADR-0015.

CREATE TABLE personal_quizzes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_account_id uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('BLIND', 'CUSTOM')),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 60),
  language text NOT NULL DEFAULT 'tr' CHECK (language IN ('tr', 'en')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  -- everything in the quiz is deleted after this moment (extended whenever the quiz is used)
  retain_until timestamptz NOT NULL
);
CREATE INDEX personal_quizzes_owner_idx ON personal_quizzes (owner_account_id, created_at DESC);
CREATE INDEX personal_quizzes_retention_idx ON personal_quizzes (retain_until);

CREATE TABLE blind_prompts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id uuid NOT NULL REFERENCES personal_quizzes (id) ON DELETE CASCADE,
  position smallint NOT NULL CHECK (position BETWEEN 0 AND 19),
  -- 'CATALOG' prompts come from the curated list (their wording is localised by key); 'CUSTOM' ones are
  -- written by the creator and screened like any user text
  source text NOT NULL CHECK (source IN ('CATALOG', 'CUSTOM')),
  catalog_key text,
  text text,
  CONSTRAINT blind_prompts_shape CHECK (
    (source = 'CATALOG' AND catalog_key IS NOT NULL AND text IS NULL)
    OR (source = 'CUSTOM' AND text IS NOT NULL AND char_length(text) BETWEEN 3 AND 140)
  ),
  UNIQUE (quiz_id, position)
);

CREATE TABLE blind_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id uuid NOT NULL REFERENCES personal_quizzes (id) ON DELETE CASCADE,
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 30),
  -- keyed hash of the 256-bit invite token; the token only exists in the link the creator shares
  invite_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- the target read the consent text and agreed; nothing can be stored before this
  consented_at timestamptz
);
CREATE INDEX blind_targets_quiz_idx ON blind_targets (quiz_id);

CREATE TABLE blind_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_id uuid NOT NULL REFERENCES blind_targets (id) ON DELETE CASCADE,
  prompt_id uuid NOT NULL REFERENCES blind_prompts (id) ON DELETE CASCADE,
  -- nonce || ciphertext || tag of {"answer": "...", "decoys": ["..."]}; AAD = response id | prompt id
  sealed bytea NOT NULL,
  key_id text NOT NULL,
  visibility_policy text NOT NULL DEFAULT 'TARGET_ONLY'
    CHECK (visibility_policy IN ('TARGET_ONLY', 'GAME_ENGINE', 'REVEALED_IN_GAME')),
  -- the target looked at the finished question privately and approved it
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (target_id, prompt_id),
  -- a question that is not approved can never be played
  CONSTRAINT blind_responses_policy CHECK (visibility_policy = 'TARGET_ONLY' OR approved_at IS NOT NULL)
);
CREATE INDEX blind_responses_prompt_idx ON blind_responses (prompt_id);

-- Custom Quiz: the author wrote the questions, so nothing is secret.
CREATE TABLE custom_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id uuid NOT NULL REFERENCES personal_quizzes (id) ON DELETE CASCADE,
  position smallint NOT NULL CHECK (position BETWEEN 0 AND 49),
  text text NOT NULL CHECK (char_length(text) BETWEEN 5 AND 200),
  options jsonb NOT NULL,
  correct_index smallint NOT NULL CHECK (correct_index BETWEEN 0 AND 5),
  explanation text CHECK (explanation IS NULL OR char_length(explanation) <= 200),
  UNIQUE (quiz_id, position)
);
