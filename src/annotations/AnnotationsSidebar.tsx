import { useMemo } from 'react';
import { getController } from '../viewer/actions';
import { anchorPoint, groupByPage, hasNote } from './list';
import type { Annotation } from './model';
import { useAnnotations } from './store';

function BubbleChip({ color }: { color: string }) {
  return (
    <svg className="chip-bubble" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        d="M3 3h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H10l-5 4v-4H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"
        fill={color}
        stroke="rgb(0 0 0 / 0.6)"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** A small pen mark standing for a signature in the list. */
function SignatureChip() {
  return (
    <svg className="chip-bubble" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path d="M3 17c3-9 5-11 6-9s-2 8 0 8 3-5 5-5 1 4 3 4 2-2 4-3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Item({ ann, selected }: { ann: Annotation; selected: boolean }) {
  const go = () => {
    useAnnotations.getState().select(ann.id);
    const [x, y] = anchorPoint(ann);
    getController()?.scrollToPdfPoint(ann.pageIndex, x, y);
  };

  return (
    <li>
      <button
        type="button"
        className={'sidebar-item' + (selected ? ' selected' : '')}
        aria-current={selected ? 'true' : undefined}
        onClick={go}
      >
        {ann.kind === 'highlight' ? (
          <>
            <span className="chip-bar" style={{ background: ann.color }} aria-hidden="true" />
            <span className="item-body">
              <span className="item-text">{ann.text || '(highlight)'}</span>
              {hasNote(ann) && <span className="item-note">{ann.contents}</span>}
            </span>
          </>
        ) : ann.kind === 'signature' ? (
          <>
            <SignatureChip />
            <span className="item-body">
              <span className="item-text">{ann.variant === 'initials' ? 'Initials' : 'Signature'}</span>
            </span>
          </>
        ) : ann.kind === 'textbox' ? (
          <>
            <span className="chip-text" style={{ color: ann.color }} aria-hidden="true">
              T
            </span>
            <span className="item-body">
              {ann.replaces && <span className="item-note">Edited text</span>}
              {hasNote(ann) ? (
                <span className="item-text">{ann.contents}</span>
              ) : (
                <span className="item-empty">{ann.replaces ? 'Text removed' : 'Empty text box'}</span>
              )}
            </span>
          </>
        ) : (
          <>
            <BubbleChip color={ann.color} />
            <span className="item-body">
              {hasNote(ann) ? (
                <span className="item-note plain">{ann.contents}</span>
              ) : (
                <span className="item-empty">Empty note</span>
              )}
            </span>
          </>
        )}
      </button>
    </li>
  );
}

/** Lists every highlight and note by page; clicking one selects it and scrolls to it. */
export function AnnotationsSidebar() {
  const open = useAnnotations((s) => s.sidebarOpen);
  const annotations = useAnnotations((s) => s.annotations);
  const selectedId = useAnnotations((s) => s.selectedId);
  const groups = useMemo(() => groupByPage(annotations), [annotations]);

  if (!open) return null;

  return (
    <aside className="sidebar" aria-label="Annotations">
      <header className="sidebar-header">
        <h2>Annotations</h2>
        <span className="sidebar-count">{annotations.length}</span>
        <button
          type="button"
          className="sidebar-close"
          aria-label="Close annotations panel"
          onClick={() => useAnnotations.getState().setSidebarOpen(false)}
        >
          Close
        </button>
      </header>
      {groups.length === 0 ? (
        <p className="sidebar-empty">
          Nothing yet. Select text to highlight it, press <kbd>N</kbd> and click a page to add a note,
          or press <kbd>T</kbd> to add a text box.
        </p>
      ) : (
        <div className="sidebar-list">
          {groups.map((g) => (
            <section key={g.pageIndex} aria-label={`Page ${g.pageIndex + 1}`}>
              <h3>Page {g.pageIndex + 1}</h3>
              <ul>
                {g.items.map((a) => (
                  <Item key={a.id} ann={a} selected={a.id === selectedId} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </aside>
  );
}
