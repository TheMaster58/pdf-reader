import { readCanvasRegion, sampleColours, type SampledColours } from '../pdf/pagePixels';
import { describeFont, replacementFrame, runAt, runBox, type TextRun } from '../pdf/textRuns';
import { showNotice } from './persist';
import { getController } from '../viewer/actions';
import { loadPageText, peekPageText } from '../viewer/pageText';
import { useApp } from '../viewer/store';
import { fractionToPdf, type Rect } from './geometry';
import { MAX_FONT_SIZE, MIN_FONT_SIZE, createTextBox, type TextBoxAnnotation } from './model';
import { usePageHosts, type PageHost } from './pageHosts';
import { useAnnotations } from './store';

/** A page under the pointer: which one, where it is on screen, and where the pointer is on it in points. */
interface PageUnder {
  pageIndex: number;
  host: PageHost;
  origin: DOMRect;
  /** The pointer in displayed page points (origin top-left, y down). */
  x: number;
  y: number;
}

function pageUnder(clientX: number, clientY: number): PageUnder | null {
  for (const [index, host] of Object.entries(usePageHosts.getState().hosts)) {
    const origin = host.el.getBoundingClientRect();
    if (origin.width === 0 || origin.height === 0) continue;
    if (
      clientX < origin.left ||
      clientX > origin.right ||
      clientY < origin.top ||
      clientY > origin.bottom
    ) {
      continue;
    }
    return {
      pageIndex: Number(index),
      host,
      origin,
      x: ((clientX - origin.left) / origin.width) * host.viewport.width,
      y: ((clientY - origin.top) / origin.height) * host.viewport.height,
    };
  }
  return null;
}

/** A line of text the pointer is over, with where to draw an outline round it on screen. */
export interface HoveredRun {
  run: TextRun;
  /** The line's box in client pixels. */
  box: { left: number; top: number; width: number; height: number };
}

/**
 * The line of text under a client point, if the page's text has been read. If it has not, reading
 * starts and null is returned: callers look again when `usePageTextVersion` changes.
 */
export function peekRunAt(clientX: number, clientY: number): HoveredRun | null {
  const doc = getController()?.pdfDocument;
  const under = pageUnder(clientX, clientY);
  if (!doc || !under) return null;
  const text = peekPageText(doc, under.pageIndex);
  if (!text) {
    void loadPageText(doc, under.pageIndex, under.host.viewport).catch(() => undefined);
    return null;
  }
  const run = runAt(text.runs, under.x, under.y);
  if (!run) return null;
  const vp = under.host.viewport;
  const b = runBox(run);
  const kx = under.origin.width / vp.width;
  const ky = under.origin.height / vp.height;
  return {
    run,
    box: {
      left: under.origin.left + b.left * kx,
      top: under.origin.top + b.top * ky,
      width: (b.right - b.left) * kx,
      height: (b.bottom - b.top) * ky,
    },
  };
}

/** Reads the colour of a line of text and of what is behind it from the page as drawn. */
function sampleRun(host: PageHost, run: TextRun): SampledColours {
  const fallback: SampledColours = { background: '#FFFFFF', text: '#000000' };
  const canvas = host.el.closest('.page')?.querySelector('canvas');
  if (!canvas) return fallback;
  const vp = host.viewport;
  const scale = canvas.width / vp.width;
  const b = runBox(run);
  const margin = 1.5; // a little of the background around the letters
  const image = readCanvasRegion(
    canvas,
    (b.left - margin) * scale,
    (b.top - margin) * scale,
    (b.right - b.left + 2 * margin) * scale,
    (b.bottom - b.top + 2 * margin) * scale,
  );
  return image ? sampleColours(image) : fallback;
}

/**
 * Edit text: turns a click on a line of text in the page into a text box that replaces it. The box
 * has the line's font (the closest standard one), size, colour and position, a fill the colour of
 * the page behind the text so that it hides the old line, and the old text as its starting text, so
 * the line can be retyped in place. The original text stays in the file underneath: this is a
 * cover, not a redaction.
 *
 * Returns null (and tells the user why) when the click is not on editable text.
 */
export async function startReplacementAt(
  clientX: number,
  clientY: number,
): Promise<TextBoxAnnotation | null> {
  const store = useAnnotations.getState();
  const doc = getController()?.pdfDocument;
  const under = pageUnder(clientX, clientY);
  if (!doc || !under) {
    store.select(null);
    return null;
  }

  const text = await loadPageText(doc, under.pageIndex, under.host.viewport);
  const run = runAt(text.runs, under.x, under.y);
  if (!run) {
    store.select(null); // clicking away ends the line being edited
    showNotice(
      text.runs.length === 0
        ? 'No editable text on this page. It may be a scan, or its text may be turned or sideways.'
        : 'No editable text there. Click directly on a line of text.',
      'info',
    );
    return null;
  }

  const font = text.fonts.get(run.fontName) ?? describeFont(undefined);
  const fontSize = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(run.size * 2) / 2));
  const colours = sampleRun(under.host, run);

  const vp = under.host.viewport;
  const frame = replacementFrame({ ...run, size: fontSize }, font.fontFamily);
  const toPdf = (r: { left: number; top: number; right: number; bottom: number }) => {
    const f: Rect = {
      left: Math.max(0, r.left / vp.width),
      top: Math.max(0, r.top / vp.height),
      right: Math.min(1, r.right / vp.width),
      bottom: Math.min(1, r.bottom / vp.height),
    };
    return fractionToPdf(vp, f);
  };

  const box = createTextBox({
    pageIndex: under.pageIndex,
    rect: toPdf({
      left: frame.left,
      top: frame.top,
      right: frame.left + frame.width,
      bottom: frame.top + frame.height,
    }),
    contents: run.text,
    replaces: { rect: toPdf(runBox(run)), text: run.text },
    style: {
      fontFamily: font.fontFamily,
      bold: font.bold,
      italic: font.italic,
      fontSize,
      color: colours.text,
      fill: colours.background,
      align: 'left',
      border: false,
    },
    author: useApp.getState().author,
  });
  // Close whatever line was being edited first, so a box left unchanged is dropped before this one.
  store.select(null);
  store.addAnnotations([box]);
  store.setEditing(box.id);
  return box;
}
