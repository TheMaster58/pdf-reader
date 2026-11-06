import { useEffect, useRef, useState } from 'react';
import { useApp } from './store';

/** Asks for a document password. Shown while PDF.js is waiting on `onPassword`. */
export function PasswordDialog() {
  const request = useApp((s) => s.passwordRequest);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (request) {
      setValue('');
      inputRef.current?.focus();
    }
  }, [request]);

  if (!request) return null;

  return (
    <div className="modal-backdrop">
      <form
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pw-title"
        onSubmit={(e) => {
          e.preventDefault();
          request.resolve(value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') request.resolve(null);
        }}
      >
        <h2 id="pw-title">Password required</h2>
        <p>
          {request.reason === 'incorrect'
            ? 'That password was incorrect. Try again.'
            : `${request.fileName} is password protected.`}
        </p>
        <input
          ref={inputRef}
          type="password"
          aria-label="Document password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <div className="modal-actions">
          <button type="button" onClick={() => request.resolve(null)}>
            Cancel
          </button>
          <button type="submit" className="primary">
            Open
          </button>
        </div>
      </form>
    </div>
  );
}
