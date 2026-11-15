import { useMemo } from 'react';
import QRCode from 'qrcode';
import styles from './QrCode.module.css';

/** SVG path for the dark modules, merging horizontal runs so a code stays a few KB. */
export function qrPath(
  size: number,
  isDark: (row: number, col: number) => boolean,
  quiet = 2,
): string {
  const parts: string[] = [];
  for (let row = 0; row < size; row++) {
    let col = 0;
    while (col < size) {
      if (!isDark(row, col)) {
        col += 1;
        continue;
      }
      let end = col;
      while (end < size && isDark(row, end)) end += 1;
      parts.push(`M${col + quiet} ${row + quiet}h${end - col}v1h-${end - col}z`);
      col = end;
    }
  }
  return parts.join('');
}

interface Props {
  value: string;
  /** Edge length in px. */
  size?: number;
  label: string;
}

/**
 * Renders the join QR as vector paths (no canvas, no data: URL, no HTML injection). Dark modules on
 * a white card with a quiet zone, so cameras read it from across a living room.
 */
export function QrCode({ value, size = 360, label }: Props) {
  const { path, modules } = useMemo(() => {
    const qr = QRCode.create(value, { errorCorrectionLevel: 'M' });
    const count = qr.modules.size;
    return {
      modules: count,
      path: qrPath(count, (r, c) => Boolean(qr.modules.get(r, c))),
    };
  }, [value]);
  const total = modules + 4;
  return (
    <svg
      className={styles.qr}
      width={size}
      height={size}
      viewBox={`0 0 ${total} ${total}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label={label}
    >
      <rect width={total} height={total} rx={1.2} fill="#ffffff" />
      <path d={path} fill="#0a1240" />
    </svg>
  );
}
