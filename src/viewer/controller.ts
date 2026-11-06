import { AnnotationEditorType } from 'pdfjs-dist';
import {
  EventBus,
  FindState,
  PDFFindController,
  PDFLinkService,
  PDFViewer,
} from 'pdfjs-dist/web/pdf_viewer.mjs';
import 'pdfjs-dist/web/pdf_viewer.css';
import type { PDFDocumentProxy } from './pdfjs';
import { emptyFind, useApp } from './store';
import { openExternal } from '../services/files';
import { usePageHosts } from '../annotations/pageHosts';

export const ZOOM_PRESETS = ['auto', 'page-fit', 'page-width'] as const;
export const ZOOM_PERCENTS = [50, 75, 100, 125, 150, 200, 300, 400];
const MIN_SCALE = 0.1;
const MAX_SCALE = 8;
const WHEEL_ZOOM_STEP = 1.1;

/** Links we hand to the OS instead of letting the webview navigate away from the app. */
function isExternalHref(href: string): boolean {
  return /^(https?:|mailto:)/i.test(href);
}

/** The parts of a PDF.js PDFPageView we rely on. */
interface PageViewLike {
  div: HTMLElement;
  viewport: { clone(opts: { scale: number }): { width: number; height: number; convertToPdfPoint(x: number, y: number): number[]; convertToViewportPoint(x: number, y: number): number[] } };
}

/**
 * Owns the PDF.js viewer (continuous scrolling pages, text layer, links, find) and mirrors the
 * bits React cares about (page, zoom, find results) into the zustand store.
 */
export class ViewerController {
  private readonly eventBus = new EventBus();
  private readonly linkService: PDFLinkService;
  private readonly findController: PDFFindController;
  private readonly viewer: PDFViewer;
  private doc: PDFDocumentProxy | null = null;
  private readonly abort = new AbortController();
  /** Overlay element per page index. PDF.js strips unknown children on re-render, so we re-attach. */
  private readonly hostEls = new Map<number, { ui: HTMLElement; blend: HTMLElement }>();
  private readonly hostObservers = new Map<number, MutationObserver>();

  constructor(
    private readonly container: HTMLDivElement,
    viewerEl: HTMLDivElement,
  ) {
    this.linkService = new PDFLinkService({ eventBus: this.eventBus });
    this.findController = new PDFFindController({
      linkService: this.linkService,
      eventBus: this.eventBus,
      updateMatchesCountOnProgress: true,
    });
    this.viewer = new PDFViewer({
      container,
      viewer: viewerEl,
      eventBus: this.eventBus,
      linkService: this.linkService,
      findController: this.findController,
      // We build our own highlight/note tools later; keep PDF.js's editor UI out of the way.
      annotationEditorMode: AnnotationEditorType.DISABLE,
    });
    this.linkService.setViewer(this.viewer);

    this.eventBus.on('pagesinit', () => {
      // Apply the zoom the user last chose (kept between documents).
      this.viewer.currentScaleValue = useApp.getState().scaleValue;
      useApp.setState({
        pageNumber: this.viewer.currentPageNumber,
        pagesCount: this.viewer.pagesCount,
      });
    });
    this.eventBus.on('pagerendered', (e: { pageNumber: number; source: unknown }) => {
      this.attachHost(e.pageNumber - 1, e.source as PageViewLike);
    });
    this.eventBus.on('pagechanging', (e: { pageNumber: number }) => {
      useApp.setState({ pageNumber: e.pageNumber });
    });
    this.eventBus.on('scalechanging', (e: { scale: number; presetValue?: string }) => {
      useApp.setState({ scale: e.scale, scaleValue: e.presetValue ?? String(e.scale) });
    });
    this.eventBus.on(
      'updatefindmatchescount',
      (e: { matchesCount: { current: number; total: number } }) => {
        useApp.setState((s) => ({ find: { ...s.find, ...e.matchesCount, notFound: false } }));
      },
    );
    this.eventBus.on(
      'updatefindcontrolstate',
      (e: { state: number; matchesCount: { current: number; total: number } }) => {
        useApp.setState((s) => ({
          find: {
            ...s.find,
            ...e.matchesCount,
            notFound: e.state === FindState.NOT_FOUND,
          },
        }));
      },
    );

    // Re-fit when the viewer's size changes (window resize, sidebar toggle). PDF.js doesn't do this
    // for us: a preset like "fit width" must be re-applied, a fixed zoom just needs a refresh.
    let resizeFrame = 0;
    const resizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        if (!this.doc) return;
        const value = useApp.getState().scaleValue;
        if (Number.isNaN(Number(value))) this.viewer.currentScaleValue = value;
        else this.viewer.update();
      });
    });
    resizeObserver.observe(container);
    this.abort.signal.addEventListener('abort', () => {
      cancelAnimationFrame(resizeFrame);
      resizeObserver.disconnect();
    });

    // Ctrl+wheel zooms. Must be non-passive so we can stop the webview's own page zoom.
    container.addEventListener(
      'wheel',
      (e) => {
        if (!e.ctrlKey) return;
        e.preventDefault();
        this.zoomBy(e.deltaY < 0 ? WHEEL_ZOOM_STEP : 1 / WHEEL_ZOOM_STEP);
      },
      { passive: false, signal: this.abort.signal },
    );

    // Open web links in the default browser.
    container.addEventListener(
      'click',
      (e) => {
        const anchor = (e.target as Element | null)?.closest('a[href]');
        const href = anchor?.getAttribute('href');
        if (href && isExternalHref(href)) {
          e.preventDefault();
          openExternal(href).catch((err) =>
            useApp.setState({ error: `Could not open link ${href}: ${String(err)}` }),
          );
        }
      },
      { capture: true, signal: this.abort.signal },
    );
  }

  /** The scrolling element that holds the pages. */
  getContainer(): HTMLDivElement {
    return this.container;
  }

  /** Creates (once) and keeps attached the overlay host for a rendered page. */
  private attachHost(pageIndex: number, pageView: PageViewLike): void {
    const div = pageView.div;
    let layers = this.hostEls.get(pageIndex);
    if (!layers) {
      const blend = document.createElement('div');
      blend.className = 'hl-blend';
      const ui = document.createElement('div');
      ui.className = 'hl-host';
      layers = { blend, ui };
      this.hostEls.set(pageIndex, layers);
      const attached = layers;
      const observer = new MutationObserver(() => this.reattach(div, attached));
      observer.observe(div, { childList: true });
      this.hostObservers.set(pageIndex, observer);
    }
    this.reattach(div, layers);

    const viewport = pageView.viewport.clone({ scale: 1 });
    const prev = usePageHosts.getState().hosts[pageIndex];
    const { ui, blend } = layers;
    if (
      !prev ||
      prev.el !== ui ||
      prev.viewport.width !== viewport.width ||
      prev.viewport.height !== viewport.height
    ) {
      usePageHosts.setState((s) => ({
        hosts: { ...s.hosts, [pageIndex]: { el: ui, blendEl: blend, viewport } },
      }));
    }
  }

  /** Puts our layers back (blend first, UI above it) if PDF.js dropped or reordered them. */
  private reattach(div: HTMLElement, layers: { ui: HTMLElement; blend: HTMLElement }): void {
    if (layers.blend.parentElement !== div) div.appendChild(layers.blend);
    if (layers.ui.parentElement !== div) div.appendChild(layers.ui);
  }

  private clearHosts(): void {
    for (const observer of this.hostObservers.values()) observer.disconnect();
    for (const { ui, blend } of this.hostEls.values()) {
      ui.remove();
      blend.remove();
    }
    this.hostObservers.clear();
    this.hostEls.clear();
    usePageHosts.setState({ hosts: {} });
  }

  get hasDocument(): boolean {
    return this.doc !== null;
  }

  /** Shows `doc`, replacing (and destroying) whatever was open before. */
  setDocument(doc: PDFDocumentProxy): void {
    this.closeDocument();
    this.doc = doc;
    this.viewer.setDocument(doc);
    this.linkService.setDocument(doc, null);
    this.container.focus();
  }

  closeDocument(): void {
    this.closeFind();
    this.clearHosts();
    this.viewer.setDocument(null);
    this.linkService.setDocument(null, null);
    const old = this.doc;
    this.doc = null;
    if (old) void old.loadingTask.destroy();
    useApp.setState({ pageNumber: 0, pagesCount: 0, find: emptyFind });
  }

  dispose(): void {
    this.abort.abort();
    this.closeDocument();
  }

  // ---- navigation ----

  goToPage(n: number): void {
    if (!this.doc) return;
    this.viewer.currentPageNumber = Math.min(Math.max(1, Math.round(n)), this.viewer.pagesCount);
  }

  /** Scrolls so the given PDF-space point (with a little context above it) is at the top of the view. */
  scrollToPdfPoint(pageIndex: number, x: number, y: number): void {
    if (!this.doc) return;
    this.viewer.scrollPageIntoView({
      pageNumber: pageIndex + 1,
      destArray: [null, { name: 'XYZ' }, x, y + 40, null],
      ignoreDestinationZoom: true,
    });
  }

  // ---- zoom ----

  /** `value` is a preset ('auto' | 'page-fit' | 'page-width') or a scale such as '1.25'. */
  setZoom(value: string): void {
    useApp.setState({ scaleValue: value });
    if (this.doc) this.viewer.currentScaleValue = value;
  }

  zoomBy(factor: number): void {
    if (!this.doc) return;
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, this.viewer.currentScale * factor));
    this.viewer.currentScale = next;
  }

  zoomIn(): void {
    this.zoomBy(WHEEL_ZOOM_STEP);
  }

  zoomOut(): void {
    this.zoomBy(1 / WHEEL_ZOOM_STEP);
  }

  // ---- find ----

  /** Starts a new search (first match is selected) or, with `again`, steps to the next/previous. */
  find(query: string, opts: { again?: boolean; backwards?: boolean } = {}): void {
    if (!this.doc) return;
    useApp.setState((s) => ({ find: { ...s.find, query } }));
    if (!query) {
      this.eventBus.dispatch('findbarclose', { source: this });
      useApp.setState({ find: emptyFind });
      return;
    }
    this.eventBus.dispatch('find', {
      source: this,
      type: opts.again ? 'again' : '',
      query,
      caseSensitive: false,
      entireWord: false,
      highlightAll: true,
      findPrevious: opts.backwards ?? false,
      matchDiacritics: true,
    });
  }

  closeFind(): void {
    this.eventBus.dispatch('findbarclose', { source: this });
  }

  focus(): void {
    this.container.focus();
  }
}
