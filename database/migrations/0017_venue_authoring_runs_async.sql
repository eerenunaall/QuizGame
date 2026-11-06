-- Question authoring from documents, second step (ADR-0028 §6): a run takes minutes, so it is a job the
-- page polls instead of one long request; and the daily quota becomes an ADMIN-editable per-venue knob.
-- Forward-only; never edit an applied migration.

-- A run starts as RUNNING and ends OK, EMPTY (the model found nothing usable) or FAILED (`failure` says why).
ALTER TABLE venue_authoring_runs DROP CONSTRAINT venue_authoring_runs_status_check;
ALTER TABLE venue_authoring_runs
  ADD CONSTRAINT venue_authoring_runs_status_check CHECK (status IN ('RUNNING', 'OK', 'FAILED', 'EMPTY')),
  ADD COLUMN failure text CHECK (failure IS NULL OR char_length(failure) <= 40),
  ADD COLUMN finished_at timestamptz,
  ADD COLUMN category text CHECK (category IS NULL OR char_length(category) <= 80);

-- NULL = the deployment default (AUTHORING_DAILY_RUNS, 5); 0 switches generation off for this venue.
ALTER TABLE venues
  ADD COLUMN authoring_daily_runs integer CHECK (authoring_daily_runs IS NULL OR authoring_daily_runs BETWEEN 0 AND 500);

-- Drafts are looked up by the expiry job and by "has this file been read already".
CREATE INDEX venue_question_drafts_expiry_idx ON venue_question_drafts (expires_at) WHERE state = 'DRAFT';
CREATE INDEX venue_question_drafts_hash_idx ON venue_question_drafts (venue_id, source_file_hash);
