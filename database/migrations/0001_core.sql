-- Core runtime tables: rooms, durable input log, sessions, game audit trail, security/telemetry.
-- Design notes live in docs/ADR/0003, 0006, 0009. Forward-only; never edit an applied migration.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE rooms (
  id uuid PRIMARY KEY,
  code text NOT NULL CHECK (code ~ '^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$'),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CLOSED')),
  tier text NOT NULL DEFAULT 'FREE' CHECK (tier IN ('FREE', 'FULL')),
  content_language text NOT NULL DEFAULT 'tr' CHECK (content_language IN ('tr', 'en')),
  host_account_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  close_reason text,
  owner_instance_id text,
  lease_expires_at timestamptz,
  last_heartbeat_at timestamptz,
  last_event_at timestamptz,
  state_version integer NOT NULL DEFAULT 0,
  snapshot jsonb,
  snapshot_version integer NOT NULL DEFAULT 0,
  CONSTRAINT rooms_closed_consistency CHECK ((status = 'CLOSED') = (closed_at IS NOT NULL))
);
-- A code identifies exactly one open room; closed rooms release their code.
CREATE UNIQUE INDEX rooms_open_code_unique ON rooms (code) WHERE status = 'ACTIVE';
CREATE INDEX rooms_orphans_idx ON rooms (lease_expires_at) WHERE status = 'ACTIVE';

-- The exact sequence of reducer inputs. (room_id, seq) is the fencing token: a stale owner cannot
-- append once another owner has (ADR-0003). seq = room state version after applying the input.
CREATE TABLE room_events (
  room_id uuid NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
  seq integer NOT NULL CHECK (seq > 0),
  at bigint NOT NULL,
  input jsonb NOT NULL,
  PRIMARY KEY (room_id, seq)
);

CREATE TABLE room_sessions (
  id uuid PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('DISPLAY', 'PLAYER')),
  player_id text,
  device_id_hash text,
  token_hash text NOT NULL,
  prev_token_hash text,
  prev_valid_until timestamptz,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVOKED', 'KICKED', 'LEFT', 'EXPIRED')),
  client_kind text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_client_sequence bigint NOT NULL DEFAULT 0,
  CONSTRAINT room_sessions_player_ck CHECK ((role = 'PLAYER') = (player_id IS NOT NULL))
);
CREATE INDEX room_sessions_room_idx ON room_sessions (room_id);
CREATE UNIQUE INDEX room_sessions_player_unique ON room_sessions (room_id, player_id) WHERE player_id IS NOT NULL;
-- One live player slot per device per room (ALREADY_JOINED, ADR-0009).
CREATE UNIQUE INDEX room_sessions_device_active ON room_sessions (room_id, device_id_hash)
  WHERE role = 'PLAYER' AND status = 'ACTIVE' AND device_id_hash IS NOT NULL;
CREATE UNIQUE INDEX room_sessions_one_display ON room_sessions (room_id) WHERE role = 'DISPLAY' AND status = 'ACTIVE';

CREATE TABLE games (
  id uuid PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING', 'FINISHED', 'ABORTED')),
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  total_rounds integer NOT NULL CHECK (total_rounds > 0),
  config_version integer NOT NULL,
  player_count integer NOT NULL CHECK (player_count > 0)
);
CREATE INDEX games_room_idx ON games (room_id);

-- Players are pseudonymous inside a game: no nickname is stored in the audit tables.
CREATE TABLE game_players (
  game_id uuid NOT NULL REFERENCES games (id) ON DELETE CASCADE,
  player_id text NOT NULL,
  final_score integer CHECK (final_score >= 0),
  final_rank integer CHECK (final_rank > 0),
  correct_count integer,
  best_streak integer,
  PRIMARY KEY (game_id, player_id)
);

CREATE TABLE game_rounds (
  game_id uuid NOT NULL REFERENCES games (id) ON DELETE CASCADE,
  round_index integer NOT NULL CHECK (round_index >= 0),
  kind text NOT NULL,
  question_id text NOT NULL,
  answer_ms integer NOT NULL,
  correct_option_key text,
  distribution jsonb NOT NULL DEFAULT '{}'::jsonb,
  completed_at timestamptz NOT NULL DEFAULT now(),
  config_version integer NOT NULL,
  PRIMARY KEY (game_id, round_index)
);

-- Second line of defence behind the engine: at most one answer per player per round.
CREATE TABLE game_answers (
  game_id uuid NOT NULL,
  round_index integer NOT NULL,
  player_id text NOT NULL,
  option_key text,
  correct boolean NOT NULL,
  remaining_ms integer NOT NULL CHECK (remaining_ms >= 0),
  PRIMARY KEY (game_id, round_index, player_id),
  FOREIGN KEY (game_id, round_index) REFERENCES game_rounds (game_id, round_index) ON DELETE CASCADE
);

-- Every score delta, with the components that produced it (ADR-0007).
CREATE TABLE score_deltas (
  game_id uuid NOT NULL,
  round_index integer NOT NULL,
  player_id text NOT NULL,
  delta integer NOT NULL,
  total_after integer NOT NULL CHECK (total_after >= 0),
  components jsonb NOT NULL,
  config_version integer NOT NULL,
  PRIMARY KEY (game_id, round_index, player_id),
  FOREIGN KEY (game_id, round_index) REFERENCES game_rounds (game_id, round_index) ON DELETE CASCADE
);

CREATE TABLE security_events (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL,
  room_id uuid,
  session_id uuid,
  ip_hash text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX security_events_at_idx ON security_events (at DESC);
CREATE INDEX security_events_kind_idx ON security_events (kind, at DESC);

CREATE TABLE telemetry_events (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  name text NOT NULL,
  actor text,
  props jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX telemetry_name_at_idx ON telemetry_events (name, at DESC);

CREATE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER score_deltas_append_only BEFORE UPDATE ON score_deltas FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER room_events_append_only BEFORE UPDATE ON room_events FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
