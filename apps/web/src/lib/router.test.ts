import { describe, expect, it } from 'vitest';
import { matchPath } from './router';

describe('matchPath', () => {
  it('matches static paths exactly', () => {
    expect(matchPath('/', '/')).toEqual({});
    expect(matchPath('/tv', '/tv')).toEqual({});
    expect(matchPath('/tv', '/tv/extra')).toBeNull();
    expect(matchPath('/tv', '/other')).toBeNull();
  });

  it('extracts required and optional parameters', () => {
    expect(matchPath('/join/:code?', '/join')).toEqual({});
    expect(matchPath('/join/:code?', '/join/ABC234')).toEqual({ code: 'ABC234' });
    expect(matchPath('/room/:code', '/room')).toBeNull();
    expect(matchPath('/room/:code', '/room/X7K29P')).toEqual({ code: 'X7K29P' });
  });

  it('decodes parameters safely and never throws on malformed escapes', () => {
    expect(matchPath('/join/:code?', '/join/a%20b')).toEqual({ code: 'a b' });
    expect(matchPath('/join/:code?', '/join/%E0%A4%A')).toEqual({ code: '%E0%A4%A' });
  });

  it('rejects extra segments and treats a wildcard as a catch-all', () => {
    expect(matchPath('/join/:code?', '/join/ABC234/more')).toBeNull();
    expect(matchPath('/*', '/anything/at/all')).toEqual({});
  });

  it('ignores duplicate and trailing slashes', () => {
    expect(matchPath('/join/:code?', '//join//ABC234/')).toEqual({ code: 'ABC234' });
  });
});
