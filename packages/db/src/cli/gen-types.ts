import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Regenerates the committed Kysely types from the migrated development database.
// CI regenerates and fails on any diff (drift guard).
const url =
  process.env.DATABASE_URL ?? 'postgres://quizparty:quizparty@127.0.0.1:5432/quizparty_dev';
const out = fileURLToPath(new URL('../generated/db-types.ts', import.meta.url));
execFileSync(
  'pnpm',
  [
    'exec',
    'kysely-codegen',
    '--dialect',
    'postgres',
    '--url',
    url,
    '--out-file',
    out,
    '--camel-case',
    'false',
    '--runtime-enums',
    'false',
  ],
  { stdio: 'inherit' },
);

// pg is configured to return int8 as a (safe) number, so the generated alias must say so.
const generated = readFileSync(out, 'utf8').replace(
  'export type Int8 = ColumnType<string, bigint | number | string, bigint | number | string>;',
  'export type Int8 = ColumnType<number, bigint | number | string, bigint | number | string>;',
);
writeFileSync(out, generated);
