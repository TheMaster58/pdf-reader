import { fractionToPdf, pdfToFraction, type Rect, type ViewportLike } from './geometry';
import type { PdfRect } from './model';

/**
 * Moving, resizing and growing text boxes. Everything works on rectangles in *page fractions* (0 to
 * 1 across the page as it is displayed), so it behaves the same at every zoom level and on rotated
 * pages; `growRectToHeight` converts to and from PDF space.
 */

export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** The rect moved by (dx, dy), kept inside the page. */
export function moveFraction(r: Rect, dx: number, dy: number): Rect {
  const w = r.right - r.left;
  const h = r.bottom - r.top;
  const left = clamp(r.left + dx, 0, Math.max(0, 1 - w));
  const top = clamp(r.top + dy, 0, Math.max(0, 1 - h));
  return { left, top, right: left + w, bottom: top + h };
}

/**
 * The rect with the sides touched by `handle` dragged by (dx, dy): 'e' moves the right side, 'nw'
 * the top and left, and so on. It never gets smaller than `min` or leaves the page.
 */
export function resizeFraction(
  r: Rect,
  handle: Handle,
  dx: number,
  dy: number,
  min: { width: number; height: number },
): Rect {
  let { left, top, right, bottom } = r;
  if (handle.includes('w')) left = clamp(left + dx, 0, right - min.width);
  if (handle.includes('e')) right = clamp(right + dx, left + min.width, 1);
  if (handle.includes('n')) top = clamp(top + dy, 0, bottom - min.height);
  if (handle.includes('s')) bottom = clamp(bottom + dy, top + min.height, 1);
  return { left, top, right, bottom };
}

/** The rect spanned by two corner points, with its sides in order and inside the page. */
export function rectFromPoints(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  return {
    left: clamp(Math.min(a.x, b.x), 0, 1),
    top: clamp(Math.min(a.y, b.y), 0, 1),
    right: clamp(Math.max(a.x, b.x), 0, 1),
    bottom: clamp(Math.max(a.y, b.y), 0, 1),
  };
}

/** A rect with its top-left at (x, y), the given size, and moved back inside the page if needed. */
export function rectAt(x: number, y: number, width: number, height: number): Rect {
  return moveFraction({ left: x, top: y, right: x + width, bottom: y + height }, 0, 0);
}

/**
 * Makes a box tall enough for `neededPt` points of displayed height. It grows downwards; if that
 * would run off the bottom of the page it moves up instead. A box that is already tall enough
 * comes back unchanged (same object contents).
 */
export function growRectToHeight(vp: ViewportLike, rect: PdfRect, neededPt: number): PdfRect {
  const f = pdfToFraction(vp, rect);
  const needed = neededPt / vp.height;
  if (f.bottom - f.top >= needed - 1e-9) return rect;
  let { top, bottom } = f;
  bottom = top + needed;
  if (bottom > 1) {
    bottom = 1;
    top = Math.max(0, 1 - needed);
  }
  return fractionToPdf(vp, { ...f, top, bottom });
}

/**
 * Makes a box at least `neededPt` points wide (as displayed), growing to the right. It stops at the
 * edge of the page rather than leaving it. A box that is wide enough comes back unchanged.
 */
export function widenRectToFit(vp: ViewportLike, rect: PdfRect, neededPt: number): PdfRect {
  const f = pdfToFraction(vp, rect);
  const needed = neededPt / vp.width;
  if (f.right - f.left >= needed - 1e-9) return rect;
  return fractionToPdf(vp, { ...f, right: Math.min(1, f.left + needed) });
}

/** The four corner handles: the only ones a shape-locked box (a signature) has. */
export const CORNER_HANDLES: readonly Handle[] = ['nw', 'ne', 'se', 'sw'];

/**
 * Resizes by a corner while keeping the box's shape. The opposite corner stays put. The box follows
 * whichever of the two pointer movements asks for the bigger change, never gets narrower than
 * `minWidth` and never leaves the page.
 *
 * `shape` is width divided by height *as displayed* (in points), and `page` is the displayed page
 * size in points: page fractions are not square, so the shape has to be converted.
 */
export function resizeFractionLocked(
  r: Rect,
  handle: Handle,
  dx: number,
  dy: number,
  shape: number,
  page: { width: number; height: number },
  minWidth: number,
): Rect {
  const east = handle.includes('e');
  const south = handle.includes('s');
  const startW = r.right - r.left;
  // Fraction of page width that a given fraction of page height stands for, at this shape.
  const widthPerHeight = (shape * page.height) / page.width;

  const fromX = startW + (east ? dx : -dx);
  const fromY = (r.bottom - r.top + (south ? dy : -dy)) * widthPerHeight;
  // Follow the bigger change (in proportion to the start size).
  const wanted = Math.abs(fromX - startW) >= Math.abs(fromY - startW) ? fromX : fromY;

  const anchorX = east ? r.left : r.right;
  const anchorY = south ? r.top : r.bottom;
  const roomX = east ? 1 - anchorX : anchorX;
  const roomY = (south ? 1 - anchorY : anchorY) * widthPerHeight;
  const width = Math.max(minWidth, Math.min(wanted, roomX, roomY));
  const height = width / widthPerHeight;

  return {
    left: east ? anchorX : anchorX - width,
    right: east ? anchorX + width : anchorX,
    top: south ? anchorY : anchorY - height,
    bottom: south ? anchorY + height : anchorY,
  };
}

/** Moves a box by (dxPt, dyPt) points of *displayed* distance (right and down are positive). */
export function nudgeRect(vp: ViewportLike, rect: PdfRect, dxPt: number, dyPt: number): PdfRect {
  const f = moveFraction(pdfToFraction(vp, rect), dxPt / vp.width, dyPt / vp.height);
  return fractionToPdf(vp, f);
}
