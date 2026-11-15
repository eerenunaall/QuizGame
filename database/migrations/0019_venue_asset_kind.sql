-- Question pictures for quiz nights (docs/TODO.md A2): the venue asset store now holds two kinds of image.
-- BRAND is the logo and team marks (at most 12, cleaned up when the look no longer refers to them); QUESTION
-- is a picture shown on a quiz night slide (at most 60, referenced from the night's configuration).
-- Forward-only; never edit an applied migration.
ALTER TABLE venue_assets
  ADD COLUMN kind text NOT NULL DEFAULT 'BRAND' CHECK (kind IN ('BRAND', 'QUESTION'));
CREATE INDEX venue_assets_kind_idx ON venue_assets (venue_id, kind, created_at);
