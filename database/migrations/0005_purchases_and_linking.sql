-- Purchases, entitlements and TV link intents (ADR-0013); account deletion support (ADR-0012/0018).
-- Forward-only; never edit an applied migration.

-- The id a store sees instead of our account id (Apple `appAccountToken`, Google obfuscated account id).
ALTER TABLE accounts ADD COLUMN store_account_token uuid NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX accounts_store_token_unique ON accounts (store_account_token);

CREATE TABLE purchase_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform text NOT NULL CHECK (platform IN ('IOS', 'ANDROID')),
  product_id text NOT NULL,
  external_transaction_id text NOT NULL,
  -- keyed hash of the Google purchase token (webhooks find a purchase by it); the token is never stored
  purchase_token_hash text,
  -- the buyer; set to NULL (with a tombstone) when the account is deleted, never changed to another account
  account_id uuid REFERENCES accounts (id) ON DELETE SET NULL,
  former_account_ref text,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'VERIFIED', 'REJECTED', 'REFUNDED')),
  environment text NOT NULL CHECK (environment IN ('PRODUCTION', 'SANDBOX')),
  created_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  raw_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT purchase_transactions_unique UNIQUE (platform, external_transaction_id)
);
CREATE INDEX purchase_transactions_account_idx ON purchase_transactions (account_id);
CREATE UNIQUE INDEX purchase_transactions_token_unique ON purchase_transactions (purchase_token_hash)
  WHERE purchase_token_hash IS NOT NULL;

-- A purchase belongs to the account that first proved it; no later request can move it (losing the
-- link when an account is deleted is the only change), and a refunded one cannot become valid again.
CREATE FUNCTION purchase_transactions_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.account_id IS NOT NULL AND NEW.account_id IS NOT NULL AND NEW.account_id <> OLD.account_id THEN
    RAISE EXCEPTION 'a purchase cannot move to another account';
  END IF;
  IF OLD.status = 'REFUNDED' AND NEW.status <> 'REFUNDED' THEN
    RAISE EXCEPTION 'a refunded purchase stays refunded';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER purchase_transactions_guard BEFORE UPDATE ON purchase_transactions
  FOR EACH ROW EXECUTE FUNCTION purchase_transactions_guard();

CREATE TABLE entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  product text NOT NULL,
  platform text CHECK (platform IN ('IOS', 'ANDROID')),
  source_transaction_id uuid REFERENCES purchase_transactions (id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVOKED')),
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT entitlements_revoked_consistency CHECK ((status = 'REVOKED') = (revoked_at IS NOT NULL))
);
-- At most one live entitlement per account and product: granting twice is a no-op by construction.
CREATE UNIQUE INDEX entitlements_one_active ON entitlements (account_id, product) WHERE status = 'ACTIVE';

-- Store server notifications are delivered at least once; this makes handling idempotent.
CREATE TABLE store_notifications (
  platform text NOT NULL CHECK (platform IN ('IOS', 'ANDROID')),
  notification_id text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (platform, notification_id)
);

-- A QR code on the TV carries only this random token. It has no authority of its own: claiming needs
-- a signed-in account and can only attach that account's entitlement to this room.
CREATE TABLE link_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLAIMED', 'CANCELLED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  claimed_by uuid REFERENCES accounts (id) ON DELETE SET NULL,
  claimed_at timestamptz
);
CREATE INDEX link_intents_room_idx ON link_intents (room_id, status);
