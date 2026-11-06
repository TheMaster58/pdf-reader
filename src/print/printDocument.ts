import { getBaseline } from '../annotations/persist';
import { useAnnotations } from '../annotations/store';
import { writeAnnotationsAsync } from '../pdf/annotClient';
import { getController } from '../viewer/actions';
import { loadPdf, type PDFDocumentProxy } from '../viewer/pdfjs';
import { useApp } from '../viewer/store';
import { dpiFor, type PrintQuality } from './printLayout';
import { PrintCancelledError, renderPages } from './renderPages';
import { clearPrintPages, usePrint } from './printStore';

export interface PrintRequest {
  /** 1-based page numbers, in the order they should print. */
  pages: number[];
  /** Print the highlights and notes (including unsaved ones) along with the page. */
  includeAnnotations: boolean;
  quality: PrintQuality;
}

let running: AbortController | null = null;

/** Shows the print dialog for the open document. */
export function openPrintDialog(): void {
  if (useApp.getState().status !== 'ready' || !getController()?.pdfDocument) return;
  usePrint.setState({ dialogOpen: true, error: null });
}

export function closePrintDialog(): void {
  if (usePrint.getState().busy) return;
  usePrint.setState({ dialogOpen: false, error: null });
}

/** Stops rendering pages for a print job in progress. */
export function cancelPrint(): void {
  running?.abort();
}

/**
 * The document to render. For a normal file this is the bytes a save would produce right now, so
 * unsaved highlights and notes print too (nothing is written to disk). Files that can't be
 * rewritten (encrypted, unreadable by pdf-lib) print as they are open in the viewer.
 */
async function openSource(
  includeAnnotations: boolean,
): Promise<{ doc: PDFDocumentProxy; owned: boolean }> {
  const baseline = getBaseline();
  if (baseline) {
    const annotations = includeAnnotations ? useAnnotations.getState().annotations : [];
    const bytes = await writeAnnotationsAsync(baseline.slice(), annotations);
    const doc = await loadPdf(bytes, { requestPassword: async () => null });
    return { doc, owned: true };
  }
  const open = getController()?.pdfDocument;
  if (!open) throw new Error('No document is open');
  return { doc: open, owned: false };
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** Waits until the print area is in the DOM and its images are decoded, so none print blank. */
async function waitForPrintArea(): Promise<void> {
  await nextFrame();
  await nextFrame();
  const images = [...document.querySelectorAll<HTMLImageElement>('#print-root img')];
  await Promise.all(images.map((img) => img.decode().catch(() => undefined)));
}

/**
 * Renders the chosen pages and opens the system print dialog. Progress and errors are reported
 * through the print store; the print dialog stays open on failure or cancel so the user can retry.
 */
export async function startPrint(request: PrintRequest): Promise<void> {
  if (usePrint.getState().busy || request.pages.length === 0) return;

  clearPrintPages();
  const abort = new AbortController();
  running = abort;
  usePrint.setState({
    busy: true,
    error: null,
    progress: { done: 0, total: request.pages.length },
  });

  let source: { doc: PDFDocumentProxy; owned: boolean } | null = null;
  try {
    source = await openSource(request.includeAnnotations);
    if (abort.signal.aborted) throw new PrintCancelledError();

    const rendered = await renderPages(source.doc, request.pages, {
      dpi: dpiFor(request.quality),
      signal: abort.signal,
      onProgress: (done, total) => usePrint.setState({ progress: { done, total } }),
    });

    usePrint.setState({
      pages: rendered.map((r) => ({
        url: URL.createObjectURL(r.blob),
        orientation: r.orientation,
      })),
    });
    await waitForPrintArea();

    usePrint.setState({ busy: false, progress: null, dialogOpen: false });
    // The pages stay mounted while the system dialog is open; free them when it is done.
    window.addEventListener('afterprint', clearPrintPages, { once: true });
    window.print();
  } catch (err) {
    clearPrintPages();
    if (err instanceof PrintCancelledError) {
      usePrint.setState({ busy: false, progress: null });
    } else {
      const message = `Could not print: ${err instanceof Error ? err.message : String(err)}`;
      const dialogStillOpen = usePrint.getState().dialogOpen;
      usePrint.setState({ busy: false, progress: null, error: dialogStillOpen ? message : null });
      // Failing after the dialog closed (the print call itself) is reported in the main banner.
      if (!dialogStillOpen) useApp.setState({ error: message });
    }
  } finally {
    running = null;
    if (source?.owned) void source.doc.loadingTask.destroy();
  }
}
