export type PrintQuality = 'draft' | 'standard' | 'high';

export const PRINT_QUALITIES: readonly { value: PrintQuality; label: string; dpi: number }[] = [
  { value: 'draft', label: 'Draft (150 dpi)', dpi: 150 },
  { value: 'standard', label: 'Standard (200 dpi)', dpi: 200 },
  { value: 'high', label: 'High (300 dpi)', dpi: 300 },
];

export const DEFAULT_PRINT_QUALITY: PrintQuality = 'standard';

/** Above this many pages the dialog suggests printing a range instead (every page is held in memory). */
export const PRINT_WARN_PAGES = 200;

/** PDF user-space units per inch. */
const POINTS_PER_INCH = 72;

/** The largest bitmap we are willing to create for one page (about 144 MB of pixels). */
export const MAX_PAGE_PIXELS = 36_000_000;
/** Browsers refuse canvases wider or taller than this. */
const MAX_SIDE_PIXELS = 16_384;

export function dpiFor(quality: PrintQuality): number {
  return PRINT_QUALITIES.find((q) => q.value === quality)?.dpi ?? 200;
}

export function isPrintQuality(value: unknown): value is PrintQuality {
  return PRINT_QUALITIES.some((q) => q.value === value);
}

/**
 * PDF.js scale that renders a page of `widthPt` x `heightPt` points at `dpi`, reduced when that would
 * make a bitmap too large for the browser (posters, huge drawings).
 */
export function printScale(widthPt: number, heightPt: number, dpi: number): number {
  if (!(widthPt > 0) || !(heightPt > 0) || !(dpi > 0)) return 1;
  let scale = dpi / POINTS_PER_INCH;
  const pixels = widthPt * heightPt * scale * scale;
  if (pixels > MAX_PAGE_PIXELS) scale *= Math.sqrt(MAX_PAGE_PIXELS / pixels);
  const longest = Math.max(widthPt, heightPt) * scale;
  if (longest > MAX_SIDE_PIXELS) scale *= MAX_SIDE_PIXELS / longest;
  return scale;
}

export type PageOrientation = 'portrait' | 'landscape';

/** Square pages count as portrait. */
export function orientationOf(width: number, height: number): PageOrientation {
  return width > height ? 'landscape' : 'portrait';
}
