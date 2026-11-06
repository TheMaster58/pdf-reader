import { describe, expect, it } from 'vitest';
import {
  MAX_PAGE_PIXELS,
  dpiFor,
  isPrintQuality,
  orientationOf,
  printScale,
} from '../src/print/printLayout';

// US Letter and A4 in PDF points.
const LETTER = [612, 792] as const;
const A4 = [595.28, 841.89] as const;

describe('printScale', () => {
  it('is dpi / 72 for ordinary pages', () => {
    expect(printScale(...LETTER, 72)).toBeCloseTo(1);
    expect(printScale(...LETTER, 200)).toBeCloseTo(200 / 72);
    expect(printScale(...A4, 300)).toBeCloseTo(300 / 72);
  });

  it('keeps a Letter page at 300 dpi at full resolution (about 8.4 megapixels)', () => {
    const s = printScale(...LETTER, 300);
    expect(612 * s * 792 * s).toBeLessThan(MAX_PAGE_PIXELS);
    expect(s).toBeCloseTo(300 / 72);
  });

  it('shrinks very large pages so the bitmap stays within the pixel budget', () => {
    // A0 poster: 2384 x 3370 pt.
    const s = printScale(2384, 3370, 300);
    expect(s).toBeLessThan(300 / 72);
    expect(2384 * s * 3370 * s).toBeLessThanOrEqual(MAX_PAGE_PIXELS * 1.001);
  });

  it('never makes a side longer than the browser allows', () => {
    // A very long, thin page passes the pixel test but not the side limit.
    const s = printScale(100, 14000, 300);
    expect(14000 * s).toBeLessThanOrEqual(16384 + 0.001);
  });

  it('falls back to 1 for unusable sizes', () => {
    expect(printScale(0, 792, 200)).toBe(1);
    expect(printScale(612, -1, 200)).toBe(1);
    expect(printScale(612, 792, 0)).toBe(1);
    expect(printScale(NaN, 792, 200)).toBe(1);
  });
});

describe('orientationOf', () => {
  it('is landscape only when wider than tall', () => {
    expect(orientationOf(792, 612)).toBe('landscape');
    expect(orientationOf(612, 792)).toBe('portrait');
    expect(orientationOf(500, 500)).toBe('portrait');
  });
});

describe('quality', () => {
  it('maps names to dpi', () => {
    expect(dpiFor('draft')).toBe(150);
    expect(dpiFor('standard')).toBe(200);
    expect(dpiFor('high')).toBe(300);
  });

  it('recognises valid names only', () => {
    expect(isPrintQuality('high')).toBe(true);
    expect(isPrintQuality('ultra')).toBe(false);
    expect(isPrintQuality(null)).toBe(false);
  });
});
