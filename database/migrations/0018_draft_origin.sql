-- Drafts now have two sources (ADR-0028 §6): AI (generated from a document by the model) and TEXT (questions that
-- already exist as text in a document or a paste, read by the key-free parser). Approval labels the upload by it.
-- Forward-only; never edit an applied migration.
ALTER TABLE venue_question_drafts
  ADD COLUMN origin text NOT NULL DEFAULT 'AI' CHECK (origin IN ('AI', 'TEXT'));
