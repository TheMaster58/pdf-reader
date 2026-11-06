/**
 * How pages are laid out, modelled on Acrobat's "Page Display" options.
 *  - single / two: one page (or one pair) at a time; the next page is reached by flipping.
 *  - single-continuous / two-continuous: pages (or pairs) scroll one after another.
 */
export type PageLayout = 'single' | 'single-continuous' | 'two' | 'two-continuous';

export interface ViewMode {
  layout: PageLayout;
  /** In the two-page layouts, show page 1 on its own (as a cover) and pair 2-3, 4-5... */
  cover: boolean;
}

export const DEFAULT_VIEW_MODE: ViewMode = { layout: 'single-continuous', cover: false };

export const PAGE_LAYOUTS: readonly { value: PageLayout; label: string }[] = [
  { value: 'single', label: 'Single page' },
  { value: 'single-continuous', label: 'Single page, continuous' },
  { value: 'two', label: 'Two pages' },
  { value: 'two-continuous', label: 'Two pages, continuous' },
];

export function isPageLayout(value: unknown): value is PageLayout {
  return PAGE_LAYOUTS.some((l) => l.value === value);
}

/** Shows one page (or pair) at a time instead of a scrolling column. */
export function isPaged(layout: PageLayout): boolean {
  return layout === 'single' || layout === 'two';
}

export function isTwoPage(layout: PageLayout): boolean {
  return layout === 'two' || layout === 'two-continuous';
}

/** The two PDF.js settings a view mode stands for, as names (the controller maps them to constants). */
export interface ViewerSettings {
  scroll: 'vertical' | 'page';
  spread: 'none' | 'odd' | 'even';
}

/**
 * PDF.js pairs pages by parity: "odd" starts a pair on every odd page (1-2, 3-4), "even" starts it on
 * every even page, which leaves page 1 alone (1, 2-3, 4-5): that is the cover-page arrangement.
 */
export function viewerSettings(mode: ViewMode): ViewerSettings {
  return {
    scroll: isPaged(mode.layout) ? 'page' : 'vertical',
    spread: !isTwoPage(mode.layout) ? 'none' : mode.cover ? 'even' : 'odd',
  };
}

/**
 * The first and last page (1-based) shown together with `page`. A page on its own, or any page in a
 * one-page layout, gives `[page, page]`.
 */
export function spreadPages(page: number, pageCount: number, mode: ViewMode): [number, number] {
  const n = Math.min(Math.max(1, Math.round(page) || 1), Math.max(1, pageCount));
  if (!isTwoPage(mode.layout)) return [n, n];
  if (mode.cover) {
    if (n === 1) return [1, 1];
    const first = n % 2 === 0 ? n : n - 1; // pairs start on even pages: 2-3, 4-5...
    return [first, Math.min(first + 1, pageCount)];
  }
  const first = n % 2 === 1 ? n : n - 1; // pairs start on odd pages: 1-2, 3-4...
  return [first, Math.min(first + 1, pageCount)];
}

/** Reads a stored value, falling back to the default for anything missing or malformed. */
export function parseViewMode(raw: unknown): ViewMode {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_VIEW_MODE };
  const { layout, cover } = raw as Record<string, unknown>;
  return {
    layout: isPageLayout(layout) ? layout : DEFAULT_VIEW_MODE.layout,
    cover: cover === true,
  };
}
