/** Which edges of the scroll area the view is currently resting against. */
export interface Edges {
  top: boolean;
  bottom: boolean;
  left: boolean;
  right: boolean;
}

export type Flip = 'next' | 'prev';

/**
 * What a key should do in a one-page-at-a-time layout, or null to leave it to the browser (which
 * scrolls the page). A key flips only when the view can't scroll any further in its direction, so a
 * zoomed-in page is read to its end first. Arrow keys left/right flip when there is no horizontal
 * scrolling left.
 */
export function flipForKey(key: string, shift: boolean, edges: Edges): Flip | null {
  switch (key) {
    case 'PageDown':
    case 'ArrowDown':
      return edges.bottom ? 'next' : null;
    case 'PageUp':
    case 'ArrowUp':
      return edges.top ? 'prev' : null;
    case ' ':
      if (shift) return edges.top ? 'prev' : null;
      return edges.bottom ? 'next' : null;
    case 'ArrowRight':
      return edges.right ? 'next' : null;
    case 'ArrowLeft':
      return edges.left ? 'prev' : null;
    default:
      return null;
  }
}

/**
 * Turns mouse-wheel and touchpad scrolling into page flips at the edge of a page.
 *
 * A flip needs a *fresh* gesture that starts while the view is already at the edge. That keeps a
 * touchpad's trailing momentum (which keeps arriving after the page has been scrolled to its end, and
 * after a flip) from turning several pages at once, and means a notched mouse wheel flips on the
 * notch after the one that reached the end.
 */
export class WheelFlipper {
  private lastEventAt = -Infinity;
  private direction = 0;
  private armed = false;
  private accumulated = 0;
  private locked = false;

  constructor(
    /** Scroll distance (px) needed at the edge to flip. */
    private readonly threshold = 40,
    /** A pause this long (ms) with no wheel events ends a gesture. */
    private readonly quietMs = 180,
  ) {}

  /**
   * True while the current gesture has already turned a page: the rest of it (a touchpad's momentum)
   * should be swallowed rather than scroll the new page.
   */
  get isLocked(): boolean {
    return this.locked;
  }

  /** Call for every wheel event. Returns the flip to make, if any. */
  handle(deltaY: number, edges: Edges, now: number): Flip | null {
    if (deltaY === 0) return null;
    const direction = Math.sign(deltaY);
    const gap = now - this.lastEventAt;
    this.lastEventAt = now;

    if (gap > this.quietMs) {
      // A new gesture: forget the last one.
      this.locked = false;
      this.direction = 0;
    }
    if (this.locked) return null;

    if (direction !== this.direction) {
      // First event of a gesture, or the user reversed: it counts only if it starts at the edge.
      this.direction = direction;
      this.accumulated = 0;
      this.armed = direction > 0 ? edges.bottom : edges.top;
    }
    if (!this.armed) return null;

    this.accumulated += Math.abs(deltaY);
    if (this.accumulated < this.threshold) return null;

    this.locked = true;
    this.accumulated = 0;
    return direction > 0 ? 'next' : 'prev';
  }

  reset(): void {
    this.lastEventAt = -Infinity;
    this.direction = 0;
    this.armed = false;
    this.accumulated = 0;
    this.locked = false;
  }
}
