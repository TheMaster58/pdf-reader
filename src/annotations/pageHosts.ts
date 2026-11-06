import { create } from 'zustand';
import type { ViewportLike } from './geometry';

/** The overlay element inside one rendered PDF.js page, plus what we need to place things in it. */
export interface PageHost {
  /**
   * Layer for interactive UI (the highlight popover). Absolutely positioned child of the page that
   * fills the same box as the page's text layer. Never intercepts the mouse itself.
   */
  el: HTMLElement;
  /**
   * Layer for the coloured highlight rectangles, drawn with mix-blend-mode: multiply. It must be a
   * direct child of the page with no z-index of its own: a stacking-context ancestor would isolate
   * the blend from the page canvas underneath and the colour would cover the text.
   */
  blendEl: HTMLElement;
  /** Scale-1 viewport of the page. Positions are fractions of the page, so zoom doesn't matter. */
  viewport: ViewportLike;
}

interface PageHostsState {
  /** Keyed by zero-based page index. Only pages that have been rendered at least once appear. */
  hosts: Record<number, PageHost>;
}

export const usePageHosts = create<PageHostsState>(() => ({ hosts: {} }));
