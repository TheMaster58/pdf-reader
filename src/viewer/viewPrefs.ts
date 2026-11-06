import { DEFAULT_VIEW_MODE, parseViewMode, type ViewMode } from './viewMode';

const VIEW_KEY = 'pdfreader.viewMode';

/** The page layout chosen last time (it applies to every document), or the default. */
export function loadViewMode(): ViewMode {
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    return raw ? parseViewMode(JSON.parse(raw)) : { ...DEFAULT_VIEW_MODE };
  } catch {
    return { ...DEFAULT_VIEW_MODE };
  }
}

export function saveViewMode(mode: ViewMode): void {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify(mode));
  } catch {
    /* storage unavailable: the layout just won't be remembered */
  }
}
