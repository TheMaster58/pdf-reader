import { describe, expect, it } from 'vitest';
import { highlightAppearance, noteAppearance, quadPointsFor, unionRect } from '../src/pdf/appearance';
import { hexToRgb, n, pdfColorToHex, rgbToHex } from '../src/pdf/colors';
import { formatPdfDate, parsePdfDate } from '../src/pdf/pdfDates';

describe('colours', () => {
  it('round-trips hex and 0..1 RGB', () => {
    expect(rgbToHex(hexToRgb('#8FE388'))).toBe('#8FE388');
    expect(hexToRgb('#FF0000')).toEqual([1, 0, 0]);
  });

  it('falls back to yellow for malformed input', () => {
    expect(rgbToHex(hexToRgb('nonsense'))).toBe('#FFE74C');
  });

  it('converts gray, RGB and CMYK /C arrays', () => {
    expect(pdfColorToHex([0.5])).toBe('#808080');
    expect(pdfColorToHex([1, 1, 0])).toBe('#FFFF00');
    expect(pdfColorToHex([0, 0, 1, 0])).toBe('#FFFF00');
    expect(pdfColorToHex([0, 0, 0, 1])).toBe('#000000');
  });

  it('treats an empty or odd-length array as "no colour"', () => {
    expect(pdfColorToHex([])).toBeNull();
    expect(pdfColorToHex([1, 2])).toBeNull();
    expect(pdfColorToHex(undefined)).toBeNull();
  });

  it('clamps out-of-range components', () => {
    expect(pdfColorToHex([2, -1, 0.5])).toBe('#FF0080');
  });

  it('formats numbers compactly for content streams', () => {
    expect(n(1)).toBe('1');
    expect(n(0.5)).toBe('0.5');
    expect(n(12.34567)).toBe('12.346');
    expect(n(1e-9)).toBe('0');
    expect(n(100)).toBe('100');
  });
});

describe('PDF dates', () => {
  it('formats UTC dates', () => {
    expect(formatPdfDate('2026-11-05T18:30:00.000Z')).toBe('D:20261105183000Z');
  });

  it('parses full dates with Z and offsets', () => {
    expect(parsePdfDate('D:20261105183000Z')).toBe('2026-11-05T18:30:00.000Z');
    expect(parsePdfDate("D:20240102030405+01'00'")).toBe('2024-01-02T02:04:05.000Z');
    expect(parsePdfDate("D:20240102030405-05'30'")).toBe('2024-01-02T08:34:05.000Z');
    expect(parsePdfDate('D:20240102030405+01')).toBe('2024-01-02T02:04:05.000Z');
  });

  it('accepts partial dates and a missing D: prefix', () => {
    expect(parsePdfDate('D:2024')).toBe('2024-01-01T00:00:00.000Z');
    expect(parsePdfDate('D:202403')).toBe('2024-03-01T00:00:00.000Z');
    expect(parsePdfDate('20240315')).toBe('2024-03-15T00:00:00.000Z');
  });

  it('rejects junk', () => {
    expect(parsePdfDate('yesterday')).toBeNull();
    expect(parsePdfDate('')).toBeNull();
    expect(parsePdfDate(undefined)).toBeNull();
  });

  it('format and parse are inverses at one-second resolution', () => {
    const iso = '2025-02-28T23:59:58.000Z';
    expect(parsePdfDate(formatPdfDate(iso))).toBe(iso);
  });
});

describe('appearance streams', () => {
  it('orders quad points top-left, top-right, bottom-left, bottom-right', () => {
    expect(quadPointsFor([[10, 20, 30, 40]])).toEqual([10, 40, 30, 40, 10, 20, 30, 20]);
    expect(quadPointsFor([[0, 0, 1, 1], [2, 2, 3, 3]])).toHaveLength(16);
  });

  it('computes the union of rects', () => {
    expect(unionRect([[10, 10, 20, 20], [5, 15, 30, 18]])).toEqual([5, 10, 30, 20]);
  });

  it('draws highlight rects with the multiply graphics state', () => {
    const ap = highlightAppearance([[10, 20, 110, 32]], '#FF0000');
    expect(ap.bbox).toEqual([10, 20, 110, 32]);
    expect(ap.content).toContain('/GS gs');
    expect(ap.content).toContain('1 0 0 rg');
    expect(ap.content).toContain('10 20 100 12 re f');
  });

  it('draws a 24x24 note icon in the given colour', () => {
    const ap = noteAppearance('#00FF00');
    expect(ap.bbox).toEqual([0, 0, 24, 24]);
    expect(ap.content).toContain('0 1 0 rg');
  });
});
