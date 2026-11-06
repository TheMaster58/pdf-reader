import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './styles.css';
import { usePageHosts } from './annotations/pageHosts';
import { useAnnotations } from './annotations/store';
import { useApp } from './viewer/store';

// Dev-only handle so the running app's state can be inspected and driven from DevTools/tests.
if (import.meta.env.DEV) {
  Object.assign(window, { __app: { useApp, useAnnotations, usePageHosts } });
}

/**
 * In a release build the window is a plain webview with some browser behaviour we don't want:
 * F5 / Ctrl+R reload the page (silently dropping unsaved highlights), Ctrl+P prints the app's own
 * UI, and the right-click menu offers Reload and Back. Text fields keep their normal edit menu.
 */
if (!import.meta.env.DEV) {
  window.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    const mod = e.ctrlKey || e.metaKey;
    if (key === 'f5' || (mod && (key === 'r' || key === 'p' || key === 'u'))) e.preventDefault();
  });
  window.addEventListener('contextmenu', (e) => {
    const t = e.target;
    if (!(t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement)) e.preventDefault();
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
