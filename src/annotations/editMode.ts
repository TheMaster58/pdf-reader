import { useApp } from '../viewer/store';
import { useAnnotations } from './store';

const SEEN_KEY = 'pdfreader.editTextNoticeSeen';

/** Has the one-time explanation of editing existing text been shown before? */
export function hasSeenEditNotice(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function markEditNoticeSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    /* storage unavailable: it will just be shown again next time */
  }
}

/**
 * Turns Edit text on or off. The first time it is turned on, a short explanation is shown: the old
 * text stays in the file under the new, so this is no way to remove sensitive text.
 */
export function toggleEditText(): void {
  const store = useAnnotations.getState();
  if (store.tool === 'edit') {
    store.setTool('select');
    return;
  }
  store.setTool('edit');
  if (!hasSeenEditNotice()) useApp.setState({ editNoticeOpen: true });
}
