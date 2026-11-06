import { PDFArray, PDFContext, PDFDict, PDFName, PDFNumber, PDFObject, PDFDocument } from 'pdf-lib';
import type { PdfRect } from '../annotations/model';

/** An empty signature field in a form: a box on a page that is waiting for a signature. */
export interface SignatureField {
  pageIndex: number;
  rect: PdfRect;
}

const N = (name: string) => PDFName.of(name);
/** Fields smaller than this (points) are invisible or placeholders: nobody can click them. */
const MIN_SIDE = 8;
/** Annotation flags: Hidden (bit 2) and NoView (bit 6). */
const HIDDEN = 2;
const NO_VIEW = 32;
const MAX_PARENT_DEPTH = 16;

function lookup(ctx: PDFContext, obj: PDFObject | undefined): PDFObject | undefined {
  try {
    return obj ? ctx.lookup(obj) : undefined;
  } catch {
    return undefined;
  }
}

/** An entry of a field, looking it up the chain of /Parent fields if the field itself lacks it. */
function inherited(ctx: PDFContext, dict: PDFDict, key: PDFName): PDFObject | undefined {
  let current: PDFDict | undefined = dict;
  for (let depth = 0; current && depth < MAX_PARENT_DEPTH; depth++) {
    const value = current.get(key);
    if (value !== undefined) return lookup(ctx, value);
    const parent = lookup(ctx, current.get(N('Parent')));
    current = parent instanceof PDFDict ? parent : undefined;
  }
  return undefined;
}

/**
 * Finds the signature fields that are still empty (no /V value, so not signed yet) and big enough
 * to click, in page order. Fields that are hidden are skipped.
 */
export function findEmptySignatureFields(doc: PDFDocument): SignatureField[] {
  const ctx = doc.context;
  const out: SignatureField[] = [];
  doc.getPages().forEach((page, pageIndex) => {
    const annots = page.node.Annots();
    for (let i = 0; i < (annots?.size() ?? 0); i++) {
      const dict = lookup(ctx, annots!.get(i));
      if (!(dict instanceof PDFDict) || lookup(ctx, dict.get(N('Subtype'))) !== N('Widget'))
        continue;
      if (inherited(ctx, dict, N('FT')) !== N('Sig')) continue;
      if (inherited(ctx, dict, N('V')) !== undefined) continue; // already signed

      const flags = lookup(ctx, dict.get(N('F')));
      if (flags instanceof PDFNumber && (flags.asNumber() & (HIDDEN | NO_VIEW)) !== 0) continue;

      const r = lookup(ctx, dict.get(N('Rect')));
      if (!(r instanceof PDFArray) || r.size() !== 4) continue;
      const nums = [0, 1, 2, 3].map((k) => lookup(ctx, r.get(k)));
      if (!nums.every((v): v is PDFNumber => v instanceof PDFNumber)) continue;
      const [a, b, c, d] = nums.map((v) => v.asNumber());
      const rect: PdfRect = [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)];
      if (rect[2] - rect[0] < MIN_SIDE || rect[3] - rect[1] < MIN_SIDE) continue;
      out.push({ pageIndex, rect });
    }
  });
  return out;
}
