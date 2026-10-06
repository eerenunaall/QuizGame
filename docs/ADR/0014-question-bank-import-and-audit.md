# ADR-0014: Question bank, import and audit pipeline

Status: Accepted · Date: 2026-10-06

## Context
GDD §9/§10/§27 and the rubric define a 50 000-question living bank with a lifecycle, structured audit
output and duplicate detection (lexical + MinHash + semantic). The sandbox has **no LLM key and no
internet fact sources**, and pgvector is not installed (pg_trgm and citext are). Rubric rule: nothing
becomes ACTIVE because one model says it is fine; raw AI output is never imported to production.

## Decision
### Schema (migration 0002)
`questions` (language, category, subcategory, topic, difficulty EASY..EXPERT, text, explanation,
pool EVERGREEN|CURRENT, `expires_at`, `last_verified_at`, lifecycle status
DRAFT…ACTIVE|REVIEW|RETIRED|REJECTED, `author_type` HUMAN|AI_ASSISTED|AI_DRAFT|DEV_SEED, quality /
ambiguity / difficulty / gameplay scores, `lexical_fingerprint` (unique per language),
`minhash` signature, `semantic_fingerprint` + `semantic_provider`, usage counters, `is_dev_seed`),
`question_options` (2–6, default 4; partial unique index → at most one correct, import validation →
exactly one), `question_sources`, `question_audits` (append-only history), `question_reports`,
`question_usage`, `categories`. A DB trigger refuses `status='ACTIVE'` without a PASS audit that has
a passing fact-check dimension, and forbids editing `ACTIVE` text without re-entering REVIEW.

### Import (`scripts/question-import`)
JSONL/CSV → zod validation → Turkish-aware normalization (NFC, `tr` locale case folding for İ/ı,
punctuation/space collapse) → lexical fingerprint → near-duplicate search (pg_trgm candidates +
MinHash/Jaccard verification, configurable thresholds) → semantic proximity via an
`EmbeddingProvider` (external provider when configured; otherwise a feature-hashed character-n-gram
proxy, recorded as `semantic_provider='hash-ngram'` and **never presented as a semantic check**).
Rows enter as `DRAFT/REVIEW`, never `ACTIVE`. Idempotent (fingerprint upsert), transactional per batch,
dry-run mode, machine-readable report.

### Audit (`scripts/question-audit`, also run from the admin queue)
Pluggable passes → one structured result per question (rubric §7 + GDD §27):
`{ status: PASS|REVIEW|REJECT, dimensions: { factCheck, ambiguity, grammar, style, distractorQuality,
difficulty, duplication, freshness, gameplayValue: PASS|REVIEW|FAIL|NOT_RUN }, scores{…0–5}|null,
reasonCodes[], hardRejectReasons[], suggestedRewrite }`.
1. **Heuristic pass (always runs, deterministic, no network):** structure (exactly one correct, unique
   options, 4 options), answer-in-question leak, length/parenthesis/morphology clue, "all/none of the
   above", double negatives, ambiguous temporal wording without a `CURRENT` tag, repeated openers and
   templates (batch-level), correct-position balance (chi-square across the batch), banned phrases,
   Turkish typography/ASCII-folding smells, source-required categories, expiry/freshness, duplicates.
2. **LLM passes (generator-independent fact check, ambiguity critic, language editor, difficulty,
   gameplay)** via `AuditProvider` adapters (Anthropic API over `fetch` with risk-based routing),
   strict JSON output validated by zod, retries, token budget, resumable batches. Without a key they
   report `NOT_RUN`.
3. **Arbiter:** `PASS` requires heuristics PASS **and** fact-check PASS **and** rubric minimums
   (§3). Missing passes cap the status at `REVIEW` with `FACT_CHECK_NOT_RUN`. Hard-reject rules (§1)
   always win. Batch summary: `500 → 420 PASS / 58 REVIEW / 22 REJECT` (+ reason histogram).
Telemetry moves `ACTIVE → REVIEW` automatically (correct-rate anomaly, one distractor dominating,
report rate, expired `expires_at`), never rewriting history. Review-queue priority follows rubric §10.

### Dev seed
`seed/questions.tr.jsonl` holds ≥ 170 hand-written Turkish questions on stable facts (10 × 17
categories) marked `author_type=DEV_SEED`, `UNVERIFIED`. `--dev-activate` marks them playable **only
when `NODE_ENV != production`** (or staging with `QP_ALLOW_DEV_SEED=1`); the server never serves
`is_dev_seed` rows in production. They make the sandbox, E2E and demos playable; they are not the
launch bank. **EXTERNAL:** the 50 000-question launch pool needs LLM budget, source access and human sampling.

### Kill-switches
`questions.status` change takes effect on the next deck build; `feature_flags` can disable categories,
packs and modes instantly; a question can be retired mid-game-safe (already-built decks keep it,
future decks drop it).

## Verification
Unit tests per heuristic with Turkish fixtures (good/bad pairs), property tests for normalization and
fingerprint stability, MinHash accuracy test, importer idempotency, trigger tests, batch summary test,
LLM adapter tests against a local HTTP double.
