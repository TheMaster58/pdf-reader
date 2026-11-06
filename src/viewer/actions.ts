import { setBaseline, ensureCanLeave } from '../annotations/persist';
import { useAnnotations } from '../annotations/store';
import { UnsupportedPdfError, type ExtractResult } from '../pdf/annotIO';
import { extractAnnotationsAsync } from '../pdf/annotClient';
import { extractTextForHighlights } from '../pdf/textExtract';
import {
  addRecent,
  fileNameOf,
  pathKey,
  pickPdfFile,
  readPdfFile,
  saveRecent,
} from '../services/files';
import type { ViewerController } from './controller';
import { emptyFind, useApp, type AnnotationBlock } from './store';
import { PasswordCancelledError, loadPdf } from './pdfjs';

let controller: ViewerController | null = null;
let openToken = 0;

/** The mounted PdfViewer registers its controller here so non-React code can drive it. */
export function registerController(c: ViewerController | null): void {
  controller = c;
}

export function getController(): ViewerController | null {
  return controller;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Opens the PDF at `path`. Asks about unsaved changes first. A newer call supersedes one still
 * loading.
 *
 * Highlights and notes already in the file are lifted out into editable annotations, and PDF.js is
 * given a copy of the document without them (we draw them ourselves, so they must not be drawn
 * twice). Documents we can't safely rewrite open read-only.
 */
export async function openPath(path: string): Promise<void> {
  const ctl = controller;
  if (!ctl) return;
  if (!(await ensureCanLeave())) return;

  const token = ++openToken;
  const name = fileNameOf(path);
  useApp.setState({ status: 'loading', error: null });
  try {
    const bytes = await readPdfFile(path);
    if (token !== openToken) return;

    // Parse the annotations first (in a worker). The buffers are transferred, so hand it a copy.
    let extracted: ExtractResult | null = null;
    let block: AnnotationBlock | null = null;
    try {
      extracted = await extractAnnotationsAsync(bytes.slice());
    } catch (err) {
      if (!(err instanceof UnsupportedPdfError)) throw err;
      block = { reason: err.reason, message: err.message };
    }
    if (token !== openToken) return;

    const doc = await loadPdf(extracted?.viewBytes ?? bytes.slice(), {
      requestPassword: (reason) =>
        new Promise((resolve) => {
          useApp.setState({
            passwordRequest: {
              reason,
              fileName: name,
              resolve: (pw) => {
                useApp.setState({ passwordRequest: null });
                resolve(pw);
              },
            },
          });
        }),
    });
    if (token !== openToken) {
      void doc.loadingTask.destroy();
      return;
    }

    ctl.setDocument(doc);
    const annotations = extracted?.annotations ?? [];
    useAnnotations.getState().loadAnnotations(annotations);
    setBaseline(block ? null : bytes);

    const recent = addRecent(useApp.getState().recent, path);
    saveRecent(recent);
    useApp.setState({
      status: 'ready',
      filePath: path,
      fileName: name,
      annotationBlock: block,
      recent,
      find: emptyFind,
      findOpen: false,
    });

    // Annotations that came from the file only have geometry: look up the text they cover so the
    // sidebar can show it. This runs in the background and never marks the document as changed.
    const needText = annotations.flatMap((a) => (a.kind === 'highlight' && !a.text ? [a] : []));
    if (needText.length) {
      void extractTextForHighlights(
        doc,
        needText,
        (id, text) => useAnnotations.getState().setHighlightText(id, text),
        () => token !== openToken,
      );
    }
  } catch (err) {
    if (token !== openToken) return;
    if (err instanceof PasswordCancelledError) {
      // User backed out of the password prompt: return to whatever was open before.
      useApp.setState({ status: ctl.hasDocument ? 'ready' : 'idle' });
      return;
    }
    // A file that no longer exists should not linger in the recent list.
    const recent = useApp.getState().recent.filter((p) => pathKey(p) !== pathKey(path));
    saveRecent(recent);
    useApp.setState({
      status: ctl.hasDocument ? 'ready' : 'error',
      error: `Could not open ${name}: ${messageOf(err)}`,
      recent,
    });
  }
}

export async function openWithDialog(): Promise<void> {
  const path = await pickPdfFile();
  if (path) await openPath(path);
}
