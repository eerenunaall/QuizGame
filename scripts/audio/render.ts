/**
 * Offline renderer and level meter for the game's sound palette (docs/AUDIO.md).
 *
 * The sounds are synthesised at runtime (apps/web/src/lib/sound/*): nothing is downloaded and there
 * are no audio files to license. This script runs the very same code in headless Chromium against an
 * OfflineAudioContext, which lets us measure what a browser will actually produce:
 *
 *   node scripts/audio/render.ts                 print peak / loudness / brightness of every cue
 *   node scripts/audio/render.ts --check         same, exit 1 when a cue clips or misses its target
 *   node scripts/audio/render.ts --calibrate     write apps/web/src/lib/sound/trim.generated.ts
 *   node scripts/audio/render.ts --wav <dir>     also write one 16-bit WAV per cue plus index.html
 *                                                (to listen to the palette; not committed)
 *
 * Deterministic: the noise table and the room impulse come from a fixed seed, so two runs write
 * byte-identical WAVs. No dependency beyond the Playwright already used by the e2e tests.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SOUND_DIR = join(ROOT, 'apps/web/src/lib/sound');
const SANDBOX_CHROMIUM = '/opt/pw-browsers/chromium';
const ORIGIN = 'http://sound.invalid';

interface CueReport {
  name: string;
  seconds: number;
  peakDb: number;
  rmsDb: number;
  centroidHz: number;
  /** Level (dBFS rms) of the 0.5-4 kHz band: the part of a cue that still reads over a noisy room. */
  presenceDb: number;
  wav?: string;
}

/** The page side: imports the real sources and renders cues into sample buffers. */
const HARNESS = `
import { SoundEngine } from '${ORIGIN}/engine.ts';
import { SOUND_NAMES, eventsFor, revealEvents, podiumEvents } from '${ORIGIN}/palette.ts';
import { revealPlan } from '${ORIGIN}/timeline.ts';

const RATE = 44100;

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wr = Math.cos(angle), wi = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = i + k + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

function spectrum(samples) {
  let n = 1; while (n < samples.length) n <<= 1;
  n = Math.min(n, 1 << 17);
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < Math.min(n, samples.length); i++) re[i] = samples[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / Math.min(n, samples.length)));
  fft(re, im);
  let total = 0, weighted = 0, presence = 0;
  for (let k = 1; k < n / 2; k++) {
    const f = (k * RATE) / n; const p = re[k] * re[k] + im[k] * im[k];
    total += p; weighted += p * f; if (f >= 500 && f <= 4000) presence += p;
  }
  return { centroid: total ? weighted / total : 0, presence: total ? presence / total : 0 };
}

async function render(events, trimLinear, seconds) {
  const length = Math.ceil(RATE * seconds);
  const context = new OfflineAudioContext(1, length, RATE);
  const engine = new SoundEngine(context);
  engine.setLevel(1);
  engine.play(events, 0.02, trimLinear);
  const buffer = await context.startRendering();
  return buffer.getChannelData(0);
}

function measure(samples, activeSeconds) {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  const active = Math.min(samples.length, Math.ceil(RATE * activeSeconds));
  let sum = 0;
  for (let i = 0; i < active; i++) sum += samples[i] * samples[i];
  const rms = Math.sqrt(sum / Math.max(1, active));
  const s = spectrum(samples.subarray(0, active));
  return { peak, rms, ...s };
}

function toWav(samples) {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (o, t) => { for (let i = 0; i < t.length; i++) view.setUint8(o + i, t.charCodeAt(i)); };
  text(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, RATE, true); view.setUint32(28, RATE * 2, true); view.setUint16(32, 2, true);
  view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 32767, true);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function endOf(events) { return events.reduce((m, e) => Math.max(m, e.at + e.dur), 0); }

window.cues = () => [
  ...SOUND_NAMES.map((name) => ({ name, events: () => eventsFor(name, {}) })),
  { name: 'correct@streak5', events: () => eventsFor('correct', { streak: 5 }) },
  { name: 'combo@streak5', events: () => eventsFor('combo', { streak: 5 }) },
  { name: 'join@3', events: () => eventsFor('join', { order: 3 }) },
  { name: 'tick@2', events: () => eventsFor('tick', { step: 2 }) },
  { name: 'tickUrgent@1', events: () => eventsFor('tickUrgent', { step: 1 }) },
  { name: 'sequence:reveal-correct', events: () => revealEvents(revealPlan(4, 2), { correct: true, streak: 3 }) },
  { name: 'sequence:reveal-wrong', events: () => revealEvents(revealPlan(4, 1), { correct: false }) },
  { name: 'sequence:podium', events: () => podiumEvents(3) },
];

window.measureCue = async (name, trimDb, wantWav) => {
  const cue = window.cues().find((c) => c.name === name);
  const events = cue.events();
  const seconds = endOf(events) + 1.4;
  const samples = await render(events, Math.pow(10, trimDb / 20), seconds);
  const m = measure(samples, endOf(events) + 0.3);
  return {
    name, seconds: Math.round(endOf(events) * 100) / 100,
    peakDb: 20 * Math.log10(m.peak || 1e-9), rmsDb: 20 * Math.log10(m.rms || 1e-9),
    centroidHz: Math.round(m.centroid), presenceDb: 20 * Math.log10(m.rms || 1e-9) + 10 * Math.log10(m.presence || 1e-9),
    wav: wantWav ? toWav(samples) : undefined,
  };
};
window.cueNames = () => window.cues().map((c) => c.name);
window.targets = {};
`;

function serve(path: string): { body: string; type: string } | null {
  const file = join(SOUND_DIR, path.replace(/^\//u, '').replace(/\.ts$/u, '') + '.ts');
  if (!existsSync(file)) return null;
  return { body: stripTypeScriptTypes(readFileSync(file, 'utf8')), type: 'text/javascript' };
}

async function importTargets(): Promise<{
  targets: Record<string, number>;
  trims: Record<string, number>;
}> {
  const mix = (await import(
    new URL('../../apps/web/src/lib/sound/mix.ts', import.meta.url).href
  )) as {
    TARGET_PEAK_DB: Record<string, number>;
  };
  const trim = (await import(
    new URL('../../apps/web/src/lib/sound/trim.generated.ts', import.meta.url).href
  )) as { TRIM_DB: Record<string, number> };
  return { targets: mix.TARGET_PEAK_DB, trims: trim.TRIM_DB };
}

/** `correct@streak5` is judged like `correct`, a sequence like the biggest tier. */
function baseOf(name: string): string {
  return name.split('@')[0]!.replace(/^sequence:.*/u, 'fanfare');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const calibrate = args.includes('--calibrate');
  const check = args.includes('--check');
  const wavDir = args.includes('--wav') ? args[args.indexOf('--wav') + 1] : undefined;
  const { targets, trims } = await importTargets();

  const browser = await chromium.launch(
    existsSync(SANDBOX_CHROMIUM) ? { executablePath: SANDBOX_CHROMIUM } : {},
  );
  const page = await browser.newPage();
  await page.route(`${ORIGIN}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/index.html')
      return route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><title>audio</title>',
      });
    if (path === '/harness.js')
      return route.fulfill({ contentType: 'text/javascript', body: HARNESS });
    const served = serve(path);
    return served
      ? route.fulfill({ contentType: served.type, body: served.body })
      : route.fulfill({ status: 404, body: 'not found' });
  });
  await page.goto(`${ORIGIN}/index.html`);
  await page.addScriptTag({ url: `${ORIGIN}/harness.js`, type: 'module' });
  await page.waitForFunction(
    () => typeof (window as never as { cueNames?: unknown }).cueNames === 'function',
  );
  const names = await page.evaluate(() =>
    (window as never as { cueNames: () => string[] }).cueNames(),
  );

  const measure = (name: string, trimDb: number, wav: boolean): Promise<CueReport> =>
    page.evaluate(
      ([n, t, w]) =>
        (
          window as never as {
            measureCue: (a: string, b: number, c: boolean) => Promise<CueReport>;
          }
        ).measureCue(n as string, t as number, w as boolean),
      [name, trimDb, wav] as const,
    );

  const nextTrims: Record<string, number> = {};
  const reports: CueReport[] = [];
  for (const name of names) {
    const base = baseOf(name);
    const target = targets[base];
    const sequence = name.startsWith('sequence:');
    let trim = calibrate || sequence ? 0 : (trims[base] ?? 0);
    let report = await measure(name, trim, false);
    if (calibrate && target !== undefined && !name.includes('@') && !name.startsWith('sequence:')) {
      // The limiter bends level near full scale, so converge in a few steps (stop within 0.3 dB).
      for (let pass = 0; pass < 6 && Math.abs(target - report.peakDb) > 0.3; pass++) {
        trim += target - report.peakDb;
        report = await measure(name, trim, false);
      }
      nextTrims[base] = Math.round(trim * 10) / 10;
    }
    if (wavDir)
      report = await measure(
        name,
        name.startsWith('sequence:') ? 0 : calibrate ? trim : (trims[base] ?? 0),
        true,
      );
    reports.push(report);
  }
  await browser.close();

  console.log('cue                      sec    peak   rms   centroid 0.5-4k  target');
  let failures = 0;
  for (const r of reports) {
    const target = targets[baseOf(r.name)];
    const off = target === undefined ? 0 : r.peakDb - target;
    const bad =
      r.peakDb > -0.2 ||
      (!calibrate &&
        target !== undefined &&
        !r.name.includes('@') &&
        !r.name.startsWith('sequence:') &&
        Math.abs(off) > 1.5);
    if (bad) failures += 1;
    console.log(
      `${r.name.padEnd(24)} ${r.seconds.toFixed(2).padStart(5)} ${r.peakDb.toFixed(1).padStart(6)} ${r.rmsDb.toFixed(1).padStart(6)} ${String(r.centroidHz).padStart(8)} ${r.presenceDb.toFixed(1).padStart(7)}  ${target ?? '-'}${bad ? '  <-- off target or clipping' : ''}`,
    );
  }

  if (calibrate) {
    const lines = Object.keys(nextTrims)
      .sort()
      .map((key) => `  ${key}: ${nextTrims[key]},`);
    writeFileSync(
      join(SOUND_DIR, 'trim.generated.ts'),
      `// Generated by scripts/audio/render.ts --calibrate — do not edit.\nimport type { SoundName } from './palette';\n\n/** Per-cue trim in dB that brings every cue to its target peak (see mix.ts). */\nexport const TRIM_DB: Partial<Record<SoundName, number>> = {\n${lines.join('\n')}\n};\n`,
    );
    console.log(`wrote ${Object.keys(nextTrims).length} trims`);
  }
  if (wavDir) {
    mkdirSync(wavDir, { recursive: true });
    const rows: string[] = [];
    for (const r of reports) {
      const file = `${r.name.replace(/[^a-z0-9@-]/giu, '_')}.wav`;
      writeFileSync(join(wavDir, file), Buffer.from(r.wav ?? '', 'base64'));
      rows.push(
        `<tr><td>${r.name}</td><td><audio controls preload="none" src="${file}"></audio></td></tr>`,
      );
    }
    mkdirSync(dirname(join(wavDir, 'index.html')), { recursive: true });
    writeFileSync(
      join(wavDir, 'index.html'),
      `<!doctype html><meta charset="utf-8"><title>Sound palette</title><style>body{font:16px system-ui;margin:24px}td{padding:4px 12px}</style><h1>Sound palette</h1><table>${rows.join('')}</table>`,
    );
    console.log(`wrote ${reports.length} WAV files to ${wavDir}`);
  }
  if (check && failures > 0) {
    console.error(`${failures} cue(s) clip or miss their level target`);
    process.exitCode = 1;
  }
}

await main();
