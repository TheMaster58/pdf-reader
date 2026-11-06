import { beforeEach, describe, expect, it } from 'vitest';
import { createHighlight, createNote, type HighlightAnnotation } from '../src/annotations/model';
import { useAnnotations } from '../src/annotations/store';

const state = () => useAnnotations.getState();
const hl = (text = ''): HighlightAnnotation =>
  createHighlight({ pageIndex: 0, rects: [[10, 10, 100, 22]], color: '#FFE74C', text });

describe('loadAnnotations', () => {
  beforeEach(() => state().reset());

  it('replaces everything and starts clean, with no undo history', () => {
    state().addAnnotations([hl()]);
    state().select(state().annotations[0].id);
    state().setTool('note');

    const fromFile = [hl('from the file'), createNote({ pageIndex: 1, point: [1, 2], color: '#FFE74C' })];
    state().loadAnnotations(fromFile);

    expect(state().annotations).toEqual(fromFile);
    expect(state().dirty).toBe(false);
    expect(state().undoStack).toEqual([]);
    expect(state().redoStack).toEqual([]);
    expect(state().selectedId).toBeNull();
    expect(state().tool).toBe('select');
  });

  it('cannot undo past the loaded state', () => {
    state().loadAnnotations([hl()]);
    state().undo();
    expect(state().annotations).toHaveLength(1);
    expect(state().dirty).toBe(false);
  });
});

describe('markSaved', () => {
  beforeEach(() => state().reset());

  it('clears the dirty flag when nothing changed since the snapshot', () => {
    state().addAnnotations([hl()]);
    expect(state().dirty).toBe(true);
    state().markSaved(state().annotations);
    expect(state().dirty).toBe(false);
  });

  it('keeps the document dirty if it was edited while the save was running', () => {
    state().addAnnotations([hl()]);
    const snapshot = state().annotations; // what the save started from
    state().addAnnotations([hl()]); // user keeps working during the save
    state().markSaved(snapshot);
    expect(state().dirty).toBe(true);
  });

  it('typing into a note during a save also keeps it dirty', () => {
    const n = createNote({ pageIndex: 0, point: [0, 0], color: '#FFE74C' });
    state().addAnnotations([n]);
    const snapshot = state().annotations;
    state().updateAnnotation(n.id, { contents: 'more' }, { coalesce: true });
    state().markSaved(snapshot);
    expect(state().dirty).toBe(true);
  });

  it('later edits after a save make it dirty again', () => {
    state().addAnnotations([hl()]);
    state().markSaved(state().annotations);
    state().addAnnotations([hl()]);
    expect(state().dirty).toBe(true);
  });
});

describe('setHighlightText', () => {
  beforeEach(() => state().reset());

  it('fills in missing text without touching history or the dirty flag', () => {
    const h = hl('');
    state().loadAnnotations([h]);
    state().setHighlightText(h.id, 'the covered words');
    expect((state().annotations[0] as HighlightAnnotation).text).toBe('the covered words');
    expect(state().dirty).toBe(false);
    expect(state().undoStack).toEqual([]);
  });

  it('never overwrites text a highlight already has, or touches other annotations', () => {
    const a = hl('keep me');
    const b = hl('');
    state().loadAnnotations([a, b]);
    state().setHighlightText(a.id, 'overwritten?');
    state().setHighlightText('missing-id', 'nothing');
    expect((state().annotations[0] as HighlightAnnotation).text).toBe('keep me');
    expect((state().annotations[1] as HighlightAnnotation).text).toBe('');
  });
});
