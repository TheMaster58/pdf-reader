import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { SignatureArtwork, SignatureVariant } from '../annotations/model';
import { useAnnotations } from '../annotations/store';
import { DrawPad } from './DrawPad';
import { PictureError, TYPED_FONTS, fileToArtwork, textToArtwork } from './imageImport';
import { SignatureArt } from './SignatureArt';
import { useSignatures } from './signatureStore';
import { normaliseStrokes, type Stroke } from './strokes';

type Tab = 'draw' | 'image' | 'type';

const INKS = [
  { name: 'Black', value: '#000000' },
  { name: 'Blue', value: '#1565C0' },
  { name: 'Red', value: '#D32F2F' },
];
const PENS = [
  { name: 'Thin', value: 2 },
  { name: 'Medium', value: 3.2 },
  { name: 'Thick', value: 5 },
];

const TITLES: Record<SignatureVariant, string> = {
  signature: 'Add signature',
  initials: 'Add initials',
};

function InkSwatches({ value, onPick }: { value: string; onPick: (color: string) => void }) {
  return (
    <div className="swatches" role="group" aria-label="Ink colour">
      {INKS.map((c) => (
        <button
          key={c.value}
          type="button"
          className={'swatch' + (c.value === value ? ' current' : '')}
          style={{ background: c.value }}
          aria-label={c.name}
          aria-pressed={c.value === value}
          title={c.name}
          onClick={() => onPick(c.value)}
        />
      ))}
    </div>
  );
}

/**
 * The "Add signature" / "Add initials" dialog: draw it, import a picture of it, or type it. Applying
 * hands the artwork to the sign tool (the next click on a page places it) and, if asked, keeps a
 * copy on this computer for next time.
 */
function SignatureForm({ variant }: { variant: SignatureVariant }) {
  const close = useSignatures((s) => s.closeDialog);
  const storageFailed = useSignatures((s) => s.storageFailed);
  const [tab, setTab] = useState<Tab>('draw');
  const [keep, setKeep] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Draw
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [ink, setInk] = useState(INKS[0].value);
  const [pen, setPen] = useState(PENS[1].value);
  // Image
  const [picture, setPicture] = useState<SignatureArtwork | null>(null);
  // Type
  const [name, setName] = useState('');
  const [fontIndex, setFontIndex] = useState(0);
  const [typedInk, setTypedInk] = useState(INKS[0].value);

  const firstFocus = useRef<HTMLButtonElement>(null);
  useEffect(() => firstFocus.current?.focus(), []);

  const label = variant === 'initials' ? 'initials' : 'signature';

  const canApply =
    !busy &&
    (tab === 'draw'
      ? strokes.length > 0
      : tab === 'image'
        ? picture !== null
        : name.trim().length > 0);

  const finish = (artwork: SignatureArtwork) => {
    if (keep) useSignatures.getState().save(variant, artwork);
    useAnnotations.getState().startSigning({ variant, artwork });
    close();
  };

  const apply = () => {
    if (!canApply) return;
    setError(null);
    try {
      if (tab === 'draw') {
        const normalised = normaliseStrokes(strokes, pen);
        if (!normalised) return;
        finish({
          type: 'strokes',
          strokes: normalised.strokes,
          color: ink,
          width: pen,
          box: normalised.box,
        });
      } else if (tab === 'image' && picture) {
        finish(picture);
      } else if (tab === 'type') {
        finish(textToArtwork(name, TYPED_FONTS[fontIndex].css, typedInk));
      }
    } catch (err) {
      setError(err instanceof PictureError ? err.message : 'Could not make the signature.');
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setPicture(null);
    try {
      setPicture(await fileToArtwork(file));
    } catch (err) {
      setError(err instanceof PictureError ? err.message : 'That picture could not be used.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <div
        className="modal signature-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="signature-title"
        onKeyDown={(e) => {
          if (e.key === 'Escape') close();
        }}
      >
        <h2 id="signature-title">{TITLES[variant]}</h2>

        <div className="tabs" role="tablist" aria-label="How to make it">
          {(['draw', 'image', 'type'] as Tab[]).map((t, i) => (
            <button
              key={t}
              ref={i === 0 ? firstFocus : undefined}
              type="button"
              role="tab"
              aria-selected={tab === t}
              className={tab === t ? 'tab current' : 'tab'}
              onClick={() => {
                setTab(t);
                setError(null);
              }}
            >
              {t === 'draw' ? 'Draw' : t === 'image' ? 'Image' : 'Type'}
            </button>
          ))}
        </div>

        <div className="tab-panel" role="tabpanel">
          {tab === 'draw' && (
            <>
              <DrawPad strokes={strokes} color={ink} width={pen} onChange={setStrokes} />
              <div className="draw-controls">
                <InkSwatches value={ink} onPick={setInk} />
                <label className="field inline">
                  <span>Pen</span>
                  <select value={pen} onChange={(e) => setPen(Number(e.target.value))}>
                    {PENS.map((p) => (
                      <option key={p.name} value={p.value}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <span className="spacer" />
                <button
                  type="button"
                  disabled={strokes.length === 0}
                  onClick={() => setStrokes(strokes.slice(0, -1))}
                >
                  Undo
                </button>
                <button
                  type="button"
                  disabled={strokes.length === 0}
                  onClick={() => setStrokes([])}
                >
                  Clear
                </button>
              </div>
            </>
          )}

          {tab === 'image' && (
            <div className="image-tab">
              <p>
                Choose a picture of your {label}, such as a photo or scan on white paper. The paper
                is made see-through.
              </p>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                aria-label="Picture of your signature"
                onChange={(e) => void onFile(e.target.files?.[0])}
              />
              <div className="picture-preview">
                {picture ? (
                  <SignatureArt artwork={picture} style={{ maxHeight: 120 }} />
                ) : (
                  <span>{busy ? 'Reading...' : 'No picture chosen'}</span>
                )}
              </div>
            </div>
          )}

          {tab === 'type' && (
            <div className="type-tab">
              <input
                type="text"
                aria-label={`Type your ${label}`}
                placeholder={variant === 'initials' ? 'Your initials' : 'Your name'}
                maxLength={40}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <div className="type-fonts" role="radiogroup" aria-label="Style">
                {TYPED_FONTS.map((f, i) => (
                  <button
                    key={f.name}
                    type="button"
                    role="radio"
                    aria-checked={fontIndex === i}
                    className={'type-font' + (fontIndex === i ? ' current' : '')}
                    style={{ fontFamily: f.css, color: typedInk }}
                    onClick={() => setFontIndex(i)}
                  >
                    {name.trim() || (variant === 'initials' ? 'AB' : 'Your name')}
                  </button>
                ))}
              </div>
              <InkSwatches value={typedInk} onPick={setTypedInk} />
            </div>
          )}
        </div>

        {error && (
          <p className="print-error" role="alert">
            {error}
          </p>
        )}

        <label className="print-check">
          <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
          Save {label} on this computer
        </label>
        {keep && storageFailed && (
          <p className="print-error" role="status">
            It could not be saved on this computer, but you can still place it.
          </p>
        )}

        <p className="signature-note">
          This is a visual signature only. It is not a digital certificate signature and does not
          prove who signed.
        </p>

        <div className="modal-actions">
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button type="button" className="primary" disabled={!canApply} onClick={apply}>
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

/** Shows the signature dialog when it has been asked for. */
export function SignatureDialog() {
  const variant = useSignatures((s) => s.dialog);
  return variant ? createPortal(<SignatureForm variant={variant} />, document.body) : null;
}
