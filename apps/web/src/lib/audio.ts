/**
 * Synthesised sound effects (Web Audio). Nothing is downloaded, so there is nothing to license and
 * nothing to block the first paint. The context starts suspended on most browsers; `unlock()` must
 * run from a user gesture (the TV's "press OK" gate, a phone tap).
 */
export type SoundName =
  | 'tap'
  | 'join'
  | 'tick'
  | 'tickUrgent'
  | 'countdown'
  | 'go'
  | 'whoosh'
  | 'question'
  | 'lock'
  | 'reveal'
  | 'correct'
  | 'wrong'
  | 'score'
  | 'rankUp'
  | 'final'
  | 'fanfare';

interface AudioContextLike {
  currentTime: number;
  state: string;
  destination: AudioNode;
  resume(): Promise<void>;
  close(): Promise<void>;
  createOscillator(): OscillatorNode;
  createGain(): GainNode;
  createBiquadFilter(): BiquadFilterNode;
  createBuffer(channels: number, length: number, sampleRate: number): AudioBuffer;
  createBufferSource(): AudioBufferSourceNode;
  sampleRate: number;
}

type ContextFactory = () => AudioContextLike | null;

const defaultFactory: ContextFactory = () => {
  const w = window as unknown as {
    AudioContext?: new () => AudioContextLike;
    webkitAudioContext?: new () => AudioContextLike;
  };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  return Ctor ? new Ctor() : null;
};

const NOTE = {
  C4: 261.63,
  E4: 329.63,
  G4: 392,
  A4: 440,
  C5: 523.25,
  D5: 587.33,
  E5: 659.25,
  G5: 783.99,
  A5: 880,
  C6: 1046.5,
  E6: 1318.5,
} as const;

export class Sfx {
  private context: AudioContextLike | null = null;
  private master: GainNode | null = null;
  private volume = 0.7;
  private muted = false;
  private readonly factory: ContextFactory;

  constructor(factory: ContextFactory = defaultFactory) {
    this.factory = factory;
  }

  configure(options: { volume?: number; muted?: boolean }): void {
    if (options.volume !== undefined) this.volume = Math.min(1, Math.max(0, options.volume));
    if (options.muted !== undefined) this.muted = options.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume;
  }

  /** Creates and resumes the context. Safe to call repeatedly; must come from a user gesture. */
  async unlock(): Promise<boolean> {
    try {
      this.context ??= this.factory();
      const context = this.context;
      if (!context) return false;
      if (!this.master) {
        this.master = context.createGain();
        this.master.gain.value = this.muted ? 0 : this.volume;
        this.master.connect(context.destination);
      }
      if (context.state === 'suspended') await context.resume();
      return context.state !== 'suspended';
    } catch {
      return false;
    }
  }

  get ready(): boolean {
    return this.context !== null && this.context.state === 'running';
  }

  play(name: SoundName): void {
    const context = this.context;
    const master = this.master;
    if (!context || !master || this.muted || context.state !== 'running') return;
    try {
      this.recipes[name](context, master, context.currentTime);
    } catch {
      // a failed sound must never break the game
    }
  }

  async dispose(): Promise<void> {
    try {
      await this.context?.close();
    } catch {
      // ignore
    }
    this.context = null;
    this.master = null;
  }

  private tone(
    context: AudioContextLike,
    out: AudioNode,
    at: number,
    options: {
      from: number;
      to?: number;
      duration: number;
      type?: OscillatorType;
      gain?: number;
      attack?: number;
    },
  ): void {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = options.type ?? 'sine';
    oscillator.frequency.setValueAtTime(options.from, at);
    if (options.to !== undefined)
      oscillator.frequency.exponentialRampToValueAtTime(
        Math.max(1, options.to),
        at + options.duration,
      );
    const peak = options.gain ?? 0.25;
    const attack = options.attack ?? 0.008;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(peak, at + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + options.duration);
    oscillator.connect(gain);
    gain.connect(out);
    oscillator.start(at);
    oscillator.stop(at + options.duration + 0.02);
  }

  private noise(
    context: AudioContextLike,
    out: AudioNode,
    at: number,
    options: { duration: number; from: number; to: number; gain?: number },
  ): void {
    const length = Math.max(1, Math.floor(context.sampleRate * options.duration));
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    const source = context.createBufferSource();
    source.buffer = buffer;
    const filter = context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.2;
    filter.frequency.setValueAtTime(options.from, at);
    filter.frequency.exponentialRampToValueAtTime(Math.max(1, options.to), at + options.duration);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(options.gain ?? 0.2, at + options.duration * 0.25);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + options.duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(out);
    source.start(at);
    source.stop(at + options.duration + 0.02);
  }

  private readonly recipes: Record<
    SoundName,
    (c: AudioContextLike, out: AudioNode, at: number) => void
  > = {
    tap: (c, out, at) =>
      this.tone(c, out, at, { from: 620, to: 520, duration: 0.07, type: 'triangle', gain: 0.18 }),
    join: (c, out, at) => {
      this.tone(c, out, at, { from: NOTE.C5, duration: 0.12, type: 'triangle' });
      this.tone(c, out, at + 0.09, { from: NOTE.G5, duration: 0.2, type: 'triangle' });
    },
    tick: (c, out, at) =>
      this.tone(c, out, at, { from: 1400, duration: 0.04, type: 'square', gain: 0.07 }),
    tickUrgent: (c, out, at) =>
      this.tone(c, out, at, { from: 1900, duration: 0.07, type: 'square', gain: 0.12 }),
    countdown: (c, out, at) =>
      this.tone(c, out, at, { from: NOTE.A5, duration: 0.18, type: 'triangle', gain: 0.3 }),
    go: (c, out, at) => {
      this.tone(c, out, at, { from: NOTE.E6, duration: 0.45, type: 'triangle', gain: 0.32 });
      this.tone(c, out, at, { from: NOTE.E5, duration: 0.45, type: 'sine', gain: 0.2 });
    },
    whoosh: (c, out, at) =>
      this.noise(c, out, at, { duration: 0.35, from: 300, to: 3200, gain: 0.16 }),
    question: (c, out, at) => {
      this.tone(c, out, at, { from: NOTE.G4, to: NOTE.C5, duration: 0.18, type: 'triangle' });
      this.tone(c, out, at + 0.16, { from: NOTE.E5, duration: 0.25, type: 'triangle' });
    },
    lock: (c, out, at) => {
      this.tone(c, out, at, { from: 170, to: 90, duration: 0.22, type: 'sine', gain: 0.4 });
      this.tone(c, out, at, { from: 900, to: 400, duration: 0.05, type: 'square', gain: 0.1 });
    },
    reveal: (c, out, at) => {
      this.noise(c, out, at, { duration: 0.5, from: 500, to: 4000, gain: 0.14 });
      this.tone(c, out, at + 0.45, { from: 220, to: 110, duration: 0.3, type: 'sine', gain: 0.35 });
    },
    correct: (c, out, at) => {
      [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6].forEach((hz, i) =>
        this.tone(c, out, at + i * 0.075, {
          from: hz,
          duration: 0.22,
          type: 'triangle',
          gain: 0.24,
        }),
      );
    },
    wrong: (c, out, at) => {
      this.tone(c, out, at, { from: 320, to: 110, duration: 0.4, type: 'sawtooth', gain: 0.2 });
      this.tone(c, out, at + 0.05, {
        from: 300,
        to: 100,
        duration: 0.4,
        type: 'square',
        gain: 0.1,
      });
    },
    score: (c, out, at) => {
      for (let i = 0; i < 4; i++)
        this.tone(c, out, at + i * 0.06, {
          from: 1200 + i * 220,
          duration: 0.09,
          type: 'square',
          gain: 0.08,
        });
    },
    rankUp: (c, out, at) => {
      this.tone(c, out, at, { from: NOTE.E5, duration: 0.12, type: 'triangle' });
      this.tone(c, out, at + 0.1, { from: NOTE.A5, duration: 0.22, type: 'triangle' });
    },
    final: (c, out, at) => {
      this.tone(c, out, at, { from: 90, to: 45, duration: 0.8, type: 'sine', gain: 0.5 });
      this.noise(c, out, at, { duration: 1.1, from: 200, to: 5000, gain: 0.18 });
      this.tone(c, out, at + 0.9, { from: NOTE.C5, duration: 0.5, type: 'sawtooth', gain: 0.16 });
    },
    fanfare: (c, out, at) => {
      const chord = (when: number, notes: number[], length: number): void =>
        notes.forEach((hz) =>
          this.tone(c, out, when, { from: hz, duration: length, type: 'triangle', gain: 0.17 }),
        );
      chord(at, [NOTE.G4, NOTE.C5], 0.16);
      chord(at + 0.18, [NOTE.C5, NOTE.E5], 0.16);
      chord(at + 0.36, [NOTE.E5, NOTE.G5], 0.16);
      chord(at + 0.56, [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6], 0.9);
    },
  };
}

/** One shared instance for the page. */
export const sfx = new Sfx();
