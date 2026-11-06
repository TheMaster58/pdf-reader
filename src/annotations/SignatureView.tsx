import type { CSSProperties } from 'react';
import { SignatureArt } from '../signature/SignatureArt';
import { CORNER_HANDLES, resizeFractionLocked } from './boxGeometry';
import { artworkAspect, type SignatureAnnotation } from './model';
import type { PageHost } from './pageHosts';
import { useAnnotations } from './store';
import { useBoxGesture } from './useBoxGesture';

const pct = (v: number) => `${(v * 100).toFixed(4)}%`;

/** Smallest a signature may be made, in points wide. */
const MIN_WIDTH_PT = 24;

/**
 * A placed signature or initials: shown as its artwork, moved by dragging, resized from its corners
 * with its shape locked, and deleted with a small button or the Delete key. Lives in the page's
 * interactive layer, so it takes the mouse itself.
 */
export function SignatureView({ ann, host }: { ann: SignatureAnnotation; host: PageHost }) {
  const selected = useAnnotations((s) => s.selectedId === ann.id);
  const vp = host.viewport;
  const aspect = artworkAspect(ann.artwork);

  const { frame, begin, track, end } = useBoxGesture({
    id: ann.id,
    host,
    rect: ann.rect,
    resize: (start, handle, dx, dy) =>
      resizeFractionLocked(start, handle, dx, dy, aspect, vp, MIN_WIDTH_PT / vp.width),
    onCommit: (rect) => useAnnotations.getState().updateAnnotation(ann.id, { rect }),
  });

  const style: CSSProperties = {
    left: pct(frame.left),
    top: pct(frame.top),
    width: pct(frame.right - frame.left),
    height: pct(frame.bottom - frame.top),
  };
  // The toolbar goes above the signature, or below it when it is at the very top of the page.
  const flipBelow = frame.top < 0.06;

  return (
    <div
      className={'sig-box' + (selected ? ' selected' : '')}
      data-annotation-id={ann.id}
      data-variant={ann.variant}
      style={style}
      onPointerDown={(e) => begin(e, 'move')}
      onPointerMove={track}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <SignatureArt artwork={ann.artwork} />
      {selected && (
        <>
          {CORNER_HANDLES.map((h) => (
            <span
              key={h}
              className={`text-handle h-${h}`}
              onPointerDown={(e) => begin(e, h)}
              aria-hidden="true"
            />
          ))}
          <div
            className={'sig-toolbar' + (flipBelow ? ' below' : '')}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="danger"
              onClick={() => useAnnotations.getState().removeAnnotations([ann.id])}
            >
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}
