/**
 * Synthesised sound effects (Web Audio). Nothing is downloaded, so there is nothing to license and
 * nothing to block the first paint. The context starts suspended on most browsers; `unlock()` must
 * run from a user gesture (the TV's "press OK" gate, a phone tap).
 *
 * The sound itself lives in `lib/sound/*`: one key and one timbre family (`scale.ts`, `palette.ts`),
 * a shared limiter + room (`engine.ts`) and shared timing with the animations (`timeline.ts`).
 * This file keeps the stable `sfx.play('<key>')` surface the screens use.
 */
import { SoundEngine, type AudioContextLike } from './sound/engine';
import {
  TRIM_DB,
  eventsFor,
  podiumEvents,
  revealEvents,
  type SoundEvent,
  type SoundName,
  type SoundParams,
} from './sound/palette';
import { tickPlan, type RevealPlan } from './sound/timeline';

export { SOUND_NAMES, hitSoundFor, type SoundName, type SoundParams } from './sound/palette';

type ContextFactory = () => AudioContextLike | null;

const defaultFactory: ContextFactory = () => {
  const w = window as unknown as {
    AudioContext?: new () => AudioContextLike;
    webkitAudioContext?: new () => AudioContextLike;
  };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  return Ctor ? new Ctor() : null;
};

/**
 * Who is listening. The TV is the stage in a loud room and may use the full range; a phone is held
 * a hand away from the ear (and several phones in one room add up), so it tops out lower.
 */
export type SoundProfile = 'tv' | 'phone';
export const PROFILE_CEILING: Record<SoundProfile, number> = { tv: 1, phone: 0.5 };

/** Slider (0..1) to linear gain: a perceptual taper, so the lower half of the slider is usable. */
export function levelFor(volume: number, profile: SoundProfile): number {
  const clamped = Math.min(1, Math.max(0, volume));
  return PROFILE_CEILING[profile] * clamped ** 1.6;
}

export interface PlayOptions extends SoundParams {
  /** Start this many milliseconds from now (aligns a cue with an animation). */
  delayMs?: number;
}

export class Sfx {
  private context: AudioContextLike | null = null;
  private engine: SoundEngine | null = null;
  private volume = 0.7;
  private muted = false;
  private profile: SoundProfile = 'tv';
  private ambienceWanted = false;
  private readonly factory: ContextFactory;

  constructor(factory: ContextFactory = defaultFactory) {
    this.factory = factory;
  }

  configure(options: { volume?: number; muted?: boolean; profile?: SoundProfile }): void {
    if (options.volume !== undefined) this.volume = Math.min(1, Math.max(0, options.volume));
    if (options.muted !== undefined) this.muted = options.muted;
    if (options.profile !== undefined) this.profile = options.profile;
    this.applyLevel();
    this.syncAmbience();
  }

  /** Creates and resumes the context. Safe to call repeatedly; must come from a user gesture. */
  async unlock(): Promise<boolean> {
    try {
      this.context ??= this.factory();
      const context = this.context;
      if (!context) return false;
      if (!this.engine) {
        this.engine = new SoundEngine(context, { lite: lowPower() });
        this.applyLevel();
      }
      if (context.state === 'suspended') await context.resume();
      this.syncAmbience();
      return context.state !== 'suspended';
    } catch {
      return false;
    }
  }

  get ready(): boolean {
    return this.context !== null && this.context.state === 'running';
  }

  get currentProfile(): SoundProfile {
    return this.profile;
  }

  play(name: SoundName, options: PlayOptions = {}): void {
    this.start(eventsFor(name, options), options.delayMs, name);
  }

  /** The staggered answer reveal as one score (see `revealPlan` for the matching CSS delays). */
  playReveal(plan: RevealPlan, outcome: { correct: boolean; streak?: number }): void {
    this.start(revealEvents(plan, outcome), 0);
  }

  /** The podium ceremony for the given number of ranked players. */
  playPodium(places: number): void {
    this.start(podiumEvents(places), 0);
  }

  /**
   * One second of the answer clock: ticks inside the second get denser (half seconds, then quarters)
   * and climb in pitch as time runs out. Call once per whole second with the seconds left.
   */
  countdownTick(secondsLeft: number): void {
    const plan = tickPlan(secondsLeft);
    plan.offsets.forEach((offset, index) => {
      const accent = index === plan.accent;
      this.play(secondsLeft <= 3 && accent ? 'tickUrgent' : 'tick', {
        step: secondsLeft,
        delayMs: offset * 1000,
      });
    });
  }

  /** Very quiet generative bed (lobby). Idempotent; follows mute and volume. */
  startAmbience(): void {
    this.ambienceWanted = true;
    this.syncAmbience();
  }

  stopAmbience(): void {
    this.ambienceWanted = false;
    this.syncAmbience();
  }

  async dispose(): Promise<void> {
    try {
      this.engine?.dispose();
      await this.context?.close();
    } catch {
      // ignore
    }
    this.context = null;
    this.engine = null;
  }

  private start(events: SoundEvent[], delayMs = 0, name?: SoundName): void {
    const context = this.context;
    const engine = this.engine;
    if (!context || !engine || this.muted || context.state !== 'running') return;
    try {
      const trimDb = name ? (TRIM_DB[name] ?? 0) : 0;
      const trim = 10 ** (trimDb / 20);
      engine.play(events, context.currentTime + 0.005 + Math.max(0, delayMs) / 1000, trim);
    } catch {
      // a failed sound must never break the game
    }
  }

  private applyLevel(): void {
    this.engine?.setLevel(this.muted ? 0 : levelFor(this.volume, this.profile));
  }

  private syncAmbience(): void {
    const engine = this.engine;
    if (!engine) return;
    const audible = this.ambienceWanted && !this.muted && this.volume > 0 && this.ready;
    try {
      if (audible) engine.startAmbience();
      else if (engine.ambienceRunning) engine.stopAmbience();
    } catch {
      // ambience is optional
    }
  }
}

/** Weak TVs ask for decorative motion to be off; they also get the drier, lighter sound graph. */
function lowPower(): boolean {
  return typeof document !== 'undefined' && document.documentElement.dataset.motion === 'low';
}

/** One shared instance for the page. */
export const sfx = new Sfx();
