import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  fractionToPdfPoint,
  pdfPointToFraction,
  pointInBox,
  type ViewportLike,
} from '../src/annotations/geometry';

describe('pointInBox', () => {
  it('includes the edges and excludes outside points', () => {
    expect(pointInBox(10, 10, 10, 10, 24)).toBe(true);
    expect(pointInBox(34, 34, 10, 10, 24)).toBe(true);
    expect(pointInBox(35, 20, 10, 10, 24)).toBe(false);
    expect(pointInBox(9, 20, 10, 10, 24)).toBe(false);
    expect(pointInBox(20, 9, 10, 10, 24)).toBe(false);
    expect(pointInBox(20, 35, 10, 10, 24)).toBe(false);
  });
});

// Sticky-note anchors go PDF -> page fraction -> PDF; this must be lossless on rotated pages too.
describe('PDF point <-> page fraction with real viewports', () => {
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

  const point: [number, number] = [150, 600];

  it('round-trips on every rotation', () => {
    expect(viewports).toHaveLength(4);
    for (const vp of viewports) {
      const f = pdfPointToFraction(vp, point);
      const back = fractionToPdfPoint(vp, f.x, f.y);
      expect(back[0]).toBeCloseTo(point[0], 6);
      expect(back[1]).toBeCloseTo(point[1], 6);
    }
  });

  it('puts the point at the expected place on an upright page', () => {
    const f = pdfPointToFraction(viewports[0], point);
    expect(f.x).toBeCloseTo(150 / 612, 6);
    expect(f.y).toBeCloseTo((792 - 600) / 792, 6);
  });

  it('rotates the position with the page (90 degrees swaps the axes)', () => {
    const f = pdfPointToFraction(viewports[1], point);
    expect(f.x).toBeCloseTo(600 / 792, 6);
    expect(f.y).toBeCloseTo(150 / 612, 6);
  });

  it('maps the page corners to the fraction corners', () => {
    for (const vp of viewports) {
      const topLeft = fractionToPdfPoint(vp, 0, 0);
      const bottomRight = fractionToPdfPoint(vp, 1, 1);
      const a = pdfPointToFraction(vp, topLeft);
      const b = pdfPointToFraction(vp, bottomRight);
      expect([a.x, a.y]).toEqual([expect.closeTo(0, 6), expect.closeTo(0, 6)]);
      expect([b.x, b.y]).toEqual([expect.closeTo(1, 6), expect.closeTo(1, 6)]);
    }
  });
});
