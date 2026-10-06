import { describe, expect, it, vi } from 'vitest';
import { Sfx, type SoundName } from './audio';

const SOUNDS: SoundName[] = [
  'tap',
  'join',
  'tick',
  'tickUrgent',
  'countdown',
  'go',
  'whoosh',
  'question',
  'lock',
  'reveal',
  'correct',
  'wrong',
  'score',
  'rankUp',
  'final',
  'fanfare',
  'power',
  'shield',
  'hit',
];

function fakeContext(state = 'running') {
  const param = () => ({
    value: 0,
    setValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  });
  const node = () => ({ connect: vi.fn(), start: vi.fn(), stop: vi.fn() });
  const created = { oscillators: 0, buffers: 0 };
  const context = {
    currentTime: 0,
    state,
    destination: {},
    sampleRate: 8000,
    resume: vi.fn(() => {
      context.state = 'running';
      return Promise.resolve();
    }),
    close: vi.fn(() => Promise.resolve()),
    createOscillator: vi.fn(() => {
      created.oscillators += 1;
      return { ...node(), type: 'sine', frequency: param() };
    }),
    createGain: vi.fn(() => ({ ...node(), gain: param() })),
    createBiquadFilter: vi.fn(() => ({
      ...node(),
      type: 'bandpass',
      Q: { value: 0 },
      frequency: param(),
    })),
    createBuffer: vi.fn(() => {
      created.buffers += 1;
      return { getChannelData: () => new Float32Array(8) };
    }),
    createBufferSource: vi.fn(() => ({ ...node(), buffer: null })),
  };
  return { context, created };
}

describe('Sfx', () => {
  it('stays silent until a user gesture unlocks the audio context', async () => {
    const { context, created } = fakeContext('suspended');
    const sfx = new Sfx(() => context as never);
    sfx.play('tap');
    expect(created.oscillators).toBe(0);
    expect(sfx.ready).toBe(false);
    await expect(sfx.unlock()).resolves.toBe(true);
    expect(sfx.ready).toBe(true);
    sfx.play('tap');
    expect(created.oscillators).toBeGreaterThan(0);
  });

  it('plays every named sound without throwing', async () => {
    const { context, created } = fakeContext();
    const sfx = new Sfx(() => context as never);
    await sfx.unlock();
    for (const name of SOUNDS) expect(() => sfx.play(name), name).not.toThrow();
    expect(created.oscillators).toBeGreaterThan(SOUNDS.length);
  });

  it('muting stops sound, and a missing Web Audio implementation never breaks the page', async () => {
    const { context, created } = fakeContext();
    const sfx = new Sfx(() => context as never);
    await sfx.unlock();
    sfx.configure({ muted: true });
    sfx.play('fanfare');
    expect(created.oscillators).toBe(0);

    const none = new Sfx(() => null);
    await expect(none.unlock()).resolves.toBe(false);
    expect(() => none.play('tap')).not.toThrow();
  });

  it('survives an audio graph that throws', async () => {
    const { context } = fakeContext();
    context.createOscillator.mockImplementation(() => {
      throw new Error('boom');
    });
    const sfx = new Sfx(() => context as never);
    await sfx.unlock();
    expect(() => sfx.play('correct')).not.toThrow();
  });
});
