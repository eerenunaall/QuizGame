import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, errorText, setUnauthorizedHandler } from './api';
import { parseHash } from './hooks';
import { fakeServer } from './testing';

afterEach(() => {
  vi.unstubAllGlobals();
  setUnauthorizedHandler(() => undefined);
});

describe('admin API client', () => {
  it('sends the CSRF header and JSON body, drops empty query values', async () => {
    const server = fakeServer(() => ({ json: { ok: true } }));
    await api('/v1/admin/x', {
      method: 'POST',
      body: { a: 1 },
      query: { q: '', n: 3, z: undefined },
    });
    const call = server.calls[0]!;
    expect(call.path).toBe('/v1/admin/x?n=3');
    expect(call.headers['x-quizparty-csrf']).toBe('1');
    expect(call.headers['content-type']).toBe('application/json');
    expect(call.body).toEqual({ a: 1 });
  });

  it('turns a 401 on an admin call into the sign-in form, but not a refused sign-in', async () => {
    const out = vi.fn();
    setUnauthorizedHandler(out);
    fakeServer(() => ({ status: 401, json: { error: { code: 'UNAUTHORIZED' } } }));
    await expect(api('/v1/admin/stats')).rejects.toBeInstanceOf(ApiError);
    expect(out).toHaveBeenCalledTimes(1);
    await expect(api('/v1/auth/email/verify', { method: 'POST', body: {} })).rejects.toBeInstanceOf(
      ApiError,
    );
    expect(out).toHaveBeenCalledTimes(1);
  });

  it('explains errors from the admin copy and never shows server text', async () => {
    fakeServer(() => ({
      status: 409,
      json: { error: { code: 'BLOCKED', detail: { codes: ['A', 'B'] }, message: 'SQL leak' } },
    }));
    const error = await api('/v1/admin/x').catch((e: unknown) => e);
    const text = errorText(error);
    expect(text).toContain('A, B');
    expect(text).not.toContain('SQL');
    expect(errorText(new Error('boom'))).not.toContain('boom');
    expect(errorText(new ApiError(500, 'SOMETHING_NEW', undefined))).toBe(
      errorText(new Error('x')),
    );
  });
});

describe('hash routes', () => {
  it('splits the path and the query', () => {
    const route = parseHash('#/questions/abc?x=1');
    expect(route.segments).toEqual(['questions', 'abc']);
    expect(route.query.get('x')).toBe('1');
    expect(parseHash('').segments).toEqual([]);
  });
});
