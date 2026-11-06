/** Result of reading a "which pages" string. Pages are 1-based, ascending, without duplicates. */
export type PagesResult = { ok: true; pages: number[] } | { ok: false; error: string };

/**
 * Reads a page-range string such as `1-3, 7, 10-`.
 *  - `a-b` is a range, `a-` runs to the last page and `-b` starts at page 1;
 *  - parts are separated by commas or semicolons;
 *  - the result is sorted and duplicates are dropped, so overlapping parts are fine.
 */
export function parsePageRange(input: string, pageCount: number): PagesResult {
  const text = input.trim();
  if (!text) return { ok: false, error: 'Enter the pages to print, for example 1-3, 7.' };
  if (pageCount < 1) return { ok: false, error: 'There are no pages to print.' };

  const wanted = new Set<number>();
  for (const raw of text.split(/[,;]/)) {
    // Spaces around a dash are fine ("2 - 4"); spaces between digits are not ("3 4" is not 34).
    const part = raw.trim().replace(/\s*-\s*/g, '-');
    if (!part) continue; // "1,,2" and a trailing comma are harmless
    if (/\d\s+\d/.test(part))
      return { ok: false, error: `"${raw.trim()}" isn't a page or a range.` };

    const m = /^(\d*)(-?)(\d*)$/.exec(part);
    if (!m || (m[1] === '' && m[3] === '')) {
      return { ok: false, error: `"${raw.trim()}" isn't a page or a range.` };
    }
    const isRange = m[2] === '-';
    const from = m[1] === '' ? 1 : Number(m[1]);
    const to = isRange ? (m[3] === '' ? pageCount : Number(m[3])) : from;

    if (from < 1 || to < 1) return { ok: false, error: 'Page numbers start at 1.' };
    for (const n of [from, to]) {
      if (n > pageCount) {
        const pages = pageCount === 1 ? '1 page' : `${pageCount} pages`;
        return { ok: false, error: `Page ${n} is past the end: the document has ${pages}.` };
      }
    }
    if (from > to) return { ok: false, error: `"${raw.trim()}" runs backwards.` };

    for (let p = from; p <= to; p++) wanted.add(p);
  }

  if (wanted.size === 0)
    return { ok: false, error: 'Enter the pages to print, for example 1-3, 7.' };
  return { ok: true, pages: [...wanted].sort((a, b) => a - b) };
}

export type PageChoice = 'all' | 'current' | 'range';

/** The pages the dialog's choice stands for. */
export function resolvePages(
  choice: PageChoice,
  pageCount: number,
  currentPage: number,
  rangeText: string,
): PagesResult {
  if (pageCount < 1) return { ok: false, error: 'There are no pages to print.' };
  if (choice === 'all')
    return { ok: true, pages: Array.from({ length: pageCount }, (_, i) => i + 1) };
  if (choice === 'current') {
    const page = Math.min(Math.max(1, Math.round(currentPage) || 1), pageCount);
    return { ok: true, pages: [page] };
  }
  return parsePageRange(rangeText, pageCount);
}
