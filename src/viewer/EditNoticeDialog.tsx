import { useEffect, useRef } from 'react';
import { markEditNoticeSeen } from '../annotations/editMode';
import { useApp } from './store';

/**
 * Shown the first time Edit text is used. It says plainly how the feature works and, more
 * importantly, what it is not: the original text is covered, not removed.
 */
export function EditNoticeDialog() {
  const open = useApp((s) => s.editNoticeOpen);
  const okRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) okRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const close = () => {
    markEditNoticeSeen();
    useApp.setState({ editNoticeOpen: false });
  };

  return (
    <div className="modal-backdrop">
      <div
        className="modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="edit-notice-title"
        onKeyDown={(e) => {
          if (e.key === 'Escape') close();
        }}
      >
        <h2 id="edit-notice-title">Editing existing text</h2>
        <p>
          Click a line of text and retype it. The new text is placed over the old one, in the
          closest standard font, size and colour.
        </p>
        <p>
          <strong>The old text is covered, not removed.</strong> It is still in the file under the
          new text, so other programs can still find and copy it. Do not use this to hide sensitive
          information.
        </p>
        <p>To undo an edit, select it and choose Revert, or press Ctrl+Z.</p>
        <div className="modal-actions">
          <button ref={okRef} type="button" className="primary" onClick={close}>
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
