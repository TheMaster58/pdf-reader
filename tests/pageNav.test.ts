import { describe, expect, it } from 'vitest';
import { WheelFlipper, flipForKey, type Edges } from '../src/viewer/pageNav';

const edges = (e: Partial<Edges>): Edges => ({
  top: false,
  bottom: false,
  left: false,
  right: false,
  ...e,
});
const ALL = edges({ top: true, bottom: true, left: true, right: true });

describe('flipForKey', () => {
  it('flips down/forward only at the bottom edge, so a zoomed page is read first', () => {
    for (const key of ['PageDown', 'ArrowDown', ' ']) {
      expect(flipForKey(key, false, edges({ top: true }))).toBeNull();
      expect(flipForKey(key, false, edges({ bottom: true }))).toBe('next');
    }
  });

  it('flips up/back only at the top edge', () => {
    for (const key of ['PageUp', 'ArrowUp']) {
      expect(flipForKey(key, false, edges({ bottom: true }))).toBeNull();
      expect(flipForKey(key, false, edges({ top: true }))).toBe('prev');
    }
  });

  it('Shift+Space goes back, at the top edge', () => {
    expect(flipForKey(' ', true, edges({ top: true }))).toBe('prev');
    expect(flipForKey(' ', true, edges({ bottom: true }))).toBeNull();
  });

  it('left/right arrows flip when there is no more horizontal scrolling that way', () => {
    expect(flipForKey('ArrowRight', false, edges({ left: true }))).toBeNull();
    expect(flipForKey('ArrowRight', false, edges({ right: true }))).toBe('next');
    expect(flipForKey('ArrowLeft', false, edges({ right: true }))).toBeNull();
    expect(flipForKey('ArrowLeft', false, edges({ left: true }))).toBe('prev');
  });

  it('a page that fits the window (every edge true) flips on any navigation key', () => {
    expect(flipForKey('PageDown', false, ALL)).toBe('next');
    expect(flipForKey('PageUp', false, ALL)).toBe('prev');
    expect(flipForKey('ArrowRight', false, ALL)).toBe('next');
    expect(flipForKey('ArrowLeft', false, ALL)).toBe('prev');
  });

  it('ignores other keys', () => {
    for (const key of ['a', 'Enter', 'Home', 'End', 'Tab']) {
      expect(flipForKey(key, false, ALL)).toBeNull();
    }
  });
});

describe('WheelFlipper', () => {
  it('does not flip while the page can still scroll in that direction', () => {
    const w = new WheelFlipper();
    expect(w.handle(120, edges({ top: true }), 0)).toBeNull();
    expect(w.handle(120, edges({}), 500)).toBeNull();
  });

  it('flips on a notch at the edge, then stays quiet for the trailing notch', () => {
    const w = new WheelFlipper();
    expect(w.handle(100, edges({ bottom: true }), 1000)).toBe('next');
    // Momentum from the same gesture keeps arriving within the quiet window: no second flip.
    expect(w.handle(100, edges({ bottom: true }), 1050)).toBeNull();
    expect(w.handle(100, edges({ bottom: true }), 1100)).toBeNull();
  });

  it('flips again once the user pauses and starts a new gesture', () => {
    const w = new WheelFlipper();
    expect(w.handle(100, edges({ bottom: true }), 0)).toBe('next');
    expect(w.handle(100, edges({ bottom: true }), 1000)).toBe('next');
  });

  it('goes back when scrolling up at the top edge', () => {
    const w = new WheelFlipper();
    expect(w.handle(-100, edges({ top: true }), 0)).toBe('prev');
  });

  it('needs enough movement: tiny touchpad events add up to the threshold', () => {
    const w = new WheelFlipper(40);
    const at = edges({ bottom: true });
    expect(w.handle(10, at, 0)).toBeNull();
    expect(w.handle(10, at, 16)).toBeNull();
    expect(w.handle(10, at, 32)).toBeNull();
    expect(w.handle(15, at, 48)).toBe('next');
  });

  it('a gesture that reaches the bottom mid-way does not flip (it started away from the edge)', () => {
    const w = new WheelFlipper();
    expect(w.handle(30, edges({}), 0)).toBeNull();
    // Inertia carries the view to the bottom, with events still arriving.
    expect(w.handle(30, edges({ bottom: true }), 16)).toBeNull();
    expect(w.handle(30, edges({ bottom: true }), 32)).toBeNull();
    expect(w.handle(30, edges({ bottom: true }), 48)).toBeNull();
    // A new gesture at the bottom does flip.
    expect(w.handle(60, edges({ bottom: true }), 1000)).toBe('next');
  });

  it('reversing direction restarts the count', () => {
    const w = new WheelFlipper(40);
    const at = edges({ top: true, bottom: true });
    expect(w.handle(30, at, 0)).toBeNull();
    expect(w.handle(-30, at, 16)).toBeNull(); // reversed: starts over
    expect(w.handle(-30, at, 32)).toBe('prev');
  });

  it('reports when the rest of a gesture should be swallowed', () => {
    const w = new WheelFlipper();
    expect(w.isLocked).toBe(false);
    expect(w.handle(100, edges({ bottom: true }), 0)).toBe('next');
    expect(w.isLocked).toBe(true);
    w.handle(100, edges({ bottom: true }), 50);
    expect(w.isLocked).toBe(true);
    w.handle(100, edges({ top: true }), 1000); // a fresh gesture, not at the bottom edge
    expect(w.isLocked).toBe(false);
  });

  it('ignores zero movement and can be reset', () => {
    const w = new WheelFlipper();
    expect(w.handle(0, ALL, 0)).toBeNull();
    expect(w.handle(100, ALL, 10)).toBe('next');
    w.reset();
    expect(w.handle(100, ALL, 20)).toBe('next');
  });
});
