import { useEffect, useRef } from 'react';
import { useApp } from './store';

/**
 * Shown before saving over a file that carries a digital (certificate) signature. Saving rewrites
 * the file, which makes that signature invalid, so the safe choice (a copy) is the default.
 */
export function SignedDialog() {
  const prompt = useApp((s) => s.signedPrompt);
  const copyRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (prompt) copyRef.current?.focus();
  }, [prompt]);

  if (!prompt) return null;

  return (
    <div className="modal-backdrop">
      <div
        className="modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="signed-title"
        onKeyDown={(e) => {
          if (e.key === 'Escape') prompt.resolve('cancel');
        }}
      >
        <h2 id="signed-title">This PDF has a digital signature</h2>
        <p>
          {prompt.fileName} is signed. Saving your changes into it will make that signature invalid.
          Save a copy instead to keep the original signed file as it is.
        </p>
        <div className="modal-actions">
          <button type="button" onClick={() => prompt.resolve('cancel')}>
            Cancel
          </button>
          <button type="button" className="danger" onClick={() => prompt.resolve('overwrite')}>
            Save anyway
          </button>
          <button
            ref={copyRef}
            type="button"
            className="primary"
            onClick={() => prompt.resolve('copy')}
          >
            Save a copy...
          </button>
        </div>
      </div>
    </div>
  );
}
