import { afterEach, describe, expect, it } from 'vitest';
import { chromiumMajor, detectDevice, installDocumentFlags } from './device';

const TIZEN =
  'Mozilla/5.0 (SMART-TV; LINUX; Tizen 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Version/5.0 TV Safari/537.36';
const WEBOS =
  'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.79 Safari/537.36 WebAppManager';
const DESKTOP =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

describe('detectDevice', () => {
  it('recognises smart-TV user agents', () => {
    expect(detectDevice({ userAgent: TIZEN }).isTv).toBe(true);
    expect(detectDevice({ userAgent: WEBOS }).isTv).toBe(true);
    expect(detectDevice({ userAgent: DESKTOP }).isTv).toBe(false);
    expect(detectDevice({ userAgent: IPHONE }).isTv).toBe(false);
  });

  it('reads the Chromium major version', () => {
    expect(chromiumMajor(WEBOS)).toBe(79);
    expect(chromiumMajor(DESKTOP)).toBe(130);
    expect(chromiumMajor(IPHONE)).toBeNull();
  });

  it('marks old engines and weak TVs as low power, strong desktops as not', () => {
    expect(detectDevice({ userAgent: WEBOS }).lowPower).toBe(true); // Chromium 79
    expect(detectDevice({ userAgent: TIZEN, hardwareConcurrency: 2 }).lowPower).toBe(true);
    expect(detectDevice({ userAgent: TIZEN, hardwareConcurrency: 8 }).lowPower).toBe(false);
    expect(detectDevice({ userAgent: DESKTOP, hardwareConcurrency: 2 }).lowPower).toBe(false);
    expect(detectDevice({ userAgent: DESKTOP, hardwareConcurrency: 16 }).lowPower).toBe(false);
  });
});

describe('installDocumentFlags', () => {
  afterEach(() => {
    delete document.documentElement.dataset.motion;
    delete document.documentElement.dataset.input;
  });

  it('sets low-motion and the input mode, and follows real input', () => {
    const stop = installDocumentFlags(document, { isTv: false, lowPower: true, chromiumMajor: 70 });
    expect(document.documentElement.dataset.motion).toBe('low');
    expect(document.documentElement.dataset.input).toBe('touch');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    expect(document.documentElement.dataset.input).toBe('keyboard');
    document.dispatchEvent(new Event('touchstart'));
    expect(document.documentElement.dataset.input).toBe('touch');
    stop();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    expect(document.documentElement.dataset.input).toBe('touch');
  });

  it('keeps TVs in remote mode whatever key arrives', () => {
    const stop = installDocumentFlags(document, {
      isTv: true,
      lowPower: false,
      chromiumMajor: 100,
    });
    expect(document.documentElement.dataset.motion).toBeUndefined();
    expect(document.documentElement.dataset.input).toBe('remote');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    expect(document.documentElement.dataset.input).toBe('remote');
    stop();
  });
});
