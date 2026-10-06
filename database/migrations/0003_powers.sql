-- Power use per answer and the sabotage audit trail (ADR-0007, ADR-0010).
ALTER TABLE game_answers
  ADD COLUMN stake text,
  ADD COLUMN double_down boolean NOT NULL DEFAULT false,
  ADD COLUMN fifty_fifty boolean NOT NULL DEFAULT false;

-- Every sabotage, including the ones the shield blocked, with who did what to whom.
CREATE TABLE sabotage_events (
  game_id uuid NOT NULL,
  round_index integer NOT NULL,
  seq smallint NOT NULL,
  actor_player_id text NOT NULL,
  target_player_id text NOT NULL,
  effect text NOT NULL CHECK (effect IN ('JAM', 'SHUFFLE', 'FOG', 'LOCKOUT', 'POINT_TAX')),
  blocked boolean NOT NULL,
  PRIMARY KEY (game_id, round_index, seq),
  FOREIGN KEY (game_id, round_index) REFERENCES game_rounds (game_id, round_index) ON DELETE CASCADE
);
