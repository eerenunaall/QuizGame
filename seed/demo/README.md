# Temporary demo question bank (cult TV, films, comics, games)

DEV/DEMO ONLY. Not part of the launch pool; delete when real content replaces it.

- `categories.json` - 11 extra categories (`id`, `tr`, `en`). Created `free_rotation=false`, `source_required=false`.
- `questions.cult.tr.jsonl` - 25 original Turkish questions per category, `authorType: DEV_SEED`,
  `externalId` prefix `demo-tr-`. Every row is marked `is_dev_seed`; the server never serves those in
  production and the CLI refuses them when `NODE_ENV=production` (ADR-0014, dev seed).

## Load / check (from the repo root; `pnpm dev:db` first)

```
Q="pnpm --filter @quizparty/scripts run question"
$Q categories --categories-file ../seed/demo/categories.json
$Q import ../seed/demo/questions.cult.tr.jsonl --dry-run --allow-dev-seed --dev-activate
$Q seed --seed-file ../seed/demo/questions.cult.tr.jsonl --categories-file ../seed/demo/categories.json
```

(`seed` creates the categories and activates the rows in one go.) Paths are relative to `scripts/`.

## Extend without code changes

Add a category: append `{ "id": "...", "tr": "...", "en": "..." }` to a categories JSON (or insert a row
via the admin console / `categories` table). Add questions: append JSONL rows (or use the admin import)
with `authorType: DEV_SEED` while they are demo content. Category art falls back to the generic icon
until an entry is added to `CATEGORY_ICONS` in `apps/web/src/lib/assets.ts`.

## Remove

```sql
DELETE FROM questions WHERE external_id LIKE 'demo-tr-%';   -- options/sources/audit rows cascade
DELETE FROM categories WHERE id IN ('game-of-thrones','harry-potter','warhammer','breaking-bad',
  'better-call-saul','the-office','how-i-met-your-mother','marvel','dc','hollywood','cult-films');
```

Then delete `seed/demo/` and `packages/question-schema/src/seed-demo.test.ts`.
