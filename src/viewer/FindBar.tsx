import { useEffect, useRef } from 'react';
import { getController } from './actions';
import { useApp } from './store';

export function FindBar() {
  const open = useApp((s) => s.findOpen);
  const find = useApp((s) => s.find);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus (and select any previous query) each time the bar opens, including via Ctrl+F while open.
  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [open]);

  if (!open) return null;

  const close = () => {
    getController()?.closeFind();
    useApp.setState({ findOpen: false });
    getController()?.focus();
  };

  let status = '';
  if (find.query) {
    if (find.notFound) status = 'No results';
    else if (find.total > 0) status = `${find.current} of ${find.total}`;
  }

  return (
    <div className="findbar" role="search">
      <input
        ref={inputRef}
        type="text"
        aria-label="Find in document"
        placeholder="Find in document"
        value={find.query}
        onChange={(e) => getController()?.find(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            getController()?.find(find.query, { again: true, backwards: e.shiftKey });
          } else if (e.key === 'Escape') {
            e.preventDefault();
            close();
          }
        }}
      />
      <span className={find.notFound ? 'find-status not-found' : 'find-status'} aria-live="polite">
        {status}
      </span>
      <button
        type="button"
        aria-label="Previous match"
        title="Previous (Shift+Enter)"
        disabled={!find.total}
        onClick={() => getController()?.find(find.query, { again: true, backwards: true })}
      >
        Prev
      </button>
      <button
        type="button"
        aria-label="Next match"
        title="Next (Enter)"
        disabled={!find.total}
        onClick={() => getController()?.find(find.query, { again: true })}
      >
        Next
      </button>
      <button type="button" aria-label="Close find" title="Close (Esc)" onClick={close}>
        Close
      </button>
    </div>
  );
}
