import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getController } from '../viewer/actions';
import { ColorSwatches } from './ColorSwatches';
import { pdfPointToFraction, pdfToFraction, type Rect } from './geometry';
import { hasNote } from './list';
import {
  NOTE_ICON_PX,
  NOTE_MARKER,
  type Annotation,
  type HighlightAnnotation,
  type NoteAnnotation,
} from './model';
import { usePageHosts, type PageHost } from './pageHosts';
import { useAnnotations } from './store';
import { SignatureView } from './SignatureView';
import { TextBoxView, TextFormatBar } from './TextBox';

const pct = (v: number) => `${(v * 100).toFixed(4)}%`;

function rectStyle(f: Rect) {
  return { left: pct(f.left), top: pct(f.top), width: pct(f.right - f.left), height: pct(f.bottom - f.top) };
}

const POPOVER_WIDTH = 260;
const GAP = 6;

/** Speech-bubble glyph used for sticky notes and the comment marker on highlights. */
function BubbleIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path
        d="M3 3h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H10l-5 4v-4H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"
        fill={color}
        stroke="rgb(0 0 0 / 0.6)"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path d="M6 8h12M6 12h8" stroke="rgb(0 0 0 / 0.6)" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/** Where the popover attaches, as page fractions plus fixed pixel offsets (icons don't scale). */
interface Anchor {
  left: number;
  /** Fraction of the page height of the edge the popover opens below. */
  belowAt: number;
  belowPx: number;
  /** Fraction of the page height of the edge it opens above when there isn't room below. */
  aboveAt: number;
}

/** Editor for the selected annotation: colour, comment, delete. Sits inside the page. */
function AnnotationPopover({
  ann,
  anchor,
  host,
}: {
  ann: HighlightAnnotation | NoteAnnotation;
  anchor: Anchor;
  host: PageHost;
}) {
  const update = useAnnotations((s) => s.updateAnnotation);
  const remove = useAnnotations((s) => s.removeAnnotations);
  const select = useAnnotations((s) => s.select);
  const focusNoteId = useAnnotations((s) => s.focusNoteId);
  const requestNoteFocus = useAnnotations((s) => s.requestNoteFocus);

  const rootRef = useRef<HTMLDivElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const [flip, setFlip] = useState(false);

  // Newly placed notes (and "Highlight + note") start with the cursor in the comment field.
  useLayoutEffect(() => {
    if (focusNoteId === ann.id) {
      noteRef.current?.focus();
      requestNoteFocus(null);
    }
  }, [focusNoteId, ann.id, requestNoteFocus]);

  // Open upwards when the popover wouldn't fit below the anchor inside the page. Re-check when the
  // page is resized (zoom), since the anchor is partly a fraction of the page height.
  useLayoutEffect(() => {
    const measure = () => {
      const root = rootRef.current;
      if (!root) return;
      const pageHeight = host.el.clientHeight;
      const belowEdge = anchor.belowAt * pageHeight + anchor.belowPx + root.offsetHeight;
      setFlip(belowEdge > pageHeight);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host.el);
    return () => observer.disconnect();
  }, [host.el, anchor.belowAt, anchor.belowPx]);

  const style = flip
    ? { top: `calc(${pct(anchor.aboveAt)} - ${GAP}px)`, transform: 'translateY(-100%)' }
    : { top: `calc(${pct(anchor.belowAt)} + ${anchor.belowPx}px)` };

  const close = () => {
    select(null);
    getController()?.focus();
  };

  return (
    <div
      ref={rootRef}
      className="hl-popover"
      role="dialog"
      aria-label={ann.kind === 'note' ? 'Note' : 'Highlight'}
      style={{
        left: `clamp(0%, ${pct(anchor.left)}, calc(100% - ${POPOVER_WIDTH + 10}px))`,
        width: POPOVER_WIDTH,
        ...style,
      }}
    >
      <div className="popover-row">
        <ColorSwatches
          value={ann.color}
          label={ann.kind === 'note' ? 'Change note to' : 'Change highlight to'}
          onPick={(color) => color !== ann.color && update(ann.id, { color })}
        />
        <button type="button" className="danger" onClick={() => remove([ann.id])}>
          Delete
        </button>
      </div>
      <textarea
        ref={noteRef}
        className="note-field"
        aria-label="Note"
        placeholder={ann.kind === 'note' ? 'Write a note...' : 'Add a note to this highlight...'}
        rows={3}
        value={ann.contents}
        onChange={(e) => update(ann.id, { contents: e.target.value }, { coalesce: true })}
        onKeyDown={(e) => {
          if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
            e.preventDefault();
            close();
          }
        }}
      />
    </div>
  );
}

function PageOverlay({ host, annotations }: { host: PageHost; annotations: Annotation[] }) {
  const selectedId = useAnnotations((s) => s.selectedId);

  // Where each annotation sits on the page, as fractions of it. Only the field for its kind is set.
  const placed = useMemo(
    () =>
      annotations.map((ann) => ({
        ann,
        rects: ann.kind === 'highlight' ? ann.rects.map((r) => pdfToFraction(host.viewport, r)) : ([] as Rect[]),
        point: ann.kind === 'note' ? pdfPointToFraction(host.viewport, ann.point) : null,
      })),
    [annotations, host.viewport],
  );
  const selected = placed.find((p) => p.ann.id === selectedId);

  let anchor: Anchor | null = null;
  if (selected) {
    if (selected.ann.kind === 'highlight' && selected.rects.length) {
      const lowest = selected.rects.reduce((a, b) => (b.bottom > a.bottom ? b : a));
      const highest = selected.rects.reduce((a, b) => (b.top < a.top ? b : a));
      anchor = { left: lowest.left, belowAt: lowest.bottom, belowPx: GAP, aboveAt: highest.top };
    } else if (selected.point) {
      anchor = {
        left: selected.point.x,
        belowAt: selected.point.y,
        belowPx: NOTE_ICON_PX + GAP,
        aboveAt: selected.point.y,
      };
    }
  }
  const selectedBox = selected?.ann.kind === 'textbox' ? selected.ann : null;

  return (
    <>
      {createPortal(
        placed.flatMap(({ ann, rects }) =>
          ann.kind === 'highlight'
            ? rects.map((f, i) => (
                <div
                  key={`${ann.id}-${i}`}
                  className={'hl-rect' + (ann.id === selectedId ? ' selected' : '')}
                  data-annotation-id={ann.id}
                  style={{ ...rectStyle(f), background: ann.color }}
                />
              ))
            : [],
        ),
        host.blendEl,
      )}
      {createPortal(
        <>
          {placed.map((p) => {
            const { ann } = p;
            if (ann.kind === 'textbox') return <TextBoxView key={ann.id} ann={ann} host={host} />;
            if (ann.kind === 'signature') return <SignatureView key={ann.id} ann={ann} host={host} />;
            if (ann.kind === 'note' && p.point) {
              return (
                <div
                  key={ann.id}
                  className={'note-icon' + (ann.id === selectedId ? ' selected' : '')}
                  data-annotation-id={ann.id}
                  style={{ left: pct(p.point.x), top: pct(p.point.y), width: NOTE_ICON_PX, height: NOTE_ICON_PX }}
                >
                  <BubbleIcon size={NOTE_ICON_PX} color={ann.color} />
                </div>
              );
            }
            if (ann.kind === 'highlight' && hasNote(ann) && p.rects.length) {
              const first = p.rects.reduce((a, b) => (b.top < a.top ? b : a));
              return (
                <div
                  key={ann.id}
                  className="note-marker"
                  data-annotation-id={ann.id}
                  style={{
                    left: `calc(${pct(first.right)} + ${NOTE_MARKER.dx}px)`,
                    top: `calc(${pct(first.top)} + ${NOTE_MARKER.dy}px)`,
                    width: NOTE_MARKER.size,
                    height: NOTE_MARKER.size,
                  }}
                >
                  <BubbleIcon size={NOTE_MARKER.size} color={ann.color} />
                </div>
              );
            }
            return null;
          })}
          {selected && anchor && (selected.ann.kind === 'highlight' || selected.ann.kind === 'note') && (
            <AnnotationPopover ann={selected.ann} anchor={anchor} host={host} />
          )}
          {selectedBox && <TextFormatBar ann={selectedBox} host={host} />}
        </>,
        host.el,
      )}
    </>
  );
}

/** Renders every page's annotations into that page's overlay layers (portals). */
export function HighlightLayers() {
  const hosts = usePageHosts((s) => s.hosts);
  const annotations = useAnnotations((s) => s.annotations);

  const byPage = useMemo(() => {
    const map = new Map<number, Annotation[]>();
    for (const a of annotations) {
      const list = map.get(a.pageIndex);
      if (list) list.push(a);
      else map.set(a.pageIndex, [a]);
    }
    return map;
  }, [annotations]);

  return (
    <>
      {[...byPage.entries()].map(([pageIndex, anns]) => {
        const host = hosts[pageIndex];
        return host ? <PageOverlay key={pageIndex} host={host} annotations={anns} /> : null;
      })}
    </>
  );
}
