import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { pdfToFraction, type ViewportLike } from '../src/annotations/geometry';
import {
  DEFAULT_TEXT_STYLE,
  createHighlight,
  createTextBox,
  type TextBoxAnnotation,
} from '../src/annotations/model';
import { usePageHosts } from '../src/annotations/pageHosts';
import { useAnnotations } from '../src/annotations/store';
import {
  editTextBox,
  finishEditing,
  nudgeSelectedTextBox,
} from '../src/annotations/textBoxActions';
import { displayedSize, neededHeight } from '../src/text/textLayout';

const state = () => useAnnotations.getState();
const boxes = () => state().annotations.filter((a): a is TextBoxAnnotation => a.kind === 'textbox');
const make = (over: Partial<TextBoxAnnotation> = {}): TextBoxAnnotation => ({
  ...createTextBox({ pageIndex: 0, rect: [100, 600, 280, 620], contents: '' }),
  ...over,
});

describe('text box tool and editing state', () => {
  beforeEach(() => state().reset());

  it('has a text tool alongside select and note', () => {
    state().setTool('text');
    expect(state().tool).toBe('text');
  });

  it('starts with the default look and remembers the last one chosen', () => {
    expect(state().textStyle).toEqual(DEFAULT_TEXT_STYLE);
    state().setTextStyle({ fontFamily: 'Times', fontSize: 20 });
    state().setTextStyle({ color: '#D32F2F' });
    expect(state().textStyle).toMatchObject({
      fontFamily: 'Times',
      fontSize: 20,
      color: '#D32F2F',
      align: 'left',
    });
  });

  it('opening a box for typing also selects it', () => {
    const box = make();
    state().addAnnotations([box]);
    state().setEditing(box.id);
    expect(state().editingId).toBe(box.id);
    expect(state().selectedId).toBe(box.id);
  });

  it('selecting something else, or nothing, ends typing; selecting the same box does not', () => {
    const a = make({ contents: 'a' });
    const b = make({ contents: 'b' });
    state().addAnnotations([a, b]);
    state().setEditing(a.id);
    state().select(a.id);
    expect(state().editingId).toBe(a.id);
    state().select(b.id);
    expect(state().editingId).toBeNull();
    state().setEditing(b.id);
    state().select(null);
    expect(state().editingId).toBeNull();
  });

  it('loading a document ends typing', () => {
    const box = make({ contents: 'x' });
    state().addAnnotations([box]);
    state().setEditing(box.id);
    state().loadAnnotations([]);
    expect(state().editingId).toBeNull();
  });
});

describe('abandoning a text box', () => {
  beforeEach(() => state().reset());

  it('a box added and discarded straight away leaves no trace', () => {
    const box = make();
    state().addAnnotations([box]);
    expect(state().dirty).toBe(true);
    state().discardAnnotation(box.id);
    expect(state().annotations).toEqual([]);
    expect(state().undoStack).toEqual([]);
    expect(state().redoStack).toEqual([]);
    expect(state().dirty).toBe(false);
  });

  it('restores the "unsaved changes" state the document was in before the box', () => {
    state().addAnnotations([
      createHighlight({ pageIndex: 0, rects: [[1, 1, 9, 9]], color: '#FFE74C', text: 'x' }),
    ]);
    expect(state().dirty).toBe(true);
    const box = make();
    state().addAnnotations([box]);
    state().discardAnnotation(box.id);
    expect(state().dirty).toBe(true); // the highlight is still unsaved
    expect(state().undoStack).toHaveLength(1);
  });

  it('is an ordinary, undoable removal once anything else has happened since', () => {
    const box = make({ contents: 'typed' });
    state().addAnnotations([box]);
    state().updateAnnotation(box.id, { contents: 'typed more' });
    state().discardAnnotation(box.id);
    expect(boxes()).toHaveLength(0);
    expect(state().undoStack.map((c) => c.kind)).toEqual(['add', 'update', 'remove']);
    state().undo();
    expect(boxes()).toHaveLength(1);
  });

  it('is an ordinary removal after the document has been saved', () => {
    const box = make();
    state().addAnnotations([box]);
    state().markSaved(state().annotations);
    expect(state().dirty).toBe(false);
    state().discardAnnotation(box.id);
    expect(boxes()).toHaveLength(0);
    expect(state().dirty).toBe(true); // the saved file still has the box
  });

  it('only forgets the add it belongs to', () => {
    const first = make({ contents: 'one' });
    const second = make({ contents: '' });
    state().addAnnotations([first]);
    state().addAnnotations([second]);
    state().discardAnnotation(first.id); // not the newest add: a normal removal
    expect(state().undoStack.map((c) => c.kind)).toEqual(['add', 'add', 'remove']);
  });

  it('deselecting an empty text box drops it, but not a box with text or other kinds', () => {
    const empty = make({ contents: '   ' });
    const full = make({ contents: 'keep' });
    const hl = createHighlight({ pageIndex: 0, rects: [[1, 1, 9, 9]], color: '#FFE74C', text: '' });
    state().addAnnotations([empty, full, hl]);

    state().select(full.id);
    state().select(null);
    expect(state().annotations.map((a) => a.id)).toContain(full.id);

    state().select(hl.id);
    state().select(null);
    expect(state().annotations.map((a) => a.id)).toContain(hl.id); // a highlight with no note is fine

    state().select(empty.id);
    state().select(full.id);
    expect(state().annotations.map((a) => a.id)).not.toContain(empty.id);
  });

  it('finishing with Escape drops an empty box; leaving by clicking does not (yet)', () => {
    const a = make();
    state().addAnnotations([a]);
    state().setEditing(a.id);
    finishEditing(a.id, false); // blur, e.g. a click on the format bar
    expect(boxes()).toHaveLength(1);
    expect(state().editingId).toBeNull();
    expect(state().selectedId).toBe(a.id);

    state().setEditing(a.id);
    finishEditing(a.id, true); // Escape
    expect(boxes()).toHaveLength(0);
  });

  it('finishing with Escape keeps a box that has text', () => {
    const a = make({ contents: 'hello' });
    state().addAnnotations([a]);
    state().setEditing(a.id);
    finishEditing(a.id, true);
    expect(boxes()).toHaveLength(1);
    expect(state().editingId).toBeNull();
  });
});

// The actions that edit a box need to know the page's size; use a real page for that.
describe('editing a text box on a page', () => {
  let viewport: ViewportLike;
  let destroy: () => Promise<void> = async () => {};

  beforeAll(async () => {
    const data = new Uint8Array(readFileSync(join(__dirname, 'fixtures', 'sample.pdf')));
    const task = getDocument({ data, useSystemFonts: true });
    destroy = () => task.destroy();
    viewport = (await (await task.promise).getPage(1)).getViewport({ scale: 1 });
  });
  afterAll(() => destroy());

  beforeEach(() => {
    state().reset();
    usePageHosts.setState({
      hosts: { 0: { el: {} as HTMLElement, blendEl: {} as HTMLElement, viewport } },
    });
  });

  const rectHeight = (b: TextBoxAnnotation) => displayedSize(b.rect, 0).height;

  it('grows the box as text is typed so that it always fits', () => {
    const box = make({ rect: [100, 600, 220, 618], fontSize: 12 });
    state().addAnnotations([box]);
    const before = rectHeight(box);
    editTextBox(box.id, {
      contents: 'The quick brown fox jumps over the lazy dog and keeps going',
    });
    const after = boxes()[0];
    expect(rectHeight(after)).toBeGreaterThan(before);
    expect(rectHeight(after)).toBeGreaterThanOrEqual(
      neededHeight(after, displayedSize(after.rect, 0).width) - 1e-6,
    );
    // The top edge stays where it was; the box grows downwards.
    expect(after.rect[3]).toBeCloseTo(box.rect[3], 6);
    expect(after.rect[0]).toBe(box.rect[0]);
    expect(after.rect[2]).toBe(box.rect[2]);
  });

  it('does not shrink the box when text is deleted', () => {
    const box = make({ rect: [100, 600, 220, 618] });
    state().addAnnotations([box]);
    editTextBox(box.id, { contents: 'a lot of words that need several lines in a narrow box' });
    const grown = rectHeight(boxes()[0]);
    editTextBox(box.id, { contents: 'a' });
    expect(rectHeight(boxes()[0])).toBeCloseTo(grown, 6);
  });

  it('grows the box for a bigger font', () => {
    const box = make({ rect: [100, 600, 280, 620], contents: 'size', fontSize: 12 });
    state().addAnnotations([box]);
    editTextBox(box.id, { fontSize: 48 });
    expect(rectHeight(boxes()[0])).toBeGreaterThanOrEqual(neededHeight(boxes()[0], 180) - 1e-6);
    expect(boxes()[0].fontSize).toBe(48);
  });

  it('a run of typing is one undo step, whether or not each key grows the box', () => {
    const box = make({ rect: [100, 600, 160, 618] });
    state().addAnnotations([box]);
    const steps = state().undoStack.length;
    for (const text of [
      'h',
      'he',
      'hel',
      'hell',
      'hello',
      'hello wor',
      'hello world and then some more words',
    ]) {
      editTextBox(box.id, { contents: text }, { coalesce: true });
    }
    expect(state().undoStack.length).toBe(steps + 1);
    expect(boxes()[0].contents).toBe('hello world and then some more words');
    state().undo();
    expect(boxes()[0].contents).toBe('');
    expect(boxes()[0].rect).toEqual(box.rect); // the growth is undone with the typing
  });

  it('remembers style changes as the look of the next box, but not text or position', () => {
    const box = make({ contents: 'x' });
    state().addAnnotations([box]);
    editTextBox(box.id, {
      fontFamily: 'Courier',
      color: '#1565C0',
      align: 'right',
      fill: '#FFF59D',
      border: true,
    });
    expect(state().textStyle).toMatchObject({
      fontFamily: 'Courier',
      color: '#1565C0',
      align: 'right',
      fill: '#FFF59D',
      border: true,
    });
    editTextBox(box.id, { contents: 'changed' });
    expect(state().textStyle).toMatchObject({ fontFamily: 'Courier' });
    expect(state().textStyle).not.toHaveProperty('contents');
    expect(state().textStyle).not.toHaveProperty('rect');
  });

  it('ignores edits to a box that is gone or is not a text box', () => {
    editTextBox('nope', { contents: 'x' });
    const hl = createHighlight({ pageIndex: 0, rects: [[1, 1, 9, 9]], color: '#FFE74C', text: '' });
    state().addAnnotations([hl]);
    editTextBox(hl.id, { contents: 'x' });
    expect(state().annotations[0]).toEqual(hl);
  });

  it('nudges the selected box by displayed points, as one coalesced undo step', () => {
    const box = make({ contents: 'x' });
    state().addAnnotations([box]);
    state().select(box.id);
    const f0 = pdfToFraction(viewport, box.rect);
    expect(nudgeSelectedTextBox(1, 0)).toBe(true);
    expect(nudgeSelectedTextBox(1, 0)).toBe(true);
    expect(nudgeSelectedTextBox(0, 10)).toBe(true);
    const f1 = pdfToFraction(viewport, boxes()[0].rect);
    expect((f1.left - f0.left) * viewport.width).toBeCloseTo(2, 4);
    expect((f1.top - f0.top) * viewport.height).toBeCloseTo(10, 4);
    expect(state().undoStack.length).toBe(2); // the add, and one update for the run of nudges
  });

  it('nudging does nothing when no text box is selected', () => {
    expect(nudgeSelectedTextBox(5, 5)).toBe(false);
    const hl = createHighlight({ pageIndex: 0, rects: [[1, 1, 9, 9]], color: '#FFE74C', text: '' });
    state().addAnnotations([hl]);
    state().select(hl.id);
    expect(nudgeSelectedTextBox(5, 5)).toBe(false);
  });

  it('keeps a nudged box on the page', () => {
    const box = make({ contents: 'x', rect: [2, 770, 110, 790] });
    state().addAnnotations([box]);
    state().select(box.id);
    nudgeSelectedTextBox(-100, -100);
    const f = pdfToFraction(viewport, boxes()[0].rect);
    expect(f.left).toBeGreaterThanOrEqual(0);
    expect(f.top).toBeGreaterThanOrEqual(0);
  });
});
