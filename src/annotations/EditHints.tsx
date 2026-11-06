import { useEffect, useState } from 'react';
import { usePageTextVersion } from '../viewer/pageText';
import { peekRunAt, type HoveredRun } from './replaceText';
import { useAnnotations } from './store';

/**
 * While Edit text is on, outlines the line of text under the pointer, so it is clear what a click
 * will change. Lines that are not editable (scanned, turned or sideways text) get no outline.
 */
export function EditTextHints() {
  const editing = useAnnotations((s) => s.tool === 'edit');
  const version = usePageTextVersion((s) => s.version);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!editing) {
      setPointer(null);
      return;
    }
    const onMove = (e: MouseEvent) => setPointer({ x: e.clientX, y: e.clientY });
    const onLeave = () => setPointer(null);
    document.addEventListener('mousemove', onMove);
    document.documentElement.addEventListener('mouseleave', onLeave);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.documentElement.removeEventListener('mouseleave', onLeave);
    };
  }, [editing]);

  // Look again when the page's text finishes loading, even if the pointer has not moved.
  void version;
  const hovered: HoveredRun | null = editing && pointer ? peekRunAt(pointer.x, pointer.y) : null;
  if (!hovered) return null;
  const { box } = hovered;
  return (
    <div
      className="edit-run-hint"
      style={{ left: box.left - 2, top: box.top - 1, width: box.width + 4, height: box.height + 2 }}
      aria-hidden="true"
    />
  );
}
