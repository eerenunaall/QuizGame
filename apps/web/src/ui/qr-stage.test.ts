import { describe, expect, it } from 'vitest';
import QRCode from 'qrcode';
import { qrPath } from './QrCode';
import { STAGE_HEIGHT, STAGE_WIDTH, stageScale } from './Stage';

describe('qrPath', () => {
  it('merges horizontal runs of dark modules into single rectangles', () => {
    const grid = ['XX.X', '....', '.XXX'].map((row) => [...row].map((char) => char === 'X'));
    const path = qrPath(4, (row, col) => grid[row]?.[col] ?? false, 0);
    expect(path).toBe('M0 0h2v1h-2zM3 0h1v1h-1zM1 2h3v1h-3z');
  });

  it('offsets every module by the quiet zone', () => {
    expect(qrPath(1, () => true, 2)).toBe('M2 2h1v1h-1z');
  });

  it('draws exactly the modules of a real code', () => {
    const qr = QRCode.create('https://example.com/join/ABC234', { errorCorrectionLevel: 'M' });
    const size = qr.modules.size;
    const path = qrPath(size, (row, col) => Boolean(qr.modules.get(row, col)), 0);
    let dark = 0;
    for (const match of path.matchAll(/h(\d+)v1/gu)) dark += Number(match[1]);
    let expected = 0;
    for (let row = 0; row < size; row++)
      for (let col = 0; col < size; col++) if (qr.modules.get(row, col)) expected += 1;
    expect(dark).toBe(expected);
    expect(path.length).toBeLessThan(6000);
  });
});

describe('stageScale', () => {
  it('is 1 at the design resolution and fits both dimensions', () => {
    expect(stageScale(STAGE_WIDTH, STAGE_HEIGHT)).toBe(1);
    expect(stageScale(1280, 720)).toBeCloseTo(2 / 3);
    expect(stageScale(3840, 2160)).toBe(2);
    // Ultra-wide and portrait windows are limited by the tighter side.
    expect(stageScale(3840, 1080)).toBe(1);
    expect(stageScale(1080, 1920)).toBeCloseTo(1080 / STAGE_WIDTH);
  });
});
