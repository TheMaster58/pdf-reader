import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { SignatureArt } from '../signature/SignatureArt';
import { fieldFrames } from '../signature/placement';
import { useApp } from '../viewer/store';
import { signaturePlacementAt, type SignaturePlacement } from './interaction';
import { usePageHosts } from './pageHosts';
import { useAnnotations } from './store';

const pct = (v: number) => `${(v * 100).toFixed(4)}%`;

/**
 * While signing, marks every empty signature field in the document with a dashed outline, so it is
 * clear where a click will drop the signature inside a box rather than at the pointer.
 */
export function SignatureFieldHints() {
  const signing = useAnnotations((s) => s.tool === 'sign' && s.signing !== null);
  const hosts = usePageHosts((s) => s.hosts);
  const fields = useApp((s) => s.signatureFields);
  if (!signing) return null;

  return (
    <>
      {Object.entries(hosts).map(([index, host]) => {
        const frames = fieldFrames(
          host.viewport,
          fields.filter((f) => f.pageIndex === Number(index)).map((f) => f.rect),
        );
        if (frames.length === 0) return null;
        return createPortal(
          frames.map((f, i) => (
            <div
              key={i}
              className="sig-field-hint"
              style={{
                left: pct(f.left),
                top: pct(f.top),
                width: pct(f.right - f.left),
                height: pct(f.bottom - f.top),
              }}
            >
              <span>Sign here</span>
            </div>
          )),
          host.el,
          `sig-hints-${index}`,
        );
      })}
    </>
  );
}

/**
 * A faint copy of the signature that follows the pointer over a page, at the size and place it will
 * land. Over an empty signature field it shows the field highlighted and the signature fitted in it.
 */
export function SignaturePreview() {
  const signing = useAnnotations((s) => (s.tool === 'sign' ? s.signing : null));
  const [placement, setPlacement] = useState<SignaturePlacement | null>(null);

  useEffect(() => {
    if (!signing) {
      setPlacement(null);
      return;
    }
    const onMove = (e: MouseEvent) => setPlacement(signaturePlacementAt(e.clientX, e.clientY));
    // Leaving the window leaves the last position behind otherwise.
    const onLeave = () => setPlacement(null);
    document.addEventListener('mousemove', onMove);
    document.documentElement.addEventListener('mouseleave', onLeave);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.documentElement.removeEventListener('mouseleave', onLeave);
    };
  }, [signing]);

  if (!signing || !placement) return null;
  const { origin, frame, field } = placement;
  const box = (f: { left: number; top: number; right: number; bottom: number }) => ({
    left: origin.left + f.left * origin.width,
    top: origin.top + f.top * origin.height,
    width: (f.right - f.left) * origin.width,
    height: (f.bottom - f.top) * origin.height,
  });

  return (
    <>
      {field && <div className="sig-preview-field" style={box(field)} />}
      <div className="sig-preview" style={box(frame)} aria-hidden="true">
        <SignatureArt artwork={signing.artwork} />
      </div>
    </>
  );
}
