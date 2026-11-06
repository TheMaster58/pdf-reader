import { create } from 'zustand';
import type { PageOrientation } from './printLayout';

/** One rendered page waiting in the hidden print area. */
export interface PrintPage {
  url: string;
  orientation: PageOrientation;
}

export interface PrintState {
  dialogOpen: boolean;
  /** Pages are being rendered. */
  busy: boolean;
  progress: { done: number; total: number } | null;
  /** The pages in the hidden print area. Empty except while (and just after) printing. */
  pages: PrintPage[];
  error: string | null;
}

export const usePrint = create<PrintState>(() => ({
  dialogOpen: false,
  busy: false,
  progress: null,
  pages: [],
  error: null,
}));

/** Drops the rendered pages and frees their memory. */
export function clearPrintPages(): void {
  const { pages } = usePrint.getState();
  for (const p of pages) URL.revokeObjectURL(p.url);
  if (pages.length) usePrint.setState({ pages: [] });
}
