import { createPortal } from 'react-dom';
import { usePrint } from './printStore';

/**
 * The hidden print area: one image per page, shown only when printing (see the @media print rules).
 * It lives directly under <body>, outside the app, so the print styles can hide the whole app.
 */
export function PrintRoot() {
  const pages = usePrint((s) => s.pages);
  return createPortal(
    <div id="print-root" aria-hidden="true">
      {pages.map((p) => (
        <div key={p.url} className={`pr-page ${p.orientation}`}>
          <img src={p.url} alt="" />
        </div>
      ))}
    </div>,
    document.body,
  );
}
