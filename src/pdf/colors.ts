export type Rgb = [number, number, number];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** '#RRGGBB' -> [r, g, b] with components in 0..1. Falls back to yellow for malformed input. */
export function hexToRgb(hex: string): Rgb {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return [1, 0.906, 0.298];
  return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255];
}

export function rgbToHex([r, g, b]: Rgb): string {
  const h = (v: number) =>
    Math.round(clamp01(v) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`.toUpperCase();
}

/**
 * Converts a PDF /C colour array (1 = gray, 3 = RGB, 4 = CMYK) to a hex colour. An empty or invalid
 * array (meaning "transparent" in PDF) returns null so the caller can pick a default.
 */
export function pdfColorToHex(c: number[] | undefined): string | null {
  if (!c) return null;
  switch (c.length) {
    case 1:
      return rgbToHex([c[0], c[0], c[0]]);
    case 3:
      return rgbToHex([c[0], c[1], c[2]]);
    case 4: {
      const [cy, m, y, k] = c.map(clamp01);
      return rgbToHex([(1 - cy) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)]);
    }
    default:
      return null;
  }
}

/** Number formatting for PDF content streams: no exponent, at most 3 decimals, no trailing zeros. */
export function n(v: number): string {
  const s = v.toFixed(3);
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}
