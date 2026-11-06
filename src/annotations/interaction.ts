import {
  clientToFraction,
  fractionToPdf,
  fractionToPdfPoint,
  mergeLineRects,
  pdfPointToFraction,
  pdfToFraction,
  pointInBox,
  pointInPdfRects,
  type Rect,
} from './geometry';
import { hasNote } from './list';
import {
  NOTE_ICON_PX,
  NOTE_MARKER,
  createHighlight,
  createNote,
  type HighlightAnnotation,
  type NoteAnnotation,
} from './model';
import { usePageHosts } from './pageHosts';
import { useApp } from '../viewer/store';
import { useAnnotations } from './store';

/** The part of a text selection that falls on one page. */
export interface PageSelection {
  pageIndex: number;
  /** One box per selected text run, in client (viewport) pixels. */
  rects: Rect[];
  text: string;
}

export interface SelectionCapture {
  pages: PageSelection[];
  /** Bounding box of everything selected, in client pixels (for positioning the toolbar). */
  bounds: Rect;
}

function unionOf(a: Rect | null, b: Rect): Rect {
  if (!a) return { ...b };
  return {
    left: Math.min(a.left, b.left),
    top: Math.min(a.top, b.top),
    right: Math.max(a.right, b.right),
    bottom: Math.max(a.bottom, b.bottom),
  };
}

/**
 * Reads the current browser text selection, if it lies inside the PDF container, and splits it by
 * page. Only boxes of selected *text* are used: Range.getClientRects() also returns the boxes of
 * whole elements the range happens to contain (page-sized ones, in PDF.js's text layer).
 */
export function captureSelection(container: HTMLElement): SelectionCapture | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) return null;

  const pages: PageSelection[] = [];
  let bounds: Rect | null = null;

  for (const layer of container.querySelectorAll<HTMLElement>('.textLayer')) {
    if (!range.intersectsNode(layer)) continue;
    const pageNumber = Number(layer.closest<HTMLElement>('.page')?.dataset.pageNumber);
    if (!Number.isFinite(pageNumber) || pageNumber < 1) continue;

    const rects: Rect[] = [];
    const parts: string[] = [];
    const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!range.intersectsNode(node)) continue;
      const part = document.createRange();
      part.selectNodeContents(node);
      if (node === range.startContainer) part.setStart(node, range.startOffset);
      if (node === range.endContainer) part.setEnd(node, range.endOffset);
      const text = part.toString();
      if (!text) continue;
      parts.push(text);
      for (const r of part.getClientRects()) {
        if (r.width <= 0 || r.height <= 0) continue;
        const rect = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
        rects.push(rect);
        bounds = unionOf(bounds, rect);
      }
    }
    if (rects.length) {
      pages.push({
        pageIndex: pageNumber - 1,
        rects,
        text: parts.join(' ').replace(/\s+/g, ' ').trim(),
      });
    }
  }
  return pages.length && bounds ? { pages, bounds } : null;
}

/** Turns a captured selection into highlight annotations (one per page it touches). */
export function highlightsFromCapture(
  capture: SelectionCapture,
  color: string,
): HighlightAnnotation[] {
  const hosts = usePageHosts.getState().hosts;
  const out: HighlightAnnotation[] = [];
  for (const page of capture.pages) {
    const host = hosts[page.pageIndex];
    if (!host) continue;
    const origin = host.el.getBoundingClientRect();
    if (origin.width === 0 || origin.height === 0) continue;
    const rects = mergeLineRects(page.rects).map((r) =>
      fractionToPdf(host.viewport, clientToFraction(r, origin)),
    );
    if (rects.length) {
      out.push(
        createHighlight({
          pageIndex: page.pageIndex,
          rects,
          color,
          text: page.text,
          author: useApp.getState().author,
        }),
      );
    }
  }
  return out;
}

/**
 * Highlights the current selection with `color`, then clears the selection.
 * Returns the highlights created (empty if there was nothing to highlight).
 */
export function highlightSelection(container: HTMLElement, color: string): HighlightAnnotation[] {
  const capture = captureSelection(container);
  if (!capture) return [];
  const anns = highlightsFromCapture(capture, color);
  if (!anns.length) return [];
  const store = useAnnotations.getState();
  store.addAnnotations(anns);
  store.setActiveColor(color);
  window.getSelection()?.removeAllRanges();
  return anns;
}

/**
 * Puts a sticky note with its icon's top-left at the given client point (nudged to stay on the
 * page). Returns null if the point isn't over a rendered page.
 */
export function placeNoteAt(clientX: number, clientY: number): NoteAnnotation | null {
  const { hosts } = usePageHosts.getState();
  for (const [index, host] of Object.entries(hosts)) {
    const box = host.el.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) continue;
    if (clientX < box.left || clientX > box.right || clientY < box.top || clientY > box.bottom) continue;
    const px = Math.min(Math.max(0, clientX - box.left), Math.max(0, box.width - NOTE_ICON_PX));
    const py = Math.min(Math.max(0, clientY - box.top), Math.max(0, box.height - NOTE_ICON_PX));
    const note = createNote({
      pageIndex: Number(index),
      point: fractionToPdfPoint(host.viewport, px / box.width, py / box.height),
      color: useAnnotations.getState().activeColor,
      author: useApp.getState().author,
    });
    const store = useAnnotations.getState();
    store.addAnnotations([note]);
    store.select(note.id);
    store.requestNoteFocus(note.id);
    return note;
  }
  return null;
}

/** Id of the topmost highlight or sticky note under the given client point, or null. */
export function hitTestAnnotation(clientX: number, clientY: number): string | null {
  const hosts = usePageHosts.getState().hosts;
  const { annotations } = useAnnotations.getState();
  for (let i = annotations.length - 1; i >= 0; i--) {
    const ann = annotations[i];
    const host = hosts[ann.pageIndex];
    if (!host) continue;
    const box = host.el.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) continue;
    const px = clientX - box.left;
    const py = clientY - box.top;

    if (ann.kind === 'note') {
      // The icon has a fixed pixel size, so compare in pixels.
      const p = pdfPointToFraction(host.viewport, ann.point);
      if (pointInBox(px, py, p.x * box.width, p.y * box.height, NOTE_ICON_PX)) return ann.id;
      continue;
    }

    const fx = px / box.width;
    const fy = py / box.height;
    if (fx >= 0 && fx <= 1 && fy >= 0 && fy <= 1) {
      const [x, y] = fractionToPdfPoint(host.viewport, fx, fy);
      if (pointInPdfRects(ann.rects, x, y)) return ann.id;
    }
    if (hasNote(ann)) {
      // The speech-bubble marker hangs off the top-right of the first line.
      const first = ann.rects
        .map((r) => pdfToFraction(host.viewport, r))
        .reduce((a, b) => (b.top < a.top ? b : a));
      const left = first.right * box.width + NOTE_MARKER.dx;
      const top = first.top * box.height + NOTE_MARKER.dy;
      if (pointInBox(px, py, left, top, NOTE_MARKER.size)) return ann.id;
    }
  }
  return null;
}
