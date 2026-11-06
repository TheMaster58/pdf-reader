import { moveFraction } from '../annotations/boxGeometry';
import { pdfToFraction, type Rect, type ViewportLike } from '../annotations/geometry';
import type { PdfRect } from '../annotations/model';

/**
 * Where a signature goes when it is placed. Everything is in *page fractions* (0 to 1 across the
 * page as displayed), so it behaves the same at every zoom and on rotated pages. `aspect` is the
 * signature's width divided by its height.
 */

/** The frame of a signature of the given width (points) centred on `at`, kept inside the page. */
export function frameAround(
  vp: ViewportLike,
  at: { x: number; y: number },
  widthPt: number,
  aspect: number,
): Rect {
  // Never bigger than most of the page, whatever the default or the zoom.
  const w = Math.min(widthPt, vp.width * 0.9, vp.height * 0.9 * aspect);
  const h = w / aspect;
  const wf = w / vp.width;
  const hf = h / vp.height;
  return moveFraction(
    { left: at.x - wf / 2, top: at.y - hf / 2, right: at.x + wf / 2, bottom: at.y + hf / 2 },
    0,
    0,
  );
}

/**
 * The biggest frame of the signature's shape that fits inside `field`, with `padPt` points of room
 * all round, centred in it.
 */
export function fitInto(field: Rect, vp: ViewportLike, aspect: number, padPt = 3): Rect {
  const availW = Math.max(1, (field.right - field.left) * vp.width - 2 * padPt);
  const availH = Math.max(1, (field.bottom - field.top) * vp.height - 2 * padPt);
  const w = Math.min(availW, availH * aspect);
  const h = w / aspect;
  const cx = (field.left + field.right) / 2;
  const cy = (field.top + field.bottom) / 2;
  const wf = w / vp.width;
  const hf = h / vp.height;
  return { left: cx - wf / 2, top: cy - hf / 2, right: cx + wf / 2, bottom: cy + hf / 2 };
}

/** The fields of one page as page fractions. */
export function fieldFrames(vp: ViewportLike, rects: readonly PdfRect[]): Rect[] {
  return rects.map((r) => pdfToFraction(vp, r));
}

/** The index of the smallest field containing the point, or -1. */
export function fieldAt(frames: readonly Rect[], at: { x: number; y: number }): number {
  let best = -1;
  let bestArea = Infinity;
  frames.forEach((f, i) => {
    if (at.x < f.left || at.x > f.right || at.y < f.top || at.y > f.bottom) return;
    const area = (f.right - f.left) * (f.bottom - f.top);
    if (area < bestArea) {
      best = i;
      bestArea = area;
    }
  });
  return best;
}
