-- Blind Quiz invite claim (ADR-0015, ATTACK 10). Forward-only; never edit an applied migration.
--
-- The creator holds the invite link (they hand it to the target), so the link alone must not open the
-- target's answers. The first consent mints a second secret that only the target's browser keeps (an
-- HttpOnly cookie); this is its keyed hash. Once set, every read, write and delete needs it, and the
-- creator can no longer rotate the invite into a new link that would read the answers.
ALTER TABLE blind_targets ADD COLUMN claim_hash text;
