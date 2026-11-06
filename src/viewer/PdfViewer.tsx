import { useEffect, useRef } from 'react';
import { ViewerController } from './controller';
import { registerController } from './actions';

/**
 * Hosts the PDF.js viewer. The scroll container and page container are created imperatively
 * (PDF.js owns their children, and attaches listeners it can't remove), so React StrictMode's
 * mount/unmount/mount in dev just gets a fresh pair of elements each time.
 */
export function PdfViewer() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const container = document.createElement('div');
    container.className = 'pdf-container';
    container.tabIndex = 0;
    container.setAttribute('aria-label', 'PDF document');
    const viewerEl = document.createElement('div');
    viewerEl.className = 'pdfViewer';
    container.appendChild(viewerEl);
    host.appendChild(container);

    const controller = new ViewerController(container, viewerEl);
    registerController(controller);
    return () => {
      registerController(null);
      controller.dispose();
      container.remove();
    };
  }, []);

  return <div ref={hostRef} className="viewer-host" />;
}
