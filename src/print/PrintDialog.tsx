import { useEffect, useRef, useState } from 'react';
import { useApp } from '../viewer/store';
import { cancelPrint, closePrintDialog, startPrint } from './printDocument';
import { PRINT_QUALITIES, PRINT_WARN_PAGES, type PrintQuality } from './printLayout';
import { resolvePages, type PageChoice } from './printRange';
import { loadPrintQuality, savePrintQuality } from './printSettings';
import { usePrint } from './printStore';

function PrintForm() {
  const pagesCount = useApp((s) => s.pagesCount);
  const currentPage = useApp((s) => s.pageNumber);
  const readOnly = useApp((s) => s.annotationBlock !== null);
  const busy = usePrint((s) => s.busy);
  const progress = usePrint((s) => s.progress);
  const error = usePrint((s) => s.error);

  const [choice, setChoice] = useState<PageChoice>('all');
  const [rangeText, setRangeText] = useState('');
  const [includeAnnotations, setIncludeAnnotations] = useState(true);
  const [quality, setQuality] = useState<PrintQuality>(loadPrintQuality);
  const rangeRef = useRef<HTMLInputElement>(null);
  const printRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    printRef.current?.focus();
  }, []);

  const selection = resolvePages(choice, pagesCount, currentPage, rangeText);
  // Only complain about the range once the user has typed something.
  const rangeError =
    choice === 'range' && rangeText.trim() !== '' && !selection.ok ? selection.error : null;
  const count = selection.ok ? selection.pages.length : 0;

  const submit = () => {
    if (!selection.ok || busy) return;
    savePrintQuality(quality);
    void startPrint({
      pages: selection.pages,
      includeAnnotations: includeAnnotations && !readOnly,
      quality,
    });
  };

  const close = () => {
    if (busy) cancelPrint();
    else closePrintDialog();
  };

  return (
    <div className="modal-backdrop">
      <form
        className="modal print-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="print-title"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close();
        }}
      >
        <h2 id="print-title">Print</h2>

        <fieldset className="print-pages" disabled={busy}>
          <legend>Pages</legend>
          <label>
            <input
              type="radio"
              name="print-pages"
              checked={choice === 'all'}
              onChange={() => setChoice('all')}
            />
            All ({pagesCount})
          </label>
          <label>
            <input
              type="radio"
              name="print-pages"
              checked={choice === 'current'}
              onChange={() => setChoice('current')}
            />
            Current page ({currentPage})
          </label>
          <label>
            <input
              type="radio"
              name="print-pages"
              checked={choice === 'range'}
              onChange={() => {
                setChoice('range');
                queueMicrotask(() => rangeRef.current?.focus());
              }}
            />
            Pages:
            <input
              ref={rangeRef}
              type="text"
              className="print-range"
              aria-label="Page range"
              placeholder="e.g. 1-3, 7, 10-"
              value={rangeText}
              onChange={(e) => {
                setRangeText(e.target.value);
                setChoice('range');
              }}
            />
          </label>
          {rangeError && (
            <span className="print-error" role="alert">
              {rangeError}
            </span>
          )}
        </fieldset>

        {!readOnly && (
          <label className="print-check">
            <input
              type="checkbox"
              checked={includeAnnotations}
              disabled={busy}
              onChange={(e) => setIncludeAnnotations(e.target.checked)}
            />
            Print highlights and notes
          </label>
        )}

        <label className="field">
          <span>Quality</span>
          <select
            value={quality}
            disabled={busy}
            onChange={(e) => setQuality(e.target.value as PrintQuality)}
          >
            {PRINT_QUALITIES.map((q) => (
              <option key={q.value} value={q.value}>
                {q.label}
              </option>
            ))}
          </select>
        </label>

        {count > PRINT_WARN_PAGES && !busy && (
          <p className="print-warning" role="status">
            {count} pages is a lot to prepare at once and uses a lot of memory. Consider printing a
            range.
          </p>
        )}

        {busy && progress && (
          <div className="print-progress" role="status">
            <progress value={progress.done} max={Math.max(1, progress.total)} />
            <span>
              Preparing page {Math.min(progress.done + 1, progress.total)} of {progress.total}...
            </span>
          </div>
        )}

        {error && (
          <p className="print-error" role="alert">
            {error}
          </p>
        )}

        <div className="modal-actions">
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button ref={printRef} type="submit" className="primary" disabled={busy || !selection.ok}>
            Print...
          </button>
        </div>
      </form>
    </div>
  );
}

/** Choose pages, whether to include highlights and notes, and the quality; then open the system dialog. */
export function PrintDialog() {
  const open = usePrint((s) => s.dialogOpen);
  return open ? <PrintForm /> : null;
}
