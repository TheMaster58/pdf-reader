import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { textForRects, type TextItemLike } from '../src/pdf/textExtract';

// 12 pt text starting at x = 100: "Hello world" is 11 characters spread over 110 units.
const item = (str: string, x: number, y: number, width: number): TextItemLike => ({
  str,
  transform: [12, 0, 0, 12, x, y],
  width,
  height: 12,
});

describe('textForRects', () => {
  const line = item('Hello world', 100, 700, 110);

  it('returns a whole run when the rect covers it', () => {
    expect(textForRects([line], [[90, 698, 220, 712]])).toBe('Hello world');
  });

  it('trims a run in proportion to the covered width', () => {
    // Covers x 100..155 = first half -> first 5.5 chars of 11 -> "Hello " / "Hello" after trim.
    expect(textForRects([line], [[100, 698, 155, 712]])).toBe('Hello');
    expect(textForRects([line], [[155, 698, 210, 712]])).toBe('world');
  });

  it('ignores runs on other lines', () => {
    const other = item('Elsewhere', 100, 600, 90);
    expect(textForRects([line, other], [[90, 698, 220, 712]])).toBe('Hello world');
  });

  it('keeps reading order across lines and joins with single spaces', () => {
    const l1 = item('first line', 100, 700, 100);
    const l2 = item('second line', 100, 685, 110);
    const rects: [number, number, number, number][] = [
      [90, 698, 220, 712],
      [90, 683, 220, 697],
    ];
    expect(textForRects([l1, l2], rects)).toBe('first line second line');
  });

  it('skips empty and whitespace-only runs', () => {
    expect(textForRects([item('   ', 100, 700, 30), line], [[90, 698, 220, 712]])).toBe('Hello world');
  });

  it('skips rotated text and zero-width items', () => {
    const rotated: TextItemLike = { str: 'sideways', transform: [0, 12, -12, 0, 100, 700], width: 80, height: 12 };
    expect(textForRects([rotated], [[0, 0, 600, 800]])).toBe('');
    expect(textForRects([item('x', 100, 700, 0)], [[0, 0, 600, 800]])).toBe('');
  });

  it('ignores a rect that only grazes a line', () => {
    expect(textForRects([line], [[90, 711, 220, 730]])).toBe('');
  });

  it('returns nothing when there are no rects', () => {
    expect(textForRects([line], [])).toBe('');
  });
});

describe('textForRects on a real page', () => {
  it('finds the words under the highlighted line of the sample fixture', async () => {
    const data = new Uint8Array(readFileSync(join(__dirname, 'fixtures', 'sample.pdf')));
    const task = getDocument({ data, useSystemFonts: true });
    const doc = await task.promise;
    try {
      const content = await (await doc.getPage(1)).getTextContent();
      const items = content.items.filter((i) => 'str' in i) as unknown as TextItemLike[];
      // The first body line is drawn at y = 680, 12 pt, from x = 72.
      expect(textForRects(items, [[71, 677, 330, 692]])).toBe('The quick brown fox jumps over the lazy dog.');
      // Two lines.
      expect(
        textForRects(items, [
          [71, 677, 330, 692],
          [71, 657, 330, 672],
        ]),
      ).toBe('The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs.');
    } finally {
      await task.destroy();
    }
  });
});
