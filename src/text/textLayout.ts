import type { PdfRect, TextAlign, TextFontFamily } from '../annotations/model';
import { sanitizeText, textWidth } from './fontMetrics';

/** Space between the box edge and the text, in points. */
export const TEXT_PADDING = 2;
/** Line height as a multiple of the font size. */
export const LINE_HEIGHT = 1.2;
/** Width of the outline drawn when a box has a border, in points. */
export const BORDER_WIDTH = 0.75;

/**
 * Distance from the top of a line box to its baseline, as a multiple of the font size. A line box
 * is `LINE_HEIGHT` tall with the glyphs centred in it, so this depends on the font's ascent and
 * descent. The values are those of the fonts the on-screen text uses (Arial, Times New Roman,
 * Courier New), which match the PDF standard fonts, and are what places the saved text exactly
 * where the editor shows it.
 */
export const BASELINE_EM: Record<TextFontFamily, number> = {
  Helvetica: 0.9465,
  Times: 0.9375,
  Courier: 0.8665,
};

/** What layout needs to know about a box's text. */
export interface TextSpec {
  contents: string;
  fontFamily: TextFontFamily;
  fontSize: number;
  bold?: boolean;
  italic?: boolean;
}

/**
 * Breaks text into lines no wider than `maxWidth` points. Lines break at spaces; a word wider than
 * the box is split between characters. Explicit line breaks are kept, and spaces at a wrap are
 * dropped (as editors do), so a line never starts or ends with the space that was the break.
 */
export function wrapText(spec: TextSpec, maxWidth: number): string[] {
  const { fontFamily: family, fontSize: size } = spec;
  const width = (s: string) => textWidth(family, size, s, spec);
  const limit = Math.max(maxWidth, 0);
  const lines: string[] = [];

  const trimEnd = (s: string) => s.replace(/ +$/, '');

  for (const paragraph of sanitizeText(spec.contents).split('\n')) {
    let line = '';
    const flush = () => {
      lines.push(trimEnd(line));
      line = '';
    };
    // Adds text one character at a time, starting a new line whenever the next one would not fit.
    const fill = (text: string) => {
      for (const ch of text) {
        if (line !== '' && width(line + ch) > limit) flush();
        line += ch;
      }
    };

    // Each word with the spaces after it (leading spaces belong to the first word), or a run of spaces.
    for (const token of paragraph.match(/ *[^ ]+ *| +/g) ?? []) {
      if (width(line + trimEnd(token)) <= limit) {
        line += token;
      } else if (line.trim() === '') {
        // Nothing but spaces so far, and the word is wider than a whole line.
        fill(token);
      } else {
        flush(); // wrap here; the spaces that were the break are dropped
        const next = token.replace(/^ +/, '');
        if (width(trimEnd(next)) <= limit) line = next;
        else fill(next);
      }
    }
    flush();
  }
  return lines;
}

/** Wraps the text of a box that is `widthPt` points wide (padding included). */
export function layoutLines(spec: TextSpec, widthPt: number): string[] {
  return wrapText(spec, widthPt - 2 * TEXT_PADDING);
}

/** Height in points needed to show `lineCount` lines, padding included. */
export function heightForLines(fontSize: number, lineCount: number): number {
  return 2 * TEXT_PADDING + Math.max(1, lineCount) * LINE_HEIGHT * fontSize;
}

/** Height in points a box `widthPt` wide needs to show all of its text. */
export function neededHeight(spec: TextSpec, widthPt: number): number {
  return heightForLines(spec.fontSize, layoutLines(spec, widthPt).length);
}

/** Smallest width a box may be given: room for a few characters at its font size. */
export function minBoxWidth(fontSize: number): number {
  return 2 * TEXT_PADDING + 2 * fontSize;
}

/** Size of a box as it appears on screen: the rect's sides swap on a page rotated by 90 or 270. */
export function displayedSize(
  rect: PdfRect,
  pageRotation: number,
): { width: number; height: number } {
  const w = Math.abs(rect[2] - rect[0]);
  const h = Math.abs(rect[3] - rect[1]);
  return normaliseRotation(pageRotation) % 180 === 0
    ? { width: w, height: h }
    : { width: h, height: w };
}

/** A page rotation as 0, 90, 180 or 270. */
export function normaliseRotation(degrees: number): number {
  return (((Math.round(degrees / 90) * 90) % 360) + 360) % 360;
}

/** Where a line starts, in points from the left edge of a box `widthPt` wide. */
export function lineOffset(
  spec: TextSpec,
  line: string,
  align: TextAlign,
  widthPt: number,
): number {
  const lineWidth = textWidth(spec.fontFamily, spec.fontSize, line, spec);
  if (align === 'center') return (widthPt - lineWidth) / 2;
  if (align === 'right') return widthPt - TEXT_PADDING - lineWidth;
  return TEXT_PADDING;
}
