import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFString, StandardFonts } from 'pdf-lib';
import {
  createTextBox,
  type TextBoxAnnotation,
  type TextFontFamily,
} from '../src/annotations/model';
import { extractAnnotations, parseDefaultAppearance, writeAnnotations } from '../src/pdf/annotIO';
import { glyphWidth, textWidth } from '../src/text/fontMetrics';
import { wrapText } from '../src/text/textLayout';

const A = 'A'.codePointAt(0)!;

describe('bold and italic metrics', () => {
  it('knows the standard widths of each cut', () => {
    expect(glyphWidth('Helvetica', A)).toBe(667);
    expect(glyphWidth('Helvetica', A, { bold: true })).toBe(722);
    expect(glyphWidth('Helvetica', A, { italic: true })).toBe(667); // oblique has the regular widths
    expect(glyphWidth('Helvetica', A, { bold: true, italic: true })).toBe(722);
    expect(glyphWidth('Times', A, { bold: true })).toBe(722);
    expect(glyphWidth('Times', 'i'.codePointAt(0)!, { italic: true })).toBe(278);
    expect(glyphWidth('Courier', 'W'.codePointAt(0)!, { bold: true })).toBe(600);
  });

  it('adds up to what pdf-lib measures for the same cut, without kerning', async () => {
    const doc = await PDFDocument.create();
    const sample = 'The quick brown fox, jumps over 12 lazy dogs! AV To Wa (“quotes”, €5)';
    const cases: [TextFontFamily, { bold?: boolean; italic?: boolean }, StandardFonts][] = [
      ['Helvetica', { bold: true }, StandardFonts.HelveticaBold],
      ['Helvetica', { italic: true }, StandardFonts.HelveticaOblique],
      ['Helvetica', { bold: true, italic: true }, StandardFonts.HelveticaBoldOblique],
      ['Times', { bold: true }, StandardFonts.TimesRomanBold],
      ['Times', { italic: true }, StandardFonts.TimesRomanItalic],
      ['Times', { bold: true, italic: true }, StandardFonts.TimesRomanBoldItalic],
      ['Courier', { bold: true }, StandardFonts.CourierBold],
    ];
    for (const [family, variant, std] of cases) {
      const font = doc.embedStandardFont(std);
      const unkerned = [...sample].reduce((sum, ch) => sum + font.widthOfTextAtSize(ch, 1000), 0);
      expect(
        textWidth(family, 1000, sample, variant),
        `${family} ${JSON.stringify(variant)}`,
      ).toBeCloseTo(unkerned, 6);
    }
  });

  it('wraps bold text sooner than regular, because its letters are wider', () => {
    const text = 'WWW AAA WWW AAA WWW AAA';
    const regular = wrapText({ contents: text, fontFamily: 'Helvetica', fontSize: 12 }, 120);
    const bold = wrapText(
      { contents: text, fontFamily: 'Helvetica', fontSize: 12, bold: true },
      120,
    );
    expect(bold.length).toBeGreaterThanOrEqual(regular.length);
    expect(bold.join(' ')).toBe(text);
  });
});

describe('bold and italic in the saved file', () => {
  const box = (over: Partial<TextBoxAnnotation>): TextBoxAnnotation => ({
    ...createTextBox({ pageIndex: 0, rect: [100, 600, 300, 640], contents: 'Styled text' }),
    ...over,
  });

  async function blank() {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    return doc.save();
  }

  it('round-trips all twelve combinations of family, bold and italic', async () => {
    for (const fontFamily of ['Helvetica', 'Times', 'Courier'] as TextFontFamily[]) {
      for (const bold of [false, true]) {
        for (const italic of [false, true]) {
          const bytes = await writeAnnotations(await blank(), [box({ fontFamily, bold, italic })]);
          const back = (await extractAnnotations(bytes)).annotations[0] as TextBoxAnnotation;
          expect(back, `${fontFamily} ${bold} ${italic}`).toMatchObject({
            fontFamily,
            bold,
            italic,
          });
        }
      }
    }
  });

  it('uses the conventional resource name for each cut and the matching standard font', async () => {
    const bytes = await writeAnnotations(await blank(), [
      box({ bold: true }),
      box({ fontFamily: 'Times', italic: true }),
      box({ fontFamily: 'Courier', bold: true, italic: true }),
    ]);
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    const das: string[] = [];
    const baseFonts: string[] = [];
    for (const [, obj] of doc.context.enumerateIndirectObjects()) {
      if (!('get' in obj)) continue;
      const d = obj as import('pdf-lib').PDFDict;
      const da = d.get(PDFName.of('DA'));
      if (da instanceof PDFString) das.push(da.decodeText());
      const base = d.get(PDFName.of('BaseFont'));
      if (base instanceof PDFName) baseFonts.push(base.decodeText());
    }
    expect(das.map((d) => d.split(' ')[0]).sort()).toEqual(['/CoBO', '/HeBo', '/TiIt']);
    expect(baseFonts).toEqual(
      expect.arrayContaining(['Helvetica-Bold', 'Times-Italic', 'Courier-BoldOblique']),
    );
  });
});

describe('parseDefaultAppearance and the style names', () => {
  it('reads the standard resource names and full names for every cut', () => {
    expect(parseDefaultAppearance('/HeBo 12 Tf')).toMatchObject({
      fontFamily: 'Helvetica',
      bold: true,
      italic: false,
    });
    expect(parseDefaultAppearance('/HeOb 12 Tf')).toMatchObject({
      fontFamily: 'Helvetica',
      bold: false,
      italic: true,
    });
    expect(parseDefaultAppearance('/HeBO 12 Tf')).toMatchObject({
      fontFamily: 'Helvetica',
      bold: true,
      italic: true,
    });
    expect(parseDefaultAppearance('/TiBI 12 Tf')).toMatchObject({
      fontFamily: 'Times',
      bold: true,
      italic: true,
    });
    expect(parseDefaultAppearance('/Times-Italic 12 Tf')).toMatchObject({
      fontFamily: 'Times',
      italic: true,
    });
    expect(parseDefaultAppearance('/Courier-Bold 9 Tf')).toMatchObject({
      fontFamily: 'Courier',
      bold: true,
    });
    expect(parseDefaultAppearance('/Helv 12 Tf')).toMatchObject({ bold: false, italic: false });
  });

  it('still refuses made-up and non-standard names', () => {
    for (const da of [
      '/Helv-Bold 12 Tf',
      '/Arial-BoldMT 12 Tf',
      '/TimesNewRoman 12 Tf',
      '/F1 12 Tf',
    ]) {
      expect(parseDefaultAppearance(da), da).toBeNull();
    }
  });

  it('does not treat object prototype names as fonts', () => {
    for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
      expect(parseDefaultAppearance(`/${name} 12 Tf`), name).toBeNull();
    }
  });
});
