import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { resizeFractionLocked, type Handle } from '../src/annotations/boxGeometry';
import {
  fractionToPdf,
  pdfToFraction,
  type Rect,
  type ViewportLike,
} from '../src/annotations/geometry';
import { fieldAt, fieldFrames, fitInto, frameAround } from '../src/signature/placement';

const PAGE = { width: 612, height: 792 };
const vp: ViewportLike = {
  width: PAGE.width,
  height: PAGE.height,
  convertToPdfPoint: (x, y) => [x, PAGE.height - y],
  convertToViewportPoint: (x, y) => [x, PAGE.height - y],
};
const box = (left: number, top: number, right: number, bottom: number): Rect => ({
  left,
  top,
  right,
  bottom,
});
const sizePt = (r: Rect, v: ViewportLike = vp) => ({
  w: (r.right - r.left) * v.width,
  h: (r.bottom - r.top) * v.height,
});

describe('frameAround', () => {
  it('centres a signature of the given width on the point, keeping its shape', () => {
    const f = frameAround(vp, { x: 0.5, y: 0.5 }, 150, 3);
    const s = sizePt(f);
    expect(s.w).toBeCloseTo(150);
    expect(s.h).toBeCloseTo(50);
    expect((f.left + f.right) / 2).toBeCloseTo(0.5);
    expect((f.top + f.bottom) / 2).toBeCloseTo(0.5);
  });

  it('pulls the frame back onto the page near an edge, without changing its size', () => {
    const f = frameAround(vp, { x: 0.99, y: 0.01 }, 150, 3);
    expect(f.right).toBeCloseTo(1);
    expect(f.top).toBeCloseTo(0);
    expect(sizePt(f).w).toBeCloseTo(150);
  });

  it('never makes a signature bigger than the page', () => {
    const s = sizePt(frameAround(vp, { x: 0.5, y: 0.5 }, 5000, 2));
    expect(s.w).toBeLessThanOrEqual(PAGE.width * 0.9 + 1e-6);
    expect(s.w / s.h).toBeCloseTo(2);
    const tall = sizePt(frameAround(vp, { x: 0.5, y: 0.5 }, 5000, 0.1));
    expect(tall.h).toBeLessThanOrEqual(PAGE.height * 0.9 + 1e-6);
  });
});

describe('fitInto (a signature field)', () => {
  const field = box(0.2, 0.2, 0.7, 0.3); // 306 x 79.2 pt

  it('fits inside the field with room all round, keeping the shape', () => {
    const f = fitInto(field, vp, 3, 3);
    const s = sizePt(f);
    expect(s.w / s.h).toBeCloseTo(3);
    expect(f.left).toBeGreaterThanOrEqual(field.left);
    expect(f.right).toBeLessThanOrEqual(field.right);
    expect(f.top).toBeGreaterThanOrEqual(field.top);
    expect(f.bottom).toBeLessThanOrEqual(field.bottom);
  });

  it('is limited by the height of a wide, shallow field', () => {
    const s = sizePt(fitInto(field, vp, 3, 3));
    expect(s.h).toBeCloseTo(79.2 - 6, 1);
    expect(s.w).toBeCloseTo((79.2 - 6) * 3, 1);
  });

  it('is limited by the width of a tall, narrow field', () => {
    const narrow = box(0.1, 0.1, 0.2, 0.5);
    const s = sizePt(fitInto(narrow, vp, 3, 3));
    expect(s.w).toBeCloseTo(61.2 - 6, 1);
  });

  it('is centred in the field', () => {
    const f = fitInto(field, vp, 2, 3);
    expect((f.left + f.right) / 2).toBeCloseTo((field.left + field.right) / 2);
    expect((f.top + f.bottom) / 2).toBeCloseTo((field.top + field.bottom) / 2);
  });

  it('copes with a field smaller than its padding', () => {
    const tiny = box(0.5, 0.5, 0.5 + 4 / 612, 0.5 + 4 / 792);
    const s = sizePt(fitInto(tiny, vp, 3, 3));
    expect(s.w).toBeGreaterThan(0);
    expect(Number.isFinite(s.h)).toBe(true);
  });
});

describe('fieldAt', () => {
  const frames = [box(0, 0, 0.5, 0.5), box(0.2, 0.2, 0.3, 0.3), box(0.6, 0.6, 0.9, 0.9)];

  it('finds the field under a point', () => {
    expect(fieldAt(frames, { x: 0.7, y: 0.7 })).toBe(2);
    expect(fieldAt(frames, { x: 0.05, y: 0.05 })).toBe(0);
  });

  it('prefers the smallest when fields overlap', () => {
    expect(fieldAt(frames, { x: 0.25, y: 0.25 })).toBe(1);
  });

  it('counts the edges as inside, and finds nothing outside every field', () => {
    expect(fieldAt(frames, { x: 0.5, y: 0.5 })).toBe(0);
    expect(fieldAt(frames, { x: 0.55, y: 0.55 })).toBe(-1);
    expect(fieldAt([], { x: 0.1, y: 0.1 })).toBe(-1);
  });
});

describe('resizeFractionLocked', () => {
  // A 3:1 box (in points) starting at (0.3, 0.3).
  const start = box(0.3, 0.3, 0.5, 0.3 + (0.2 * PAGE.width) / 3 / PAGE.height);
  const aspectOf = (r: Rect) => sizePt(r).w / sizePt(r).h;
  const min = 0.05;
  const go = (h: Handle, dx: number, dy: number, r = start) =>
    resizeFractionLocked(r, h, dx, dy, 3, PAGE, min);
  const width = (r: Rect) => r.right - r.left;

  it('keeps the shape whichever way the pointer goes', () => {
    for (const h of ['nw', 'ne', 'se', 'sw'] as Handle[]) {
      for (const [dx, dy] of [
        [0.1, 0],
        [0, 0.1],
        [-0.05, 0.05],
        [0.08, -0.12],
      ]) {
        expect(aspectOf(go(h, dx, dy)), `${h} ${dx},${dy}`).toBeCloseTo(3, 6);
      }
    }
  });

  it('keeps the opposite corner where it was', () => {
    const se = go('se', 0.1, 0.02);
    expect(se.left).toBeCloseTo(start.left);
    expect(se.top).toBeCloseTo(start.top);
    const nw = go('nw', -0.1, -0.02);
    expect(nw.right).toBeCloseTo(start.right);
    expect(nw.bottom).toBeCloseTo(start.bottom);
    const ne = go('ne', 0.1, 0);
    expect(ne.left).toBeCloseTo(start.left);
    expect(ne.bottom).toBeCloseTo(start.bottom);
    const sw = go('sw', -0.1, 0);
    expect(sw.right).toBeCloseTo(start.right);
    expect(sw.top).toBeCloseTo(start.top);
  });

  it('gets bigger when dragged outwards and smaller when dragged inwards', () => {
    expect(width(go('se', 0.1, 0.05))).toBeGreaterThan(width(start));
    expect(width(go('se', -0.05, -0.01))).toBeLessThan(width(start));
    expect(width(go('nw', 0.05, 0.01))).toBeLessThan(width(start));
  });

  it('follows a mostly vertical drag as well as a horizontal one', () => {
    expect(width(go('se', 0, 0.2))).toBeGreaterThan(width(start) * 1.5);
  });

  it('stops at the minimum width', () => {
    const r = go('se', -5, -5);
    expect(width(r)).toBeCloseTo(min);
    expect(aspectOf(r)).toBeCloseTo(3, 6);
  });

  it('stops at the page edge in either direction, keeping the shape', () => {
    const r = go('se', 5, 0);
    expect(r.right).toBeLessThanOrEqual(1 + 1e-9);
    expect(r.bottom).toBeLessThanOrEqual(1 + 1e-9);
    expect(aspectOf(r)).toBeCloseTo(3, 6);
    const tall = go('nw', -5, -5);
    expect(tall.left).toBeGreaterThanOrEqual(-1e-9);
    expect(tall.top).toBeGreaterThanOrEqual(-1e-9);
    expect(aspectOf(tall)).toBeCloseTo(3, 6);
  });

  it('works for a tall shape on a wide page too', () => {
    const wide = { width: 1000, height: 400 };
    const s = box(0.4, 0.2, 0.5, 0.2 + (0.1 * wide.width) / 0.5 / wide.height); // 1:2 in points
    const r = resizeFractionLocked(s, 'se', 0.05, 0.05, 0.5, wide, 0.02);
    expect(((r.right - r.left) * wide.width) / ((r.bottom - r.top) * wide.height)).toBeCloseTo(
      0.5,
      6,
    );
  });
});

// The same maths must hold on rotated pages, where the displayed page is not the file's page.
describe('with real page viewports (rotated.pdf)', () => {
  const viewports: ViewportLike[] = [];
  let destroy: () => Promise<void> = async () => {};

  beforeAll(async () => {
    const data = new Uint8Array(readFileSync(join(__dirname, 'fixtures', 'rotated.pdf')));
    const task = getDocument({ data, useSystemFonts: true });
    const doc = await task.promise;
    destroy = () => task.destroy();
    for (let n = 1; n <= doc.numPages; n++) {
      viewports.push((await doc.getPage(n)).getViewport({ scale: 1 }));
    }
  });
  afterAll(() => destroy());

  it('a placed frame has the signature shape on screen and survives the trip into PDF space', () => {
    for (const v of viewports) {
      const f = frameAround(v, { x: 0.4, y: 0.6 }, 150, 3);
      const s = sizePt(f, v);
      expect(s.w / s.h).toBeCloseTo(3, 6);
      const back = pdfToFraction(v, fractionToPdf(v, f));
      for (const side of ['left', 'top', 'right', 'bottom'] as const) {
        expect(back[side]).toBeCloseTo(f[side], 8);
      }
    }
  });

  it('a field converted to the page is found at its own centre, and a signature fits in it', () => {
    for (const v of viewports) {
      const frames = fieldFrames(v, [[100, 500, 300, 560]]);
      const c = {
        x: (frames[0].left + frames[0].right) / 2,
        y: (frames[0].top + frames[0].bottom) / 2,
      };
      expect(fieldAt(frames, c)).toBe(0);
      const fit = fitInto(frames[0], v, 3, 2);
      expect(fit.left).toBeGreaterThanOrEqual(frames[0].left - 1e-9);
      expect(fit.right).toBeLessThanOrEqual(frames[0].right + 1e-9);
      expect(fit.top).toBeGreaterThanOrEqual(frames[0].top - 1e-9);
      expect(fit.bottom).toBeLessThanOrEqual(frames[0].bottom + 1e-9);
    }
  });
});
