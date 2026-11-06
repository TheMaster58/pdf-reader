import { useEffect, useState } from 'react';
import { fileNameOf } from '../services/files';
import { saveCurrent } from '../annotations/persist';
import { getController, openPath, openWithDialog } from './actions';
import { ZOOM_PERCENTS } from './controller';
import { useAnnotations } from '../annotations/store';
import { useApp } from './store';

const PRESET_LABELS: Record<string, string> = {
  auto: 'Automatic',
  'page-fit': 'Fit page',
  'page-width': 'Fit width',
};

function ZoomSelect() {
  const scaleValue = useApp((s) => s.scaleValue);
  const scale = useApp((s) => s.scale);
  const hasDoc = useApp((s) => s.status === 'ready');

  const numeric = Number(scaleValue);
  const percentMatch = ZOOM_PERCENTS.find((p) => Math.abs(p / 100 - numeric) < 0.001);
  const isPreset = scaleValue in PRESET_LABELS;
  // Current value must map to an option; zoom levels reached by Ctrl+wheel get a one-off entry.
  const value = isPreset ? scaleValue : percentMatch ? String(percentMatch / 100) : scaleValue;
  const customLabel = `${Math.round(scale * 100)}%`;

  return (
    <select
      aria-label="Zoom"
      value={value}
      disabled={!hasDoc}
      onChange={(e) => getController()?.setZoom(e.target.value)}
    >
      {Object.entries(PRESET_LABELS).map(([v, label]) => (
        <option key={v} value={v}>
          {label}
        </option>
      ))}
      {ZOOM_PERCENTS.map((p) => (
        <option key={p} value={String(p / 100)}>
          {p}%
        </option>
      ))}
      {!isPreset && !percentMatch && <option value={scaleValue}>{customLabel}</option>}
    </select>
  );
}

function PageInput() {
  const pageNumber = useApp((s) => s.pageNumber);
  const pagesCount = useApp((s) => s.pagesCount);
  const [draft, setDraft] = useState<string | null>(null);

  // Drop any half-typed value when the real page changes (scrolling, find, links).
  useEffect(() => setDraft(null), [pageNumber]);

  const commit = () => {
    const n = Number(draft);
    if (draft !== null && Number.isFinite(n) && draft.trim() !== '') getController()?.goToPage(n);
    setDraft(null);
  };

  return (
    <span className="page-nav">
      <input
        type="text"
        inputMode="numeric"
        aria-label="Page number"
        value={draft ?? (pagesCount ? String(pageNumber) : '')}
        disabled={!pagesCount}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.target.select()}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit();
            getController()?.focus();
          } else if (e.key === 'Escape') {
            setDraft(null);
            getController()?.focus();
          }
        }}
      />
      <span className="page-total">/ {pagesCount || '-'}</span>
    </span>
  );
}

function RecentMenu() {
  const recent = useApp((s) => s.recent);
  const [open, setOpen] = useState(false);

  return (
    <div className="menu">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={recent.length === 0}
        onClick={() => setOpen((o) => !o)}
        title="Recent files"
      >
        Recent
      </button>
      {open && (
        <>
          <div className="menu-backdrop" onClick={() => setOpen(false)} />
          <ul className="menu-list" role="menu">
            {recent.map((path) => (
              <li key={path} role="none">
                <button
                  type="button"
                  role="menuitem"
                  title={path}
                  onClick={() => {
                    setOpen(false);
                    void openPath(path);
                  }}
                >
                  {fileNameOf(path)}
                  <small>{path}</small>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export function Toolbar() {
  const hasDoc = useApp((s) => s.status === 'ready');
  const findOpen = useApp((s) => s.findOpen);
  const fileName = useApp((s) => s.fileName);
  const noteTool = useAnnotations((s) => s.tool === 'note');
  const sidebarOpen = useAnnotations((s) => s.sidebarOpen);
  const count = useAnnotations((s) => s.annotations.length);
  const dirty = useAnnotations((s) => s.dirty);
  const blocked = useApp((s) => s.annotationBlock !== null);
  const saving = useApp((s) => s.saving);

  return (
    <header className="toolbar" role="toolbar" aria-label="Main toolbar">
      <button type="button" onClick={() => void openWithDialog()} title="Open PDF (Ctrl+O)">
        Open
      </button>
      <RecentMenu />
      <button
        type="button"
        className={dirty ? 'primary' : undefined}
        disabled={!hasDoc || blocked || saving || !dirty}
        title="Save highlights and notes into the PDF (Ctrl+S)"
        onClick={() => void saveCurrent()}
      >
        {saving ? 'Saving...' : 'Save'}
      </button>
      <button
        type="button"
        disabled={!hasDoc || blocked || saving}
        title="Save a copy with a new name (Ctrl+Shift+S)"
        onClick={() => void saveCurrent({ saveAs: true })}
      >
        Save as...
      </button>
      <span className="toolbar-sep" />
      <PageInput />
      <span className="toolbar-sep" />
      <button
        type="button"
        aria-label="Zoom out"
        title="Zoom out (Ctrl+-)"
        disabled={!hasDoc}
        onClick={() => getController()?.zoomOut()}
      >
        -
      </button>
      <ZoomSelect />
      <button
        type="button"
        aria-label="Zoom in"
        title="Zoom in (Ctrl++)"
        disabled={!hasDoc}
        onClick={() => getController()?.zoomIn()}
      >
        +
      </button>
      <span className="toolbar-sep" />
      <button
        type="button"
        aria-pressed={findOpen}
        disabled={!hasDoc}
        title="Find in document (Ctrl+F)"
        onClick={() => {
          if (findOpen) {
            getController()?.closeFind();
            useApp.setState({ findOpen: false });
          } else {
            useApp.setState({ findOpen: true });
          }
        }}
      >
        Find
      </button>
      <span className="toolbar-sep" />
      <button
        type="button"
        aria-pressed={noteTool}
        disabled={!hasDoc || blocked}
        title="Add a sticky note (N)"
        onClick={() => useAnnotations.getState().setTool(noteTool ? 'select' : 'note')}
      >
        Note
      </button>
      <button
        type="button"
        aria-pressed={sidebarOpen}
        title="Show highlights and notes"
        onClick={() => useAnnotations.getState().setSidebarOpen(!sidebarOpen)}
      >
        Annotations{count > 0 ? ` (${count})` : ''}
      </button>
      <span className="toolbar-title" title={fileName ?? undefined}>
        {fileName}
      </span>
      <button
        type="button"
        title="Settings"
        onClick={() => useApp.setState({ settingsOpen: true })}
      >
        Settings
      </button>
    </header>
  );
}
