import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { orientationOf, printScale, type PageOrientation } from './printLayout';

export interface RenderedPage {
  blob: Blob;
  orientation: PageOrientation;
}

export class PrintCancelledError extends Error {
  constructor() {
    super('Printing was cancelled');
    this.name = 'PrintCancelledError';
  }
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Could not encode the page image'))),
      'image/png',
    );
  });
}

/**
 * Draws one page at `dpi` into a PNG. Uses the "print" rendering intent, so annotations are drawn
 * only if they are marked printable (as other readers do), and the page gets a white background.
 */
export async function renderPageImage(
  page: PDFPageProxy,
  dpi: number,
  signal?: AbortSignal,
): Promise<RenderedPage> {
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: printScale(base.width, base.height, dpi) });

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(viewport.width));
  canvas.height = Math.max(1, Math.ceil(viewport.height));

  const task = page.render({ canvas, viewport, intent: 'print', background: '#ffffff' });
  const onAbort = () => task.cancel();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    await task.promise;
    return { blob: await toBlob(canvas), orientation: orientationOf(base.width, base.height) };
  } catch (err) {
    if (signal?.aborted) throw new PrintCancelledError();
    throw err;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    // Release the bitmap right away: the PNG is all we keep.
    canvas.width = 0;
    canvas.height = 0;
    page.cleanup();
  }
}

/**
 * Renders the given 1-based pages one after another (so only one bitmap exists at a time).
 * Rejects with PrintCancelledError if `signal` aborts.
 */
export async function renderPages(
  doc: PDFDocumentProxy,
  pageNumbers: readonly number[],
  opts: { dpi: number; signal?: AbortSignal; onProgress?: (done: number, total: number) => void },
): Promise<RenderedPage[]> {
  const out: RenderedPage[] = [];
  opts.onProgress?.(0, pageNumbers.length);
  for (const n of pageNumbers) {
    if (opts.signal?.aborted) throw new PrintCancelledError();
    out.push(await renderPageImage(await doc.getPage(n), opts.dpi, opts.signal));
    opts.onProgress?.(out.length, pageNumbers.length);
  }
  return out;
}
