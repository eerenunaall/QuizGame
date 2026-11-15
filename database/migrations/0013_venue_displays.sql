-- Venue displays (ADR-0028): a café's TVs are paired from its panel and hold a revocable credential; each
-- paired TV is a licence seat. Only keyed hashes of codes and tokens are stored.
-- Forward-only; never edit an applied migration.

-- The licence knob: how many TVs a venue may pair (ADMIN changes it in the console).
ALTER TABLE venues
  ADD COLUMN display_seats integer NOT NULL DEFAULT 3 CHECK (display_seats BETWEEN 0 AND 50);

CREATE TABLE venue_displays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES venues (id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
  paired_by uuid REFERENCES accounts (id) ON DELETE SET NULL,
  paired_at timestamptz NOT NULL,
  -- HMAC of the credential the TV holds now, of the one offered to it (rotation) and of the one it
  -- held before the last promotion (accepted for a short grace, then treated as theft)
  token_hash text NOT NULL UNIQUE,
  pending_token_hash text UNIQUE,
  previous_token_hash text,
  rotated_at timestamptz NOT NULL,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES accounts (id) ON DELETE SET NULL,
  -- OWNER (panel), ADMIN (console) or REUSE (a replayed old credential)
  revoke_reason text CHECK (revoke_reason IN ('OWNER', 'ADMIN', 'REUSE')),
  CONSTRAINT venue_displays_revoked_consistency CHECK ((revoked_at IS NULL) = (revoke_reason IS NULL))
);
CREATE INDEX venue_displays_venue_idx ON venue_displays (venue_id) WHERE revoked_at IS NULL;
CREATE INDEX venue_displays_previous_idx ON venue_displays (previous_token_hash)
  WHERE previous_token_hash IS NOT NULL;

-- A code shown on a TV, waiting for an owner to claim it. Single use, short-lived.
CREATE TABLE venue_display_pairings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash text NOT NULL UNIQUE,
  -- the browser that showed the code holds this secret (HttpOnly cookie) and alone collects the result
  secret_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  claimed_at timestamptz,
  claimed_venue_id uuid REFERENCES venues (id) ON DELETE CASCADE,
  claimed_by uuid REFERENCES accounts (id) ON DELETE SET NULL,
  -- the display the claim created, handed to the TV on its next poll
  display_id uuid REFERENCES venue_displays (id) ON DELETE CASCADE,
  collected_at timestamptz,
  CONSTRAINT venue_display_pairings_claim_consistency
    CHECK ((claimed_at IS NULL) = (display_id IS NULL))
);
CREATE INDEX venue_display_pairings_expiry_idx ON venue_display_pairings (expires_at);
