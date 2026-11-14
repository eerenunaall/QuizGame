import { describe, expect, it } from 'vitest';
import { QUESTION_STATUSES, type QuestionStatus } from '@quizparty/question-schema';
import {
  LifecycleError,
  SYSTEM_ACTOR,
  canTransition,
  isEditor,
  mapDatabaseError,
  mayTransition,
  type Actor,
} from './lifecycle';

const as = (...roles: Actor['roles'][number][]): Actor => ({ accountId: 'a', roles });

describe('which moves the lifecycle allows', () => {
  const allowed: [QuestionStatus, QuestionStatus[]][] = [
    ['REVIEW', ['DRAFT', 'APPROVED', 'REJECTED', 'RETIRED']],
    ['APPROVED', ['ACTIVE', 'REVIEW', 'RETIRED']],
    ['ACTIVE', ['REVIEW', 'RETIRED']],
    ['RETIRED', ['REVIEW']],
    ['REJECTED', ['REVIEW']],
  ];
  it.each(allowed)('from %s only to %j', (from, targets) => {
    for (const to of QUESTION_STATUSES.filter((status) => status !== from))
      expect({ from, to, ok: canTransition(from, to) }).toEqual({
        from,
        to,
        ok: targets.includes(to),
      });
  });

  it('lets the pipeline stages between DRAFT and APPROVED reach the states the application uses', () => {
    for (const from of QUESTION_STATUSES.filter(
      (status) => !['REVIEW', 'APPROVED', 'ACTIVE', 'RETIRED', 'REJECTED'].includes(status),
    ))
      for (const to of ['DRAFT', 'REVIEW', 'APPROVED', 'REJECTED', 'RETIRED'] as const)
        if (from !== to)
          expect({ from, to, ok: canTransition(from, to) }).toEqual({ from, to, ok: true });
  });

  it('never lets anything jump straight into ACTIVE except from APPROVED', () => {
    for (const from of QUESTION_STATUSES.filter(
      (status) => status !== 'APPROVED' && status !== 'ACTIVE',
    ))
      expect({ from, ok: canTransition(from, 'ACTIVE') }).toEqual({ from, ok: false });
  });
});

describe('who may move a question', () => {
  it.each([
    [
      'ADMIN',
      { DRAFT: true, REVIEW: true, APPROVED: true, ACTIVE: true, REJECTED: true, RETIRED: true },
    ],
    [
      'EDITOR',
      { DRAFT: true, REVIEW: true, APPROVED: true, ACTIVE: true, REJECTED: true, RETIRED: true },
    ],
    [
      'MODERATOR',
      {
        DRAFT: false,
        REVIEW: true,
        APPROVED: false,
        ACTIVE: false,
        REJECTED: false,
        RETIRED: true,
      },
    ],
    [
      'SUPPORT',
      {
        DRAFT: false,
        REVIEW: false,
        APPROVED: false,
        ACTIVE: false,
        REJECTED: false,
        RETIRED: false,
      },
    ],
    [
      'SYSTEM',
      { DRAFT: true, REVIEW: true, APPROVED: true, ACTIVE: true, REJECTED: true, RETIRED: true },
    ],
  ] as const)('%s', (role, expected) => {
    for (const [to, ok] of Object.entries(expected))
      expect({ to, ok: mayTransition(as(role), to as QuestionStatus) }).toEqual({ to, ok });
  });

  it('gives an actor without roles, or only unknown ones, nothing', () => {
    for (const to of QUESTION_STATUSES) expect(mayTransition(as(), to)).toBe(false);
  });

  it('counts any one of several roles', () => {
    expect(mayTransition(as('SUPPORT', 'MODERATOR'), 'RETIRED')).toBe(true);
    expect(mayTransition(as('SUPPORT', 'MODERATOR'), 'ACTIVE')).toBe(false);
  });

  it('treats only admins and editors as people who may edit content', () => {
    expect(isEditor(as('ADMIN'))).toBe(true);
    expect(isEditor(as('EDITOR'))).toBe(true);
    expect(isEditor(as('MODERATOR'))).toBe(false);
    expect(isEditor(as('SUPPORT'))).toBe(false);
    expect(isEditor(SYSTEM_ACTOR)).toBe(false);
  });
});

describe('what the database guards say', () => {
  it('names the three refusals of migration 0004 and leaves other errors alone', () => {
    const named = (message: string) => mapDatabaseError(new Error(message));
    expect(
      named('question x cannot become ACTIVE without a passing audit for revision 2'),
    ).toMatchObject({ code: 'AUDIT_REQUIRED' });
    expect(
      named('question x needs 2-6 options with exactly one correct (has 4 / 2)'),
    ).toMatchObject({ code: 'OPTIONS_INVALID' });
    expect(named('question x needs exactly one correct option')).toMatchObject({
      code: 'OPTIONS_INVALID',
    });
    expect(named('content of an ACTIVE question is frozen; move it to REVIEW first')).toMatchObject(
      { code: 'INVALID_TRANSITION', detail: { frozen: true } },
    );
    expect(
      named('options of an APPROVED question are frozen; move it to REVIEW first'),
    ).toMatchObject({ code: 'INVALID_TRANSITION' });
    expect(named('deadlock detected')).toBeNull();
    expect(mapDatabaseError('not even an error')).toBeNull();
    expect(mapDatabaseError(null)).toBeNull();
  });

  it('carries a code and a detail an API can map', () => {
    const error = new LifecycleError('BLOCKED', { codes: ['X'] });
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({
      name: 'LifecycleError',
      code: 'BLOCKED',
      message: 'BLOCKED',
      detail: { codes: ['X'] },
    });
    expect(new LifecycleError('NOT_FOUND').detail).toEqual({});
  });
});
