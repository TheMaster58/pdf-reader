import { sanitizeText, textWidth } from '../text/fontMetrics';
import { TEXT_PADDING, displayedSize, neededHeight } from '../text/textLayout';
import { growRectToHeight, nudgeRect, widenRectToFit } from './boxGeometry';
import { isPointlessTextBox, type PdfRect, type TextBoxAnnotation, type TextStyle } from './model';
import { usePageHosts } from './pageHosts';
import { useAnnotations } from './store';

/** What can change about a text box. */
export type TextBoxPatch = Partial<TextStyle> & { contents?: string; rect?: PdfRect };

const STYLE_KEYS: (keyof TextStyle)[] = [
  'fontFamily',
  'fontSize',
  'color',
  'align',
  'bold',
  'italic',
  'fill',
  'border',
];

function findTextBox(id: string): TextBoxAnnotation | null {
  const ann = useAnnotations.getState().annotations.find((a) => a.id === id);
  return ann?.kind === 'textbox' ? ann : null;
}

/** Width in points that a box needs to show its widest explicit line without wrapping. */
function widthOfWidestLine(box: TextBoxAnnotation): number {
  const widest = sanitizeText(box.contents)
    .split(/\n/)
    .reduce((w, line) => Math.max(w, textWidth(box.fontFamily, box.fontSize, line, box)), 0);
  // The box's padding on both sides, and a little room so the last letter is not on the edge.
  return widest + 2 * TEXT_PADDING + 1.5;
}

/**
 * Changes a text box. Whatever the change (typing, a bigger font, a narrower box), the box is made
 * tall enough for its text afterwards, as part of the same undo step. Style changes are also
 * remembered as the look of the next text box.
 *
 * `rect` is always included in the update so that typing, which sometimes grows the box and
 * sometimes does not, still counts as one run of edits and folds into a single undo step.
 */
export function editTextBox(id: string, patch: TextBoxPatch, opts?: { coalesce?: boolean }): void {
  const ann = findTextBox(id);
  if (!ann) return;
  const next = { ...ann, ...patch };
  let rect = next.rect;

  const host = usePageHosts.getState().hosts[ann.pageIndex];
  if (host) {
    const rotation = host.viewport.rotation ?? 0;
    // A box that replaces a line of text gets wider as the new text gets longer, up to the page edge,
    // instead of wrapping onto the line below (and covering it). Not when the user sets the size.
    if (ann.replaces && !('rect' in patch)) {
      rect = widenRectToFit(host.viewport, rect, widthOfWidestLine(next));
    }
    const { width } = displayedSize(rect, rotation);
    rect = growRectToHeight(host.viewport, rect, neededHeight(next, width));
  }

  const store = useAnnotations.getState();
  store.updateAnnotation(id, { ...patch, rect }, opts);

  // The look of the next *new* text box is whatever was last chosen on a plain box; matching the
  // font of a line being edited must not leak into it.
  if (!ann.replaces) {
    const style: Partial<TextStyle> = {};
    for (const key of STYLE_KEYS) {
      if (key in patch) (style as Record<string, unknown>)[key] = patch[key];
    }
    if (Object.keys(style).length) store.setTextStyle(style);
  }
}

/**
 * Ends typing in a text box.
 *
 * `abandonIfEmpty` is for a deliberate "I'm done" (Escape): a box with no text is dropped, if it was
 * only just created as if it had never been added. Leaving by clicking somewhere (blur) must not do
 * that: the click may be on the format bar, to choose a font before typing. An empty box that stays
 * behind is dropped when it is deselected instead (see the store's `select`).
 */
export function finishEditing(id: string, abandonIfEmpty: boolean): void {
  const store = useAnnotations.getState();
  if (store.editingId === id) store.setEditing(null);
  const ann = findTextBox(id);
  if (abandonIfEmpty && ann && isPointlessTextBox(ann)) store.discardAnnotation(id);
}

/** Moves the selected text box by displayed points (right and down are positive). */
export function nudgeSelectedTextBox(dxPt: number, dyPt: number): boolean {
  const { selectedId } = useAnnotations.getState();
  const ann = selectedId ? findTextBox(selectedId) : null;
  const host = ann && usePageHosts.getState().hosts[ann.pageIndex];
  if (!ann || !host) return false;
  useAnnotations
    .getState()
    .updateAnnotation(
      ann.id,
      { rect: nudgeRect(host.viewport, ann.rect, dxPt, dyPt) },
      { coalesce: true },
    );
  return true;
}
