import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '@quizparty/db/testing';
import {
  ADMIN_ABSOLUTE_MS,
  ADMIN_IDLE_MS,
  AccountSessionService,
  WEB_SLIDING_MS,
} from '../../apps/realtime/src/auth/account-sessions';
import { AccountService } from '../../apps/realtime/src/auth/accounts';

/** Roles, the last-administrator rule and session lifetimes, with a clock the test moves by hand. */
let t: TestDatabase;
let now = Date.UTC(2026, 9, 6, 12);
const clock = { now: () => now };
let accounts: AccountService;
let sessions: AccountSessionService;
const context = { ipHash: 'ip', userAgentHash: null };

beforeAll(async () => {
  t = await createTestDatabase();
  accounts = new AccountService(t.db, clock, ['boss@example.com']);
  sessions = new AccountSessionService(t.db, accounts, 'secret-secret-secret-secret-secret', clock);
});
afterAll(async () => {
  await t.drop();
});

const person = async (email: string) => (await accounts.signIn(email, 'tr'))!;
const BOSS = '00000000-0000-4000-8000-0000000000b0'; // who granted: any uuid (an account id in real use)

describe('accounts', () => {
  it('are created at first sign-in and found again at the next, case-insensitively', async () => {
    const first = await person('new@example.com');
    expect(first).toMatchObject({
      email: 'new@example.com',
      status: 'ACTIVE',
      roles: [],
      locale: 'tr',
    });
    const again = (await accounts.signIn('new@example.com', 'en'))!;
    expect(again.id).toBe(first.id);
    expect(again.locale).toBe('tr'); // signing in again does not rewrite the profile
  });

  it('give the bootstrap address ADMIN, once and only it', async () => {
    expect((await person('boss@example.com')).roles).toEqual(['ADMIN']);
    expect((await person('boss@example.com')).roles).toEqual(['ADMIN']);
    expect((await person('someone@example.com')).roles).toEqual([]);
  });

  it('do not sign in when suspended', async () => {
    const victim = await person('suspended@example.com');
    expect(await accounts.setStatus(victim.id, 'SUSPENDED')).toBe('OK');
    expect(await accounts.signIn('suspended@example.com', 'tr')).toBeNull();
    expect(await accounts.setStatus(victim.id, 'ACTIVE')).toBe('OK');
    expect(await accounts.signIn('suspended@example.com', 'tr')).not.toBeNull();
  });
});

describe('roles', () => {
  it('are replaced as a set and read back', async () => {
    const editor = await person('editor@example.com');
    expect(await accounts.setRoles(editor.id, ['EDITOR', 'MODERATOR'], BOSS)).toBe('OK');
    expect((await accounts.get(editor.id))!.roles.sort()).toEqual(['EDITOR', 'MODERATOR']);
    expect(await accounts.setRoles(editor.id, [], BOSS)).toBe('OK');
    expect((await accounts.get(editor.id))!.roles).toEqual([]);
    expect(await accounts.setRoles('00000000-0000-4000-8000-000000000000', ['EDITOR'], BOSS)).toBe(
      'NOT_FOUND',
    );
  });

  it('never leave the system without an administrator, even when two try at once', async () => {
    const boss = await person('boss@example.com');
    const second = await person('second.admin@example.com');
    expect(await accounts.setRoles(second.id, ['ADMIN'], boss.id)).toBe('OK');
    const results = await Promise.all([
      accounts.setRoles(boss.id, [], second.id),
      accounts.setRoles(second.id, [], boss.id),
    ]);
    expect(results.filter((r) => r === 'OK')).toHaveLength(1);
    expect(results.filter((r) => r === 'LAST_ADMIN')).toHaveLength(1);
    const admins = await t.db
      .selectFrom('account_roles')
      .select('account_id')
      .where('role', '=', 'ADMIN')
      .execute();
    expect(admins).toHaveLength(1);
    expect(await accounts.setRoles(admins[0]!.account_id, ['EDITOR'], BOSS)).toBe('LAST_ADMIN');
    expect(await accounts.setStatus(admins[0]!.account_id, 'SUSPENDED')).toBe('LAST_ADMIN');
  });

  it('are listed with a search and a role filter, and the search is not a pattern', async () => {
    const all = await accounts.list({ limit: 50, offset: 0 });
    expect(all.total).toBeGreaterThanOrEqual(5);
    const found = await accounts.list({ search: 'editor@', limit: 10, offset: 0 });
    expect(found.accounts.map((a) => a.email)).toEqual(['editor@example.com']);
    expect((await accounts.list({ search: '%', limit: 10, offset: 0 })).total).toBe(0);
    expect(
      (await accounts.list({ role: 'ADMIN', limit: 10, offset: 0 })).accounts.every((a) =>
        a.roles.includes('ADMIN'),
      ),
    ).toBe(true);
    expect((await accounts.list({ limit: 2, offset: 2 })).accounts).toHaveLength(2);
  });
});

describe('sessions', () => {
  it('open, resolve and carry the roles as they are now', async () => {
    const moderator = await person('mod@example.com');
    const { token } = await sessions.create(moderator.id, 'ADMIN', context);
    expect((await sessions.resolve(token))!.account.roles).toEqual([]);
    await accounts.setRoles(moderator.id, ['MODERATOR'], BOSS);
    expect((await sessions.resolve(token))!.account.roles).toEqual(['MODERATOR']);
    await accounts.setRoles(moderator.id, [], BOSS);
    expect((await sessions.resolve(token))!.account.roles).toEqual([]);
  });

  it('end for staff after an hour of silence and after twelve hours whatever they do', async () => {
    const staff = await person('staff@example.com');
    const { token } = await sessions.create(staff.id, 'ADMIN', context);
    for (
      let elapsed = 0;
      elapsed < ADMIN_ABSOLUTE_MS - ADMIN_IDLE_MS;
      elapsed += ADMIN_IDLE_MS / 2
    ) {
      now += ADMIN_IDLE_MS / 2;
      expect(await sessions.resolve(token)).not.toBeNull(); // keeps being used
    }
    now = Date.UTC(2026, 9, 6, 12) + ADMIN_ABSOLUTE_MS + 1;
    expect(await sessions.resolve(token)).toBeNull();
    now += 100 * 3_600_000;
    const idle = await sessions.create(staff.id, 'ADMIN', context);
    now += ADMIN_IDLE_MS + 1;
    expect(await sessions.resolve(idle.token)).toBeNull();
  });

  it('slide for ordinary users: each use pushes the end thirty days out', async () => {
    const host = await person('host@example.com');
    const { token } = await sessions.create(host.id, 'WEB', context);
    now += WEB_SLIDING_MS - 1000;
    expect(await sessions.resolve(token)).not.toBeNull();
    now += WEB_SLIDING_MS - 1000;
    expect(await sessions.resolve(token)).not.toBeNull();
    now += WEB_SLIDING_MS + 1;
    expect(await sessions.resolve(token)).toBeNull();
  });

  it('can be revoked one at a time or all at once, and by suspending the account', async () => {
    const user = await person('revoked@example.com');
    const a = await sessions.create(user.id, 'WEB', context);
    const b = await sessions.create(user.id, 'MOBILE', context);
    await sessions.revoke(a.sessionId);
    expect(await sessions.resolve(a.token)).toBeNull();
    expect(await sessions.resolve(b.token)).not.toBeNull();
    await sessions.revokeAll(user.id);
    expect(await sessions.resolve(b.token)).toBeNull();
    const c = await sessions.create(user.id, 'WEB', context);
    await accounts.setStatus(user.id, 'SUSPENDED');
    expect(await sessions.resolve(c.token)).toBeNull();
  });

  it('are found only by the exact token', async () => {
    const user = await person('exact@example.com');
    const { token } = await sessions.create(user.id, 'WEB', context);
    for (const bad of [
      token.slice(0, -1),
      `${token}x`,
      token.toUpperCase(),
      '',
      ' ',
      token.replace(/./u, '!'),
    ])
      expect(await sessions.resolve(bad)).toBeNull();
  });

  it('are forgotten a week after they end', async () => {
    const user = await person('purge@example.com');
    await sessions.create(user.id, 'WEB', context);
    now += WEB_SLIDING_MS + 8 * 86_400_000;
    expect(await sessions.purge()).toBeGreaterThanOrEqual(1);
  });
});
