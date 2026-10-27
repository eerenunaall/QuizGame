/**
 * Turns palette events into a Web Audio graph. One shared chain serves every cue:
 *
 *   voice -> input -> compressor (gentle limiter) -> master gain -> speakers
 *              ^
 *   voice -> send -> convolver (generated room) -> wet return
 *
 * Nothing is downloaded: the room impulse and the noise table are generated here from a seeded
 * PRNG, so the sound is identical on every device. Optional nodes (compressor, convolver) are
 * feature-detected, because the engines of old smart TVs lack some of them; the cue just sounds
 * drier.
 */
import { midiToHz } from './scale';
import { mulberry32, AmbienceScheduler, type AmbienceNote } from './timeline';
import type { SoundEvent } from './palette';

interface ParamLike {
  value: number;
  setValueAtTime(value: number, at: number): unknown;
  exponentialRampToValueAtTime(value: number, at: number): unknown;
}

export interface AudioContextLike {
  currentTime: number;
  state: string;
  destination: AudioNode;
  sampleRate: number;
  resume(): Promise<void>;
  close(): Promise<void>;
  createOscillator(): OscillatorNode;
  createGain(): GainNode;
  createBiquadFilter(): BiquadFilterNode;
  createBuffer(channels: number, length: number, sampleRate: number): AudioBuffer;
  createBufferSource(): AudioBufferSourceNode;
  createConvolver?(): ConvolverNode;
  createDynamicsCompressor?(): DynamicsCompressorNode;
  createWaveShaper?(): WaveShaperNode;
}

const FLOOR = 0.0001;
const MAX_HZ = 14000;

export interface EngineOptions {
  /** Skip the reverb and thin out dense cues (weak TVs and phones in power-saving mode). */
  lite?: boolean;
}

/** Linear below 0.8, then a smooth knee that approaches (and never exceeds) 1. */
function softClipCurve(): Float32Array<ArrayBuffer> {
  const size = 2048;
  const curve = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const x = (i / (size - 1)) * 2 - 1;
    const magnitude = Math.abs(x);
    const y = magnitude < 0.8 ? magnitude : 0.8 + 0.2 * Math.tanh((magnitude - 0.8) / 0.2);
    curve[i] = Math.sign(x) * y;
  }
  return curve;
}

export class SoundEngine {
  readonly input: GainNode;
  readonly master: GainNode;
  private readonly noiseTable: AudioBuffer;
  private readonly send: GainNode | null = null;
  private readonly lite: boolean;
  private ambience: { gain: GainNode; timer: number; scheduler: AmbienceScheduler } | null = null;

  private readonly context: AudioContextLike;

  constructor(context: AudioContextLike, options: EngineOptions = {}) {
    this.context = context;
    this.lite = options.lite === true;
    this.input = context.createGain();
    this.master = context.createGain();
    const compressor = context.createDynamicsCompressor?.();
    // Safety net behind the limiter: peaks that still get through are rounded off, never hard-clipped.
    const shaper = context.createWaveShaper?.();
    if (shaper) shaper.curve = softClipCurve();
    if (compressor) {
      // A gentle limiter: the loudest stacked cues (fanfare, podium) are squeezed instead of clipping.
      compressor.threshold.value = -4;
      compressor.knee.value = 6;
      compressor.ratio.value = 12;
      compressor.attack.value = 0.002;
      compressor.release.value = 0.14;
      this.input.connect(compressor);
      if (shaper) {
        compressor.connect(shaper);
        shaper.connect(this.master);
      } else compressor.connect(this.master);
    } else {
      this.input.connect(this.master);
    }
    this.master.connect(context.destination);
    this.noiseTable = this.makeNoiseTable();
    if (!this.lite && context.createConvolver) {
      const convolver = context.createConvolver();
      convolver.buffer = this.makeRoom();
      const wetReturn = context.createGain();
      wetReturn.gain.value = 0.9;
      this.send = context.createGain();
      this.send.gain.value = 1;
      this.send.connect(convolver);
      convolver.connect(wetReturn);
      wetReturn.connect(this.input);
    }
  }

  /** Master level (0..1 linear gain, already tapered). */
  setLevel(level: number): void {
    this.master.gain.value = level;
  }

  /** Schedules the events of one cue starting at `at` (context time). `trim` is a linear multiplier. */
  play(events: readonly SoundEvent[], at: number, trim = 1, out: AudioNode = this.input): void {
    let shortNoise = 0;
    for (const event of events) {
      if (this.lite && event.voice === 'noise' && event.dur < 0.06 && shortNoise++ % 2 === 1)
        continue;
      this.render(event, at + event.at, event.gain * trim, out);
    }
  }

  async dispose(): Promise<void> {
    this.stopAmbience(true);
  }

  /* ───────── voices ───────── */

  private render(event: SoundEvent, at: number, peak: number, out: AudioNode): void {
    const gain = this.context.createGain();
    gain.connect(out);
    if (event.wet && this.send) {
      const wet = this.context.createGain();
      wet.gain.value = event.wet;
      gain.connect(wet);
      wet.connect(this.send);
    }
    switch (event.voice) {
      case 'bell':
        this.bell(event, at, peak, gain);
        break;
      case 'mallet':
        this.mallet(event, at, peak, gain);
        break;
      case 'pad':
        this.pad(event, at, peak, gain);
        break;
      case 'thump':
        this.thump(event, at, peak, gain);
        break;
      case 'noise':
        this.noise(event, at, peak, gain);
        break;
      case 'click':
        this.click(event, at, peak, gain);
        break;
    }
  }

  private envelope(
    param: ParamLike,
    at: number,
    peak: number,
    attack: number,
    duration: number,
  ): void {
    param.setValueAtTime(FLOOR, at);
    param.exponentialRampToValueAtTime(Math.max(FLOOR * 2, peak), at + attack);
    param.exponentialRampToValueAtTime(FLOOR, at + Math.max(attack * 2, duration));
  }

  private osc(
    type: OscillatorType,
    from: number,
    to: number | undefined,
    at: number,
    duration: number,
    out: AudioNode,
  ): OscillatorNode {
    const oscillator = this.context.createOscillator();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(from, at);
    if (to !== undefined)
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, to), at + duration);
    oscillator.connect(out);
    oscillator.start(at);
    oscillator.stop(at + duration + 0.05);
    return oscillator;
  }

  /** Glass-like bell: the fundamental, an octave and a short inharmonic shimmer. */
  private bell(event: SoundEvent, at: number, peak: number, out: AudioNode): void {
    // The upper partials carry the sound through a loud room: speech noise leaves 2-4 kHz free.
    const partials: readonly (readonly [number, number, number])[] = [
      [1, 1, 1],
      [2, 0.6, 0.6],
      [3, 0.3, 0.38],
      [4.16, 0.22, 0.26],
      [6.27, 0.08, 0.14],
    ];
    for (const [ratio, level, span] of partials) {
      const frequency = event.hz * ratio;
      if (frequency > MAX_HZ) continue;
      const g = this.context.createGain();
      g.connect(out);
      this.envelope(g.gain, at, peak * level, 0.004, event.dur * span);
      this.osc('sine', frequency, undefined, at, event.dur * span, g);
    }
  }

  /** Marimba / woodblock pluck. */
  private mallet(event: SoundEvent, at: number, peak: number, out: AudioNode): void {
    const filter = this.context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.7;
    filter.frequency.setValueAtTime(Math.min(9000, event.hz * 7), at);
    filter.frequency.exponentialRampToValueAtTime(Math.max(300, event.hz * 1.6), at + event.dur);
    const g = this.context.createGain();
    filter.connect(g);
    g.connect(out);
    this.envelope(g.gain, at, peak, 0.003, event.dur);
    this.osc('triangle', event.hz, event.to, at, event.dur, filter);
  }

  /** Warm detuned saw pad. */
  private pad(event: SoundEvent, at: number, peak: number, out: AudioNode): void {
    const filter = this.context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.5;
    filter.frequency.setValueAtTime(Math.max(500, event.hz * 2.2), at);
    filter.frequency.exponentialRampToValueAtTime(
      Math.max(400, event.hz * 4),
      at + event.dur * 0.4,
    );
    const g = this.context.createGain();
    filter.connect(g);
    g.connect(out);
    this.envelope(g.gain, at, peak * 0.5, Math.min(0.09, event.dur * 0.25), event.dur);
    for (const detune of [0.996, 1.004])
      this.osc('sawtooth', event.hz * detune, undefined, at, event.dur, filter);
  }

  /** Round kick / tom / bonk: a sine with a quick pitch drop plus a little upper body for small speakers. */
  private thump(event: SoundEvent, at: number, peak: number, out: AudioNode): void {
    const body = this.context.createGain();
    body.connect(out);
    // The body is felt more than heard on TV speakers; keeping it modest leaves room for the mids.
    this.envelope(body.gain, at, peak * 0.6, 0.003, event.dur);
    this.osc('sine', event.hz, event.to ?? event.hz * 0.5, at, event.dur * 0.55, body);
    const upper = this.context.createGain();
    upper.connect(out);
    this.envelope(upper.gain, at, peak * 0.22, 0.002, Math.min(0.09, event.dur * 0.3));
    this.osc('triangle', event.hz * 2.4, (event.to ?? event.hz * 0.5) * 2.4, at, 0.09, upper);
    // Phone speakers cannot play below ~300 Hz: a short mid "knock" keeps the hit audible there.
    const knock = this.context.createGain();
    knock.connect(out);
    this.envelope(knock.gain, at, peak * 0.2, 0.002, 0.05);
    this.osc('triangle', event.hz * 5, (event.to ?? event.hz * 0.5) * 4, at, 0.05, knock);
  }

  /** Band-passed noise from the shared table, sweeping from `hz` to `to`. */
  private noise(event: SoundEvent, at: number, peak: number, out: AudioNode): void {
    const source = this.context.createBufferSource();
    source.buffer = this.noiseTable;
    source.loop = true;
    const filter = this.context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.1;
    filter.frequency.setValueAtTime(Math.max(40, event.hz), at);
    filter.frequency.exponentialRampToValueAtTime(
      Math.max(40, event.to ?? event.hz),
      at + event.dur,
    );
    const g = this.context.createGain();
    source.connect(filter);
    filter.connect(g);
    g.connect(out);
    const attack = event.dur < 0.12 ? event.dur * 0.15 : event.dur * 0.3;
    this.envelope(g.gain, at, peak, Math.max(0.002, attack), event.dur);
    // every burst starts somewhere else in the table, so a roll is not the same grain repeated
    const offset = ((at * 7.31) % 1) * Math.max(0.01, this.noiseTable.duration - 0.5);
    source.start(at, Number.isFinite(offset) ? offset : 0);
    source.stop(at + event.dur + 0.05);
  }

  /** A 15 ms transient: the click that lets a sound cut through a noisy room. */
  private click(event: SoundEvent, at: number, peak: number, out: AudioNode): void {
    this.noise({ ...event, voice: 'noise', to: event.hz, dur: event.dur }, at, peak, out);
  }

  /* ───────── ambience ───────── */

  /** Quiet generative bed for the lobby: slow C - Am - F - G pads and the odd music-box twinkle. */
  startAmbience(): void {
    if (this.ambience) return;
    const gain = this.context.createGain();
    gain.connect(this.input);
    const now = this.context.currentTime;
    gain.gain.setValueAtTime(FLOOR, now);
    gain.gain.exponentialRampToValueAtTime(1, now + 2.5);
    const rng = mulberry32(0x51ee);
    const scheduler = new AmbienceScheduler(
      () => this.context.currentTime,
      (notes, at) => this.scheduleAmbience(notes, at, gain),
      rng,
    );
    scheduler.tick();
    const timer = window.setInterval(() => scheduler.tick(), 500);
    this.ambience = { gain, timer, scheduler };
  }

  stopAmbience(immediate = false): void {
    const current = this.ambience;
    if (!current) return;
    this.ambience = null;
    window.clearInterval(current.timer);
    const now = this.context.currentTime;
    current.gain.gain.setValueAtTime(current.gain.gain.value || 1, now);
    current.gain.gain.exponentialRampToValueAtTime(FLOOR, now + (immediate ? 0.05 : 0.9));
  }

  get ambienceRunning(): boolean {
    return this.ambience !== null;
  }

  private scheduleAmbience(notes: AmbienceNote[], at: number, out: AudioNode): void {
    for (const note of notes) {
      const frequency = midiToHz(note.midi);
      if (note.kind === 'pad')
        this.render(
          { at: 0, voice: 'pad', hz: frequency, dur: note.dur, gain: 1, wet: 0.5 },
          at + note.at,
          0.07,
          out,
        );
      else
        this.render(
          { at: 0, voice: 'bell', hz: frequency, dur: note.dur, gain: 1, wet: 0.7 },
          at + note.at,
          0.05,
          out,
        );
    }
  }

  /* ───────── generated tables ───────── */

  /** Two seconds of white noise from a fixed seed, shared by every noise voice. */
  private makeNoiseTable(): AudioBuffer {
    const length = Math.floor(this.context.sampleRate * 2);
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    const random = mulberry32(0xa11ce);
    for (let i = 0; i < data.length; i++) data[i] = random() * 2 - 1;
    return buffer;
  }

  /** A small bright room: 0.9 s of exponentially decaying noise, slightly different per ear. */
  private makeRoom(): AudioBuffer {
    const rate = this.context.sampleRate;
    const length = Math.floor(rate * 0.9);
    const buffer = this.context.createBuffer(2, length, rate);
    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);
      const random = mulberry32(0x600d + channel * 977);
      let smooth = 0;
      for (let i = 0; i < data.length; i++) {
        const decay = (1 - i / length) ** 3.2;
        // one-pole low-pass that closes over time: the tail gets darker like a real room
        const mix = 0.35 + 0.6 * (i / length);
        smooth += (random() * 2 - 1 - smooth) * (1 - mix);
        data[i] = smooth * decay;
      }
    }
    return buffer;
  }
}
