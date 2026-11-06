import { useEffect, useRef } from 'react';
import { useApp } from './store';

/** The Chromium/WebView2 build this window runs on, from the user agent (e.g. "Edg/131.0.2903.51"). */
function webviewVersion(): string | null {
  const m = /Edg\/([\d.]+)/.exec(navigator.userAgent);
  return m ? m[1] : null;
}

const CREDITS: { name: string; license: string }[] = [
  { name: 'PDF.js', license: 'Apache-2.0' },
  { name: 'pdf-lib', license: 'MIT' },
  { name: 'Tauri', license: 'MIT / Apache-2.0' },
  { name: 'React', license: 'MIT' },
  { name: 'Zustand', license: 'MIT' },
];

/** App name, version and the open-source software it is built on. Opened with F1 or from Settings. */
export function AboutDialog() {
  const open = useApp((s) => s.aboutOpen);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const close = () => useApp.setState({ aboutOpen: false });
  const webview = webviewVersion();

  return (
    <div className="modal-backdrop">
      <div
        className="modal about"
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-title"
        onKeyDown={(e) => {
          if (e.key === 'Escape' || e.key === 'F1') {
            e.preventDefault();
            close();
          }
        }}
      >
        <h2 id="about-title">PDF Reader</h2>
        <p className="about-version">
          Version {__APP_VERSION__}
          {webview ? ` · WebView2 ${webview}` : ''}
        </p>
        <p>Read PDFs, highlight text and add notes. Highlights and notes are saved inside the PDF itself, so other PDF readers can see them.</p>
        <h3>Built with</h3>
        <ul className="credits">
          {CREDITS.map((c) => (
            <li key={c.name}>
              <span>{c.name}</span>
              <span>{c.license}</span>
            </li>
          ))}
        </ul>
        <div className="modal-actions">
          <button ref={closeRef} type="button" className="primary" onClick={close}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
