import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWindow, type CloseRequestedEvent } from '@tauri-apps/api/window';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';

const BACKSLASH = String.fromCharCode(92);

/** Last path segment, for either slash style. */
export function fileNameOf(path: string): string {
  const parts = path.split(BACKSLASH).join('/').split('/');
  return parts[parts.length - 1] || path;
}

export function isPdfPath(path: string): boolean {
  return path.toLowerCase().endsWith('.pdf');
}

export async function readPdfFile(path: string): Promise<Uint8Array> {
  const buf = await invoke<ArrayBuffer>('read_file', { path });
  return new Uint8Array(buf);
}

/** Shows the native open dialog. Returns null if the user cancels. */
export async function pickPdfFile(): Promise<string | null> {
  const selected = await openDialog({
    multiple: false,
    directory: false,
    filters: [{ name: 'PDF documents', extensions: ['pdf'] }],
  });
  return typeof selected === 'string' ? selected : null;
}

/** Shows the native save dialog. Returns null if the user cancels. */
export async function pickSavePath(defaultPath: string): Promise<string | null> {
  const chosen = await saveDialog({ defaultPath, filters: [{ name: 'PDF documents', extensions: ['pdf'] }] });
  return chosen ?? null;
}

/**
 * Replaces the file at `path` with `bytes` via a temporary file and an atomic rename, so a crash or
 * a full disk can't leave a half-written PDF. The bytes travel as the request body; the path goes
 * in a (percent-encoded) header because headers must be ASCII.
 */
export async function writeFileAtomic(path: string, bytes: Uint8Array): Promise<void> {
  await invoke('write_file_atomic', bytes, { headers: { path: encodeURIComponent(path) } });
}

/** The signed-in Windows user name, if known. */
export function getUsername(): Promise<string | null> {
  return invoke<string | null>('get_username');
}

/** Lets the app veto a window close (e.g. to ask about unsaved changes). */
export function onCloseRequested(
  handler: (event: CloseRequestedEvent) => void | Promise<void>,
): Promise<() => void> {
  return getCurrentWindow().onCloseRequested(handler);
}

/** Closes the window without raising another close-requested event. */
export function destroyWindow(): Promise<void> {
  return getCurrentWindow().destroy();
}

/** PDF passed on the command line when the app started, if any. */
export function getLaunchFile(): Promise<string | null> {
  return invoke<string | null>('get_launch_file');
}

/** Fires when a second app instance was started with a PDF (Explorer "Open with"). */
export function onOpenFileRequest(handler: (path: string) => void): Promise<() => void> {
  return listen<string>('open-file', (e) => handler(e.payload));
}

/** Fires when files are dragged over/dropped on the window. */
export function onFileDrop(handlers: {
  hover: (over: boolean) => void;
  drop: (paths: string[]) => void;
}): Promise<() => void> {
  return getCurrentWebview().onDragDropEvent((e) => {
    const p = e.payload;
    if (p.type === 'enter' || p.type === 'over') handlers.hover(true);
    else if (p.type === 'leave') handlers.hover(false);
    else if (p.type === 'drop') {
      handlers.hover(false);
      handlers.drop(p.paths);
    }
  });
}

export function setWindowTitle(title: string): Promise<void> {
  return getCurrentWindow().setTitle(title);
}

export function openExternal(url: string): Promise<void> {
  return openUrl(url);
}

const AUTHOR_KEY = 'pdfreader.author';

export function loadAuthor(): string | null {
  try {
    return localStorage.getItem(AUTHOR_KEY);
  } catch {
    return null;
  }
}

export function saveAuthor(name: string): void {
  try {
    localStorage.setItem(AUTHOR_KEY, name);
  } catch {
    /* storage unavailable: the name just won't persist */
  }
}

const RECENT_KEY = 'pdfreader.recent';
const RECENT_MAX = 10;

/** Comparison key for a path: Windows paths are case-insensitive and accept either slash. */
export function pathKey(path: string): string {
  return path.split(BACKSLASH).join('/').toLowerCase();
}

/** Pure helper: put `path` first, drop duplicates of the same file, cap the list. */
export function addRecent(list: string[], path: string, max = RECENT_MAX): string[] {
  const key = pathKey(path);
  return [path, ...list.filter((p) => pathKey(p) !== key)].slice(0, max);
}

export function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

export function saveRecent(list: string[]): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable: recent files just won't persist */
  }
}
