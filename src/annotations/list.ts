import type { Annotation } from './model';

/** Highest PDF y of an annotation (its visual top on an unrotated page). */
function topY(a: Annotation): number {
  if (a.kind === 'highlight') return Math.max(...a.rects.map((r) => r[3]));
  return a.kind === 'note' ? a.point[1] : a.rect[3]; // text boxes and signatures have a rect
}

function leftX(a: Annotation): number {
  if (a.kind === 'highlight') return Math.min(...a.rects.map((r) => r[0]));
  return a.kind === 'note' ? a.point[0] : a.rect[0];
}

/** Reading order for the sidebar: by page, then top to bottom, then left to right. */
export function sortAnnotations(list: readonly Annotation[]): Annotation[] {
  return [...list].sort(
    (a, b) => a.pageIndex - b.pageIndex || topY(b) - topY(a) || leftX(a) - leftX(b),
  );
}

export interface PageGroup {
  pageIndex: number;
  items: Annotation[];
}

/** Groups annotations by page, in reading order. */
export function groupByPage(list: readonly Annotation[]): PageGroup[] {
  const groups: PageGroup[] = [];
  for (const a of sortAnnotations(list)) {
    const last = groups[groups.length - 1];
    if (last && last.pageIndex === a.pageIndex) last.items.push(a);
    else groups.push({ pageIndex: a.pageIndex, items: [a] });
  }
  return groups;
}

/** PDF-space point to scroll to so the annotation is in view (its top-left). */
export function anchorPoint(a: Annotation): [number, number] {
  return [leftX(a), topY(a)];
}

/** Does it carry a written comment? (A signature has none.) */
export function hasNote(a: Annotation): boolean {
  return a.kind !== 'signature' && a.contents.trim().length > 0;
}
