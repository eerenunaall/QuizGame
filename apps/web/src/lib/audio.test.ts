import { describe, expect, it, vi } from 'vitest';
import { SOUND_NAMES, Sfx, levelFor, type SoundName } from './audio';

const SOUNDS: SoundName[] = [...SOUND_NAMES];

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

  it('plays the scored sequences and the tick plan', async () => {
    const { context, created } = fakeContext();
    const sfx = new Sfx(() => context as never);
    await sfx.unlock();
    sfx.playReveal(
      { rollMs: 480, dimAt: [480, null, 700], hitAt: 900, popStepMs: 70, totalMs: 1500 },
      { correct: true, streak: 3 },
    );
    sfx.playPodium(3);
    for (const seconds of [9, 4, 2]) sfx.countdownTick(seconds);
    sfx.play('correct', { streak: 5 });
    sfx.play('join', { order: 4, delayMs: 120 });
    expect(created.oscillators).toBeGreaterThan(40);
  });

  it('keeps phones quieter than the TV and follows the slider with a taper', () => {
    expect(levelFor(1, 'tv')).toBe(1);
    expect(levelFor(1, 'phone')).toBeLessThan(levelFor(1, 'tv'));
    expect(levelFor(0.5, 'tv')).toBeLessThan(0.5);
    expect(levelFor(0, 'tv')).toBe(0);
    expect(levelFor(7, 'tv')).toBe(1);
  });

  it('starts and stops the lobby ambience, and mute silences it', async () => {
    const { context } = fakeContext();
    const sfx = new Sfx(() => context as never);
    sfx.startAmbience(); // before the unlock: remembered, nothing plays
    await sfx.unlock();
    expect(context.createOscillator).toHaveBeenCalled();
    const before = context.createOscillator.mock.calls.length;
    sfx.configure({ muted: true });
    sfx.stopAmbience();
    expect(context.createOscillator.mock.calls.length).toBe(before);
    await sfx.dispose();
  });
});
