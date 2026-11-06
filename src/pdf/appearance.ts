import type { PdfRect, SignatureArtwork, TextBoxAnnotation } from '../annotations/model';
import { strokesToPdfOps } from '../signature/strokes';
import {
  BASELINE_EM,
  BORDER_WIDTH,
  LINE_HEIGHT,
  TEXT_PADDING,
  layoutLines,
  lineOffset,
  normaliseRotation,
} from '../text/textLayout';
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

/**
 * The matrix that turns an upright appearance into one that is upright on a page displayed with the
 * given rotation. The page turns clockwise, so the appearance is turned the other way beforehand.
 * Null for an unrotated page.
 */
export function uprightMatrix(pageRotation: number): [number, number, number, number, number, number] | null {
  switch (normaliseRotation(pageRotation)) {
    case 90:
      return [0, 1, -1, 0, 0, 0];
    case 180:
      return [-1, 0, 0, -1, 0, 0];
    case 270:
      return [0, -1, 1, 0, 0, 0];
    default:
      return null;
  }
}

/**
 * Appearance stream for a text box: optional background and outline, then each wrapped line placed
 * exactly where the on-screen editor puts it. `size` is the box as displayed (upright); `encode`
 * turns a line into a PDF string operand (a hex string in the font's encoding).
 */
export function textBoxAppearance(
  box: TextBoxAnnotation,
  size: { width: number; height: number },
  fontResource: string,
  encode: (line: string) => string,
): { bbox: PdfRect; content: string } {
  const { width, height } = size;
  const out: string[] = ['q'];

  if (box.fill) {
    const [r, g, b] = hexToRgb(box.fill);
    out.push(`${n(r)} ${n(g)} ${n(b)} rg`, `0 0 ${n(width)} ${n(height)} re f`);
  }
  const [tr, tg, tb] = hexToRgb(box.color);
  if (box.border) {
    const inset = BORDER_WIDTH / 2;
    out.push(
      `${n(tr)} ${n(tg)} ${n(tb)} RG`,
      `${n(BORDER_WIDTH)} w`,
      `${n(inset)} ${n(inset)} ${n(width - BORDER_WIDTH)} ${n(height - BORDER_WIDTH)} re S`,
    );
  }

  const lines = layoutLines(box, width);
  const lineHeight = LINE_HEIGHT * box.fontSize;
  out.push('BT', `/${fontResource} ${n(box.fontSize)} Tf`, `${n(tr)} ${n(tg)} ${n(tb)} rg`);
  lines.forEach((line, i) => {
    if (!line) return;
    const x = lineOffset(box, line, box.align, width);
    const baseline = height - (TEXT_PADDING + i * lineHeight + BASELINE_EM[box.fontFamily] * box.fontSize);
    out.push(`1 0 0 1 ${n(x)} ${n(baseline)} Tm`, `${encode(line)} Tj`);
  });
  out.push('ET', 'Q');

  return { bbox: [0, 0, width, height], content: out.join('\n') };
}

/**
 * Appearance stream for a drawn signature: the strokes as vector paths, scaled from the drawing's
 * own units to the displayed size (pdf y points up, the drawing's points down, so y is flipped).
 * The pen width scales along with everything else, exactly as the on-screen SVG does.
 */
export function signatureStrokeAppearance(
  art: Extract<SignatureArtwork, { type: 'strokes' }>,
  size: { width: number; height: number },
): { bbox: PdfRect; content: string } {
  const [r, g, b] = hexToRgb(art.color);
  const sx = size.width / art.box[0];
  const sy = size.height / art.box[1];
  const content = [
    'q',
    `${n(r)} ${n(g)} ${n(b)} RG`,
    `${n(art.width)} w`,
    '1 J',
    '1 j',
    `${n(sx)} 0 0 ${n(-sy)} 0 ${n(size.height)} cm`,
    ...strokesToPdfOps(art.strokes),
    'Q',
  ].join('\n');
  return { bbox: [0, 0, size.width, size.height], content };
}

/** Appearance stream that paints an image over the whole box. */
export function signatureImageAppearance(
  size: { width: number; height: number },
  imageResource: string,
): { bbox: PdfRect; content: string } {
  const content = ['q', `${n(size.width)} 0 0 ${n(size.height)} 0 0 cm`, `/${imageResource} Do`, 'Q'].join('\n');
  return { bbox: [0, 0, size.width, size.height], content };
}
