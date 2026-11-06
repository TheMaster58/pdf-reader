import type { HighlightAnnotation, PdfRect } from '../annotations/model';
import type { PDFDocumentProxy } from '../viewer/pdfjs';

/** The fields of a PDF.js text item that we use. */
export interface TextItemLike {
  str: string;
  transform: number[];
  width: number;
  height: number;
}

/** An item is "on" a rect if at least this fraction of its height lies inside the rect's band. */
const MIN_VERTICAL_OVERLAP = 0.5;

/**
 * The text under a highlight's rects, in reading order. A highlight usually starts and ends
 * part-way through a text run, so for horizontal text each run is trimmed in proportion to how much
 * of its width the rect covers (an approximation: it assumes even character widths).
 * Rotated text runs are skipped.
 */
export function textForRects(items: readonly TextItemLike[], rects: readonly PdfRect[]): string {
  const parts: string[] = [];
  for (const item of items) {
    if (!item.str.trim()) continue;
    const [a, b, c, , x, y] = item.transform;
    if (Math.abs(b) > 1e-3 || Math.abs(c) > 1e-3 || a <= 0) continue; // only upright, left-to-right text
    const h = item.height || Math.abs(item.transform[3]) || 1;
    const bottom = y - 0.25 * h;
    const top = y + 0.85 * h;
    const width = item.width;
    if (width <= 0) continue;

    for (const [rx1, ry1, rx2, ry2] of rects) {
      const overlapY = Math.min(top, ry2) - Math.max(bottom, ry1);
      if (overlapY < MIN_VERTICAL_OVERLAP * (top - bottom)) continue;
      const from = Math.max(x, rx1);
      const to = Math.min(x + width, rx2);
      if (to <= from) continue;
      const n = item.str.length;
      const i0 = Math.round(((from - x) / width) * n);
      const i1 = Math.round(((to - x) / width) * n);
      const piece = item.str.slice(i0, i1);
      if (piece.trim()) parts.push(piece);
      break; // an item belongs to at most one line of the highlight
    }
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Looks up the highlighted text of annotations that came from the file (we only know their
 * geometry), and reports each one through `onText`. Failures leave the text empty.
 */
export async function extractTextForHighlights(
  doc: PDFDocumentProxy,
  highlights: readonly HighlightAnnotation[],
  onText: (id: string, text: string) => void,
  isCancelled: () => boolean = () => false,
): Promise<void> {
  const byPage = new Map<number, HighlightAnnotation[]>();
  for (const h of highlights) {
    const list = byPage.get(h.pageIndex);
    if (list) list.push(h);
    else byPage.set(h.pageIndex, [h]);
  }
  for (const [pageIndex, list] of byPage) {
    if (isCancelled()) return;
    try {
      const page = await doc.getPage(pageIndex + 1);
      const content = await page.getTextContent();
      const items = content.items.filter((i): i is typeof i & TextItemLike => 'str' in i) as TextItemLike[];
      for (const h of list) {
        const text = textForRects(items, h.rects);
        if (text && !isCancelled()) onText(h.id, text);
      }
    } catch {
      /* a page we can't read just keeps the "(highlight)" label */
    }
  }
}
