import { create } from 'zustand';
import type { ViewportLike } from '../annotations/geometry';
import {
  buildRuns,
  describeFont,
  type DescribedFont,
  type FontInfo,
  type RawTextItem,
  type TextRun,
} from '../pdf/textRuns';
import type { PDFDocumentProxy } from './pdfjs';

/** The editable text of one page: its lines, and the closest of our fonts for each PDF font. */
export interface PageText {
  runs: TextRun[];
  fonts: Map<string, DescribedFont>;
}

const loading = new WeakMap<PDFDocumentProxy, Map<number, Promise<PageText>>>();
const loaded = new WeakMap<PDFDocumentProxy, Map<number, PageText>>();

/** Counts finished loads, so anything showing hints can look again when text arrives. */
export const usePageTextVersion = create<{ version: number }>(() => ({ version: 0 }));

/** PDF.js's generic family string for a font, boiled down to what the font mapping understands. */
function genericFamily(family: string | undefined): string | undefined {
  if (!family) return undefined;
  if (/monospace/i.test(family)) return 'monospace';
  if (/serif/i.test(family) && !/sans/i.test(family)) return 'serif';
  return 'sans-serif';
}

/**
 * Reads a page's text and groups it into lines. `viewport` is the page's scale-1 viewport, so the
 * lines come out in the page as displayed (rotation included). Results are kept per document.
 */
export function loadPageText(
  doc: PDFDocumentProxy,
  pageIndex: number,
  viewport: Pick<ViewportLike, 'convertToViewportPoint'>,
): Promise<PageText> {
  let pages = loading.get(doc);
  if (!pages) loading.set(doc, (pages = new Map()));
  const existing = pages.get(pageIndex);
  if (existing) return existing;

  const promise = (async (): Promise<PageText> => {
    const page = await doc.getPage(pageIndex + 1);
    const content = await page.getTextContent();
    const items = content.items.filter((i) => 'str' in i) as unknown as RawTextItem[];

    // PDF.js knows whether a font is bold or italic once it has loaded it, which it has for a page
    // that has been drawn. For one that has not, the generic family from the text styles is all there is.
    const fonts = new Map<string, DescribedFont>();
    for (const [id, style] of Object.entries(content.styles ?? {})) {
      const info: FontInfo = {
        fallbackName: genericFamily((style as { fontFamily?: string }).fontFamily),
      };
      try {
        if (page.commonObjs.has(id)) {
          const f = page.commonObjs.get(id) as Partial<FontInfo> & { fallbackName?: string };
          info.name = f.name;
          info.bold = f.bold;
          info.italic = f.italic;
          info.fallbackName = f.fallbackName ?? info.fallbackName;
        }
      } catch {
        /* the font object is not available: use what the styles say */
      }
      fonts.set(id, describeFont(info));
    }

    const result: PageText = { runs: buildRuns(items, viewport), fonts };
    let done = loaded.get(doc);
    if (!done) loaded.set(doc, (done = new Map()));
    done.set(pageIndex, result);
    usePageTextVersion.setState((s) => ({ version: s.version + 1 }));
    return result;
  })();
  // A failed read is not remembered, so the next try starts again.
  promise.catch(() => pages.delete(pageIndex));
  pages.set(pageIndex, promise);
  return promise;
}

/** The page's text if it has already been read, else null (without starting to read it). */
export function peekPageText(doc: PDFDocumentProxy, pageIndex: number): PageText | null {
  return loaded.get(doc)?.get(pageIndex) ?? null;
}
