import { useRef, useState, type PointerEvent } from 'react';
import { moveFraction, type Handle } from './boxGeometry';
import { fractionToPdf, pdfToFraction, type Rect } from './geometry';
import type { PdfRect } from './model';
import type { PageHost } from './pageHosts';
import { useAnnotations } from './store';

/** Pixels the pointer must travel before a press counts as a drag rather than a click. */
const DRAG_SLOP = 3;

export type GestureKind = 'move' | Handle;

interface Gesture {
  /** The element that holds the pointer: the box itself or one of its handles. */
  target: Element;
  pointerId: number;
  kind: GestureKind;
  startX: number;
  startY: number;
  start: Rect;
  /** Size of the page on screen when the gesture began, to turn pixels into page fractions. */
  page: { width: number; height: number };
  wasSelected: boolean;
  moved: boolean;
}

export interface BoxGestureOptions {
  id: string;
  host: PageHost;
  /** The box as saved, in PDF space. */
  rect: PdfRect;
  /** The box as it is after dragging `handle` by (dx, dy) page fractions from `start`. */
  resize: (start: Rect, handle: Handle, dx: number, dy: number) => Rect;
  /** Called once, on release, with the final box. */
  onCommit: (rect: PdfRect) => void;
  /** Called after a plain click (no drag) on a box that was already selected. */
  onClickSelected?: () => void;
}

/**
 * Moving and resizing a box on a page with the pointer, shared by text boxes and signatures.
 *
 *  - While the pointer moves, the box follows it without touching the document (`frame`); the change
 *    is committed once, on release, so one drag is one undo step.
 *  - The last position is also kept in a ref: a release can arrive before React has re-rendered after
 *    the final move, and must still see where the box got to.
 *  - A press selects the box. A press-and-release without movement on an already selected box is
 *    reported as a click instead of a drag.
 */
export function useBoxGesture(o: BoxGestureOptions) {
  const vp = o.host.viewport;
  const [live, setLiveState] = useState<Rect | null>(null);
  const liveRef = useRef<Rect | null>(null);
  const setLive = (r: Rect | null) => {
    liveRef.current = r;
    setLiveState(r);
  };
  const gesture = useRef<Gesture | null>(null);

  /** Where to draw the box: the live position during a drag, else where it is saved. */
  const frame = live ?? pdfToFraction(vp, o.rect);

  const begin = (e: PointerEvent, kind: GestureKind) => {
    if (e.button !== 0) return;
    // Handling the press here keeps it from also starting a text selection or a page click.
    e.preventDefault();
    e.stopPropagation();
    const page = o.host.el.getBoundingClientRect();
    if (page.width === 0 || page.height === 0) return;
    const target = e.currentTarget as Element;
    try {
      // Keeps the gesture going when the pointer leaves the box or the window.
      target.setPointerCapture(e.pointerId);
    } catch {
      /* the pointer is gone already: carry on, the gesture just won't follow it outside */
    }
    const store = useAnnotations.getState();
    const wasSelected = store.selectedId === o.id;
    gesture.current = {
      target,
      pointerId: e.pointerId,
      kind,
      startX: e.clientX,
      startY: e.clientY,
      start: pdfToFraction(vp, o.rect),
      page: { width: page.width, height: page.height },
      wasSelected,
      moved: false,
    };
    if (!wasSelected) store.select(o.id);
  };

  const track = (e: PointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    const dxPx = e.clientX - g.startX;
    const dyPx = e.clientY - g.startY;
    if (!g.moved && Math.hypot(dxPx, dyPx) < DRAG_SLOP) return;
    g.moved = true;
    const dx = dxPx / g.page.width;
    const dy = dyPx / g.page.height;
    setLive(g.kind === 'move' ? moveFraction(g.start, dx, dy) : o.resize(g.start, g.kind, dx, dy));
  };

  const end = (e: PointerEvent) => {
    const g = gesture.current;
    gesture.current = null;
    if (!g || e.pointerId !== g.pointerId) return;
    if (g.target.hasPointerCapture?.(g.pointerId)) g.target.releasePointerCapture(g.pointerId);
    if (e.type === 'pointercancel') {
      setLive(null);
      return;
    }
    const final = liveRef.current;
    if (g.moved && final) o.onCommit(fractionToPdf(vp, final));
    else if (!g.moved && g.wasSelected && g.kind === 'move') o.onClickSelected?.();
    setLive(null);
  };

  return { frame, begin, track, end };
}
