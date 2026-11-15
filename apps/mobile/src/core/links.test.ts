import { describe, expect, it } from '@jest/globals';
import { parseAppLink, routeFor, validIntentId, validRoomCode } from './links';

const HOSTS = ['quiz.example.com'];
const INTENT = 'A'.repeat(22);

describe('parseAppLink', () => {
  it.each([
    ['quiznight://join/ABC234', 'ABC234'],
    ['quiznight://join/abc234', 'ABC234'],
    ['quiznight://join/ABC234/', 'ABC234'],
    ['quiznight://join/ABC234?utm=1#x', 'ABC234'],
    ['https://quiz.example.com/j/ABC234', 'ABC234'],
    ['https://quiz.example.com/join/ABC234', 'ABC234'],
    ['https://QUIZ.example.com/j/abc234?x=1', 'ABC234'],
    ['https://quiz.example.com/j/ABC234?utm=a%20b', 'ABC234'],
  ])('%s opens the join screen', (url, roomCode) => {
    expect(parseAppLink(url, HOSTS)).toEqual({ kind: 'JOIN', roomCode });
  });

  it('accepts unlock links on both forms', () => {
    expect(parseAppLink(`quiznight://unlock/${INTENT}`, HOSTS)).toEqual({
      kind: 'UNLOCK',
      intentId: INTENT,
    });
    expect(parseAppLink(`https://quiz.example.com/unlock/${INTENT}`, HOSTS)).toEqual({
      kind: 'UNLOCK',
      intentId: INTENT,
    });
  });

  it.each([
    'http://quiz.example.com/j/ABC234', // not https
    'https://evil.example.com/j/ABC234', // other host
    'https://quiz.example.com.evil.com/j/ABC234', // look-alike host
    'https://user:pw@quiz.example.com/j/ABC234', // credentials
    'https://quiz.example.com/j/ABC234/extra',
    'https://quiz.example.com/j/ABC2%334',
    'https://quiz.example.com/j/../join/ABC234',
    'https://quiz.example.com/j/ABC10O', // alphabet excludes 0/O/1/I/L
    'https://quiz.example.com/blind/' + 'B'.repeat(43), // Blind Quiz stays in the browser
    'quiznight://join/ABC23',
    'quiznight://join/ABC234%2F..',
    'quiznight://join/..%2F..%2Fprofile',
    'quiznight://profile',
    'quiznight://unlock/short',
    'javascript:alert(1)',
    'quiznight://join/' + 'A'.repeat(600),
    '',
  ])('refuses %s', (url) => {
    expect(parseAppLink(url, HOSTS)).toBeNull();
  });

  it('accepts no https link at all when no host is configured', () => {
    expect(parseAppLink('https://quiz.example.com/j/ABC234', [])).toBeNull();
    expect(parseAppLink('quiznight://join/ABC234', [])).not.toBeNull();
  });
});

describe('routes', () => {
  it('maps a link to its route and validates route params', () => {
    expect(routeFor({ kind: 'JOIN', roomCode: 'ABC234' })).toBe('/join/ABC234');
    expect(routeFor({ kind: 'UNLOCK', intentId: INTENT })).toBe(`/unlock/${INTENT}`);
    expect(validRoomCode('abc 234')).toBe('ABC234');
    expect(validRoomCode(['ABC234'])).toBeNull();
    expect(validRoomCode('nope')).toBeNull();
    expect(validIntentId(INTENT)).toBe(INTENT);
    expect(validIntentId('x'.repeat(21))).toBeNull();
  });
});
