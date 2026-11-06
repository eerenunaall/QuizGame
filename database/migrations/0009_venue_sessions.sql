-- Venue mode (ADR-0024): time-metered tables for cafés, staff and rewards. Behind the `venue.sessions`
-- flag, off by default. The system meters time; it never takes or records money.
-- Forward-only; never edit an applied migration.

INSERT INTO feature_flags (key, enabled, public, description) VALUES
  ('venue.sessions', false, false, 'Venue mode: time-metered tables, staff page, rewards (ADR-0024)')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE venues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  -- validated by the server on every write; missing keys read as their defaults
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES accounts (id) ON DELETE SET NULL
);

CREATE TABLE venue_staff (
  venue_id uuid NOT NULL REFERENCES venues (id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('OWNER', 'STAFF')),
  added_at timestamptz NOT NULL DEFAULT now(),
  added_by uuid REFERENCES accounts (id) ON DELETE SET NULL,
  PRIMARY KEY (venue_id, account_id)
);
CREATE INDEX venue_staff_account_idx ON venue_staff (account_id);

CREATE TABLE venue_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES venues (id) ON DELETE CASCADE,
  -- the room may be gone (closed and purged) long before the report is read: no foreign key
  room_id uuid NOT NULL,
  room_code text NOT NULL,
  opened_by uuid REFERENCES accounts (id) ON DELETE SET NULL,
  purchased_seconds integer NOT NULL CHECK (purchased_seconds > 0 AND purchased_seconds <= 86400),
  started_at timestamptz NOT NULL,
  paused_at timestamptz,
  paused_total_seconds double precision NOT NULL DEFAULT 0 CHECK (paused_total_seconds >= 0),
  ended_at timestamptz,
  state text NOT NULL DEFAULT 'RUNNING' CHECK (state IN ('RUNNING', 'PAUSED', 'ENDED')),
  CONSTRAINT venue_sessions_paused_consistency CHECK ((state = 'PAUSED') = (paused_at IS NOT NULL)),
  CONSTRAINT venue_sessions_ended_consistency CHECK ((state = 'ENDED') = (ended_at IS NOT NULL))
);
-- One open table per room: a second open on the same TV is refused by the database itself.
CREATE UNIQUE INDEX venue_sessions_one_open_per_room ON venue_sessions (room_id) WHERE state <> 'ENDED';
CREATE INDEX venue_sessions_venue_started_idx ON venue_sessions (venue_id, started_at);

-- Append-only audit of what staff did to a table (who, what, how many seconds).
CREATE TABLE venue_session_events (
  id bigserial PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES venue_sessions (id) ON DELETE CASCADE,
  venue_id uuid NOT NULL REFERENCES venues (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('OPEN', 'EXTEND', 'PAUSE', 'RESUME', 'END', 'REDEEM')),
  staff_account_id uuid REFERENCES accounts (id) ON DELETE SET NULL,
  seconds integer NOT NULL DEFAULT 0,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX venue_session_events_venue_idx ON venue_session_events (venue_id, at);

CREATE FUNCTION venue_session_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'venue_session_events is append-only';
END $$;
CREATE TRIGGER venue_session_events_no_update BEFORE UPDATE ON venue_session_events
  FOR EACH ROW EXECUTE FUNCTION venue_session_events_append_only();

-- A reward for the winner of a game played on a metered table. The winner is a nickname, never an
-- account; only a keyed hash of the code is kept.
CREATE TABLE venue_rewards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES venues (id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES venue_sessions (id) ON DELETE CASCADE,
  room_id uuid NOT NULL,
  game_id uuid NOT NULL,
  winner_display_name text NOT NULL CHECK (char_length(winner_display_name) <= 64),
  -- what the reward was when it was won (the owner may change the text later)
  reward_text text NOT NULL CHECK (char_length(reward_text) BETWEEN 1 AND 120),
  code_hash text NOT NULL,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  redeemed_at timestamptz,
  redeemed_by uuid REFERENCES accounts (id) ON DELETE SET NULL,
  CONSTRAINT venue_rewards_code_unique UNIQUE (venue_id, code_hash),
  -- one reward per game at most
  CONSTRAINT venue_rewards_game_unique UNIQUE (game_id),
  -- redeemed is one fact: both columns set together (redeemed_by may later be nulled by an account deletion)
  CONSTRAINT venue_rewards_redeemed_consistency CHECK (redeemed_at IS NOT NULL OR redeemed_by IS NULL)
);
CREATE INDEX venue_rewards_venue_issued_idx ON venue_rewards (venue_id, issued_at);
CREATE INDEX venue_rewards_session_idx ON venue_rewards (session_id, issued_at);
