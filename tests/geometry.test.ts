import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  clientToFraction,
  fractionToPdf,
  mergeLineRects,
  pdfToFraction,
  pointInPdfRects,
  type Rect,
  type ViewportLike,
} from '../src/annotations/geometry';
import type { PdfRect } from '../src/annotations/model';

const box = (left: number, top: number, right: number, bottom: number): Rect => ({
  left,
  top,
  right,
  bottom,
});

describe('mergeLineRects', () => {
  it('joins the spans of one line into a single rect', () => {
    const out = mergeLineRects([box(10, 10, 50, 22), box(52, 10, 90, 22), box(92, 10, 130, 22)]);
    expect(out).toEqual([box(10, 10, 130, 22)]);
  });

  it('is independent of input order', () => {
    const out = mergeLineRects([box(92, 10, 130, 22), box(10, 10, 50, 22), box(52, 10, 90, 22)]);
    expect(out).toEqual([box(10, 10, 130, 22)]);
  });

  it('keeps separate lines separate', () => {
    const out = mergeLineRects([box(10, 10, 100, 22), box(10, 30, 100, 42)]);
    expect(out).toHaveLength(2);
    expect(out[0].top).toBe(10);
    expect(out[1].top).toBe(30);
  });

  it('does not bridge a wide gap on the same line (e.g. two columns)', () => {
    const out = mergeLineRects([box(10, 10, 100, 22), box(300, 10, 400, 22)]);
    expect(out).toHaveLength(2);
  });

  it('collapses duplicate and contained boxes', () => {
    const out = mergeLineRects([box(10, 10, 100, 22), box(10, 10, 100, 22), box(20, 11, 60, 21)]);
    expect(out).toEqual([box(10, 10, 100, 22)]);
  });

  it('uses the union of slightly different heights on a line', () => {
    const out = mergeLineRects([box(10, 10, 50, 22), box(51, 8, 90, 24)]);
    expect(out).toEqual([box(10, 8, 90, 24)]);
  });

  it('trims overlap between adjacent lines at their midpoint', () => {
    const out = mergeLineRects([box(10, 10, 100, 24), box(10, 20, 100, 34)]);
    expect(out).toHaveLength(2);
    expect(out[0].bottom).toBe(out[1].top);
    expect(out[0].bottom).toBe(22);
  });

  it('drops empty boxes and handles no input', () => {
    expect(mergeLineRects([])).toEqual([]);
    expect(mergeLineRects([box(5, 5, 5, 20), box(5, 5, 20, 5)])).toEqual([]);
  });
});

describe('clientToFraction', () => {
  it('expresses a client rect as fractions of its origin box', () => {
    const f = clientToFraction(box(150, 220, 250, 270), { left: 100, top: 200, width: 400, height: 100 });
    expect(f).toEqual(box(0.125, 0.2, 0.375, 0.7));
  });
});

describe('pointInPdfRects', () => {
  const rects: PdfRect[] = [
    [10, 10, 20, 20],
    [50, 50, 60, 60],
  ];
  it('hits inside and within the padding, misses outside', () => {
    expect(pointInPdfRects(rects, 15, 15)).toBe(true);
    expect(pointInPdfRects(rects, 55, 61)).toBe(true);
    expect(pointInPdfRects(rects, 55, 63)).toBe(false);
    expect(pointInPdfRects(rects, 30, 30)).toBe(false);
  });
});

// Real PDF.js viewports for pages rotated 0/90/180/270 (tests/fixtures/rotated.pdf).
describe('PDF <-> page-fraction conversion with real viewports', () => {
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

  // A line of text near the top-left of the unrotated page, in PDF user space.
  const source: PdfRect = [72, 700, 200, 724];

  it('round-trips a rect on every rotation', () => {
    expect(viewports).toHaveLength(4);
    for (const vp of viewports) {
      const back = fractionToPdf(vp, pdfToFraction(vp, source));
      back.forEach((v, i) => expect(v).toBeCloseTo(source[i], 6));
    }
  });

  it('maps to the expected screen position without rotation', () => {
    const f = pdfToFraction(viewports[0], source);
    expect(f.left).toBeCloseTo(72 / 612, 6);
    expect(f.right).toBeCloseTo(200 / 612, 6);
    expect(f.top).toBeCloseTo((792 - 724) / 792, 6);
    expect(f.bottom).toBeCloseTo((792 - 700) / 792, 6);
  });

  it('maps to the expected screen position on a 90 degree page', () => {
    // Page is 792 wide x 612 tall once rotated; (x, y) in PDF space becomes (y, x) on screen.
    const f = pdfToFraction(viewports[1], source);
    expect(f.left).toBeCloseTo(700 / 792, 6);
    expect(f.right).toBeCloseTo(724 / 792, 6);
    expect(f.top).toBeCloseTo(72 / 612, 6);
    expect(f.bottom).toBeCloseTo(200 / 612, 6);
  });

  it('keeps every fraction inside the page for all rotations', () => {
    for (const vp of viewports) {
      const f = pdfToFraction(vp, source);
      for (const v of [f.left, f.top, f.right, f.bottom]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
      expect(f.right).toBeGreaterThan(f.left);
      expect(f.bottom).toBeGreaterThan(f.top);
    }
  });

  it('normalises corner order so the result is always x1<x2, y1<y2', () => {
    for (const vp of viewports) {
      const r = fractionToPdf(vp, { left: 0.1, top: 0.2, right: 0.4, bottom: 0.3 });
      expect(r[2]).toBeGreaterThan(r[0]);
      expect(r[3]).toBeGreaterThan(r[1]);
    }
  });
});
