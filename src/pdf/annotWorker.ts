import type { Annotation } from '../annotations/model';
import { UnsupportedPdfError, extractAnnotations, writeAnnotations } from './annotIO';

/**
 * Runs the PDF parsing/writing off the main thread so a big document never freezes the UI.
 * Messages: { id, type: 'extract', bytes } and { id, type: 'write', bytes, annotations }.
 */
export type WorkerRequest =
  | { id: number; type: 'extract'; bytes: Uint8Array }
  | { id: number; type: 'write'; bytes: Uint8Array; annotations: Annotation[] };

export type WorkerResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: { name: string; message: string; reason?: 'encrypted' | 'invalid' } };

const scope = self as unknown as {
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
};

/** The buffer behind `bytes`, if it can be handed over without copying. */
function transferable(bytes: Uint8Array): Transferable[] {
  return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? [bytes.buffer] : [];
}

scope.onmessage = async (e) => {
  const req = e.data;
  try {
    if (req.type === 'extract') {
      const result = await extractAnnotations(req.bytes);
      scope.postMessage({ id: req.id, ok: true, result }, result.viewBytes ? transferable(result.viewBytes) : []);
    } else {
      const bytes = await writeAnnotations(req.bytes, req.annotations);
      scope.postMessage({ id: req.id, ok: true, result: bytes }, transferable(bytes));
    }
  } catch (err) {
    const error =
      err instanceof UnsupportedPdfError
        ? { name: err.name, message: err.message, reason: err.reason }
        : { name: 'Error', message: err instanceof Error ? err.message : String(err) };
    scope.postMessage({ id: req.id, ok: false, error });
  }
};
