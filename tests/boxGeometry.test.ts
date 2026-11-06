import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  growRectToHeight,
  moveFraction,
  nudgeRect,
  rectAt,
  rectFromPoints,
  resizeFraction,
  type Handle,
} from '../src/annotations/boxGeometry';
import { pdfToFraction, type Rect, type ViewportLike } from '../src/annotations/geometry';
import type { PdfRect } from '../src/annotations/model';

const box = (left: number, top: number, right: number, bottom: number): Rect => ({
  left,
  top,
  right,
  bottom,
});
const MIN = { width: 0.1, height: 0.05 };

describe('moveFraction', () => {
  it('moves by the given distance', () => {
    const r = moveFraction(box(0.2, 0.2, 0.4, 0.3), 0.1, 0.05);
    expect(r.left).toBeCloseTo(0.3);
    expect(r.top).toBeCloseTo(0.25);
    expect(r.right - r.left).toBeCloseTo(0.2);
    expect(r.bottom - r.top).toBeCloseTo(0.1);
  });

  it('keeps the whole box on the page and its size unchanged', () => {
    const r = moveFraction(box(0.7, 0.8, 0.9, 0.9), 0.5, 0.5);
    expect(r.right).toBeCloseTo(1);
    expect(r.bottom).toBeCloseTo(1);
    expect(r.right - r.left).toBeCloseTo(0.2);
    const s = moveFraction(box(0.1, 0.1, 0.3, 0.2), -0.5, -0.5);
    expect(s.left).toBe(0);
    expect(s.top).toBe(0);
  });

  it('does not misbehave for a box as big as the page', () => {
    expect(moveFraction(box(0, 0, 1, 1), 0.3, 0.3)).toEqual(box(0, 0, 1, 1));
  });
});

describe('resizeFraction', () => {
  const start = box(0.3, 0.3, 0.6, 0.5);

  it.each<[Handle, number, number, Rect]>([
    ['e', 0.1, 0.1, box(0.3, 0.3, 0.7, 0.5)],
    ['w', 0.1, 0.1, box(0.4, 0.3, 0.6, 0.5)],
    ['s', 0.1, 0.1, box(0.3, 0.3, 0.6, 0.6)],
    ['n', 0.1, 0.1, box(0.3, 0.4, 0.6, 0.5)],
    ['se', 0.1, 0.1, box(0.3, 0.3, 0.7, 0.6)],
    ['nw', 0.1, 0.1, box(0.4, 0.4, 0.6, 0.5)],
    ['ne', 0.1, 0.1, box(0.3, 0.4, 0.7, 0.5)],
    ['sw', 0.1, 0.1, box(0.4, 0.3, 0.6, 0.6)],
  ])('%s handle moves only its own sides', (handle, dx, dy, expected) => {
    const r = resizeFraction(start, handle, dx, dy, MIN);
    for (const side of ['left', 'top', 'right', 'bottom'] as const) {
      expect(r[side]).toBeCloseTo(expected[side]);
    }
  });

  it('stops at the minimum size instead of flipping over', () => {
    const r = resizeFraction(start, 'e', -0.9, 0, MIN);
    expect(r.right - r.left).toBeCloseTo(MIN.width);
    expect(r.left).toBeCloseTo(0.3);
    const t = resizeFraction(start, 'n', 0, 0.9, MIN);
    expect(t.bottom - t.top).toBeCloseTo(MIN.height);
    expect(t.bottom).toBeCloseTo(0.5);
  });

  it('stays inside the page', () => {
    const r = resizeFraction(start, 'se', 0.9, 0.9, MIN);
    expect(r.right).toBe(1);
    expect(r.bottom).toBe(1);
    const s = resizeFraction(start, 'nw', -0.9, -0.9, MIN);
    expect(s.left).toBe(0);
    expect(s.top).toBe(0);
  });
});

describe('rectFromPoints / rectAt', () => {
  it('orders the corners whichever way the user dragged', () => {
    expect(rectFromPoints({ x: 0.5, y: 0.6 }, { x: 0.2, y: 0.3 })).toEqual(box(0.2, 0.3, 0.5, 0.6));
  });

  it('clamps drags that leave the page', () => {
    expect(rectFromPoints({ x: -0.2, y: 0.5 }, { x: 1.4, y: 2 })).toEqual(box(0, 0.5, 1, 1));
  });

  it('places a box at a point and pulls it back onto the page', () => {
    const r = rectAt(0.9, 0.95, 0.3, 0.1);
    expect(r.right).toBeCloseTo(1);
    expect(r.bottom).toBeCloseTo(1);
    expect(r.right - r.left).toBeCloseTo(0.3);
  });
});

// The conversions to and from PDF space must hold on rotated pages as well.
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

  const rect: PdfRect = [100, 500, 300, 540];

  it('the fixture covers several rotations', () => {
    expect(new Set(viewports.map((v) => v.rotation)).size).toBeGreaterThan(1);
  });

  it('growing makes the box exactly tall enough on screen, top edge fixed', () => {
    for (const vp of viewports) {
      const before = pdfToFraction(vp, rect);
      // On a page rotated by 90 or 270 this rect is displayed 200pt tall, so ask for more than its height here.
      const target = (before.bottom - before.top) * vp.height + 80;
      const grown = growRectToHeight(vp, rect, target);
      const after = pdfToFraction(vp, grown);
      expect((after.bottom - after.top) * vp.height).toBeCloseTo(target, 3);
      expect(after.top).toBeCloseTo(before.top, 6);
      expect(after.left).toBeCloseTo(before.left, 6);
      expect(after.right).toBeCloseTo(before.right, 6);
    }
  });

  it('leaves a box that is already tall enough untouched', () => {
    for (const vp of viewports) {
      const f = pdfToFraction(vp, rect);
      const current = (f.bottom - f.top) * vp.height;
      expect(growRectToHeight(vp, rect, current - 5)).toBe(rect);
      expect(growRectToHeight(vp, rect, current)).toBe(rect);
    }
  });

  it('moves up instead of running off the bottom of the page', () => {
    for (const vp of viewports) {
      const f = pdfToFraction(vp, rect);
      const nearBottom = nudgeRect(vp, rect, 0, (1 - f.bottom) * vp.height); // flush with the bottom
      const target = (f.bottom - f.top) * vp.height + 60;
      const grown = growRectToHeight(vp, nearBottom, target);
      const after = pdfToFraction(vp, grown);
      expect(after.bottom).toBeLessThanOrEqual(1 + 1e-9);
      expect((after.bottom - after.top) * vp.height).toBeCloseTo(target, 3);
    }
  });

  it('nudges by displayed points in the displayed direction, whatever the page rotation', () => {
    for (const vp of viewports) {
      const before = pdfToFraction(vp, rect);
      const moved = pdfToFraction(vp, nudgeRect(vp, rect, 10, 0));
      expect((moved.left - before.left) * vp.width).toBeCloseTo(10, 3);
      expect(moved.top).toBeCloseTo(before.top, 6);
      const down = pdfToFraction(vp, nudgeRect(vp, rect, 0, 7));
      expect((down.top - before.top) * vp.height).toBeCloseTo(7, 3);
      expect(down.left).toBeCloseTo(before.left, 6);
    }
  });
});
