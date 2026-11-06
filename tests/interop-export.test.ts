import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import {
  createHighlight,
  createNote,
  createSignature,
  createTextBox,
  type Annotation,
  type PdfRect,
  type SignatureArtwork,
  type TextStyle,
} from '../src/annotations/model';
import { writeAnnotations } from '../src/pdf/annotIO';
import { buildRuns, replacementFrame, runBox } from '../src/pdf/textRuns';
import { normaliseStrokes, type Point } from '../src/signature/strokes';
import { acrobatStylePdf } from './helpers/foreignPdf';
import { makePng, toDataUrl } from './helpers/png';

/**
 * Writes annotated PDFs to the directory in INTEROP_OUT so they can be opened in other readers
 * (PDFium, pypdf, Edge...). Skipped unless that environment variable is set.
 *   INTEROP_OUT=some/dir npx vitest run tests/interop-export.test.ts
 */
describe.skipIf(!process.env.INTEROP_OUT)('export for interop checks', () => {
  it('writes sample.pdf with a highlight, a commented highlight and two notes', async () => {
    const out = process.env.INTEROP_OUT!;
    mkdirSync(out, { recursive: true });
    const original = new Uint8Array(readFileSync(join(__dirname, 'fixtures', 'sample.pdf')));

    // Page 1 text lines are drawn at y = 680, 660, 640 (12 pt Helvetica) starting at x = 72.
    const annotations: Annotation[] = [
      createHighlight({
        pageIndex: 0,
        rects: [[71, 677, 330, 692]],
        color: '#FFE74C',
        text: 'The quick brown fox jumps over the lazy dog.',
        author: 'Interop Tester',
      }),
      {
        ...createHighlight({
          pageIndex: 0,
          rects: [[71, 657, 310, 672]],
          color: '#8CC8FF',
          text: 'Pack my box with five dozen liquor jugs.',
          author: 'Interop Tester',
        }),
        contents: 'A comment on the blue highlight',
      },
      {
        ...createNote({
          pageIndex: 0,
          point: [400, 600],
          color: '#FF9EC4',
          author: 'Interop Tester',
        }),
        contents: 'Sticky note',
      },
      createHighlight({
        pageIndex: 4,
        rects: [[71, 557, 330, 572]],
        color: '#8FE388',
        text: 'Here is the needle in the haystack.',
        author: 'Interop Tester',
      }),
    ];
    const bytes = await writeAnnotations(original, annotations);
    writeFileSync(join(out, 'annotated.pdf'), bytes);
    expect(bytes.length).toBeGreaterThan(original.length);
  });

  it('writes textboxes.pdf: every font, alignment, a fill and an outline, wrapped and multi-line text', async () => {
    const out = process.env.INTEROP_OUT!;
    mkdirSync(out, { recursive: true });
    const original = new Uint8Array(readFileSync(join(__dirname, 'fixtures', 'sample.pdf')));
    const box = (rect: PdfRect, contents: string, style: Partial<TextStyle> = {}) =>
      createTextBox({ pageIndex: 0, rect, contents, style, author: 'Interop Tester' });
    const annotations: Annotation[] = [
      box([72, 480, 300, 510], 'Sans-serif, 12pt, left aligned'),
      box([72, 440, 300, 470], 'Serif, 14pt, centred', {
        fontFamily: 'Times',
        fontSize: 14,
        align: 'center',
      }),
      box([72, 400, 300, 430], 'Monospace, 10pt, right aligned', {
        fontFamily: 'Courier',
        fontSize: 10,
        align: 'right',
      }),
      box(
        [72, 330, 300, 390],
        'A box with a yellow background, a blue outline and blue text that wraps over several lines.',
        {
          color: '#1565C0',
          fill: '#FFF59D',
          border: true,
        },
      ),
      box([320, 480, 540, 540], 'Line one\nLine two\n\nLine four (after a blank line)', {
        fontSize: 11,
      }),
      box([320, 400, 540, 450], 'Red text, 18pt: AV To Wa (no kerning)', {
        color: '#D32F2F',
        fontSize: 18,
      }),
      box([320, 330, 540, 380], 'Accents and symbols: café, naïve, €5, “quotes”, ½', {
        fontFamily: 'Times',
      }),
    ];
    writeFileSync(join(out, 'textboxes.pdf'), await writeAnnotations(original, annotations));
  });

  it('writes textboxes-rotated.pdf: one box on each of four pages rotated 0, 90, 180 and 270', async () => {
    const out = process.env.INTEROP_OUT!;
    mkdirSync(out, { recursive: true });
    const doc = await PDFDocument.create();
    for (const angle of [0, 90, 180, 270]) {
      const page = doc.addPage([612, 792]);
      page.setRotation(degrees(angle));
      page.drawText(`Page rotated ${angle} degrees`, { x: 72, y: 740, size: 14 });
    }
    const annotations: Annotation[] = [0, 1, 2, 3].map((i) =>
      createTextBox({
        pageIndex: i,
        rect: [100, 600, 340, 650],
        contents: `This text box should read upright on page ${i + 1}, whatever the rotation`,
        style: { fill: '#FFF59D', border: true },
        author: 'Interop Tester',
      }),
    );
    writeFileSync(
      join(out, 'textboxes-rotated.pdf'),
      await writeAnnotations(await doc.save(), annotations),
    );
  });

  it('writes signatures.pdf: drawn and picture signatures and initials, on normal and rotated pages', async () => {
    const out = process.env.INTEROP_OUT!;
    mkdirSync(out, { recursive: true });
    const doc = await PDFDocument.create();
    for (const angle of [0, 90, 180, 270]) {
      const page = doc.addPage([612, 792]);
      page.setRotation(degrees(angle));
      page.drawText(`Page rotated ${angle} degrees`, { x: 72, y: 740, size: 14 });
      page.drawLine({ start: { x: 72, y: 560 }, end: { x: 330, y: 560 }, thickness: 0.5 });
      page.drawText('Signed:', { x: 72, y: 565, size: 10 });
    }

    // A looping signature drawn as strokes, in blue.
    const loop: Point[] = [];
    for (let i = 0; i <= 60; i++) {
      const t = i / 60;
      loop.push([10 + t * 200, 40 + Math.sin(t * 14) * 22 * (1 - t * 0.4)]);
    }
    const strokesArt = normaliseStrokes([loop, [[10, 72], [210, 70]]], 3.2)!;
    const drawn: SignatureArtwork = {
      type: 'strokes',
      strokes: strokesArt.strokes,
      color: '#1565C0',
      width: 3.2,
      box: strokesArt.box,
    };
    // A picture signature with soft, see-through parts: a dark scribble with a transparent background.
    const png = makePng(240, 80, (x, y) => {
      const d = Math.abs(y - (40 + 25 * Math.sin(x / 14)));
      return d < 4 ? [30, 30, 110, 255] : d < 6 ? [30, 30, 110, 110] : [0, 0, 0, 0];
    });
    const picture: SignatureArtwork = { type: 'image', pngDataUrl: toDataUrl(png), size: [240, 80] };

    // The app derives a box from what is displayed, so on a page turned by 90 or 270 the box in the
    // file has its width and height swapped. Do the same here, or the signature would be squeezed.
    const rectFor = (angle: number, x: number, y: number, w: number, h: number): PdfRect =>
      angle % 180 === 0 ? [x, y, x + w, y + h] : [x, y, x + h, y + w];
    const drawnHeight = 150 / (strokesArt.box[0] / strokesArt.box[1]);
    const annotations: Annotation[] = [];
    [0, 90, 180, 270].forEach((angle, i) => {
      annotations.push(
        createSignature({ pageIndex: i, rect: rectFor(angle, 110, 540, 150, drawnHeight), variant: 'signature', artwork: drawn, author: 'Interop Tester' }),
        createSignature({ pageIndex: i, rect: rectFor(angle, 280, 520, 120, 40), variant: 'signature', artwork: picture, author: 'Interop Tester' }),
        createSignature({ pageIndex: i, rect: rectFor(angle, 440, 540, 60, 60 / (strokesArt.box[0] / strokesArt.box[1])), variant: 'initials', artwork: drawn, author: 'Interop Tester' }),
      );
    });
    writeFileSync(join(out, 'signatures.pdf'), await writeAnnotations(await doc.save(), annotations));
  });

  it('writes edited-text.pdf: lines of existing text replaced in several fonts, colours and backgrounds', async () => {
    const out = process.env.INTEROP_OUT!;
    mkdirSync(out, { recursive: true });
    const doc = await PDFDocument.create();
    const times = await doc.embedFont(StandardFonts.TimesRoman);
    const courierBold = await doc.embedFont(StandardFonts.CourierBold);
    const oblique = await doc.embedFont(StandardFonts.HelveticaOblique);
    const helv = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const page = doc.addPage([612, 792]);
    page.drawText('Quarterly report', { x: 72, y: 730, size: 24, font: bold });
    page.drawText('Serif line of text that will change', { x: 72, y: 690, size: 14, font: times });
    page.drawText('Mono bold line that will change', { x: 72, y: 650, size: 12, font: courierBold, color: rgb(0.1, 0.2, 0.6) });
    page.drawText('Red italic line that will change', { x: 72, y: 610, size: 12, font: oblique, color: rgb(0.8, 0.1, 0.1) });
    page.drawRectangle({ x: 60, y: 535, width: 300, height: 36, color: rgb(1, 0.957, 0.627) });
    page.drawText('Text on a yellow background that will change', { x: 72, y: 548, size: 12, font: helv });
    page.drawText('This line stays exactly as it is.', { x: 72, y: 500, size: 12, font: helv });
    page.drawText('This one will be erased entirely.', { x: 72, y: 460, size: 12, font: helv });
    page.drawText('Untouched footer line.', { x: 72, y: 420, size: 12, font: helv });
    const bytes = await doc.save();

    // Find the lines the way the app does, then replace some of them.
    const task = getDocument({ data: bytes.slice(), useSystemFonts: true });
    const pdf = await task.promise;
    const pdfPage = await pdf.getPage(1);
    const viewport = pdfPage.getViewport({ scale: 1 });
    const content = await pdfPage.getTextContent();
    const runs = buildRuns(content.items.filter((i) => 'str' in i) as never, viewport);
    const toPdf = (r: { left: number; top: number; width: number; height: number }): PdfRect => [
      r.left,
      792 - (r.top + r.height),
      r.left + r.width,
      792 - r.top,
    ];
    const edit = (startsWith: string, text: string, style: Partial<TextStyle>) => {
      const run = runs.find((r) => r.text.startsWith(startsWith))!;
      const family = style.fontFamily ?? 'Helvetica';
      const frame = replacementFrame(run, family);
      const b = runBox(run);
      return createTextBox({
        pageIndex: 0,
        rect: toPdf(frame),
        contents: text,
        replaces: { rect: [b.left, 792 - b.bottom, b.right, 792 - b.top], text: run.text },
        style: { fontSize: Math.round(run.size * 2) / 2, color: '#000000', fill: '#FFFFFF', ...style },
        author: 'Interop Tester',
      });
    };
    const wide = (box: ReturnType<typeof edit>, extra: number): void => {
      box.rect = [box.rect[0], box.rect[1], box.rect[2] + extra, box.rect[3]];
    };
    const edits = [
      edit('Quarterly', 'Annual report', { bold: true }),
      edit('Serif line', 'A different serif line, a little longer than before', { fontFamily: 'Times' }),
      edit('Mono bold', 'Changed mono bold', { fontFamily: 'Courier', bold: true, color: '#1A3399' }),
      edit('Red italic', 'Changed red italic text', { italic: true, color: '#CC1A1A' }),
      edit('Text on a yellow', 'New text on the yellow', { fill: '#FFF4A0' }),
      edit('This one will be erased', '', {}),
    ];
    wide(edits[1], 140); // the app widens a replacement box as the text grows; here it is done by hand
    await task.destroy();
    writeFileSync(join(out, 'edited-text.pdf'), await writeAnnotations(bytes, edits));
  });

  it('writes foreign.pdf, annotated the way other tools do it', async () => {
    const out = process.env.INTEROP_OUT!;
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'foreign.pdf'), await acrobatStylePdf());
  });
});
