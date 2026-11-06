import type { PdfRect } from '../annotations/model';
import { hexToRgb, n } from './colors';

/** Smallest rectangle containing all of the given rects. */
export function unionRect(rects: PdfRect[]): PdfRect {
  return rects.reduce<PdfRect>(
    (a, r) => [Math.min(a[0], r[0]), Math.min(a[1], r[1]), Math.max(a[2], r[2]), Math.max(a[3], r[3])],
    [Infinity, Infinity, -Infinity, -Infinity],
  );
}

/**
 * /QuadPoints for one rect. Acrobat (and every other reader) uses the order top-left, top-right,
 * bottom-left, bottom-right, even though the spec text says counter-clockwise.
 */
export function quadPointsFor(rects: PdfRect[]): number[] {
  return rects.flatMap(([x1, y1, x2, y2]) => [x1, y2, x2, y2, x1, y1, x2, y1]);
}

/** Appearance stream for a highlight: filled rects drawn with the Multiply blend mode. */
export function highlightAppearance(rects: PdfRect[], color: string): { bbox: PdfRect; content: string } {
  const [r, g, b] = hexToRgb(color);
  const lines = ['/GS gs', `${n(r)} ${n(g)} ${n(b)} rg`];
  for (const [x1, y1, x2, y2] of rects) {
    lines.push(`${n(x1)} ${n(y1)} ${n(x2 - x1)} ${n(y2 - y1)} re f`);
  }
  return { bbox: unionRect(rects), content: lines.join('\n') };
}

/** Side of a sticky-note icon in PDF units. Matches the on-screen icon size at 100% zoom. */
export const NOTE_RECT_SIZE = 24;

/** Appearance stream for a sticky note: a speech bubble in the note's colour, in a 24x24 box. */
export function noteAppearance(color: string): { bbox: PdfRect; content: string } {
  const [r, g, b] = hexToRgb(color);
  const content = [
    `${n(r)} ${n(g)} ${n(b)} rg`,
    '0.2 0.2 0.2 RG',
    '1.2 w',
    '1 j',
    // Bubble with a tail at the bottom left (PDF y grows upwards).
    '2.5 22 m 21.5 22 l 21.5 8.5 l 10 8.5 l 5.5 3 l 5.5 8.5 l 2.5 8.5 l h B',
    '1.4 w',
    '1 J',
    '6 17 m 18 17 l S',
    '6 13 m 14 13 l S',
  ].join('\n');
  return { bbox: [0, 0, NOTE_RECT_SIZE, NOTE_RECT_SIZE], content };
}
