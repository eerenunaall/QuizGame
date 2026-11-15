-- Reports of personal-quiz questions (ADR-0015 "UGC safety", acceptance AC). The report names the quiz and
-- the question by id only: no question text, option or answer is copied here, so a moderator can remove
-- the content without the sealed answer ever leaving the vault. Forward-only; never edit an applied migration.

CREATE TABLE personal_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- the reports go with the quiz: when its retention ends or its owner deletes it, there is nothing left to judge
  quiz_id uuid NOT NULL REFERENCES personal_quizzes (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('BLIND', 'CUSTOM')),
  -- blind_responses.id or custom_questions.id; no foreign key, so removing the question keeps the case
  question_id uuid NOT NULL,
  -- pseudonym of the reporting room session; never a nickname, never an address
  reporter_hash text NOT NULL,
  room_id uuid,
  reason text NOT NULL CHECK (reason IN
    ('WRONG_ANSWER', 'MULTIPLE_CORRECT', 'OUTDATED', 'TYPO', 'OFFENSIVE', 'UNCLEAR', 'DUPLICATE', 'OTHER')),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'ACTIONED', 'DISMISSED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid,
  resolution text CHECK (resolution IS NULL OR resolution IN ('DISMISS', 'REMOVE_QUESTION', 'DELETE_QUIZ')),
  CONSTRAINT personal_reports_resolved_consistency CHECK ((status = 'OPEN') = (resolved_at IS NULL)),
  UNIQUE (question_id, reporter_hash)
);
CREATE INDEX personal_reports_status_idx ON personal_reports (status, created_at DESC);
CREATE INDEX personal_reports_quiz_idx ON personal_reports (quiz_id);
