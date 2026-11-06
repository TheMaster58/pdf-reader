import { useState } from 'react';
import { changeViewMode } from './actions';
import { useApp } from './store';
import { PAGE_LAYOUTS, isTwoPage } from './viewMode';

/** "View" drop-down: how pages are laid out, like Acrobat's Page Display. */
export function ViewMenu() {
  const mode = useApp((s) => s.viewMode);
  const hasDoc = useApp((s) => s.status === 'ready');
  const [open, setOpen] = useState(false);
  const twoPage = isTwoPage(mode.layout);

  const close = () => setOpen(false);

  return (
    <div className="menu">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={!hasDoc}
        title="Page layout"
        onClick={() => setOpen((o) => !o)}
      >
        View
      </button>
      {open && (
        <>
          <div className="menu-backdrop" onClick={close} />
          <ul
            className="menu-list view-menu"
            role="menu"
            onKeyDown={(e) => {
              if (e.key === 'Escape') close();
            }}
          >
            {PAGE_LAYOUTS.map((l) => (
              <li key={l.value} role="none">
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={mode.layout === l.value}
                  onClick={() => {
                    changeViewMode({ ...mode, layout: l.value });
                    close();
                  }}
                >
                  <span className="menu-mark">{mode.layout === l.value ? '•' : ''}</span>
                  {l.label}
                </button>
              </li>
            ))}
            <li role="separator" className="menu-sep" />
            <li role="none">
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={mode.cover}
                disabled={!twoPage}
                title="Show the first page on its own, then pair 2-3, 4-5..."
                onClick={() => {
                  changeViewMode({ ...mode, cover: !mode.cover });
                  close();
                }}
              >
                <span className="menu-mark">{mode.cover ? '✓' : ''}</span>
                Show cover page in two-page view
              </button>
            </li>
          </ul>
        </>
      )}
    </div>
  );
}
