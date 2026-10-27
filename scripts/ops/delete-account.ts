/**
 * `pnpm ops:delete-account --email person@example.com [--yes]`: serves an erasure request for someone who cannot
 * use the app's own "Delete account" (docs/RUNBOOK.md). It runs the very same code as `DELETE /v1/me`
 * (`AccountPrivacy.deleteAccount`), so the rules are identical: purchases keep a tombstone, personal quizzes and
 * entitlements go, sessions are revoked, the address and display name are cleared. Staff accounts are refused
 * (remove their roles in the admin console first). Without `--yes` it only reports what it found.
 *
 * Needs DATABASE_URL and the server's SERVER_SECRET (the purchase tombstone is keyed with it).
 */
import { parseArgs } from 'node:util';
import { createDatabase, createPool } from '@quizparty/db';
// Brings in the Fastify request typing that privacy.ts relies on (type-only, nothing runs).
import type {} from '../../apps/realtime/src/auth/guard';
import { AccountSessionService } from '../../apps/realtime/src/auth/account-sessions';
import { AccountService } from '../../apps/realtime/src/auth/accounts';
import { OtpService } from '../../apps/realtime/src/auth/otp';
import { AccountPrivacy } from '../../apps/realtime/src/auth/privacy';
import { systemClock } from '../../apps/realtime/src/util/clock';

const { values } = parseArgs({
  options: { email: { type: 'string' }, yes: { type: 'boolean', default: false } },
});
const email = values.email?.trim().toLowerCase();
const secret = process.env.SERVER_SECRET;
const databaseUrl = process.env.DATABASE_URL;
if (!email || !secret || secret.length < 32 || !databaseUrl) {
  console.error(
    'usage: DATABASE_URL=... SERVER_SECRET=... pnpm ops:delete-account --email person@example.com [--yes]\n' +
      '(SERVER_SECRET must be the production value, 32+ characters)',
  );
  process.exit(2);
}

const pool = createPool(databaseUrl, { max: 2, applicationName: 'quizparty-ops' });
const db = createDatabase(pool);
let code = 0;
try {
  const account = await db
    .selectFrom('accounts')
    .select(['id', 'status'])
    .where('email', '=', email)
    .executeTakeFirst();
  if (!account || account.status === 'DELETED') {
    console.log('no active account with that address (nothing to delete)');
  } else if (!values.yes) {
    console.log(`found account ${account.id} (${account.status}); re-run with --yes to delete it`);
  } else {
    const accounts = new AccountService(db, systemClock, []);
    const privacy = new AccountPrivacy({
      db,
      clock: systemClock,
      secret,
      sessions: new AccountSessionService(db, accounts, secret, systemClock),
      // This tool only deletes; the export (which lists personal quizzes) is never called from here.
      personalQuizzes: () => Promise.resolve([]),
      // `forget` only deletes the pending codes for the address; nothing is ever sent from here.
      otp: new OtpService(
        db,
        secret,
        systemClock,
        { send: () => Promise.resolve() },
        () => undefined,
      ),
      onEntitlementLost: () => undefined,
    });
    const outcome = await privacy.deleteAccount(account.id);
    console.log(`account ${account.id}: ${outcome}`);
    if (outcome === 'STAFF') {
      console.error('this account holds staff roles: remove them in the admin console first');
      code = 1;
    }
  }
} finally {
  await pool.end();
}
process.exit(code);
