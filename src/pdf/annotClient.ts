import type { Annotation } from '../annotations/model';
import { UnsupportedPdfError, type ExtractResult } from './annotIO';
import type { WorkerRequest, WorkerResponse } from './annotWorker';

/** Omit that applies to each member of a union (plain Omit collapses the union). */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

type Pending = { resolve: (value: unknown) => void; reject: (reason: unknown) => void };

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function failAll(error: Error) {
  for (const p of pending.values()) p.reject(error);
  pending.clear();
  worker?.terminate();
  worker = null;
}

function getWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL('./annotWorker.ts', import.meta.url), { type: 'module' });
  w.onmessage = (e: MessageEvent<WorkerResponse>) => {
    const res = e.data;
    const p = pending.get(res.id);
    if (!p) return;
    pending.delete(res.id);
    if (res.ok) p.resolve(res.result);
    else if (res.error.name === 'UnsupportedPdfError' && res.error.reason) {
      p.reject(new UnsupportedPdfError(res.error.reason, res.error.message));
    } else p.reject(new Error(res.error.message));
  };
  w.onerror = (e) => failAll(new Error(`Annotation worker failed: ${e.message || 'unknown error'}`));
  worker = w;
  return w;
}

function call<T>(request: DistributiveOmit<WorkerRequest, 'id'>): Promise<T> {
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    // The buffer is transferred, not copied: callers must pass a copy if they still need the bytes.
    getWorker().postMessage({ ...request, id }, [request.bytes.buffer]);
  });
}

/** Reads highlights and notes out of a PDF. Consumes `bytes`. Rejects with UnsupportedPdfError. */
export function extractAnnotationsAsync(bytes: Uint8Array): Promise<ExtractResult> {
  return call<ExtractResult>({ type: 'extract', bytes });
}

/** Builds the bytes of the document with the given annotations written in. Consumes `bytes`. */
export function writeAnnotationsAsync(bytes: Uint8Array, annotations: Annotation[]): Promise<Uint8Array> {
  return call<Uint8Array>({ type: 'write', bytes, annotations });
}
