#!/usr/bin/env bash
# Loads a verified question bank through the real import path (ADR-0014): categories, then every
# questions.*.tr.jsonl, then (optional) external audit verdicts audits.*.jsonl, then activation of what the
# arbiter passed. Safe to run on every start: the importer is idempotent (re-import = SKIPPED/UNCHANGED).
#
# Used by entrypoint.sh when QP_BANK_DIR is set. Works in production: it never passes --allow-dev-seed,
# so a DEV_SEED row is refused by the importer (FORBIDDEN_AUTHOR) and reported as a problem row.
# Problem rows are reported loudly but do not stop the start: the service must come up with what is valid.
# Layout of QP_BANK_DIR (default seed/gusto):
#   categories.json           optional  [{id,tr,en}]
#   questions.*.tr.jsonl      rows with authorType AI_ASSISTED (or HUMAN) and sources
#   audits.*.jsonl            optional  external audit verdicts (`question import-results` format), keyed by externalId
#   audits.*.source           optional  one line: the auditor label for the same-named file (e.g. audits.R1.source);
#                                       default QP_BANK_AUDIT_SOURCE, then gusto-verified
# Re-applying an audits file is idempotent (an identical verdict for the same revision and auditor is not stored again).
set -euo pipefail

DIR="${1:-${QP_BANK_DIR:-}}"
KEEP_PREFIX="${QP_BANK_KEEP_PREFIX:-gusto-}"
Q=(pnpm --filter @quizparty/scripts run question)

if [ -z "$DIR" ] || [ ! -d "$DIR" ]; then
  echo "bank: no bank directory ($DIR), nothing to load"
  exit 0
fi
DIR="$(cd "$DIR" && pwd)"

shopt -s nullglob
files=("$DIR"/questions.*.tr.jsonl)
if [ "${#files[@]}" -eq 0 ]; then
  echo "bank: $DIR has no questions.*.tr.jsonl, nothing to load"
  exit 0
fi

if [ -f "$DIR/categories.json" ]; then
  "${Q[@]}" categories --categories-file "$DIR/categories.json"
else
  "${Q[@]}" categories
fi

for f in "${files[@]}"; do
  echo "bank: importing $f"
  "${Q[@]}" import "$f" || echo "bank: WARNING $f had problem rows (see lines above); the valid rows were imported"
done

for f in "$DIR"/audits.*.jsonl; do
  echo "bank: applying audit verdicts $f"
  # Exit 1 = some lines skipped (e.g. already applied revision); the questions still get judged below.
  source_label="${QP_BANK_AUDIT_SOURCE:-gusto-verified}"
  if [ -f "${f%.jsonl}.source" ]; then source_label="$(head -n1 "${f%.jsonl}.source" | tr -d '\r\n')"; fi
  "${Q[@]}" import-results "$f" --source "$source_label" || echo "bank: some audit lines were skipped (continuing)"
done

# Only questions whose arbiter verdict is PASS become ACTIVE; the rest stay in REVIEW for a person.
# `--no-models`: no model key is needed, the verdicts above are the fact check.
# Never REVIEW here: this runs on every start, and a question that players reported or a moderator /
# the maintenance job pulled out of play keeps its old PASS verdict, so it would come back at the next
# restart. Only a person sends a REVIEW question back (verdicts from a new audits file do it themselves).
"${Q[@]}" audit --status DRAFT,APPROVED --no-models --auto-activate || echo "bank: audit reported problems (continuing)"

# Switch the served bank to the verified one. Guarded: a no-op until the command exists.
help_text="$("${Q[@]}" help 2>&1 || true)"
if grep -q "retire-dev" <<<"$help_text"; then
  "${Q[@]}" retire-dev --keep-prefix "$KEEP_PREFIX"
else
  echo "bank: question CLI has no retire-dev yet, skipping (development rows stay as they are)"
fi
