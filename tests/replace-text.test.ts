import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib';
import { widenRectToFit } from '../src/annotations/boxGeometry';
import { pdfToFraction, type ViewportLike } from '../src/annotations/geometry';
import {
  DEFAULT_TEXT_STYLE,
  createTextBox,
  isPointlessTextBox,
  type PdfRect,
  type TextBoxAnnotation,
} from '../src/annotations/model';
import { usePageHosts } from '../src/annotations/pageHosts';
import { useAnnotations } from '../src/annotations/store';
import { editTextBox, finishEditing } from '../src/annotations/textBoxActions';
import { extractAnnotations, writeAnnotations } from '../src/pdf/annotIO';
import { displayedSize } from '../src/text/textLayout';

const N = (name: string) => PDFName.of(name);
const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, 'fixtures', name)));

async function blankPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  return doc.save();
}
const state = () => useAnnotations.getState();

const original = 'The quick brown fox jumps over the lazy dog.';
const edited = (over: Partial<TextBoxAnnotation> = {}): TextBoxAnnotation => ({
  ...createTextBox({
    pageIndex: 0,
    rect: [70, 100, 320, 118] as PdfRect,
    contents: original,
    replaces: { rect: [72, 106, 313, 117], text: original },
    style: { fill: '#FFFFFF' },
  }),
  ...over,
});
const plain = (over: Partial<TextBoxAnnotation> = {}): TextBoxAnnotation => ({
  ...createTextBox({ pageIndex: 0, rect: [70, 300, 320, 320], contents: 'plain' }),
  ...over,
});

describe('isPointlessTextBox', () => {
  it('an empty plain box is pointless; one with text is not', () => {
    expect(isPointlessTextBox(plain({ contents: '' }))).toBe(true);
    expect(isPointlessTextBox(plain({ contents: '   ' }))).toBe(true);
    expect(isPointlessTextBox(plain({ contents: 'x' }))).toBe(false);
  });

  it('an edit that changed nothing is pointless', () => {
    expect(isPointlessTextBox(edited())).toBe(true);
  });

  it('an edit that changed the text is not, and neither is one that erased it', () => {
    expect(isPointlessTextBox(edited({ contents: 'Something else.' }))).toBe(false);
    expect(isPointlessTextBox(edited({ contents: '' }))).toBe(false); // erasing a line is an edit
  });
});

describe('an edited line in the saved file', () => {
  it('records what it replaces and reads it back', async () => {
    const box = edited({ contents: 'The slow brown fox.' });
    const bytes = await writeAnnotations(fixture('sample.pdf'), [box]);
    const back = (await extractAnnotations(bytes)).annotations[0] as TextBoxAnnotation;
    expect(back.contents).toBe('The slow brown fox.');
    expect(back.replaces).toEqual({ rect: [72, 106, 313, 117], text: original });
    expect(back.fill?.toLowerCase()).toBe('#ffffff');
  });

  it('keeps original text that is not plain Latin', async () => {
    const text = 'Zażółć gęślą jaźń 日本語';
    const box = edited({ replaces: { rect: [72, 106, 313, 117], text } });
    const back = (await extractAnnotations(await writeAnnotations(fixture('sample.pdf'), [box])))
      .annotations[0] as TextBoxAnnotation;
    expect(back.replaces?.text).toBe(text);
  });

  it('a plain text box has no replaces', async () => {
    const back = (
      await extractAnnotations(await writeAnnotations(fixture('sample.pdf'), [plain()]))
    ).annotations[0] as TextBoxAnnotation;
    expect(back.replaces).toBeUndefined();
  });

  it('is an ordinary FreeText with an opaque background, so other readers show it covering the line', async () => {
    const bytes = await writeAnnotations(await blankPdf(), [edited({ contents: 'New text' })]);
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    const annots = doc.getPages()[0].node.Annots()!;
    const dict = doc.context.lookup(annots.get(0)) as import('pdf-lib').PDFDict;
    expect(dict.get(N('Subtype'))).toBe(N('FreeText'));
    expect(dict.has(N('IC'))).toBe(true);
  });

  it('a damaged edit marker is ignored: the box is still taken over, as a plain box', async () => {
    const bytes = await writeAnnotations(await blankPdf(), [edited({ contents: 'New text' })]);
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    const dict = doc.context.lookup(
      doc.getPages()[0].node.Annots()!.get(0),
    ) as import('pdf-lib').PDFDict;
    for (const bad of [
      doc.context.obj({ Text: PDFHexString.fromText('x') }), // no rect
      doc.context.obj({ Rect: [1, 2, 3], Text: PDFHexString.fromText('x') }), // short rect
      doc.context.obj({ Rect: [1, 2, 3, 4] }), // no text
      PDFString.of('nonsense'),
      N('Name'),
    ]) {
      dict.set(N('PDFReaderEdit'), bad);
      const back = (await extractAnnotations(await doc.save())).annotations[0] as TextBoxAnnotation;
      expect(back.kind).toBe('textbox');
      expect(back.contents).toBe('New text');
      expect(back.replaces).toBeUndefined();
    }
  });

  it('saving again does not stack edits, and a revert (removal) leaves nothing behind', async () => {
    const first = await writeAnnotations(fixture('sample.pdf'), [edited({ contents: 'New text' })]);
    const loaded = (await extractAnnotations(first)).annotations as TextBoxAnnotation[];
    const second = await writeAnnotations(first, loaded);
    expect((await extractAnnotations(second)).annotations).toHaveLength(1);

    const reverted = await writeAnnotations(second, []);
    expect((await extractAnnotations(reverted)).annotations).toHaveLength(0);
    expect(Buffer.from(reverted).toString('latin1')).not.toContain('PDFReaderEdit');
  });
});

describe('widenRectToFit', () => {
  const vp: ViewportLike = {
    width: 612,
    height: 792,
    convertToPdfPoint: (x, y) => [x, 792 - y],
    convertToViewportPoint: (x, y) => [x, 792 - y],
  };
  const rect: PdfRect = [100, 600, 200, 620];

  it('grows to the right and leaves the rest alone', () => {
    const r = widenRectToFit(vp, rect, 160);
    expect(r[0]).toBeCloseTo(100);
    expect(r[2] - r[0]).toBeCloseTo(160);
    expect(r[1]).toBe(600);
    expect(r[3]).toBe(620);
  });

  it('leaves a wide enough box unchanged', () => {
    expect(widenRectToFit(vp, rect, 100)).toBe(rect);
    expect(widenRectToFit(vp, rect, 40)).toBe(rect);
  });

  it('stops at the page edge', () => {
    const r = widenRectToFit(vp, rect, 5000);
    expect(r[2]).toBeCloseTo(612);
  });
});

describe('widenRectToFit on rotated pages', () => {
  const viewports: ViewportLike[] = [];
  let destroy: () => Promise<void> = async () => {};
  beforeAll(async () => {
    const task = getDocument({ data: fixture('rotated.pdf'), useSystemFonts: true });
    const doc = await task.promise;
    destroy = () => task.destroy();
    for (let n = 1; n <= doc.numPages; n++)
      viewports.push((await doc.getPage(n)).getViewport({ scale: 1 }));
  });
  afterAll(() => destroy());

  it('grows to the right as displayed, whatever the rotation', () => {
    for (const vp of viewports) {
      const rect: PdfRect = [100, 500, 220, 520];
      const before = pdfToFraction(vp, rect);
      const after = pdfToFraction(vp, widenRectToFit(vp, rect, 300));
      expect(after.left).toBeCloseTo(before.left, 8);
      expect(after.top).toBeCloseTo(before.top, 8);
      expect(after.bottom).toBeCloseTo(before.bottom, 8);
      const target = Math.min(1, before.left + 300 / vp.width);
      expect(after.right).toBeCloseTo(target, 8);
    }
  });
});

describe('editing a replaced line', () => {
  let viewport: ViewportLike;
  let destroy: () => Promise<void> = async () => {};
  beforeAll(async () => {
    const task = getDocument({ data: fixture('sample.pdf'), useSystemFonts: true });
    destroy = () => task.destroy();
    viewport = (await (await task.promise).getPage(1)).getViewport({ scale: 1 });
  });
  afterAll(() => destroy());

  beforeEach(() => {
    state().reset();
    state().setTextStyle({ ...DEFAULT_TEXT_STYLE });
    usePageHosts.setState({
      hosts: { 0: { el: {} as HTMLElement, blendEl: {} as HTMLElement, viewport } },
    });
  });
  const only = () => state().annotations[0] as TextBoxAnnotation;
  const width = (b: TextBoxAnnotation) => displayedSize(b.rect, 0).width;

  it('gets wider, not taller, as the new text gets longer', () => {
    const box = edited({
      rect: [70, 100, 130, 118.4],
      contents: 'short',
      replaces: { rect: [72, 106, 120, 117], text: 'short' },
    });
    state().addAnnotations([box]);
    const h = displayedSize(box.rect, 0).height;
    editTextBox(box.id, { contents: 'a considerably longer line than before' });
    expect(width(only())).toBeGreaterThan(130 - 70);
    expect(displayedSize(only().rect, 0).height).toBeCloseTo(h, 6); // still one line
  });

  it('never gets narrower when text is deleted (the cover must keep covering the old line)', () => {
    const box = edited({
      rect: [70, 100, 130, 118.4],
      contents: 'short',
      replaces: { rect: [72, 106, 120, 117], text: 'short' },
    });
    state().addAnnotations([box]);
    editTextBox(box.id, { contents: 'a considerably longer line than before' });
    const wide = width(only());
    editTextBox(box.id, { contents: 'x' });
    expect(width(only())).toBeCloseTo(wide, 6);
  });

  it('respects a size the user sets, and wraps (grows taller) within it', () => {
    const box = edited({
      rect: [70, 100, 130, 118.4],
      contents: 'x',
      replaces: { rect: [72, 106, 120, 117], text: 'x' },
    });
    state().addAnnotations([box]);
    editTextBox(box.id, {
      rect: [70, 100, 130, 118.4],
      contents: 'a considerably longer line than before',
    });
    expect(width(only())).toBeCloseTo(60, 6);
    expect(displayedSize(only().rect, 0).height).toBeGreaterThan(18.4);
  });

  it('a plain box still wraps instead of widening', () => {
    const box = plain({ rect: [70, 300, 130, 318.4], contents: 'x' });
    state().addAnnotations([box]);
    editTextBox(box.id, { contents: 'a considerably longer line than before' });
    expect(width(only())).toBeCloseTo(60, 6);
  });

  it('stops widening at the page edge and wraps from there', () => {
    const box = edited({
      rect: [500, 100, 560, 118.4],
      contents: 'x',
      replaces: { rect: [502, 106, 520, 117], text: 'x' },
    });
    state().addAnnotations([box]);
    editTextBox(box.id, {
      contents: 'this line is much too long to fit between here and the right-hand page edge',
    });
    expect(only().rect[2]).toBeLessThanOrEqual(612 + 1e-6);
    expect(displayedSize(only().rect, 0).height).toBeGreaterThan(18);
  });

  it('does not make the font of an edited line the look of the next plain box', () => {
    const box = edited();
    state().addAnnotations([box]);
    editTextBox(box.id, { bold: true, fontFamily: 'Times', fontSize: 30 });
    expect(state().textStyle).toEqual(DEFAULT_TEXT_STYLE);
    // ...whereas a plain box does.
    const p = plain();
    state().addAnnotations([p]);
    editTextBox(p.id, { bold: true });
    expect(state().textStyle.bold).toBe(true);
  });

  it('an unchanged edit is dropped when finished with Escape, as if never made', () => {
    const box = edited();
    state().addAnnotations([box]);
    state().setEditing(box.id);
    finishEditing(box.id, true);
    expect(state().annotations).toHaveLength(0);
    expect(state().undoStack).toHaveLength(0);
    expect(state().dirty).toBe(false);
  });

  it('a changed edit is kept when finished', () => {
    const box = edited();
    state().addAnnotations([box]);
    state().setEditing(box.id);
    editTextBox(box.id, { contents: 'Changed.' });
    finishEditing(box.id, true);
    expect(state().annotations).toHaveLength(1);
  });

  it('erasing a line entirely is kept: it hides the text', () => {
    const box = edited();
    state().addAnnotations([box]);
    state().setEditing(box.id);
    editTextBox(box.id, { contents: '' });
    finishEditing(box.id, true);
    expect(state().annotations).toHaveLength(1);
    expect(only().contents).toBe('');
  });

  it('moving on to another line drops the first when it was left unchanged', () => {
    const a = edited();
    const b = edited({
      rect: [70, 140, 320, 158],
      replaces: { rect: [72, 146, 313, 157], text: original },
    });
    state().addAnnotations([a]);
    state().setEditing(a.id);
    state().addAnnotations([b]);
    state().setEditing(b.id); // as clicking the next line does
    expect(state().annotations.map((x) => x.id)).toEqual([b.id]);
  });

  it('moving on keeps the first when it was changed', () => {
    const a = edited();
    const b = edited({
      rect: [70, 140, 320, 158],
      replaces: { rect: [72, 146, 313, 157], text: original },
    });
    state().addAnnotations([a]);
    state().setEditing(a.id);
    editTextBox(a.id, { contents: 'Changed.' });
    state().addAnnotations([b]);
    state().setEditing(b.id);
    expect(state().annotations).toHaveLength(2);
  });

  it('deselecting an unchanged edit drops it (it would be saved as a pointless cover)', () => {
    const box = edited();
    state().addAnnotations([box]);
    state().select(box.id);
    state().select(null);
    expect(state().annotations).toHaveLength(0);
  });

  it('the edit tool can be turned on and off like the others', () => {
    state().setTool('edit');
    expect(state().tool).toBe('edit');
    state().setTool('select');
    expect(state().tool).toBe('select');
  });
});
