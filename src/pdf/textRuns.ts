import type { ViewportLike } from '../annotations/geometry';
import type { TextFontFamily } from '../annotations/model';
import { BASELINE_EM, TEXT_PADDING, heightForLines } from '../text/textLayout';

/** The fields of a PDF.js text item that we use. */
export interface RawTextItem {
  str: string;
  /** Matrix in PDF user space: [a, b, c, d, e, f]; (e, f) is where the text starts, on the baseline. */
  transform: number[];
  /** Length along the baseline, in user-space units. */
  width: number;
  height: number;
  fontName: string;
}

/** What PDF.js knows about a font (from its `commonObjs`), all optional. */
export interface FontInfo {
  name?: string;
  fallbackName?: string;
  bold?: boolean;
  italic?: boolean;
}

export interface DescribedFont {
  fontFamily: TextFontFamily;
  bold: boolean;
  italic: boolean;
}

const MONO = /courier|mono|consolas|menlo|typewriter|lucida console|andale|fixed|code/i;
const SERIF =
  /times|georgia|garamond|palatino|minion|cambria|century|bodoni|caslon|didot|baskerville|utopia|charter|libertin|latin ?modern|lmroman|cmr\d|nimbus ?rom|book antiqua|(?<!sans[- ]?)serif/i;
const BOLD = /bold|black|heavy|demi|semibold|extrabold|ultra/i;
const ITALIC = /italic|oblique|slanted|kursiv/i;

/**
 * The closest of our fonts for a PDF font: sans-serif, serif or monospace, with bold and italic.
 * PDF.js reports bold and italic itself; the name (when there is one, minus its "ABCDEF+" subset
 * prefix) refines the family, and the serif / monospace hint PDF.js derives from the font's flags
 * is used when the name says nothing.
 */
export function describeFont(info: FontInfo | undefined): DescribedFont {
  const name = (info?.name ?? '').replace(/^[A-Z]{6}\+/, '');
  let fontFamily: TextFontFamily = 'Helvetica';
  if (MONO.test(name)) fontFamily = 'Courier';
  else if (/sans|arial|helvet|verdana|tahoma|calibri|segoe/i.test(name)) fontFamily = 'Helvetica';
  else if (SERIF.test(name)) fontFamily = 'Times';
  else if (info?.fallbackName === 'monospace') fontFamily = 'Courier';
  else if (info?.fallbackName === 'serif') fontFamily = 'Times';
  return {
    fontFamily,
    bold: info?.bold ?? BOLD.test(name),
    italic: info?.italic ?? ITALIC.test(name),
  };
}

/** A line of text in one font, in *displayed* page points (origin top-left, y down, upright). */
export interface TextRun {
  text: string;
  fontName: string;
  left: number;
  /** The baseline's distance from the top of the page. */
  baseline: number;
  width: number;
  /** Font size in points. */
  size: number;
}

/** Glyphs reach this far above the baseline and below it, as a multiple of the font size. */
export const ASCENT = 0.9;
export const DESCENT = 0.25;

const UPRIGHT_TOLERANCE = 0.02;

/**
 * Turns PDF.js text items into runs. Only text that is upright and runs left to right *as
 * displayed* is kept (on a page turned by 90 degrees that is text running along the file's y axis);
 * anything slanted or vertical cannot be edited. Items on one baseline, in the same font and size,
 * with only a word space between them, are joined into one run: a line. Duplicates (some producers
 * draw bold text twice, slightly offset) are dropped.
 */
export function buildRuns(
  items: readonly RawTextItem[],
  viewport: Pick<ViewportLike, 'convertToViewportPoint'>,
): TextRun[] {
  const singles: TextRun[] = [];
  for (const item of items) {
    if (!item.str.trim() || !(item.width > 0)) continue;
    const [a, b, c, d, e, f] = item.transform;
    const origin = viewport.convertToViewportPoint(e, f);
    const along = viewport.convertToViewportPoint(e + a, f + b);
    const up = viewport.convertToViewportPoint(e + c, f + d);
    const dx = along[0] - origin[0];
    const dy = along[1] - origin[1];
    const ux = up[0] - origin[0];
    const uy = up[1] - origin[1];
    // Along the baseline: rightwards and level. Up: upwards on screen (negative y) and upright.
    if (!(dx > 0) || Math.abs(dy) > UPRIGHT_TOLERANCE * dx) continue;
    if (!(uy < 0) || Math.abs(ux) > UPRIGHT_TOLERANCE * Math.abs(uy)) continue;
    const size = Math.hypot(ux, uy);
    if (!(size > 0.5)) continue;
    singles.push({
      text: item.str.normalize('NFKC'),
      fontName: item.fontName,
      left: origin[0],
      baseline: origin[1],
      width: item.width * (Math.hypot(dx, dy) / Math.hypot(a, b || 0)),
      size,
    });
  }

  // Lines: items whose baselines are within a quarter of the font size of each other.
  const sorted = [...singles].sort((p, q) => p.baseline - q.baseline || p.left - q.left);
  const lines: TextRun[][] = [];
  for (const s of sorted) {
    const line = lines[lines.length - 1];
    if (line && Math.abs(line[0].baseline - s.baseline) <= 0.25 * Math.max(line[0].size, s.size)) {
      line.push(s);
    } else {
      lines.push([s]);
    }
  }

  const runs: TextRun[] = [];
  for (const line of lines) {
    line.sort((p, q) => p.left - q.left);
    let current = null as TextRun | null;
    for (const s of line) {
      if (current) {
        const gap = s.left - (current.left + current.width);
        const duplicate =
          s.text === current.text && Math.abs(s.left - current.left) < 0.1 * current.size;
        if (duplicate) continue;
        const sameStyle =
          s.fontName === current.fontName && Math.abs(s.size - current.size) <= 0.08 * current.size;
        if (sameStyle && gap >= -0.2 * current.size && gap <= 1.0 * current.size) {
          const needsSpace =
            gap > 0.12 * current.size && !/\s$/.test(current.text) && !/^\s/.test(s.text);
          current = {
            ...current,
            text: current.text + (needsSpace ? ' ' : '') + s.text,
            width: s.left + s.width - current.left,
          };
          continue;
        }
        runs.push(current);
      }
      current = { ...s };
    }
    if (current) runs.push(current);
  }
  return runs;
}

/** The box a run occupies, in displayed page points: where a click counts as on it. */
export function runBox(run: TextRun): { left: number; top: number; right: number; bottom: number } {
  return {
    left: run.left,
    top: run.baseline - ASCENT * run.size,
    right: run.left + run.width,
    bottom: run.baseline + DESCENT * run.size,
  };
}

/** The run under a point in displayed page points (the smallest if several overlap), or null. */
export function runAt(runs: readonly TextRun[], x: number, y: number): TextRun | null {
  let best: TextRun | null = null;
  let bestArea = Infinity;
  for (const run of runs) {
    const b = runBox(run);
    if (x < b.left || x > b.right || y < b.top || y > b.bottom) continue;
    const area = (b.right - b.left) * (b.bottom - b.top);
    if (area < bestArea) {
      best = run;
      bestArea = area;
    }
  }
  return best;
}

/** A little extra room so the cover reaches past the last letter's side bearing. */
const COVER_EXTRA = 1.5;

/**
 * The text box that replaces a run, in displayed page points. It is placed so that the first line
 * of new text sits exactly on the original baseline and starts at the original left edge (the box's
 * own padding and the font's ascent are accounted for), and is big enough to hide the old text.
 */
export function replacementFrame(
  run: TextRun,
  fontFamily: TextFontFamily,
): { left: number; top: number; width: number; height: number } {
  return {
    left: run.left - TEXT_PADDING,
    top: run.baseline - TEXT_PADDING - BASELINE_EM[fontFamily] * run.size,
    width: run.width + 2 * TEXT_PADDING + COVER_EXTRA,
    height: heightForLines(run.size, 1) + COVER_EXTRA,
  };
}
