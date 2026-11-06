-- Venue images (ADR-0030 §4): a venue's logo and its team marks, stored per venue. The bytes were parsed
-- and validated whole before they got here (PNG, WebP or JPEG only, no metadata, no trailing bytes);
-- a row is addressed by (venue, sha256) and served by that content hash.
-- Forward-only; never edit an applied migration.

CREATE TABLE venue_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES venues (id) ON DELETE CASCADE,
  -- lowercase hex sha256 of `bytes`: the public address of the image, and the idempotency key of an upload
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  content_type text NOT NULL CHECK (content_type IN ('image/png', 'image/webp', 'image/jpeg')),
  width integer NOT NULL CHECK (width BETWEEN 1 AND 16383),
  height integer NOT NULL CHECK (height BETWEEN 1 AND 16383),
  bytes bytea NOT NULL CHECK (octet_length(bytes) BETWEEN 1 AND 307200),
  created_by uuid REFERENCES accounts (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT venue_assets_pixels CHECK (width::bigint * height <= 1600000),
  CONSTRAINT venue_assets_unique UNIQUE (venue_id, sha256)
);
CREATE INDEX venue_assets_venue_idx ON venue_assets (venue_id, created_at);
