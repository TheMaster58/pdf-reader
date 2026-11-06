import { useEffect, useRef, useState } from 'react';
import { saveAuthor } from '../services/files';
import { useSignatures } from '../signature/signatureStore';
import { useApp } from './store';

/**
 * The form is its own component, mounted only while the dialog is open. Its draft therefore starts
 * from the author as it is *now*, with the right value on the very first render. (Keeping the draft
 * in a component that is always mounted left it stale, and re-syncing it in an effect reset the
 * text selection that had just been made.)
 */
function SettingsForm({ initialAuthor }: { initialAuthor: string }) {
  const [draft, setDraft] = useState(initialAuthor);
  const savedCount = useSignatures((s) => s.saved.length);
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const close = () => useApp.setState({ settingsOpen: false });

  return (
    <div className="modal-backdrop">
      <form
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onSubmit={(e) => {
          e.preventDefault();
          const name = draft.trim();
          saveAuthor(name);
          useApp.setState({ author: name, settingsOpen: false });
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close();
        }}
      >
        <h2 id="settings-title">Settings</h2>
        <label className="field">
          <span>Author name</span>
          <input
            ref={inputRef}
            type="text"
            value={draft}
            maxLength={100}
            onChange={(e) => setDraft(e.target.value)}
          />
        </label>
        <p>Shown as the author of highlights and notes you add from now on. Existing ones keep their author.</p>
        <div className="field">
          <span>Saved signatures</span>
          {savedCount === 0 ? (
            <p>None are saved on this computer.</p>
          ) : confirmingRemoval ? (
            <div className="remove-confirm">
              <p>
                Remove {savedCount} saved {savedCount === 1 ? 'signature' : 'signatures'} from this computer?
              </p>
              <button type="button" onClick={() => setConfirmingRemoval(false)}>
                Keep them
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => {
                  useSignatures.getState().clearAll();
                  setConfirmingRemoval(false);
                }}
              >
                Remove
              </button>
            </div>
          ) : (
            <button type="button" className="danger" onClick={() => setConfirmingRemoval(true)}>
              Remove all saved signatures...
            </button>
          )}
        </div>
        <div className="modal-actions">
          <button
            type="button"
            className="about-link"
            onClick={() => useApp.setState({ settingsOpen: false, aboutOpen: true })}
          >
            About...
          </button>
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="primary">
            Save
          </button>
        </div>
      </form>
    </div>
  );
}

/** Small settings dialog. For now there is one setting: the name stamped on new annotations. */
export function SettingsDialog() {
  const open = useApp((s) => s.settingsOpen);
  const author = useApp((s) => s.author);
  return open ? <SettingsForm initialAuthor={author} /> : null;
}
