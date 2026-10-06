import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname } from 'node:path';
import { parseArgs } from 'node:util';
import { createDatabase, createPool, type Database } from '@quizparty/db';
import {
  AUDIT_INSTRUCTIONS,
  AnthropicClient,
  HttpEmbeddingProvider,
  ensureLaunchCategories,
  exportForAudit,
  importAuditResults,
  importQuestions,
  llmProviders,
  parseImportText,
  parseResults,
  renderCsv,
  renderJsonl,
  runAudit,
  runMaintenance,
  selectQuestionIds,
  type AuditProvider,
  type ImportFormat,
} from '@quizparty/question-bank';
import {
  QUESTION_STATUSES,
  formatSummary,
  type EmbeddingProvider,
  type QuestionStatus,
} from '@quizparty/question-schema';

/**
 * `pnpm question <command>`: the operator's tools for the question bank (ADR-0014).
 *
 *   import <file>          validate, de-duplicate, heuristically audit and insert questions
 *   audit                  run audit passes (heuristics always; model passes when configured)
 *   export                 write questions for a manual audit round (JSONL or CSV + instructions)
 *   import-results <file>  apply the results of a manual audit round
 *   maintain               one maintenance pass (expiry, stale, anomalies)
 *   seed                   categories plus the development seed (never in production)
 *   categories             create the launch categories
 *
 * Everything that changes data takes `--dry-run`. Exit codes: 0 done, 1 failed, 2 refused or bad usage.
 */
export interface Io {
  out(line: string): void;
  err(line: string): void;
  read(path: string): string;
  write(path: string, content: string): void;
}

export const realIo: Io = {
  out: (line) => console.log(line),
  err: (line) => console.error(line),
  read: (path) => readFileSync(path, 'utf8'),
  write: (path, content) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  },
};

export type Env = Record<string, string | undefined>;

const HELP = `Usage: pnpm question <command> [options]

Commands
  import <file> [--format jsonl|csv] [--dry-run] [--update] [--allow-dev-seed] [--dev-activate]
                [--batch-size N] [--report out.json]
  audit        [--status DRAFT,REVIEW] [--category id] [--language tr|en] [--ids a,b] [--unaudited]
                [--limit N] [--dry-run] [--no-models] [--auto-activate] [--token-budget N] [--report out.json]
  export       --out file [--format jsonl|csv] [--status DRAFT,REVIEW] [--category id] [--limit N]
                (also writes <out>.instructions.md for the manual audit round)
  import-results <file> --source label
  maintain
  seed         [--seed-file seed/questions.tr.jsonl] [--dry-run]
  categories

Environment
  DATABASE_URL, NODE_ENV, QP_ALLOW_DEV_SEED
  AUDIT_API_KEY, AUDIT_MODEL_FAST, AUDIT_MODEL_STRONG [, AUDIT_API_BASE]   model audit passes
  EMBEDDINGS_BASE_URL, EMBEDDINGS_MODEL [, EMBEDDINGS_API_KEY]             real semantic duplicates
`;

const FORMATS = ['jsonl', 'csv'] as const;

function pickFormat(path: string, requested: string | undefined): ImportFormat {
  if (requested) {
    if (!(FORMATS as readonly string[]).includes(requested))
      throw new UsageError(`unknown format ${requested}`);
    return requested as ImportFormat;
  }
  return extname(path).toLowerCase() === '.csv' ? 'csv' : 'jsonl';
}

class UsageError extends Error {}

/** A file the operator named: a missing or unreadable one is a usage mistake, not a crash. */
function readInput(io: Io, path: string): string {
  try {
    return io.read(path);
  } catch (error) {
    throw new UsageError(
      `cannot read ${path}: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
  }
}

function parseStatuses(value: string | undefined, fallback: QuestionStatus[]): QuestionStatus[] {
  if (!value) return fallback;
  const list = value.split(',').map((item) => item.trim().toUpperCase());
  for (const item of list)
    if (!(QUESTION_STATUSES as readonly string[]).includes(item))
      throw new UsageError(`unknown status ${item}`);
  return list as QuestionStatus[];
}

function embeddingsFrom(env: Env): EmbeddingProvider | undefined {
  if (!env.EMBEDDINGS_BASE_URL || !env.EMBEDDINGS_MODEL) return undefined;
  return new HttpEmbeddingProvider({
    baseUrl: env.EMBEDDINGS_BASE_URL,
    model: env.EMBEDDINGS_MODEL,
    ...(env.EMBEDDINGS_API_KEY ? { apiKey: env.EMBEDDINGS_API_KEY } : {}),
  });
}

function modelProviders(env: Env): AuditProvider[] {
  if (!env.AUDIT_API_KEY) return [];
  const fast = env.AUDIT_MODEL_FAST;
  const strong = env.AUDIT_MODEL_STRONG ?? fast;
  if (!fast || !strong)
    throw new UsageError(
      'AUDIT_API_KEY needs AUDIT_MODEL_FAST (and optionally AUDIT_MODEL_STRONG)',
    );
  const client = new AnthropicClient({
    apiKey: env.AUDIT_API_KEY,
    ...(env.AUDIT_API_BASE ? { baseUrl: env.AUDIT_API_BASE } : {}),
  });
  return llmProviders({ client, models: { fast, strong } });
}

/** Dev-seed content is never allowed near production data (ADR-0014). */
function devSeedAllowed(env: Env): boolean {
  return env.NODE_ENV !== 'production' || env.QP_ALLOW_DEV_SEED === '1';
}

export interface RunOptions {
  /** Test hook: use this database instead of opening one from DATABASE_URL. */
  db?: Database;
  now?: () => Date;
}

export async function run(
  argv: readonly string[],
  env: Env,
  io: Io,
  options: RunOptions = {},
): Promise<number> {
  const [command, ...rest] = argv;
  if (!command || command === 'help' || command === '--help') {
    io.out(HELP);
    return command ? 0 : 2;
  }
  const resources: { close?: () => Promise<void> } = {};
  try {
    const { values, positionals } = parseArgs({
      args: [...rest],
      allowPositionals: true,
      options: {
        format: { type: 'string' },
        'dry-run': { type: 'boolean' },
        update: { type: 'boolean' },
        'allow-dev-seed': { type: 'boolean' },
        'dev-activate': { type: 'boolean' },
        'batch-size': { type: 'string' },
        report: { type: 'string' },
        status: { type: 'string' },
        category: { type: 'string' },
        language: { type: 'string' },
        ids: { type: 'string' },
        unaudited: { type: 'boolean' },
        limit: { type: 'string' },
        'no-models': { type: 'boolean' },
        'auto-activate': { type: 'boolean' },
        'token-budget': { type: 'string' },
        out: { type: 'string' },
        source: { type: 'string' },
        'seed-file': { type: 'string' },
      },
    });
    const now = options.now ?? (() => new Date());
    const db =
      options.db ??
      (() => {
        const pool = createPool(
          env.DATABASE_URL ?? 'postgres://quizparty:quizparty@127.0.0.1:5432/quizparty_dev',
          { max: 4, applicationName: 'quizparty-question-cli' },
        );
        resources.close = () => pool.end();
        return createDatabase(pool);
      })();
    const embeddings = embeddingsFrom(env);
    const writeReport = (report: unknown): void => {
      if (values.report) io.write(values.report, `${JSON.stringify(report, null, 2)}\n`);
    };

    switch (command) {
      case 'categories': {
        const created = await ensureLaunchCategories(db);
        io.out(`launch categories: ${created} created`);
        return 0;
      }

      case 'import': {
        const file = positionals[0];
        if (!file) throw new UsageError('import needs a file');
        if (values['dev-activate'] && !values['allow-dev-seed'])
          throw new UsageError('--dev-activate needs --allow-dev-seed');
        if ((values['allow-dev-seed'] || values['dev-activate']) && !devSeedAllowed(env)) {
          io.err('refused: development seed content is not allowed when NODE_ENV=production');
          return 2;
        }
        const format = pickFormat(file, values.format);
        const rows = parseImportText(readInput(io, file), format);
        const report = await importQuestions(db, rows, {
          now: now(),
          dryRun: values['dry-run'] ?? false,
          updateExisting: values.update ?? false,
          allowDevSeed: values['allow-dev-seed'] ?? false,
          devActivate: values['dev-activate'] ?? false,
          ...(values['batch-size'] ? { batchSize: Number(values['batch-size']) } : {}),
          source: file,
          ...(embeddings ? { embeddings } : {}),
        });
        writeReport(report);
        io.out(
          `${report.dryRun ? '[dry run] ' : ''}${report.total} rows: ` +
            Object.entries(report.counts)
              .filter(([, n]) => n > 0)
              .map(([outcome, n]) => `${n} ${outcome}`)
              .join(', '),
        );
        io.out(`created as: ${JSON.stringify(report.created)}`);
        io.out(`automatic review of the new questions: ${formatSummary(report.summary)}`);
        for (const finding of report.batchFindings)
          io.out(`batch warning: ${finding.code} ${JSON.stringify(finding.detail)}`);
        const problems = report.items.filter((item) =>
          ['INVALID', 'UNKNOWN_CATEGORY', 'FORBIDDEN_AUTHOR', 'CONFLICT'].includes(item.outcome),
        );
        for (const item of problems.slice(0, 20))
          io.err(
            `line ${item.line} (${item.key}): ${item.outcome} ${JSON.stringify(item.issues ?? [])}`,
          );
        if (problems.length > 20) io.err(`… and ${problems.length - 20} more (see --report)`);
        return problems.length > 0 ? 1 : 0;
      }

      case 'audit': {
        const statuses = parseStatuses(values.status, ['DRAFT', 'REVIEW']);
        const ids = await selectQuestionIds(db, {
          ...(values.ids ? { ids: values.ids.split(',').map((id) => id.trim()) } : { statuses }),
          ...(values.category ? { category: values.category } : {}),
          ...(values.language ? { language: values.language } : {}),
          ...(values.unaudited ? { unaudited: true } : {}),
          ...(values.limit ? { limit: Number(values.limit) } : {}),
        });
        const providers = values['no-models'] ? [] : modelProviders(env);
        io.out(
          `${ids.length} questions; passes: heuristics${providers.length > 0 ? ` + ${providers.length} model passes` : ' (no model configured: fact check stays NOT_RUN)'}`,
        );
        const report = await runAudit(db, ids, {
          now: now(),
          providers,
          dryRun: values['dry-run'] ?? false,
          autoActivate: values['auto-activate'] ?? false,
          ...(values['token-budget'] ? { tokenBudget: Number(values['token-budget']) } : {}),
          ...(embeddings ? { embeddings } : {}),
        });
        writeReport(report);
        io.out(`${report.dryRun ? '[dry run] ' : ''}verdicts: ${formatSummary(report.summary)}`);
        io.out(`status changes: ${JSON.stringify(report.statusChanges)}`);
        io.out(
          `tokens: ${report.tokens.input} in / ${report.tokens.output} out${report.budgetExhausted ? ' (budget exhausted)' : ''}`,
        );
        const top = Object.entries(report.summary.reasons)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10);
        if (top.length > 0)
          io.out(`top reasons: ${top.map(([code, n]) => `${code} ${n}`).join(', ')}`);
        for (const failure of report.errors.slice(0, 10))
          io.err(`${failure.id}: ${failure.message}`);
        return report.errors.length > 0 ? 1 : 0;
      }

      case 'export': {
        if (!values.out) throw new UsageError('export needs --out');
        const format = pickFormat(values.out, values.format);
        const rows = await exportForAudit(db, {
          statuses: parseStatuses(values.status, ['DRAFT', 'REVIEW']),
          ...(values.category ? { category: values.category } : {}),
          ...(values.limit ? { limit: Number(values.limit) } : {}),
        });
        io.write(values.out, format === 'csv' ? renderCsv(rows) : renderJsonl(rows));
        io.write(`${values.out}.instructions.md`, AUDIT_INSTRUCTIONS);
        io.out(`${rows.length} questions written to ${values.out}`);
        return 0;
      }

      case 'import-results': {
        const file = positionals[0];
        if (!file) throw new UsageError('import-results needs a file');
        if (!values.source)
          throw new UsageError('import-results needs --source (who produced the results)');
        const report = await importAuditResults(db, parseResults(readInput(io, file)), {
          now: now(),
          source: values.source,
          ...(embeddings ? { embeddings } : {}),
        });
        writeReport(report);
        io.out(
          `${report.applied} of ${report.total} results applied; verdicts: ${formatSummary(report.summary)}`,
        );
        for (const skipped of report.skipped.slice(0, 20))
          io.err(`line ${skipped.line}: ${skipped.reason} ${skipped.key ?? ''}`);
        return report.skipped.length > 0 ? 1 : 0;
      }

      case 'maintain': {
        const report = await runMaintenance(db, { now: now() });
        io.out(
          report.ran
            ? `maintenance: ${report.expired} expired, ${report.reverify} due for re-verification, ${report.telemetry} flagged by answer statistics`
            : 'maintenance: another instance holds the lock',
        );
        return 0;
      }

      case 'seed': {
        if (!devSeedAllowed(env)) {
          io.err('refused: the development seed is not allowed when NODE_ENV=production');
          return 2;
        }
        const file = values['seed-file'] ?? 'seed/questions.tr.jsonl';
        const text = readInput(io, file);
        await ensureLaunchCategories(db);
        const report = await importQuestions(db, parseImportText(text, 'jsonl'), {
          now: now(),
          dryRun: values['dry-run'] ?? false,
          allowDevSeed: true,
          devActivate: true,
          source: file,
        });
        io.out(
          `${report.dryRun ? '[dry run] ' : ''}seed: ${Object.entries(report.counts)
            .filter(([, n]) => n > 0)
            .map(([outcome, n]) => `${n} ${outcome}`)
            .join(', ')}`,
        );
        return report.counts.INVALID + report.counts.UNKNOWN_CATEGORY > 0 ? 1 : 0;
      }

      default:
        io.err(`unknown command: ${command}`);
        io.out(HELP);
        return 2;
    }
  } catch (error) {
    if (error instanceof UsageError || (error instanceof TypeError && 'code' in error)) {
      io.err(error.message);
      return 2;
    }
    io.err(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
    return 1;
  } finally {
    await resources.close?.();
  }
}
