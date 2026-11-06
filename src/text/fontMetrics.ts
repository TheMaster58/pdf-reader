import { Encodings, Font, FontNames } from '@pdf-lib/standard-fonts';
import type { TextFontFamily } from '../annotations/model';

/** Which cut of a font: regular, bold, italic (oblique for sans and mono) or both. */
export interface FontVariant {
  bold?: boolean;
  italic?: boolean;
}

/** [regular, bold, italic, bold italic] for each family. */
const FONT_NAMES: Record<TextFontFamily, [FontNames, FontNames, FontNames, FontNames]> = {
  Helvetica: [
    FontNames.Helvetica,
    FontNames.HelveticaBold,
    FontNames.HelveticaOblique,
    FontNames.HelveticaBoldOblique,
  ],
  Times: [
    FontNames.TimesRoman,
    FontNames.TimesRomanBold,
    FontNames.TimesRomanItalic,
    FontNames.TimesRomanBoldItalic,
  ],
  Courier: [
    FontNames.Courier,
    FontNames.CourierBold,
    FontNames.CourierOblique,
    FontNames.CourierBoldOblique,
  ],
};

const loaded = new Map<FontNames, Font>();

function fontFor(family: TextFontFamily, variant: FontVariant = {}): Font {
  const name = FONT_NAMES[family][(variant.bold ? 1 : 0) + (variant.italic ? 2 : 0)];
  let font = loaded.get(name);
  if (!font) {
    font = Font.load(name);
    loaded.set(name, font);
  }
  return font;
}

/** Can this character be written with the standard fonts (the WinAnsi / Windows-1252 set)? */
export function canEncode(codePoint: number): boolean {
  return Encodings.WinAnsi.canEncodeUnicodeCodePoint(codePoint);
}

/**
 * The text as it will be saved: line breaks normalised to "\n", tabs turned into spaces, and every
 * character the standard fonts cannot show replaced by "?".
 */
export function sanitizeText(text: string): string {
  let out = '';
  for (const ch of text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ')) {
    const cp = ch.codePointAt(0)!;
    out += ch === '\n' || canEncode(cp) ? ch : '?';
  }
  return out;
}

/** Does the text contain characters that will be replaced when saved? */
export function hasUnsupportedCharacters(text: string): boolean {
  return sanitizeText(text) !== text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ');
}

/** Width of one character in thousandths of the font size. */
export function glyphWidth(
  family: TextFontFamily,
  codePoint: number,
  variant?: FontVariant,
): number {
  const cp = canEncode(codePoint) ? codePoint : 0x3f; // '?'
  const { name } = Encodings.WinAnsi.encodeUnicodeCodePoint(cp);
  return fontFor(family, variant).getWidthOfGlyph(name) ?? 250;
}

/**
 * Width of a single line in points. Characters just add up: PDF viewers draw `Tj` text without
 * kerning, so applying kern pairs here would measure narrower than what is drawn.
 */
export function textWidth(
  family: TextFontFamily,
  size: number,
  text: string,
  variant?: FontVariant,
): number {
  let units = 0;
  for (const ch of text) units += glyphWidth(family, ch.codePointAt(0)!, variant);
  return (units * size) / 1000;
}
