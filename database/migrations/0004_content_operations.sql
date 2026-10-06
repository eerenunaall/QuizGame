-- Content operations (ADR-0014, ADR-0012, ADR-0018): the audit trail and lifecycle guards of the
-- question bank, player reports, feature flags, the account/role/session core the admin console
-- signs in with, the admin audit log, bans and incidents. Forward-only.

-- ───────────── question bank: revisions, telemetry counters, status log, audits ─────────────

ALTER TABLE questions
  ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  -- transaction that last bumped `revision`: one editing transaction is one revision
  ADD COLUMN revision_txid bigint,
  ADD COLUMN fingerprint_version smallint NOT NULL DEFAULT 1,
  ADD COLUMN skip_count bigint NOT NULL DEFAULT 0;

ALTER TABLE question_options
  ADD COLUMN pick_count bigint NOT NULL DEFAULT 0;

CREATE INDEX questions_category_status_idx ON questions (category_id, status);
CREATE INDEX questions_expiry_idx ON questions (expires_at)
  WHERE status = 'ACTIVE' AND expires_at IS NOT NULL;

-- Every audit pass ever run, never edited (rubric §7, GDD §27). The arbiter's verdict is stored as
-- pass = 'ARBITER'; ACTIVE needs the latest one for the current revision to be PASS.
CREATE TABLE question_audits (
  id bigserial PRIMARY KEY,
  question_id uuid NOT NULL REFERENCES questions (id) ON DELETE CASCADE,
  question_revision integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  pass text NOT NULL CHECK (pass IN
    ('HEURISTIC', 'FACT_CHECK', 'AMBIGUITY', 'LANGUAGE', 'DIFFICULTY', 'GAMEPLAY', 'ARBITER', 'MANUAL')),
  provider text NOT NULL CHECK (char_length(provider) BETWEEN 1 AND 80),
  status text NOT NULL CHECK (status IN ('PASS', 'REVIEW', 'REJECT')),
  dimensions jsonb NOT NULL DEFAULT '{}'::jsonb,
  scores jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason_codes text[] NOT NULL DEFAULT '{}',
  hard_reject_reasons text[] NOT NULL DEFAULT '{}',
  review_reasons text[] NOT NULL DEFAULT '{}',
  suggested_rewrite text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_account_id uuid
);
CREATE INDEX question_audits_question_idx ON question_audits (question_id, id DESC);
CREATE INDEX question_audits_pass_idx ON question_audits (question_id, pass, id DESC);
CREATE TRIGGER question_audits_append_only BEFORE UPDATE ON question_audits
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Status transitions are logged by a trigger so that no path, including hand-written SQL, can
-- change a question's status unrecorded. The application states who and why with
-- set_config('qp.actor' | 'qp.reason' | 'qp.detail', ..., true) inside its transaction.
CREATE TABLE question_status_log (
  id bigserial PRIMARY KEY,
  question_id uuid NOT NULL REFERENCES questions (id) ON DELETE CASCADE,
  at timestamptz NOT NULL DEFAULT now(),
  from_status text,
  to_status text NOT NULL,
  actor_account_id uuid,
  reason text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX question_status_log_question_idx ON question_status_log (question_id, id DESC);
CREATE TRIGGER question_status_log_append_only BEFORE UPDATE ON question_status_log
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE FUNCTION questions_status_log() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO question_status_log (question_id, from_status, to_status, actor_account_id, reason, detail)
    VALUES (
      NEW.id,
      CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END,
      NEW.status,
      NULLIF(current_setting('qp.actor', true), '')::uuid,
      COALESCE(NULLIF(current_setting('qp.reason', true), ''), 'UNSPECIFIED'),
      COALESCE(NULLIF(current_setting('qp.detail', true), '')::jsonb, '{}'::jsonb)
    );
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER questions_status_log AFTER INSERT OR UPDATE OF status ON questions
  FOR EACH ROW EXECUTE FUNCTION questions_status_log();

-- The lifecycle guard. Nothing becomes APPROVED or ACTIVE without a passing arbiter audit for the
-- current revision whose fact-check dimension passed (ADR-0014: never on one model's say-so), and
-- the content of an APPROVED/ACTIVE question is frozen: editing means moving it to REVIEW first,
-- which bumps the revision and invalidates the old audit. Dev-seed rows are exempt (they are never
-- served in production, see QP_ALLOW_DEV_SEED).
CREATE FUNCTION questions_guard() RETURNS trigger AS $$
DECLARE
  latest question_audits%ROWTYPE;
  option_count integer;
  correct_count integer;
  content_changed boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.revision_txid := txid_current();
  ELSE
    content_changed :=
      NEW.text IS DISTINCT FROM OLD.text
      OR NEW.explanation IS DISTINCT FROM OLD.explanation
      OR NEW.difficulty IS DISTINCT FROM OLD.difficulty
      OR NEW.category_id IS DISTINCT FROM OLD.category_id
      OR NEW.language IS DISTINCT FROM OLD.language
      OR NEW.pool IS DISTINCT FROM OLD.pool;
    IF content_changed AND OLD.status IN ('APPROVED', 'ACTIVE') AND NEW.status = OLD.status
       AND NOT OLD.is_dev_seed THEN
      RAISE EXCEPTION 'content of an % question is frozen; move it to REVIEW first', OLD.status
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF content_changed AND NEW.revision_txid IS DISTINCT FROM txid_current() THEN
      NEW.revision := OLD.revision + 1;
      NEW.revision_txid := txid_current();
    END IF;
  END IF;

  IF NEW.status IN ('APPROVED', 'ACTIVE') AND NOT NEW.is_dev_seed
     AND (TG_OP = 'INSERT'
          OR OLD.status IS DISTINCT FROM NEW.status
          OR content_changed
          OR OLD.is_dev_seed) THEN
    SELECT * INTO latest FROM question_audits
      WHERE question_id = NEW.id AND pass = 'ARBITER' AND question_revision = NEW.revision
      ORDER BY id DESC LIMIT 1;
    IF NOT FOUND OR latest.status <> 'PASS' OR latest.dimensions ->> 'factCheck' IS DISTINCT FROM 'PASS' THEN
      RAISE EXCEPTION 'question % cannot become % without a passing audit for revision %',
        NEW.id, NEW.status, NEW.revision USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    SELECT count(*), count(*) FILTER (WHERE is_correct) INTO option_count, correct_count
      FROM question_options WHERE question_id = NEW.id;
    IF option_count < 2 OR option_count > 6 OR correct_count <> 1 THEN
      RAISE EXCEPTION 'question % needs 2-6 options with exactly one correct (has % / %)',
        NEW.id, option_count, correct_count USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER questions_guard BEFORE INSERT OR UPDATE ON questions
  FOR EACH ROW EXECUTE FUNCTION questions_guard();

-- Options belong to the question's revision: changing them bumps it (once per transaction) and is
-- refused while the question is APPROVED/ACTIVE. Counter updates (pick_count) do not fire this.
CREATE FUNCTION question_options_guard() RETURNS trigger AS $$
DECLARE
  qid uuid;
  parent record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    qid := OLD.question_id;
  ELSE
    qid := NEW.question_id;
  END IF;
  SELECT status, is_dev_seed INTO parent FROM questions WHERE id = qid;
  IF FOUND THEN
    IF parent.status IN ('APPROVED', 'ACTIVE') AND NOT parent.is_dev_seed THEN
      RAISE EXCEPTION 'options of an % question are frozen; move it to REVIEW first', parent.status
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    UPDATE questions SET revision = revision + 1, revision_txid = txid_current()
      WHERE id = qid AND revision_txid IS DISTINCT FROM txid_current();
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER question_options_guard
  BEFORE INSERT OR DELETE OR UPDATE OF question_id, position, text, is_correct ON question_options
  FOR EACH ROW EXECUTE FUNCTION question_options_guard();

-- ───────────── player reports ─────────────

CREATE TABLE question_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL REFERENCES questions (id) ON DELETE CASCADE,
  question_revision integer NOT NULL,
  -- pseudonym of the reporting room session; never a nickname, never an address
  reporter_hash text NOT NULL,
  room_id uuid,
  reason text NOT NULL CHECK (reason IN
    ('WRONG_ANSWER', 'MULTIPLE_CORRECT', 'OUTDATED', 'TYPO', 'OFFENSIVE', 'UNCLEAR', 'DUPLICATE', 'OTHER')),
  note text CHECK (note IS NULL OR char_length(note) <= 300),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'ACTIONED', 'DISMISSED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid,
  resolution text CHECK (resolution IS NULL OR char_length(resolution) <= 300),
  CONSTRAINT question_reports_resolved_consistency CHECK ((status = 'OPEN') = (resolved_at IS NULL)),
  UNIQUE (question_id, reporter_hash)
);
CREATE INDEX question_reports_status_idx ON question_reports (status, created_at DESC);
CREATE INDEX question_reports_question_idx ON question_reports (question_id, status);

CREATE FUNCTION question_reports_count() RETURNS trigger AS $$
BEGIN
  UPDATE questions SET report_count = report_count + 1 WHERE id = NEW.question_id;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER question_reports_count AFTER INSERT ON question_reports
  FOR EACH ROW EXECUTE FUNCTION question_reports_count();

-- ───────────── feature flags ─────────────

CREATE TABLE feature_flags (
  key text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_.-]{1,63}$'),
  enabled boolean NOT NULL DEFAULT false,
  description text NOT NULL DEFAULT '',
  -- exposed to clients through GET /v1/flags (never put anything sensitive behind a public flag)
  public boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
INSERT INTO feature_flags (key, enabled, public, description) VALUES
  ('mode.blind_quiz', false, true, 'Blind Quiz (ADR-0015)'),
  ('mode.who_said_it', false, true, 'Who Said It (ADR-0015)'),
  ('mode.custom_quiz', false, true, 'Custom quizzes (ADR-0015)'),
  ('sabotage.noise', false, false, 'The excluded NOISE sabotage (ADR-0010)'),
  ('ai.decoys', false, false, 'AI decoy answers for personal quizzes (ADR-0015)'),
  ('auth.email_login', true, true, 'Email one-time-code sign-in (ADR-0012)'),
  ('auth.apple', false, true, 'Sign in with Apple (ADR-0012)'),
  ('auth.google', false, true, 'Sign in with Google (ADR-0012)'),
  ('content.current_events', true, true, 'Serve questions from the CURRENT pool'),
  ('report.questions', true, true, 'Players can report a question from the reveal screen')
ON CONFLICT (key) DO NOTHING;

-- ───────────── accounts, roles, sessions, one-time codes (ADR-0012) ─────────────

CREATE TABLE accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext UNIQUE,
  email_verified_at timestamptz,
  display_name text CHECK (display_name IS NULL OR char_length(display_name) BETWEEN 1 AND 40),
  avatar_id text,
  locale text NOT NULL DEFAULT 'tr' CHECK (locale IN ('tr', 'en')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'DELETED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz,
  deleted_at timestamptz,
  CONSTRAINT accounts_deleted_consistency CHECK ((status = 'DELETED') = (deleted_at IS NOT NULL))
);

CREATE TABLE account_roles (
  account_id uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('ADMIN', 'EDITOR', 'MODERATOR', 'SUPPORT')),
  granted_by uuid,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, role)
);

CREATE TABLE account_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  -- HMAC of the opaque 256-bit bearer token; the token itself is never stored
  token_hash text NOT NULL UNIQUE,
  kind text NOT NULL CHECK (kind IN ('WEB', 'MOBILE', 'ADMIN')),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  ip_hash text,
  user_agent_hash text
);
CREATE INDEX account_sessions_account_idx ON account_sessions (account_id) WHERE revoked_at IS NULL;

CREATE TABLE email_otps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- HMACs only: a leaked table reveals neither addresses nor codes
  email_hash text NOT NULL,
  code_hash text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('LOGIN')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  attempts smallint NOT NULL DEFAULT 0,
  consumed_at timestamptz,
  ip_hash text
);
CREATE INDEX email_otps_lookup_idx ON email_otps (email_hash, created_at DESC);
CREATE INDEX email_otps_created_idx ON email_otps (created_at);

-- ───────────── admin audit log, bans, incidents ─────────────

CREATE TABLE admin_audit (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  actor_account_id uuid,
  actor_roles text[] NOT NULL DEFAULT '{}',
  action text NOT NULL CHECK (char_length(action) BETWEEN 1 AND 80),
  target_type text NOT NULL CHECK (char_length(target_type) BETWEEN 1 AND 40),
  target_id text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_hash text,
  request_id text
);
CREATE INDEX admin_audit_at_idx ON admin_audit (at DESC);
CREATE INDEX admin_audit_target_idx ON admin_audit (target_type, target_id, at DESC);
CREATE INDEX admin_audit_actor_idx ON admin_audit (actor_account_id, at DESC);
CREATE TRIGGER admin_audit_no_update BEFORE UPDATE ON admin_audit
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER admin_audit_no_delete BEFORE DELETE ON admin_audit
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Where a room session came from, so a ban can be placed from a live room without ever showing
-- an address or a device id to the moderator.
ALTER TABLE room_sessions ADD COLUMN ip_hash text;

CREATE TABLE bans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('ACCOUNT', 'DEVICE', 'IP')),
  -- ACCOUNT: the account id; DEVICE and IP: the same keyed pseudonyms the room tables hold
  subject_hash text NOT NULL CHECK (char_length(subject_hash) BETWEEN 1 AND 128),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 300),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  lifted_at timestamptz,
  lifted_by uuid
);
CREATE UNIQUE INDEX bans_open_unique ON bans (kind, subject_hash) WHERE lifted_at IS NULL;

CREATE TABLE incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 160),
  severity text NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'MITIGATED', 'RESOLVED')),
  summary text NOT NULL DEFAULT '' CHECK (char_length(summary) <= 4000),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CONSTRAINT incidents_resolved_consistency CHECK ((status = 'RESOLVED') = (resolved_at IS NOT NULL))
);
CREATE TRIGGER incidents_touch BEFORE UPDATE ON incidents
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE incident_notes (
  id bigserial PRIMARY KEY,
  incident_id uuid NOT NULL REFERENCES incidents (id) ON DELETE CASCADE,
  at timestamptz NOT NULL DEFAULT now(),
  author_account_id uuid,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000)
);
CREATE INDEX incident_notes_incident_idx ON incident_notes (incident_id, id);
