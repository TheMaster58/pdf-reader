import type { PdfRect } from './model';

/** A rectangle in any 2D space (client pixels, page fractions...). */
export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The slice of PDF.js's PageViewport that we use. Pass a viewport made with scale 1. */
export interface ViewportLike {
  width: number;
  height: number;
  convertToPdfPoint(x: number, y: number): number[];
  convertToViewportPoint(x: number, y: number): number[];
}

const width = (r: Rect) => r.right - r.left;
const height = (r: Rect) => r.bottom - r.top;

function verticalOverlap(a: Rect, b: Rect): number {
  return Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
}

function union(a: Rect, b: Rect): Rect {
  return {
    left: Math.min(a.left, b.left),
    top: Math.min(a.top, b.top),
    right: Math.max(a.right, b.right),
    bottom: Math.max(a.bottom, b.bottom),
  };
}

/** Two boxes count as the same text line if they share at least this much of the shorter one. */
const LINE_OVERLAP = 0.5;
/** Boxes on a line are joined if the gap is at most this fraction of the line height (a space). */
const MAX_GAP_RATIO = 0.6;

/**
 * Turns the many small boxes a text selection produces (one per text-layer span, plus duplicates)
 * into one rectangle per visual line, with neighbouring lines trimmed so they don't overlap.
 * Works in any consistent unit; client pixels are expected so the gap ratio is meaningful.
 */
export function mergeLineRects(rects: Rect[]): Rect[] {
  const valid = rects.filter((r) => width(r) > 0 && height(r) > 0);
  const byCentre = [...valid].sort(
    (a, b) => a.top + a.bottom - (b.top + b.bottom) || a.left - b.left,
  );

  // 1. Group boxes into lines.
  const lines: { bounds: Rect; members: Rect[] }[] = [];
  for (const r of byCentre) {
    const line = lines.find(
      (l) => verticalOverlap(l.bounds, r) >= LINE_OVERLAP * Math.min(height(l.bounds), height(r)),
    );
    if (line) {
      line.members.push(r);
      line.bounds = union(line.bounds, r);
    } else {
      lines.push({ bounds: r, members: [r] });
    }
  }

  // 2. Within a line, join boxes that touch, overlap, or are separated by roughly a space.
  const merged: Rect[] = [];
  for (const line of lines) {
    const sorted = [...line.members].sort((a, b) => a.left - b.left);
    let cur = sorted[0];
    for (const r of sorted.slice(1)) {
      if (r.left - cur.right <= MAX_GAP_RATIO * height(line.bounds)) cur = union(cur, r);
      else {
        merged.push(cur);
        cur = r;
      }
    }
    merged.push(cur);
  }

  // 3. Trim vertical overlap between lines that sit one above the other.
  const out = merged.map((r) => ({ ...r })).sort((a, b) => a.top - b.top || a.left - b.left);
  for (let i = 0; i < out.length; i++) {
    for (let j = i + 1; j < out.length; j++) {
      const upper = out[i];
      const lower = out[j];
      const sharesColumn = Math.min(upper.right, lower.right) > Math.max(upper.left, lower.left);
      if (sharesColumn && upper.bottom > lower.top && lower.top > upper.top) {
        const mid = (upper.bottom + lower.top) / 2;
        upper.bottom = mid;
        lower.top = mid;
      }
    }
  }
  return out;
}

/** Client-pixel rect -> fractions (0..1) of an origin box such as a page's overlay element. */
export function clientToFraction(
  r: Rect,
  origin: { left: number; top: number; width: number; height: number },
): Rect {
  return {
    left: (r.left - origin.left) / origin.width,
    top: (r.top - origin.top) / origin.height,
    right: (r.right - origin.left) / origin.width,
    bottom: (r.bottom - origin.top) / origin.height,
  };
}

/** Page-fraction rect -> PDF user space. `vp` must be a scale-1 viewport of the page. */
export function fractionToPdf(vp: ViewportLike, f: Rect): PdfRect {
  const [x1, y1] = vp.convertToPdfPoint(f.left * vp.width, f.top * vp.height);
  const [x2, y2] = vp.convertToPdfPoint(f.right * vp.width, f.bottom * vp.height);
  return [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
}

/** PDF user space -> page-fraction rect (inverse of fractionToPdf). */
export function pdfToFraction(vp: ViewportLike, r: PdfRect): Rect {
  const [ax, ay] = vp.convertToViewportPoint(r[0], r[1]);
  const [bx, by] = vp.convertToViewportPoint(r[2], r[3]);
  return {
    left: Math.min(ax, bx) / vp.width,
    top: Math.min(ay, by) / vp.height,
    right: Math.max(ax, bx) / vp.width,
    bottom: Math.max(ay, by) / vp.height,
  };
}

/** PDF user-space point -> fractions (0..1) of the page. `vp` must be a scale-1 viewport. */
export function pdfPointToFraction(vp: ViewportLike, p: [number, number]): { x: number; y: number } {
  const [x, y] = vp.convertToViewportPoint(p[0], p[1]);
  return { x: x / vp.width, y: y / vp.height };
}

/** Page fractions (0..1) -> PDF user-space point. `vp` must be a scale-1 viewport. */
export function fractionToPdfPoint(vp: ViewportLike, fx: number, fy: number): [number, number] {
  const [x, y] = vp.convertToPdfPoint(fx * vp.width, fy * vp.height);
  return [x, y];
}

/** Is (x, y) inside the box at (left, top) with the given size? Edges count as inside. */
export function pointInBox(x: number, y: number, left: number, top: number, size: number): boolean {
  return x >= left && x <= left + size && y >= top && y <= top + size;
}

/** Is the PDF-space point inside any of the rects (with `pad` PDF units of slack)? */
export function pointInPdfRects(rects: PdfRect[], x: number, y: number, pad = 1): boolean {
  return rects.some((r) => x >= r[0] - pad && x <= r[2] + pad && y >= r[1] - pad && y <= r[3] + pad);
}
