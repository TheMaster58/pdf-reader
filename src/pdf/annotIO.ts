import {
  EncryptedPDFError,
  PDFArray,
  PDFContext,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFObject,
  PDFPage,
  PDFRef,
  PDFString,
} from 'pdf-lib';
import {
  DEFAULT_HIGHLIGHT_COLOR,
  type Annotation,
  type HighlightAnnotation,
  type NoteAnnotation,
  type PdfRect,
} from '../annotations/model';
import {
  NOTE_RECT_SIZE,
  highlightAppearance,
  noteAppearance,
  quadPointsFor,
  unionRect,
} from './appearance';
import { hexToRgb, pdfColorToHex } from './colors';
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
}

const N = (name: string) => PDFName.of(name);

// ---- reading helpers -------------------------------------------------------------------------

function lookupNumber(ctx: PDFContext, obj: PDFObject | undefined): number | undefined {
  const o = obj && ctx.lookup(obj);
  return o instanceof PDFNumber ? o.asNumber() : undefined;
}

function lookupNumbers(ctx: PDFContext, obj: PDFObject | undefined): number[] | undefined {
  const arr = obj && ctx.lookupMaybe(obj, PDFArray);
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

/** Does this annotation belong to the set the app edits (highlights and sticky notes)? */
function isManaged(ctx: PDFContext, dict: PDFDict): boolean {
  const st = subtypeOf(ctx, dict);
  if (st === N('Highlight')) return true;
  // A Text annotation with /IRT is a reply in someone else's comment thread: leave it alone.
  if (st === N('Text')) return !dict.has(N('IRT'));
  return false;
}

function annotationFrom(
  ctx: PDFContext,
  dict: PDFDict,
  pageIndex: number,
  usedIds: Set<string>,
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

/** Refs of the appearance streams an annotation points at (/AP /N, possibly a dict of states). */
function appearanceRefs(ctx: PDFContext, dict: PDFDict): PDFRef[] {
  const ap = ctx.lookupMaybe(dict.get(N('AP')), PDFDict);
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
  const perPage: { page: PDFPage; entries: Entry[] }[] = pages.map((page) => {
    const annots = page.node.Annots();
    const entries: Entry[] = [];
    if (annots) {
      for (let i = 0; i < annots.size(); i++) {
        const obj = annots.get(i);
        entries.push({ obj, dict: ctx.lookupMaybe(obj, PDFDict) });
      }
    }
    return { page, entries };
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
  for (const { entries } of perPage) {
    for (const { dict } of entries) {
      if (dict && !isManaged(ctx, dict)) appearanceRefs(ctx, dict).forEach((r) => keptAppearances.add(r));
    }
    for (const { obj, dict } of entries) {
      if (dict && obj instanceof PDFRef && replyTargets.has(obj)) {
        appearanceRefs(ctx, dict).forEach((r) => keptAppearances.add(r));
      }
    }
  }

  perPage.forEach(({ page, entries }, pageIndex) => {
    const keep: PDFObject[] = [];
    let removedAny = false;
    for (const { obj, dict } of entries) {
      const inThread = obj instanceof PDFRef && replyTargets.has(obj);
      const ann = dict && !inThread && isManaged(ctx, dict) ? annotationFrom(ctx, dict, pageIndex, usedIds) : null;
      if (!dict || !ann) {
        // Not ours, unreadable, or the target of replies: leave it exactly as it is.
        keep.push(obj);
        continue;
      }
      found.push(ann);
      removedAny = true;

      const popup = dict.get(N('Popup'));
      if (popup instanceof PDFRef) ctx.delete(popup);
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
  const annotations = stripManaged(doc);
  const viewBytes = annotations.length > 0 ? await doc.save() : null;
  return { annotations, viewBytes };
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

function commonEntries(ann: Annotation) {
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

/**
 * Produces the bytes to save: the original document, minus the annotations the app manages, plus
 * the given set. Always starts from the original so repeated saves never pile up duplicates.
 */
export async function writeAnnotations(original: Uint8Array, annotations: Annotation[]): Promise<Uint8Array> {
  const doc = await loadForEditing(original);
  stripManaged(doc);
  const ctx = doc.context;
  const pages = doc.getPages();
  for (const ann of annotations) {
    const page = pages[ann.pageIndex];
    if (!page) continue;
    if (ann.kind === 'highlight') addHighlight(ctx, page, ann);
    else addNote(ctx, page, ann);
  }
  doc.setModificationDate(new Date());
  return doc.save();
}
