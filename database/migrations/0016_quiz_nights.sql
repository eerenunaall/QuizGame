-- Host-led quiz nights (ADR-0029). The configuration is a jsonb document validated on every write; what
-- happens during the night is an append-only command log (replayed by the server, never edited), so a
-- score dispute can be answered from the log: who changed what, when, and the value before.
-- Forward-only; never edit an applied migration.

CREATE TABLE quiz_nights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES venues (id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) <= 80),
  event_date date NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'READY', 'LIVE', 'FINISHED')),
  -- rounds, questions (with answers), teams, settings: see packages/quiznight ConfigSchema
  config jsonb NOT NULL,
  created_by uuid REFERENCES accounts (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  started_at timestamptz,
  finished_at timestamptz,
  CONSTRAINT quiz_nights_started_consistency CHECK (status IN ('DRAFT', 'READY') OR started_at IS NOT NULL)
);
CREATE INDEX quiz_nights_venue_idx ON quiz_nights (venue_id, event_date DESC);

CREATE TABLE quiz_night_events (
  night_id uuid NOT NULL REFERENCES quiz_nights (id) ON DELETE CASCADE,
  seq integer NOT NULL CHECK (seq >= 1),
  at timestamptz NOT NULL,
  -- the account that sent the command, stamped by the server (a client cannot name an actor)
  actor uuid REFERENCES accounts (id) ON DELETE SET NULL,
  cmd jsonb NOT NULL,
  prev jsonb,
  -- (night, seq) is the order of the night; two writers cannot both take the same seq
  PRIMARY KEY (night_id, seq)
);

-- The TV's display link: a signed, expiring, revocable token (only its id is stored; the signature is
-- recomputed from the server secret, so a database leak cannot mint links).
CREATE TABLE quiz_night_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  night_id uuid NOT NULL REFERENCES quiz_nights (id) ON DELETE CASCADE,
  created_by uuid REFERENCES accounts (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE INDEX quiz_night_links_night_idx ON quiz_night_links (night_id);

-- One prize per night, issued after the podium; only a keyed hash of the code is kept.
CREATE TABLE quiz_night_rewards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  night_id uuid NOT NULL UNIQUE REFERENCES quiz_nights (id) ON DELETE CASCADE,
  venue_id uuid NOT NULL REFERENCES venues (id) ON DELETE CASCADE,
  team_id text NOT NULL CHECK (char_length(team_id) <= 64),
  team_name text NOT NULL CHECK (char_length(team_name) <= 64),
  reward_text text NOT NULL CHECK (char_length(reward_text) BETWEEN 1 AND 160),
  code_hash text NOT NULL,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  redeemed_at timestamptz,
  redeemed_by uuid REFERENCES accounts (id) ON DELETE SET NULL,
  CONSTRAINT quiz_night_rewards_code_unique UNIQUE (venue_id, code_hash),
  CONSTRAINT quiz_night_rewards_redeemed_consistency CHECK (redeemed_at IS NOT NULL OR redeemed_by IS NULL)
);
