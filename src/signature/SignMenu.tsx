import { useState } from 'react';
import { useAnnotations } from '../annotations/store';
import type { SignatureVariant } from '../annotations/model';
import { useApp } from '../viewer/store';
import type { SavedSignature } from './savedSignatures';
import { SignatureArt } from './SignatureArt';
import { useSignatures } from './signatureStore';

function SavedRow({ item, onPick }: { item: SavedSignature; onPick: () => void }) {
  const remove = useSignatures((s) => s.remove);
  const label = item.variant === 'initials' ? 'initials' : 'signature';
  return (
    <li role="none" className="saved-row">
      <button
        type="button"
        role="menuitem"
        className="saved-pick"
        title={`Place this ${label}`}
        onClick={onPick}
      >
        <span className="saved-art">
          <SignatureArt artwork={item.artwork} style={{ objectFit: 'contain' }} />
        </span>
      </button>
      <button
        type="button"
        className="saved-remove"
        aria-label={`Remove saved ${label}`}
        title={`Remove this saved ${label}`}
        onClick={() => remove(item.id)}
      >
        &times;
      </button>
    </li>
  );
}

/**
 * The Sign button with its menu, like Acrobat's Fill & Sign. The button places your newest saved
 * signature at once (or asks you to make one if there is none yet); the arrow opens the menu with
 * every saved signature and initials, and the way to add more.
 */
export function SignMenu() {
  const hasDoc = useApp((s) => s.status === 'ready');
  const blocked = useApp((s) => s.annotationBlock !== null);
  const saved = useSignatures((s) => s.saved);
  const signing = useAnnotations((s) => s.tool === 'sign');
  const [open, setOpen] = useState(false);

  const signatures = saved.filter((s) => s.variant === 'signature');
  const initials = saved.filter((s) => s.variant === 'initials');
  const disabled = !hasDoc || blocked;
  const close = () => setOpen(false);

  const carry = (item: SavedSignature) => {
    useAnnotations.getState().startSigning({ variant: item.variant, artwork: item.artwork });
    close();
  };
  const add = (variant: SignatureVariant) => {
    useSignatures.getState().openDialog(variant);
    close();
  };

  const onMain = () => {
    if (signing) {
      useAnnotations.getState().setTool('select');
    } else if (signatures.length > 0) {
      carry(signatures[0]);
    } else {
      add('signature');
    }
  };

  return (
    <div className="menu sign-menu">
      <button
        type="button"
        className="split-main"
        aria-pressed={signing}
        disabled={disabled}
        title="Sign: place your saved signature (click the page to put it down)"
        onClick={onMain}
      >
        Sign
      </button>
      <button
        type="button"
        className="split-arrow"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Signature menu"
        disabled={disabled}
        title="Saved signatures and initials"
        onClick={() => setOpen((o) => !o)}
      >
        {'▾'}
      </button>
      {open && (
        <>
          <div className="menu-backdrop" onClick={close} />
          <ul
            className="menu-list sign-list"
            role="menu"
            onKeyDown={(e) => e.key === 'Escape' && close()}
          >
            {signatures.length > 0 && (
              <li role="presentation" className="menu-heading">
                Signatures
              </li>
            )}
            {signatures.map((s) => (
              <SavedRow key={s.id} item={s} onPick={() => carry(s)} />
            ))}
            {initials.length > 0 && (
              <li role="presentation" className="menu-heading">
                Initials
              </li>
            )}
            {initials.map((s) => (
              <SavedRow key={s.id} item={s} onPick={() => carry(s)} />
            ))}
            {saved.length > 0 && <li role="separator" className="menu-sep" />}
            <li role="none">
              <button type="button" role="menuitem" onClick={() => add('signature')}>
                Add signature...
              </button>
            </li>
            <li role="none">
              <button type="button" role="menuitem" onClick={() => add('initials')}>
                Add initials...
              </button>
            </li>
          </ul>
        </>
      )}
    </div>
  );
}
