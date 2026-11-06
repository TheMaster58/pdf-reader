import { useEffect, useRef } from 'react';
import { useApp } from './store';

/** "Save changes?" prompt shown before unsaved highlights or notes would be discarded. */
export function UnsavedDialog() {
  const prompt = useApp((s) => s.unsavedPrompt);
  const saveRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (prompt) saveRef.current?.focus();
  }, [prompt]);

  if (!prompt) return null;

  return (
    <div className="modal-backdrop">
      <div
        className="modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="unsaved-title"
        onKeyDown={(e) => {
          if (e.key === 'Escape') prompt.resolve('cancel');
        }}
      >
        <h2 id="unsaved-title">Save your highlights and notes?</h2>
        <p>
          {prompt.fileName} has changes that haven&apos;t been saved. If you don&apos;t save, they will be
          lost.
        </p>
        <div className="modal-actions">
          <button type="button" onClick={() => prompt.resolve('cancel')}>
            Cancel
          </button>
          <button type="button" onClick={() => prompt.resolve('discard')}>
            Don&apos;t save
          </button>
          <button ref={saveRef} type="button" className="primary" onClick={() => prompt.resolve('save')}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
