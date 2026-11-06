/**
 * What kind of screen and input are we on? The TV layout, focus handling and decorative motion
 * depend on it. Everything here is a hint with a safe default; nothing is security relevant.
 */
export type InputMode = 'touch' | 'keyboard' | 'remote';

const TV_UA =
  /smart-?tv|tizen|web0s|webos|hbbtv|netcast|aft[a-z]|bravia|crkey|googletv|android tv|appletv|playstation|xbox|vidaa|viera|roku|philipstv|opera tv/iu;

export interface DeviceInfo {
  isTv: boolean;
  /** True for engines old or weak enough that decorative animation should be switched off. */
  lowPower: boolean;
  chromiumMajor: number | null;
}

export function chromiumMajor(userAgent: string): number | null {
  const match = /(?:Chrome|Chromium)\/(\d+)/u.exec(userAgent);
  return match ? Number(match[1]) : null;
}

export function detectDevice(nav: {
  userAgent: string;
  hardwareConcurrency?: number;
  deviceMemory?: number;
}): DeviceInfo {
  const major = chromiumMajor(nav.userAgent);
  const isTv = TV_UA.test(nav.userAgent);
  const weak =
    (nav.hardwareConcurrency !== undefined && nav.hardwareConcurrency <= 2) ||
    (nav.deviceMemory !== undefined && nav.deviceMemory <= 1);
  const oldEngine = major !== null && major < 80;
  return { isTv, lowPower: oldEngine || (isTv && weak), chromiumMajor: major };
}

/** Sets `data-motion` / `data-input` on <html> and keeps `data-input` current. */
export function installDocumentFlags(doc: Document, info: DeviceInfo): () => void {
  const root = doc.documentElement;
  if (info.lowPower) root.dataset.motion = 'low';
  const set = (mode: InputMode): void => {
    if (root.dataset.input !== mode) root.dataset.input = mode;
  };
  set(info.isTv ? 'remote' : 'touch');
  const onKey = (): void => set(info.isTv ? 'remote' : 'keyboard');
  const onTouch = (): void => set('touch');
  doc.addEventListener('keydown', onKey, true);
  doc.addEventListener('touchstart', onTouch, { capture: true, passive: true });
  return () => {
    doc.removeEventListener('keydown', onKey, true);
    doc.removeEventListener('touchstart', onTouch, true);
  };
}
