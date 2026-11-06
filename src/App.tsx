import { useEffect } from 'react';
import {
  destroyWindow,
  fileNameOf,
  getLaunchFile,
  getUsername,
  isPdfPath,
  onCloseRequested,
  onFileDrop,
  onOpenFileRequest,
  setWindowTitle,
} from './services/files';
import { ensureCanLeave, saveCurrent } from './annotations/persist';
import { HighlightLayers } from './annotations/PageOverlay';
import { AnnotationsSidebar } from './annotations/AnnotationsSidebar';
import { SelectionToolbar } from './annotations/SelectionToolbar';
import { useAnnotations } from './annotations/store';
import { FindBar } from './viewer/FindBar';
import { PasswordDialog } from './viewer/PasswordDialog';
import { PdfViewer } from './viewer/PdfViewer';
import { AboutDialog } from './viewer/AboutDialog';
import { SettingsDialog } from './viewer/SettingsDialog';
import { UnsavedDialog } from './viewer/UnsavedDialog';
import { Toolbar } from './viewer/Toolbar';
import { getController, openPath, openWithDialog } from './viewer/actions';
import { useApp } from './viewer/store';

// StrictMode runs effects twice in dev; the launch file must only be opened once.
let launchFileHandled = false;

/** Subscribes to a Tauri event source, cleaning up correctly even if unmounted before it resolves. */
function useTauriSubscription(subscribe: () => Promise<() => void>) {
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    subscribe()
      .then((fn) => (cancelled ? fn() : (unlisten = fn)))
      .catch((err) => console.error('subscription failed', err));
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
}

function useKeyboardShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ctl = getController();
      const state = useApp.getState();
      const hasDoc = state.status === 'ready';
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      const target = e.target as HTMLElement | null;
      const inField =
        target instanceof HTMLInputElement ||
        target instanceof HTMLSelectElement ||
        target instanceof HTMLTextAreaElement ||
        !!target?.isContentEditable;
      const annotations = useAnnotations.getState();

      if (e.key === 'F1') {
        e.preventDefault();
        useApp.setState((s) => ({ aboutOpen: !s.aboutOpen }));
      } else if (mod && key === 's') {
        e.preventDefault();
        void saveCurrent({ saveAs: e.shiftKey });
      } else if (mod && key === 'o') {
        e.preventDefault();
        void openWithDialog();
      } else if (mod && key === 'f') {
        e.preventDefault();
        if (hasDoc) {
          // Re-set so the find bar re-focuses even if it's already open.
          useApp.setState({ findOpen: false });
          queueMicrotask(() => useApp.setState({ findOpen: true }));
        }
      } else if (mod && (key === '=' || key === '+')) {
        e.preventDefault();
        ctl?.zoomIn();
      } else if (mod && (key === '-' || key === '_')) {
        e.preventDefault();
        ctl?.zoomOut();
      } else if (mod && key === '0') {
        e.preventDefault();
        ctl?.setZoom('auto');
      } else if (mod && !inField && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) annotations.redo();
        else annotations.undo();
      } else if (mod && !inField && key === 'y') {
        e.preventDefault();
        annotations.redo();
      } else if (!mod && !inField && hasDoc && !state.annotationBlock && key === 'n') {
        e.preventDefault();
        annotations.setTool(annotations.tool === 'note' ? 'select' : 'note');
      } else if (!mod && !inField && annotations.tool === 'note' && e.key === 'Escape') {
        annotations.setTool('select');
      } else if (!mod && !inField && annotations.selectedId && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault();
        annotations.removeAnnotations([annotations.selectedId]);
      } else if (!mod && !inField && annotations.selectedId && e.key === 'Escape') {
        annotations.select(null);
      } else if (e.key === 'F3' && hasDoc && state.find.query) {
        e.preventDefault();
        ctl?.find(state.find.query, { again: true, backwards: e.shiftKey });
      } else if (!mod && !inField && hasDoc && e.key === 'Home') {
        e.preventDefault();
        ctl?.goToPage(1);
      } else if (!mod && !inField && hasDoc && e.key === 'End') {
        e.preventDefault();
        ctl?.goToPage(state.pagesCount);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/** Window title with an unsaved-changes dot, the close guard, and the default author name. */
function useDocumentLifecycle() {
  const dirty = useAnnotations((s) => s.dirty);
  const fileName = useApp((s) => s.fileName);

  useEffect(() => {
    if (fileName) void setWindowTitle(`${dirty ? '\u2022 ' : ''}${fileName} - PDF Reader`);
  }, [dirty, fileName]);

  // Closing the window with unsaved annotations asks first.
  useTauriSubscription(() =>
    onCloseRequested(async (event) => {
      if (!useAnnotations.getState().dirty) return;
      event.preventDefault();
      if (await ensureCanLeave()) await destroyWindow();
    }),
  );

  // New annotations are stamped with the Windows user name unless the user chose another.
  useEffect(() => {
    if (useApp.getState().author) return;
    getUsername()
      .then((name) => {
        if (name && !useApp.getState().author) useApp.setState({ author: name });
      })
      .catch(() => undefined);
  }, []);
}

const BLOCK_MESSAGES = {
  encrypted:
    'This document is password protected, so highlights and notes can\'t be added or saved yet. You can still read it.',
  invalid:
    'This document\'s structure can\'t be edited safely, so highlights and notes are turned off. You can still read it.',
} as const;

function EmptyState() {
  const status = useApp((s) => s.status);
  const recent = useApp((s) => s.recent);
  // Only when nothing is open: while another file loads (or asks for a password) the current
  // document stays visible underneath.
  const hasDocument = useApp((s) => s.filePath !== null);
  if (hasDocument) return null;

  return (
    <div className="empty-state">
      <h1>PDF Reader</h1>
      {status === 'loading' ? (
        <p>Opening...</p>
      ) : (
        <>
          <button type="button" className="primary" onClick={() => void openWithDialog()}>
            Open a PDF
          </button>
          <p className="hint">or drop a PDF file anywhere in this window</p>
          {recent.length > 0 && (
            <section aria-label="Recent files">
              <h2>Recent</h2>
              <ul>
                {recent.map((path) => (
                  <li key={path}>
                    <button type="button" title={path} onClick={() => void openPath(path)}>
                      {fileNameOf(path)}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

export function App() {
  const error = useApp((s) => s.error);
  const dragOver = useApp((s) => s.dragOver);
  const loading = useApp((s) => s.status === 'loading');

  useKeyboardShortcuts();
  useDocumentLifecycle();
  const block = useApp((s) => s.annotationBlock);
  const notice = useApp((s) => s.notice);

  useTauriSubscription(() => onOpenFileRequest((path) => void openPath(path)));
  useTauriSubscription(() =>
    onFileDrop({
      hover: (over) => useApp.setState({ dragOver: over }),
      drop: (paths) => {
        const pdf = paths.find(isPdfPath);
        if (pdf) void openPath(pdf);
        else useApp.setState({ error: 'Only PDF files can be opened.' });
      },
    }),
  );

  useEffect(() => {
    if (launchFileHandled) return;
    launchFileHandled = true;
    getLaunchFile()
      .then((path) => {
        if (path) void openPath(path);
      })
      .catch((err) => console.error('get_launch_file failed', err));
  }, []);

  return (
    <div className="app">
      <Toolbar />
      {error && (
        <div className="banner error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => useApp.setState({ error: null })}>
            Dismiss
          </button>
        </div>
      )}
      {block && !error && (
        <div className="banner info" role="status" title={block.message}>
          <span>{BLOCK_MESSAGES[block.reason]}</span>
        </div>
      )}
      <div className="workspace">
        <main className="stage">
          <PdfViewer />
          <HighlightLayers />
          <FindBar />
          <EmptyState />
          {loading && <div className="loading-bar" role="progressbar" aria-label="Loading" />}
          {dragOver && <div className="drop-overlay">Drop a PDF to open it</div>}
        </main>
        <AnnotationsSidebar />
      </div>
      <SelectionToolbar />
      <PasswordDialog />
      <UnsavedDialog />
      <SettingsDialog />
      <AboutDialog />
      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}
    </div>
  );
}
