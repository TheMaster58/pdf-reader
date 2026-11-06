import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import type { TextFontFamily } from '../src/annotations/model';
import {
  canEncode,
  glyphWidth,
  hasUnsupportedCharacters,
  sanitizeText,
  textWidth,
} from '../src/text/fontMetrics';
import {
  LINE_HEIGHT,
  TEXT_PADDING,
  displayedSize,
  heightForLines,
  layoutLines,
  lineOffset,
  neededHeight,
  normaliseRotation,
  wrapText,
  type TextSpec,
} from '../src/text/textLayout';

const spec = (
  contents: string,
  fontFamily: TextFontFamily = 'Helvetica',
  fontSize = 12,
): TextSpec => ({
  contents,
  fontFamily,
  fontSize,
});

describe('font metrics', () => {
  it('knows the standard widths (Helvetica A = 667, space = 278; Courier is 600 everywhere)', () => {
    expect(glyphWidth('Helvetica', 'A'.codePointAt(0)!)).toBe(667);
    expect(glyphWidth('Helvetica', 32)).toBe(278);
    expect(glyphWidth('Courier', 'i'.codePointAt(0)!)).toBe(600);
    expect(glyphWidth('Courier', 'W'.codePointAt(0)!)).toBe(600);
    expect(glyphWidth('Times', 'A'.codePointAt(0)!)).toBe(722);
  });

  it('scales with the font size', () => {
    expect(textWidth('Courier', 10, 'abcd')).toBeCloseTo(24);
    expect(textWidth('Courier', 20, 'abcd')).toBeCloseTo(48);
  });

  // The wrapping is only right if it agrees with what pdf-lib (and so the saved file) measures.
  it('adds up to the same width pdf-lib measures, without kerning', async () => {
    const doc = await PDFDocument.create();
    const fonts: [TextFontFamily, StandardFonts][] = [
      ['Helvetica', StandardFonts.Helvetica],
      ['Times', StandardFonts.TimesRoman],
      ['Courier', StandardFonts.Courier],
    ];
    const sample = 'The quick brown fox, jumps over 12 lazy dogs! AV To Wa (“quotes”, €5, café)';
    for (const [family, std] of fonts) {
      const font = doc.embedStandardFont(std);
      // pdf-lib applies kerning pairs; ours must not, so compare against the unkerned sum of pdf-lib's glyph widths.
      const unkerned = [...sample].reduce((sum, ch) => sum + font.widthOfTextAtSize(ch, 1000), 0);
      expect(textWidth(family, 1000, sample)).toBeCloseTo(unkerned, 6);
    }
  });

  it('counts a character it cannot encode as a question mark', () => {
    expect(glyphWidth('Helvetica', 0x4e2d)).toBe(glyphWidth('Helvetica', 0x3f));
  });

  it('sanitises text to what can be saved', () => {
    expect(sanitizeText('a\r\nb\rc')).toBe('a\nb\nc');
    expect(sanitizeText('tab\there')).toBe('tab    here');
    expect(sanitizeText('café “q” €')).toBe('café “q” €');
    expect(sanitizeText('日本語')).toBe('???');
    expect(sanitizeText('😀')).toBe('?'); // one question mark per character, not per UTF-16 unit
    expect(canEncode(0x41)).toBe(true);
    expect(canEncode(0x4e2d)).toBe(false);
  });

  it('reports unsupported characters but not ordinary line breaks or tabs', () => {
    expect(hasUnsupportedCharacters('hello\nworld\t!')).toBe(false);
    expect(hasUnsupportedCharacters('hello 日本')).toBe(true);
  });
});

describe('wrapText', () => {
  const FONT = 'Courier'; // every character is 0.6 em, so widths are easy to reason about
  const mono = (text: string, chars: number) => wrapText(spec(text, FONT, 10), chars * 6);

  it('keeps short text on one line', () => {
    expect(mono('hello world', 20)).toEqual(['hello world']);
  });

  it('breaks at spaces', () => {
    expect(mono('aaa bbb ccc', 7)).toEqual(['aaa bbb', 'ccc']);
    expect(mono('aaa bbb ccc', 3)).toEqual(['aaa', 'bbb', 'ccc']);
  });

  it('fits exactly at the limit', () => {
    expect(mono('abc def', 7)).toEqual(['abc def']);
    expect(mono('abc def', 6.9)).toEqual(['abc', 'def']);
  });

  it('drops the spaces that were the break, but keeps spaces inside a line', () => {
    expect(mono('aaa    bbb', 5)).toEqual(['aaa', 'bbb']);
    expect(mono('a  b  c', 20)).toEqual(['a  b  c']);
  });

  it('keeps leading spaces at the start of a paragraph', () => {
    expect(mono('   indented', 20)).toEqual(['   indented']);
  });

  it('splits a word longer than a line between characters', () => {
    expect(mono('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
    expect(mono('hi abcdefghij', 4)).toEqual(['hi', 'abcd', 'efgh', 'ij']);
  });

  it('keeps explicit line breaks, including blank lines', () => {
    expect(mono('one\n\ntwo', 20)).toEqual(['one', '', 'two']);
    expect(mono('one\r\ntwo', 20)).toEqual(['one', 'two']);
    expect(mono('', 20)).toEqual(['']);
    expect(mono('\n', 20)).toEqual(['', '']);
  });

  it('wraps each paragraph on its own', () => {
    expect(mono('aaa bbb\nccc ddd', 7)).toEqual(['aaa bbb', 'ccc ddd']);
    expect(mono('aaa bbb\nccc ddd', 3)).toEqual(['aaa', 'bbb', 'ccc', 'ddd']);
  });

  it('copes with a width of zero or less (a box dragged very thin)', () => {
    expect(mono('ab', 0)).toEqual(['a', 'b']);
    expect(wrapText(spec('ab', FONT, 10), -10)).toEqual(['a', 'b']);
  });

  it('never produces a line wider than the limit unless one character alone is wider', () => {
    const text =
      'The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs! Supercalifragilisticexpialidocious';
    for (const family of ['Helvetica', 'Times', 'Courier'] as const) {
      for (const limit of [30, 60, 100, 200]) {
        for (const line of wrapText(spec(text, family, 12), limit)) {
          expect(textWidth(family, 12, line)).toBeLessThanOrEqual(limit + 1e-9);
        }
      }
    }
  });

  it('loses no characters other than the spaces at breaks', () => {
    const text = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda';
    const lines = wrapText(spec(text, 'Helvetica', 12), 90);
    expect(lines.join(' ')).toBe(text);
  });

  it('wraps the way it is saved: unsupported characters count as "?"', () => {
    expect(mono('日本', 20)).toEqual(['??']);
  });
});

describe('box sizes', () => {
  it('subtracts the padding from the width available to text', () => {
    // 'aaaa' is 24pt wide in 10pt Courier; a 28pt box has 24pt for text.
    expect(layoutLines(spec('aaaa', 'Courier', 10), 2 * TEXT_PADDING + 24)).toEqual(['aaaa']);
    expect(layoutLines(spec('aaaa', 'Courier', 10), 2 * TEXT_PADDING + 23.9)).toEqual(['aaa', 'a']);
  });

  it('is as tall as its lines plus padding, and always at least one line', () => {
    expect(heightForLines(10, 1)).toBeCloseTo(2 * TEXT_PADDING + LINE_HEIGHT * 10);
    expect(heightForLines(10, 3)).toBeCloseTo(2 * TEXT_PADDING + 3 * LINE_HEIGHT * 10);
    expect(heightForLines(10, 0)).toBeCloseTo(heightForLines(10, 1));
  });

  it('needs more height as the box gets narrower', () => {
    const s = spec('one two three four five six', 'Helvetica', 12);
    expect(neededHeight(s, 400)).toBeLessThan(neededHeight(s, 80));
  });

  it('swaps width and height on a page rotated by 90 or 270', () => {
    const rect: [number, number, number, number] = [100, 100, 300, 150];
    expect(displayedSize(rect, 0)).toEqual({ width: 200, height: 50 });
    expect(displayedSize(rect, 180)).toEqual({ width: 200, height: 50 });
    expect(displayedSize(rect, 90)).toEqual({ width: 50, height: 200 });
    expect(displayedSize(rect, 270)).toEqual({ width: 50, height: 200 });
    expect(displayedSize(rect, -90)).toEqual({ width: 50, height: 200 });
  });

  it('normalises rotations', () => {
    expect(normaliseRotation(0)).toBe(0);
    expect(normaliseRotation(360)).toBe(0);
    expect(normaliseRotation(450)).toBe(90);
    expect(normaliseRotation(-90)).toBe(270);
    expect(normaliseRotation(-180)).toBe(180);
  });

  it('places lines by alignment', () => {
    const s = spec('abcd', 'Courier', 10); // 24pt wide
    expect(lineOffset(s, 'abcd', 'left', 100)).toBe(TEXT_PADDING);
    expect(lineOffset(s, 'abcd', 'center', 100)).toBeCloseTo(38);
    expect(lineOffset(s, 'abcd', 'right', 100)).toBeCloseTo(100 - TEXT_PADDING - 24);
  });
});
