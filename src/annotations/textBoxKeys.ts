import { getController } from '../viewer/actions';
import { useAnnotations } from './store';
import { nudgeSelectedTextBox } from './textBoxActions';

/**
 * Keys for a selected text box: Enter types into it, the arrow keys nudge it (Shift for bigger
 * steps). Meant for a capture-phase listener on the window, so the arrows move the box instead of
 * scrolling the page or turning it in the one-page-at-a-time layouts. Returns true if it handled
 * the key.
 */
export function onTextBoxKeyDown(e: KeyboardEvent): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  const container = getController()?.getContainer();
  const t = e.target;
  // Only when the page (not a button, field or dialog) has the keyboard.
  if (!(t === document.body || (container && t instanceof Node && container.contains(t))))
    return false;
  if (
    t instanceof HTMLTextAreaElement ||
    t instanceof HTMLInputElement ||
    t instanceof HTMLSelectElement
  ) {
    return false;
  }
  const { selectedId, annotations, setEditing } = useAnnotations.getState();
  const ann = annotations.find((a) => a.id === selectedId);
  if (ann?.kind !== 'textbox') return false;

  if (e.key === 'Enter') {
    e.preventDefault();
    e.stopPropagation();
    setEditing(ann.id);
    return true;
  }
  const step = e.shiftKey ? 10 : 1;
  const move: Record<string, [number, number]> = {
    ArrowLeft: [-step, 0],
    ArrowRight: [step, 0],
    ArrowUp: [0, -step],
    ArrowDown: [0, step],
  };
  const d = move[e.key];
  if (d && nudgeSelectedTextBox(d[0], d[1])) {
    e.preventDefault();
    e.stopPropagation();
    return true;
  }
  return false;
}
