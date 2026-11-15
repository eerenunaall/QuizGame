/**
 * Keys that must never appear in any payload sent to a client before the question has been
 * revealed (GDD §11/§19.3, ADR-0008). The payload-scanner test walks every outbound message of a
 * scripted game and fails if one of these shows up; the same helper backs the runtime guard used
 * in dev/test.
 */
export const FORBIDDEN_PRE_REVEAL_KEYS: readonly string[] = [
  'correctOptionId',
  'correctAnswerId',
  'correctOption',
  'isCorrect',
  'correct',
  'answerKey',
  'explanation',
  'sourceUrl',
  'sourceTitle',
  'sources',
  'distribution',
  'results',
  'deltas',
  'delta',
  'components',
  // Who Said It: the author of a statement is the answer; the words are the question text.
  'authorPlayerId',
  'authorId',
  'statements',
  // Blind Quiz (ADR-0015): a personal answer, its alternatives and the secrets that open them are
  // never part of any game or room frame; the question text is the only way words reach a screen.
  'sealed',
  'claim',
  'claimHash',
  'inviteToken',
  'inviteUrl',
  'rawAnswer',
  'decoys',
];

export interface ForbiddenHit {
  path: string;
  key: string;
}

export function scanForbiddenKeys(
  value: unknown,
  forbidden: readonly string[] = FORBIDDEN_PRE_REVEAL_KEYS,
): ForbiddenHit[] {
  const hits: ForbiddenHit[] = [];
  const banned = new Set(forbidden);
  const visit = (node: unknown, path: string): void => {
    if (Array.isArray(node)) {
      node.forEach((item, index) => visit(item, `${path}[${index}]`));
    } else if (node !== null && typeof node === 'object') {
      for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
        const childPath = path === '' ? key : `${path}.${key}`;
        if (banned.has(key)) hits.push({ path: childPath, key });
        visit(child, childPath);
      }
    }
  };
  visit(value, '');
  return hits;
}
