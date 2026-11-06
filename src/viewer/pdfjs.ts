import { GlobalWorkerOptions, getDocument, PasswordResponses } from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;

export type { PDFDocumentProxy };

/** Why PDF.js is asking for a password. */
export type PasswordReason = 'needed' | 'incorrect';

export interface LoadOptions {
  /** Called when the file is encrypted. Resolve with a password, or null to cancel. */
  requestPassword: (reason: PasswordReason) => Promise<string | null>;
}

export class PasswordCancelledError extends Error {
  constructor() {
    super('Password entry cancelled');
    this.name = 'PasswordCancelledError';
  }
}

/** Opens a PDF from raw bytes, using the static resources copied to /pdfjs by the predev script. */
export async function loadPdf(data: Uint8Array, opts: LoadOptions): Promise<PDFDocumentProxy> {
  const task = getDocument({
    data,
    cMapUrl: '/pdfjs/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: '/pdfjs/standard_fonts/',
    wasmUrl: '/pdfjs/wasm/',
    iccUrl: '/pdfjs/iccs/',
  });
  task.onPassword = (updatePassword: (pw: string) => void, reason: number) => {
    const why: PasswordReason = reason === PasswordResponses.INCORRECT_PASSWORD ? 'incorrect' : 'needed';
    opts.requestPassword(why).then((pw) => {
      if (pw === null) {
        void task.destroy();
      } else {
        updatePassword(pw);
      }
    });
  };
  try {
    return await task.promise;
  } catch (err) {
    if (task.destroyed) throw new PasswordCancelledError();
    throw err;
  }
}
