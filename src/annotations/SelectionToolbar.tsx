import { useEffect, useState } from 'react';
import { getController } from '../viewer/actions';
import { useApp } from '../viewer/store';
import { ColorSwatches } from './ColorSwatches';
import { captureSelection, highlightSelection, hitTestAnnotation, placeNoteAt } from './interaction';
import { useAnnotations } from './store';

interface Anchor {
  /** Horizontal centre of the selection, client px. */
  x: number;
  top: number;
  bottom: number;
}

const TOOLBAR_HEIGHT = 44;
/** Keep the toolbar clear of the app toolbar at the top of the window. */
const TOP_MARGIN = 56;

const isTextField = (t: EventTarget | null) =>
  t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;

/**
 * Pointer behaviour around the PDF text, driven by document-level mouse/keyboard events because
 * the PDF container is created imperatively by PDF.js:
 *  - a text selection pops up a colour toolbar;
 *  - a plain click on a highlight or note selects it (and a click elsewhere deselects);
 *  - with the note tool active, a click on a page drops a sticky note there.
 */
export function SelectionToolbar() {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const activeColor = useAnnotations((s) => s.activeColor);
  const tool = useAnnotations((s) => s.tool);

  // Crosshair cursor (and no text selection) while placing a note.
  useEffect(() => {
    const c = getController()?.getContainer();
    c?.classList.toggle('note-tool', tool === 'note');
    return () => c?.classList.remove('note-tool');
  }, [tool]);

  useEffect(() => {
    let dragging = false;
    let down: { x: number; y: number } | null = null;
    // The click event arrives right after the mouse-up that placed a note, by which time the tool
    // has already switched back to "select". Swallow that one click so links under it don't fire.
    let swallowClick = false;

    const container = () => getController()?.getContainer() ?? null;

    const refresh = () => {
      const c = container();
      const cap = c ? captureSelection(c) : null;
      if (!c || !cap || useApp.getState().annotationBlock) {
        setAnchor(null);
        return;
      }
      // Selection scrolled completely out of view: nothing to attach the toolbar to.
      const view = c.getBoundingClientRect();
      if (cap.bounds.bottom < view.top || cap.bounds.top > view.bottom) {
        setAnchor(null);
        return;
      }
      useAnnotations.getState().select(null);
      setAnchor({ x: (cap.bounds.left + cap.bounds.right) / 2, top: cap.bounds.top, bottom: cap.bounds.bottom });
    };

    const inContainer = (t: EventTarget | null) => {
      const c = container();
      return !!c && t instanceof Node && c.contains(t);
    };
    const inPopover = (t: EventTarget | null) => t instanceof Element && !!t.closest('.hl-popover');
    const placing = () => useAnnotations.getState().tool === 'note';

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0 || !inContainer(e.target) || inPopover(e.target)) return;
      dragging = true;
      down = { x: e.clientX, y: e.clientY };
      setAnchor(null);
      if (placing()) {
        // Placing a note: don't start a text selection.
        e.preventDefault();
        return;
      }
      // PDF.js's text layer keeps the old selection alive when you press on blank page area, so a
      // click there would never dismiss it. Clear it ourselves; a drag or double-click that follows
      // makes a fresh selection. Shift-click extends the existing one, so leave that alone.
      if (!e.shiftKey) window.getSelection()?.removeAllRanges();
    };

    const onMouseUp = (e: MouseEvent) => {
      if (!dragging) return;
      dragging = false;
      const start = down;
      down = null;
      const moved = start ? Math.hypot(e.clientX - start.x, e.clientY - start.y) : 0;

      if (placing()) {
        const store = useAnnotations.getState();
        if (moved < 5) placeNoteAt(e.clientX, e.clientY);
        store.setTool('select'); // one note per activation
        swallowClick = true;
        setTimeout(() => (swallowClick = false), 400);
        return;
      }

      // Let the browser finalise the selection before reading it.
      setTimeout(() => {
        const sel = window.getSelection();
        if (sel && !sel.isCollapsed) {
          refresh();
          return;
        }
        // No selection: this was a click. Select the highlight or note under it, if any.
        const onLink = e.target instanceof Element && !!e.target.closest('a[href]');
        if (moved < 5 && !onLink) {
          useAnnotations.getState().select(hitTestAnnotation(e.clientX, e.clientY));
        }
        setAnchor(null);
      }, 0);
    };

    // In note mode a click must not follow links under the cursor.
    const onClickCapture = (e: MouseEvent) => {
      if ((placing() || swallowClick) && inContainer(e.target) && !inPopover(e.target)) {
        e.preventDefault();
        e.stopPropagation();
        swallowClick = false;
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (isTextField(e.target)) return;
      if (e.shiftKey || e.key.startsWith('Arrow') || (e.ctrlKey && e.key.toLowerCase() === 'a')) refresh();
    };

    const onSelectionChange = () => {
      if (dragging) return;
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) setAnchor(null);
    };

    // Keep the toolbar attached to the selection while the document scrolls.
    const onScroll = (e: Event) => {
      if (!dragging && inContainer(e.target)) refresh();
    };

    document.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('mouseup', onMouseUp, true);
    document.addEventListener('click', onClickCapture, true);
    document.addEventListener('keyup', onKeyUp);
    document.addEventListener('selectionchange', onSelectionChange);
    document.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onMouseDown, true);
      document.removeEventListener('mouseup', onMouseUp, true);
      document.removeEventListener('click', onClickCapture, true);
      document.removeEventListener('keyup', onKeyUp);
      document.removeEventListener('selectionchange', onSelectionChange);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, []);

  if (!anchor) return null;

  const above = anchor.top - TOOLBAR_HEIGHT - 8 >= TOP_MARGIN;
  const top = above ? anchor.top - TOOLBAR_HEIGHT - 8 : anchor.bottom + 8;
  const left = Math.min(Math.max(anchor.x, 150), window.innerWidth - 150);

  const highlight = (color: string, withNote: boolean) => {
    const c = getController()?.getContainer();
    const created = c ? highlightSelection(c, color) : [];
    setAnchor(null);
    if (withNote && created.length) {
      const store = useAnnotations.getState();
      store.select(created[0].id);
      store.requestNoteFocus(created[0].id);
    }
  };

  return (
    <div
      className="selection-toolbar"
      role="toolbar"
      aria-label="Highlight selection"
      style={{ top, left }}
      // Keep the text selection alive: a button press must not move focus or collapse it.
      onMouseDown={(e) => e.preventDefault()}
    >
      <ColorSwatches value={activeColor} label="Highlight" onPick={(color) => highlight(color, false)} />
      <button
        type="button"
        className="toolbar-note-btn"
        title="Highlight and add a note"
        onClick={() => highlight(activeColor, true)}
      >
        + Note
      </button>
    </div>
  );
}
