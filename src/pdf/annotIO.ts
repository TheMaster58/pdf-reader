import {
  EncryptedPDFError,
  PDFArray,
  PDFContext,
  PDFDict,
  PDFDocument,
  PDFFont,
  PDFHexString,
  PDFImage,
  PDFName,
  PDFNumber,
  PDFObject,
  PDFPage,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFString,
  StandardFonts,
  decodePDFRawStream,
} from 'pdf-lib';
import {
  DEFAULT_HIGHLIGHT_COLOR,
  DEFAULT_TEXT_STYLE,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  type Annotation,
  type HighlightAnnotation,
  type NoteAnnotation,
  type PdfRect,
  type SignatureAnnotation,
  type SignatureArtwork,
  type SignatureVariant,
  type TextAlign,
  type TextBoxAnnotation,
  type TextFontFamily,
} from '../annotations/model';
import { findEmptySignatureFields, type SignatureField } from './signatureFields';
import { MAX_PNG_BYTES, dataUrlToPng, pngSize, pngToDataUrl } from '../signature/pngData';
import { flatToStrokes, strokesToFlat } from '../signature/strokes';
import { sanitizeText } from '../text/fontMetrics';
import { BORDER_WIDTH, displayedSize, normaliseRotation } from '../text/textLayout';
import {
  NOTE_RECT_SIZE,
  highlightAppearance,
  noteAppearance,
  quadPointsFor,
  signatureImageAppearance,
  signatureStrokeAppearance,
  textBoxAppearance,
  unionRect,
  uprightMatrix,
} from './appearance';
import { hexToRgb, n, pdfColorToHex, rgbToHex } from './colors';
import { formatPdfDate, parsePdfDate } from './pdfDates';

/** Why a document can't have its annotations edited and saved. */
export class UnsupportedPdfError extends Error {
  constructor(
    readonly reason: 'encrypted' | 'invalid',
    message: string,
  ) {
    super(message);
    this.name = 'UnsupportedPdfError';
  }
}

export interface ExtractResult {
  /** Annotations found in the file, in page order. */
  annotations: Annotation[];
  /**
   * A copy of the document with those annotations removed, for PDF.js to display (we draw them
   * ourselves as editable overlays). Null when there was nothing to remove: show the original.
   */
  viewBytes: Uint8Array | null;
  /**
   * The document already carries a digital (certificate) signature. Saving rewrites the whole file,
   * which would make that signature invalid.
   */
  signed: boolean;
  /** Empty signature fields (form boxes waiting for a signature), for clicking a signature into. */
  signatureFields: SignatureField[];
}

const N = (name: string) => PDFName.of(name);

// ---- reading helpers -------------------------------------------------------------------------

function lookupNumber(ctx: PDFContext, obj: PDFObject | undefined): number | undefined {
  const o = obj && ctx.lookup(obj);
  return o instanceof PDFNumber ? o.asNumber() : undefined;
}

/**
 * The object (following a reference) if it is of the given kind, otherwise undefined. Unlike pdf-lib's
 * lookupMaybe this never throws on an object of another kind, which matters because the files we read
 * are written by anyone, and one odd entry must not stop a document from opening.
 */
function lookupAs<T>(
  ctx: PDFContext,
  obj: PDFObject | undefined,
  type: { prototype: T },
): T | undefined {
  let o: PDFObject | undefined;
  try {
    o = obj ? ctx.lookup(obj) : undefined;
  } catch {
    return undefined;
  }
  return o instanceof (type as unknown as new () => unknown) ? (o as T) : undefined;
}

function lookupNumbers(ctx: PDFContext, obj: PDFObject | undefined): number[] | undefined {
  const arr = lookupAs(ctx, obj, PDFArray);
  if (!arr) return undefined;
  const out: number[] = [];
  for (let i = 0; i < arr.size(); i++) {
    const v = lookupNumber(ctx, arr.get(i));
    if (v === undefined) return undefined;
    out.push(v);
  }
  return out;
}

function lookupText(ctx: PDFContext, obj: PDFObject | undefined): string | undefined {
  const o = obj && ctx.lookup(obj);
  return o instanceof PDFString || o instanceof PDFHexString ? o.decodeText() : undefined;
}

function subtypeOf(ctx: PDFContext, dict: PDFDict): PDFName | undefined {
  const st = ctx.lookup(dict.get(N('Subtype')));
  return st instanceof PDFName ? st : undefined;
}

/** Rects covered by a highlight: one per QuadPoints quad, or the annotation Rect as a fallback. */
function rectsOf(ctx: PDFContext, dict: PDFDict): PdfRect[] {
  const quads = lookupNumbers(ctx, dict.get(N('QuadPoints')));
  if (quads && quads.length >= 8 && quads.length % 8 === 0) {
    const out: PdfRect[] = [];
    for (let i = 0; i < quads.length; i += 8) {
      const xs = [quads[i], quads[i + 2], quads[i + 4], quads[i + 6]];
      const ys = [quads[i + 1], quads[i + 3], quads[i + 5], quads[i + 7]];
      out.push([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
    }
    return out;
  }
  const r = lookupNumbers(ctx, dict.get(N('Rect')));
  if (r && r.length === 4) {
    return [[Math.min(r[0], r[2]), Math.min(r[1], r[3]), Math.max(r[0], r[2]), Math.max(r[1], r[3])]];
  }
  return [];
}

interface FontChoice {
  fontFamily: TextFontFamily;
  bold: boolean;
  italic: boolean;
}

/**
 * The font names in a /DA string that stand for one of the standard fonts we can reproduce: the
 * conventional AcroForm resource names and the full PostScript names. Anything else (other fonts,
 * embedded fonts, a made-up "Helv-Bold") is not ours.
 */
const DA_FONTS: Record<string, FontChoice> = {};
/** The /DA resource name we write for each font. */
const DA_RESOURCE: Record<string, string> = {};
const STANDARD_FONT: Record<string, StandardFonts> = {};

function fontKey(f: FontChoice): string {
  return `${f.fontFamily}${f.bold ? '-bold' : ''}${f.italic ? '-italic' : ''}`;
}

{
  // For each family: the four cuts in the order regular, bold, italic, bold italic.
  const families: [TextFontFamily, string[], string[], StandardFonts[]][] = [
    [
      'Helvetica',
      ['Helv', 'HeBo', 'HeOb', 'HeBO'],
      ['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique'],
      [
        StandardFonts.Helvetica,
        StandardFonts.HelveticaBold,
        StandardFonts.HelveticaOblique,
        StandardFonts.HelveticaBoldOblique,
      ],
    ],
    [
      'Times',
      ['TiRo', 'TiBo', 'TiIt', 'TiBI'],
      ['Times-Roman', 'Times-Bold', 'Times-Italic', 'Times-BoldItalic'],
      [
        StandardFonts.TimesRoman,
        StandardFonts.TimesRomanBold,
        StandardFonts.TimesRomanItalic,
        StandardFonts.TimesRomanBoldItalic,
      ],
    ],
    [
      'Courier',
      ['Cour', 'CoBo', 'CoOb', 'CoBO'],
      ['Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique'],
      [
        StandardFonts.Courier,
        StandardFonts.CourierBold,
        StandardFonts.CourierOblique,
        StandardFonts.CourierBoldOblique,
      ],
    ],
  ];
  for (const [fontFamily, short, full, standard] of families) {
    for (let i = 0; i < 4; i++) {
      const choice: FontChoice = { fontFamily, bold: (i & 1) === 1, italic: (i & 2) === 2 };
      DA_FONTS[short[i]] = choice;
      DA_FONTS[full[i]] = choice;
      DA_RESOURCE[fontKey(choice)] = short[i];
      STANDARD_FONT[fontKey(choice)] = standard[i];
    }
  }
}

/** Marks a text box as written by this app, so it is recognised even on a rotated page. */
const TEXT_BOX_MARKER = 'PDFReaderTextBox';
/** Holds what an edited-text box replaces: the original text and where it was. */
const EDIT_MARKER = 'PDFReaderEdit';
const MAX_ORIGINAL_TEXT = 10_000;

interface ParsedDefaultAppearance extends FontChoice {
  fontSize: number;
  color: string;
}

/**
 * Reads a /DA string such as `0 0 1 rg /Helv 12 Tf`. Null for anything we can't reproduce exactly:
 * other fonts (bold, italic, embedded...), automatic size, or CMYK colour.
 */
export function parseDefaultAppearance(da: string): ParsedDefaultAppearance | null {
  const font = /\/([^\s/<>[\]()]+)\s+(-?\d*\.?\d+)\s+Tf\b/.exec(da);
  if (!font) return null;
  const choice = Object.hasOwn(DA_FONTS, font[1]) ? DA_FONTS[font[1]] : undefined;
  const fontSize = Number(font[2]);
  if (!choice || !(fontSize >= MIN_FONT_SIZE) || fontSize > MAX_FONT_SIZE) return null;
  if (/\bk\b/.test(da)) return null;

  const num = '(-?\\d*\\.?\\d+)';
  const rgb = new RegExp(`${num}\\s+${num}\\s+${num}\\s+rg\\b`).exec(da);
  const gray = new RegExp(`${num}\\s+g\\b`).exec(da);
  let color = DEFAULT_TEXT_STYLE.color;
  if (rgb) color = rgbToHex([Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]);
  else if (gray) color = rgbToHex([Number(gray[1]), Number(gray[1]), Number(gray[1])]);
  return { ...choice, fontSize, color };
}

/**
 * The text-box details of a /FreeText annotation, if this app can show and save it without changing
 * how it looks; otherwise null and the annotation is left exactly as it is. Callouts (/CL), rich
 * text (/RC), replies (/IRT), rotated boxes, and fonts we can't reproduce are not ours. On a rotated
 * page only boxes this app wrote are taken over, because only those are known to be upright there.
 */
function freeTextDetails(
  ctx: PDFContext,
  dict: PDFDict,
  pageRotation: number,
): ParsedDefaultAppearance | null {
  if (dict.has(N('IRT')) || dict.has(N('CL')) || dict.has(N('RC'))) return null;
  const own = ctx.lookup(dict.get(N(TEXT_BOX_MARKER))) !== undefined;
  if (!own && normaliseRotation(pageRotation) !== 0) return null;
  const rotate = lookupNumber(ctx, dict.get(N('Rotate')));
  if (rotate !== undefined && normaliseRotation(rotate) !== 0) return null;
  const rect = lookupNumbers(ctx, dict.get(N('Rect')));
  if (!rect || rect.length !== 4) return null;
  const da = lookupText(ctx, dict.get(N('DA')));
  return da === undefined ? null : parseDefaultAppearance(da);
}

/** Marks a /Stamp as a signature written by this app and holds what it takes to edit it again. */
const SIGNATURE_MARKER = 'PDFReaderSig';

interface ParsedSignature {
  variant: SignatureVariant;
  artwork: SignatureArtwork;
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const isSize = (v: unknown): v is [number, number] =>
  Array.isArray(v) &&
  v.length === 2 &&
  v.every((x) => typeof x === 'number' && Number.isFinite(x) && x > 0 && x <= 1e5);

/**
 * Reads the signature data this app stored in a /Stamp. Null for any stamp that is not ours, or
 * whose data is missing, damaged or out of range (such a stamp is then left exactly as it is).
 */
function signatureDetails(ctx: PDFContext, dict: PDFDict): ParsedSignature | null {
  const info = lookupAs(ctx, dict.get(N(SIGNATURE_MARKER)), PDFDict);
  if (!info) return null;
  const variantName = ctx.lookup(info.get(N('Variant')));
  const variant: SignatureVariant | null =
    variantName === N('signature') ? 'signature' : variantName === N('initials') ? 'initials' : null;
  if (!variant) return null;
  const kind = ctx.lookup(info.get(N('Kind')));
  const data = info.get(N('Data'));

  if (kind === N('strokes')) {
    const json = lookupText(ctx, data);
    if (json === undefined || json.length > 400_000) return null;
    let parsed: { s?: unknown; c?: unknown; w?: unknown; b?: unknown };
    try {
      parsed = JSON.parse(json);
    } catch {
      return null;
    }
    const strokes = flatToStrokes(parsed?.s);
    const { c, w, b } = parsed ?? {};
    if (!strokes || typeof c !== 'string' || !HEX_COLOR.test(c)) return null;
    if (typeof w !== 'number' || !(w >= 0.25 && w <= 50) || !isSize(b)) return null;
    return { variant, artwork: { type: 'strokes', strokes, color: c, width: w, box: b } };
  }

  if (kind === N('image')) {
    const stream = ctx.lookup(data);
    if (!(stream instanceof PDFRawStream)) return null;
    let bytes: Uint8Array;
    try {
      bytes = decodePDFRawStream(stream).decode();
    } catch {
      return null;
    }
    const size = bytes.length <= MAX_PNG_BYTES ? pngSize(bytes) : null;
    return size ? { variant, artwork: { type: 'image', pngDataUrl: pngToDataUrl(bytes), size } } : null;
  }
  return null;
}

/** Does this annotation belong to the set the app edits (highlights, sticky notes, text boxes)? */
function isManaged(ctx: PDFContext, dict: PDFDict, pageRotation: number): boolean {
  const st = subtypeOf(ctx, dict);
  if (st === N('Stamp')) return signatureDetails(ctx, dict) !== null;
  if (st === N('Highlight')) return true;
  // A Text annotation with /IRT is a reply in someone else's comment thread: leave it alone.
  if (st === N('Text')) return !dict.has(N('IRT'));
  if (st === N('FreeText')) return freeTextDetails(ctx, dict, pageRotation) !== null;
  return false;
}

function annotationFrom(
  ctx: PDFContext,
  dict: PDFDict,
  pageIndex: number,
  usedIds: Set<string>,
  pageRotation: number,
): Annotation | null {
  const st = subtypeOf(ctx, dict);
  const contents = lookupText(ctx, dict.get(N('Contents'))) ?? '';
  const author = lookupText(ctx, dict.get(N('T'))) ?? '';
  const modified = parsePdfDate(lookupText(ctx, dict.get(N('M')))) ?? new Date().toISOString();
  const created = parsePdfDate(lookupText(ctx, dict.get(N('CreationDate')))) ?? modified;
  const color = pdfColorToHex(lookupNumbers(ctx, dict.get(N('C')))) ?? DEFAULT_HIGHLIGHT_COLOR;

  let id = lookupText(ctx, dict.get(N('NM')));
  if (!id || usedIds.has(id)) id = crypto.randomUUID();
  usedIds.add(id);

  if (st === N('Highlight')) {
    const rects = rectsOf(ctx, dict);
    if (!rects.length) return null;
    const h: HighlightAnnotation = {
      id,
      kind: 'highlight',
      pageIndex,
      rects,
      color,
      text: '',
      contents,
      author,
      created,
      modified,
    };
    return h;
  }

  if (st === N('Stamp')) {
    const details = signatureDetails(ctx, dict);
    const r = lookupNumbers(ctx, dict.get(N('Rect')));
    if (!details || !r || r.length !== 4) return null;
    const signature: SignatureAnnotation = {
      id,
      kind: 'signature',
      pageIndex,
      rect: [Math.min(r[0], r[2]), Math.min(r[1], r[3]), Math.max(r[0], r[2]), Math.max(r[1], r[3])],
      variant: details.variant,
      artwork: details.artwork,
      author,
      created,
      modified,
    };
    return signature;
  }

  if (st === N('FreeText')) {
    const details = freeTextDetails(ctx, dict, pageRotation);
    const r = lookupNumbers(ctx, dict.get(N('Rect')));
    if (!details || !r || r.length !== 4) return null;
    const q = lookupNumber(ctx, dict.get(N('Q')));
    const align: TextAlign = q === 1 ? 'center' : q === 2 ? 'right' : 'left';
    const bs = lookupAs(ctx, dict.get(N('BS')), PDFDict);
    const borderWidth = bs
      ? lookupNumber(ctx, bs.get(N('W')))
      : lookupNumbers(ctx, dict.get(N('Border')))?.[2];
    const editInfo = lookupAs(ctx, dict.get(N(EDIT_MARKER)), PDFDict);
    const originalText = lookupText(ctx, editInfo?.get(N('Text')));
    const originalRect = lookupNumbers(ctx, editInfo?.get(N('Rect')));
    const replaces =
      editInfo &&
      originalText !== undefined &&
      originalText.length <= MAX_ORIGINAL_TEXT &&
      originalRect?.length === 4
        ? {
            rect: [
              Math.min(originalRect[0], originalRect[2]),
              Math.min(originalRect[1], originalRect[3]),
              Math.max(originalRect[0], originalRect[2]),
              Math.max(originalRect[1], originalRect[3]),
            ] as PdfRect,
            text: originalText,
          }
        : undefined;
    const box: TextBoxAnnotation = {
      id,
      kind: 'textbox',
      pageIndex,
      rect: [Math.min(r[0], r[2]), Math.min(r[1], r[3]), Math.max(r[0], r[2]), Math.max(r[1], r[3])],
      contents,
      fontFamily: details.fontFamily,
      bold: details.bold,
      italic: details.italic,
      fontSize: details.fontSize,
      color: details.color,
      align,
      fill: pdfColorToHex(lookupNumbers(ctx, dict.get(N('IC')))),
      border: (borderWidth ?? 0) > 0,
      ...(replaces ? { replaces } : {}),
      author,
      created,
      modified,
    };
    return box;
  }

  if (st === N('Text')) {
    const r = lookupNumbers(ctx, dict.get(N('Rect')));
    if (!r || r.length !== 4) return null;
    const n: NoteAnnotation = {
      id,
      kind: 'note',
      pageIndex,
      // The icon hangs from the top-left corner of its rectangle.
      point: [Math.min(r[0], r[2]), Math.max(r[1], r[3])],
      color,
      contents,
      author,
      created,
      modified,
    };
    return n;
  }
  return null;
}

// ---- loading / stripping ---------------------------------------------------------------------

/**
 * Does the file declare encryption? pdf-lib often fails with a generic parse error on encrypted
 * files before it reaches its own encryption check (e.g. AES-256 with encrypted object streams), so
 * on failure we look for /Encrypt in the trailer ourselves: at the end of the file normally, and at
 * the start for linearized files.
 */
export function looksEncrypted(bytes: Uint8Array): boolean {
  const SPAN = 8192;
  const latin1 = (chunk: Uint8Array) => Array.from(chunk, (b) => String.fromCharCode(b)).join('');
  const ends = [bytes.subarray(Math.max(0, bytes.length - SPAN)), bytes.subarray(0, SPAN)];
  return ends.some((chunk) => /\/Encrypt\s*(?:\d+\s+\d+\s+R|<<)/.test(latin1(chunk)));
}

async function loadForEditing(bytes: Uint8Array): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: false });
  } catch (err) {
    if (err instanceof EncryptedPDFError || looksEncrypted(bytes)) {
      throw new UnsupportedPdfError('encrypted', 'This document is encrypted.');
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new UnsupportedPdfError('invalid', `This document's structure could not be read for editing: ${message}`);
  }
}

/**
 * Deletes the images and fonts that the appearance of an annotation *this app wrote* uses, so that
 * removing it removes everything: otherwise a deleted signature's picture would stay in the file as
 * an unreferenced object. Only for annotations known to be ours: the fonts and images of someone
 * else's annotation may be shared with the rest of the document.
 */
function deleteOwnedResources(ctx: PDFContext, dict: PDFDict): void {
  const ap = lookupAs(ctx, dict.get(N('AP')), PDFDict);
  const form = lookupAs(ctx, ap?.get(N('N')), PDFStream);
  const resources = lookupAs(ctx, form?.dict.get(N('Resources')), PDFDict);
  if (!resources) return;
  for (const kind of ['Font', 'XObject']) {
    const group = lookupAs(ctx, resources.get(N(kind)), PDFDict);
    for (const [, ref] of group?.entries() ?? []) {
      if (!(ref instanceof PDFRef)) continue;
      const target = ctx.lookup(ref);
      if (kind === 'XObject') {
        // Only pictures: a form XObject may be used by something else.
        const stream = target instanceof PDFStream ? target : undefined;
        if (stream?.dict.get(N('Subtype')) !== N('Image')) continue;
        const mask = stream.dict.get(N('SMask'));
        if (mask instanceof PDFRef) ctx.delete(mask);
      }
      ctx.delete(ref);
    }
  }
}

/** Refs of the appearance streams an annotation points at (/AP /N, possibly a dict of states). */
function appearanceRefs(ctx: PDFContext, dict: PDFDict): PDFRef[] {
  const ap = lookupAs(ctx, dict.get(N('AP')), PDFDict);
  const normal = ap?.get(N('N'));
  if (!normal) return [];
  if (normal instanceof PDFRef) {
    // /N may be a stream, or a dict mapping states to streams.
    const target = ctx.lookup(normal);
    if (target instanceof PDFDict) {
      return target.entries().flatMap(([, v]) => (v instanceof PDFRef ? [v] : []));
    }
    return [normal];
  }
  if (normal instanceof PDFDict) {
    return normal.entries().flatMap(([, v]) => (v instanceof PDFRef ? [v] : []));
  }
  return [];
}

/**
 * Removes every managed annotation (highlights, sticky notes) and their popups from the document
 * and deletes the objects themselves, so a deleted highlight's data doesn't linger in the file.
 * Returns what was removed, converted to app annotations.
 */
function stripManaged(doc: PDFDocument): Annotation[] {
  const ctx = doc.context;
  const found: Annotation[] = [];
  const usedIds = new Set<string>();
  const pages = doc.getPages();

  type Entry = { obj: PDFObject; dict: PDFDict | undefined };
  const perPage: { page: PDFPage; rotation: number; entries: Entry[] }[] = pages.map((page) => {
    const annots = page.node.Annots();
    const entries: Entry[] = [];
    if (annots) {
      for (let i = 0; i < annots.size(); i++) {
        const obj = annots.get(i);
        entries.push({ obj, dict: lookupAs(ctx, obj, PDFDict) });
      }
    }
    return { page, rotation: page.getRotation().angle, entries };
  });

  // Annotations that others reply to (/IRT) are part of a comment thread. We recreate annotations
  // under new object numbers when saving, which would leave the replies pointing at nothing, so
  // anything with replies stays exactly as the file has it.
  const replyTargets = new Set<PDFRef>();
  for (const { entries } of perPage) {
    for (const { dict } of entries) {
      const irt = dict?.get(N('IRT'));
      if (irt instanceof PDFRef) replyTargets.add(irt);
    }
  }

  // Appearance streams still used by annotations we keep must not be deleted.
  const keptAppearances = new Set<PDFRef>();
  for (const { entries, rotation } of perPage) {
    for (const { dict } of entries) {
      if (dict && !isManaged(ctx, dict, rotation)) {
        appearanceRefs(ctx, dict).forEach((r) => keptAppearances.add(r));
      }
    }
    for (const { obj, dict } of entries) {
      if (dict && obj instanceof PDFRef && replyTargets.has(obj)) {
        appearanceRefs(ctx, dict).forEach((r) => keptAppearances.add(r));
      }
    }
  }

  perPage.forEach(({ page, rotation, entries }, pageIndex) => {
    const keep: PDFObject[] = [];
    let removedAny = false;
    for (const { obj, dict } of entries) {
      const inThread = obj instanceof PDFRef && replyTargets.has(obj);
      const ann =
        dict && !inThread && isManaged(ctx, dict, rotation)
          ? annotationFrom(ctx, dict, pageIndex, usedIds, rotation)
          : null;
      if (!dict || !ann) {
        // Not ours, unreadable, or the target of replies: leave it exactly as it is.
        keep.push(obj);
        continue;
      }
      found.push(ann);
      removedAny = true;

      const popup = dict.get(N('Popup'));
      if (popup instanceof PDFRef) ctx.delete(popup);
      // A signature's picture data is a stream of its own.
      const signatureData = lookupAs(ctx, dict.get(N(SIGNATURE_MARKER)), PDFDict)?.get(N('Data'));
      if (signatureData instanceof PDFRef) ctx.delete(signatureData);
      // And what the appearance of one of our own annotations uses (pictures, fonts) goes too.
      if (ann.kind === 'signature' || (ann.kind === 'textbox' && dict.has(N(TEXT_BOX_MARKER)))) {
        deleteOwnedResources(ctx, dict);
      }
      appearanceRefs(ctx, dict).forEach((r) => {
        if (!keptAppearances.has(r)) ctx.delete(r);
      });
      if (obj instanceof PDFRef) ctx.delete(obj);
    }
    if (!removedAny) return;
    // Drop entries that now point at deleted objects (the popups of removed annotations).
    const remaining = keep.filter((obj) => !(obj instanceof PDFRef) || ctx.lookup(obj) !== undefined);
    if (remaining.length) page.node.set(N('Annots'), ctx.obj(remaining));
    else page.node.delete(N('Annots'));
  });

  return found;
}

/**
 * Reads the highlights and sticky notes out of a PDF. If there are any, also produces a copy of the
 * document without them for display. Throws UnsupportedPdfError for encrypted or unreadable files.
 */
export async function extractAnnotations(bytes: Uint8Array): Promise<ExtractResult> {
  const doc = await loadForEditing(bytes);
  // Look before stripping: removing annotations must not hide a signature that was there.
  const signed = hasDigitalSignature(doc);
  const signatureFields = findEmptySignatureFields(doc);
  const annotations = stripManaged(doc);
  const viewBytes = annotations.length > 0 ? await doc.save() : null;
  return { annotations, viewBytes, signed, signatureFields };
}

/**
 * Does the document carry a certificate signature? Either the form says signatures exist
 * (/SigFlags bit 1, set by signing software), or some object is a signature value: a dictionary
 * with a /ByteRange (the part of the file it covers) and the signature in /Contents.
 */
export function hasDigitalSignature(doc: PDFDocument): boolean {
  const ctx = doc.context;
  const acroForm = lookupAs(ctx, doc.catalog.get(N('AcroForm')), PDFDict);
  const flags = lookupNumber(ctx, acroForm?.get(N('SigFlags')));
  if (flags !== undefined && (flags & 1) !== 0) return true;
  for (const [, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict)) continue;
    const byteRange = obj.get(N('ByteRange'));
    if (byteRange instanceof PDFArray && byteRange.size() >= 4 && obj.has(N('Contents'))) return true;
  }
  return false;
}

// ---- writing ---------------------------------------------------------------------------------

function text(value: string): PDFHexString {
  return PDFHexString.fromText(value);
}

function addForm(ctx: PDFContext, bbox: PdfRect, content: string, blend: boolean): PDFRef {
  const resources = blend
    ? { ExtGState: { GS: { Type: 'ExtGState', BM: 'Multiply', CA: 1, ca: 1 } } }
    : {};
  const stream = ctx.flateStream(content, {
    Type: 'XObject',
    Subtype: 'Form',
    FormType: 1,
    BBox: bbox,
    Resources: resources,
  });
  return ctx.register(stream);
}

function popupFor(ctx: PDFContext, parent: PDFRef, rect: PdfRect): PDFRef {
  return ctx.register(
    ctx.obj({ Type: 'Annot', Subtype: 'Popup', Rect: rect, Parent: parent, Open: false, F: 28 }),
  );
}

function commonEntries(ann: HighlightAnnotation | NoteAnnotation) {
  return {
    Type: 'Annot',
    C: hexToRgb(ann.color).map((v) => Math.round(v * 1000) / 1000),
    Contents: text(ann.contents),
    T: text(ann.author),
    M: PDFString.of(formatPdfDate(ann.modified)),
    CreationDate: PDFString.of(formatPdfDate(ann.created)),
    NM: text(ann.id),
  };
}

function addHighlight(ctx: PDFContext, page: PDFPage, ann: HighlightAnnotation): void {
  if (!ann.rects.length) return;
  const rect = unionRect(ann.rects);
  const ap = highlightAppearance(ann.rects, ann.color);
  const apRef = addForm(ctx, ap.bbox, ap.content, true);
  const dict = ctx.obj({
    ...commonEntries(ann),
    Subtype: 'Highlight',
    Rect: rect,
    QuadPoints: quadPointsFor(ann.rects),
    F: 4,
    CA: 1,
    AP: { N: apRef },
  });
  const ref = ctx.register(dict);
  if (ann.contents.trim()) {
    const popup = popupFor(ctx, ref, [rect[2] + 6, rect[3] - 90, rect[2] + 206, rect[3]]);
    (dict as PDFDict).set(N('Popup'), popup);
    page.node.addAnnot(ref);
    page.node.addAnnot(popup);
  } else {
    page.node.addAnnot(ref);
  }
}

function addNote(ctx: PDFContext, page: PDFPage, ann: NoteAnnotation): void {
  const [x, y] = ann.point;
  const rect: PdfRect = [x, y - NOTE_RECT_SIZE, x + NOTE_RECT_SIZE, y];
  const ap = noteAppearance(ann.color);
  const apRef = addForm(ctx, ap.bbox, ap.content, false);
  const dict = ctx.obj({
    ...commonEntries(ann),
    Subtype: 'Text',
    Name: 'Comment',
    Rect: rect,
    // Print + NoZoom + NoRotate: the icon keeps its size and stays upright, anchored top-left.
    F: 28,
    Open: false,
    AP: { N: apRef },
  });
  const ref = ctx.register(dict);
  if (ann.contents.trim()) {
    const popup = popupFor(ctx, ref, [x + NOTE_RECT_SIZE + 4, y - 100, x + NOTE_RECT_SIZE + 204, y]);
    (dict as PDFDict).set(N('Popup'), popup);
    page.node.addAnnot(ref);
    page.node.addAnnot(popup);
  } else {
    page.node.addAnnot(ref);
  }
}

function addTextBox(
  doc: PDFDocument,
  page: PDFPage,
  ann: TextBoxAnnotation,
  fonts: Map<string, PDFFont>,
): void {
  const ctx = doc.context;
  const rotation = normaliseRotation(page.getRotation().angle);
  const size = displayedSize(ann.rect, rotation);

  const key = fontKey(ann);
  let font = fonts.get(key);
  if (!font) {
    font = doc.embedStandardFont(STANDARD_FONT[key]);
    fonts.set(key, font);
  }
  const embedded = font;
  const resource = DA_RESOURCE[key];
  const saved: TextBoxAnnotation = { ...ann, contents: sanitizeText(ann.contents) };
  const ap = textBoxAppearance(saved, size, resource, (line) => embedded.encodeText(line).toString());
  const matrix = uprightMatrix(rotation);
  const apRef = ctx.register(
    ctx.flateStream(ap.content, {
      Type: 'XObject',
      Subtype: 'Form',
      FormType: 1,
      BBox: ap.bbox,
      ...(matrix ? { Matrix: matrix } : {}),
      Resources: { Font: { [resource]: embedded.ref } },
    }),
  );

  const [tr, tg, tb] = hexToRgb(ann.color);
  const da = `/${resource} ${n(ann.fontSize)} Tf ${n(tr)} ${n(tg)} ${n(tb)} rg`;
  const ref = ctx.register(
    ctx.obj({
      Type: 'Annot',
      Subtype: 'FreeText',
      Rect: ann.rect,
      Contents: text(saved.contents),
      T: text(ann.author),
      M: PDFString.of(formatPdfDate(ann.modified)),
      CreationDate: PDFString.of(formatPdfDate(ann.created)),
      NM: text(ann.id),
      F: 4,
      DA: PDFString.of(da),
      Q: ann.align === 'center' ? 1 : ann.align === 'right' ? 2 : 0,
      IT: 'FreeTextTypeWriter',
      BS: { W: ann.border ? BORDER_WIDTH : 0, S: 'S' },
      ...(ann.fill ? { IC: hexToRgb(ann.fill).map((v) => Math.round(v * 1000) / 1000) } : {}),
      [TEXT_BOX_MARKER]: true,
      ...(ann.replaces
        ? {
            [EDIT_MARKER]: {
              Text: PDFHexString.fromText(ann.replaces.text.slice(0, MAX_ORIGINAL_TEXT)),
              Rect: ann.replaces.rect,
            },
          }
        : {}),
      AP: { N: apRef },
    }),
  );
  page.node.addAnnot(ref);
}

async function addSignature(
  doc: PDFDocument,
  page: PDFPage,
  ann: SignatureAnnotation,
  images: Map<string, PDFImage>,
): Promise<void> {
  const ctx = doc.context;
  const rotation = normaliseRotation(page.getRotation().angle);
  const size = displayedSize(ann.rect, rotation);
  const art = ann.artwork;

  let ap: { bbox: PdfRect; content: string };
  let resources: Record<string, PDFObject | string | number | boolean | Record<string, PDFObject>> = {};
  let info: Record<string, PDFObject | string>;
  if (art.type === 'strokes') {
    ap = signatureStrokeAppearance(art, size);
    // Only digits, brackets, commas, quotes and a hex colour: nothing that needs escaping in a PDF string.
    const json = JSON.stringify({ s: strokesToFlat(art.strokes), c: art.color, w: art.width, b: art.box });
    info = { Variant: ann.variant, Kind: 'strokes', Data: PDFString.of(json) };
  } else {
    const bytes = dataUrlToPng(art.pngDataUrl);
    if (!bytes) return; // not a usable picture: write nothing rather than a broken stamp
    let image = images.get(art.pngDataUrl);
    if (!image) {
      image = await doc.embedPng(bytes);
      images.set(art.pngDataUrl, image);
    }
    ap = signatureImageAppearance(size, 'Sig');
    resources = { XObject: { Sig: image.ref } };
    info = { Variant: ann.variant, Kind: 'image', Data: ctx.register(ctx.stream(bytes, {})) };
  }

  const matrix = uprightMatrix(rotation);
  const apRef = ctx.register(
    ctx.flateStream(ap.content, {
      Type: 'XObject',
      Subtype: 'Form',
      FormType: 1,
      BBox: ap.bbox,
      ...(matrix ? { Matrix: matrix } : {}),
      Resources: resources,
    }),
  );
  const ref = ctx.register(
    ctx.obj({
      Type: 'Annot',
      Subtype: 'Stamp',
      Rect: ann.rect,
      Name: 'PDFReaderSignature',
      T: text(ann.author),
      M: PDFString.of(formatPdfDate(ann.modified)),
      CreationDate: PDFString.of(formatPdfDate(ann.created)),
      NM: text(ann.id),
      F: 4,
      [SIGNATURE_MARKER]: info,
      AP: { N: apRef },
    }),
  );
  page.node.addAnnot(ref);
}

/**
 * Produces the bytes to save: the original document, minus the annotations the app manages, plus
 * the given set. Always starts from the original so repeated saves never pile up duplicates.
 */
export async function writeAnnotations(original: Uint8Array, annotations: Annotation[]): Promise<Uint8Array> {
  const doc = await loadForEditing(original);
  stripManaged(doc);
  const ctx = doc.context;
  const pages = doc.getPages();
  const fonts = new Map<string, PDFFont>();
  const images = new Map<string, PDFImage>();
  for (const ann of annotations) {
    const page = pages[ann.pageIndex];
    if (!page) continue;
    if (ann.kind === 'highlight') addHighlight(ctx, page, ann);
    else if (ann.kind === 'textbox') addTextBox(doc, page, ann, fonts);
    else if (ann.kind === 'signature') await addSignature(doc, page, ann, images);
    else addNote(ctx, page, ann);
  }
  doc.setModificationDate(new Date());
  return doc.save();
}
