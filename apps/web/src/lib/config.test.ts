import { describe, expect, it } from 'vitest';
import { resolveEndpoints } from './config';

describe('resolveEndpoints', () => {
  it('is same-origin by default and follows the page scheme for the socket', () => {
    expect(resolveEndpoints({ protocol: 'http:', host: 'localhost:8080' })).toEqual({
      apiUrl: '',
      wsUrl: 'ws://localhost:8080/ws',
    });
    expect(resolveEndpoints({ protocol: 'https:', host: 'play.example.com' })).toEqual({
      apiUrl: '',
      wsUrl: 'wss://play.example.com/ws',
    });
  });

  it('lets the environment point at a split deployment and trims trailing slashes', () => {
    expect(
      resolveEndpoints(
        { protocol: 'https:', host: 'app.example.com' },
        { VITE_API_URL: 'https://api.example.com//', VITE_WS_URL: 'wss://rt.example.com/ws' },
      ),
    ).toEqual({ apiUrl: 'https://api.example.com', wsUrl: 'wss://rt.example.com/ws' });
  });
});
