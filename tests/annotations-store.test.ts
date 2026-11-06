import { beforeEach, describe, expect, it } from 'vitest';
import { applyCommand, invertCommand, removeCommand } from '../src/annotations/history';
import { createHighlight, type Annotation } from '../src/annotations/model';
import { useAnnotations } from '../src/annotations/store';

const make = (pageIndex = 0, color = '#FFE74C'): Annotation =>
  createHighlight({ pageIndex, rects: [[10, 10, 100, 22]], color, text: 'hello' });

const state = () => useAnnotations.getState();
const ids = () => state().annotations.map((a) => a.id);

describe('history commands', () => {
  it('add / remove are inverses', () => {
    const a = make();
    const added = applyCommand([], { kind: 'add', anns: [a] });
    expect(added).toEqual([a]);
    expect(applyCommand(added, invertCommand({ kind: 'add', anns: [a] }))).toEqual([]);
  });

  it('removing then undoing restores the original order', () => {
    const [a, b, c] = [make(), make(), make()];
    const list = [a, b, c];
    const cmd = removeCommand(list, [a.id, c.id])!;
    const after = applyCommand(list, cmd);
    expect(after).toEqual([b]);
    expect(applyCommand(after, invertCommand(cmd))).toEqual([a, b, c]);
  });

  it('removeCommand returns null when nothing matches', () => {
    expect(removeCommand([make()], ['nope'])).toBeNull();
  });
});

describe('annotation store', () => {
  beforeEach(() => state().reset());

  it('adds highlights, marks the document dirty and records undo', () => {
    expect(state().dirty).toBe(false);
    const a = make();
    state().addAnnotations([a]);
    expect(ids()).toEqual([a.id]);
    expect(state().dirty).toBe(true);
    expect(state().undoStack).toHaveLength(1);
  });

  it('adding nothing is a no-op', () => {
    state().addAnnotations([]);
    expect(state().dirty).toBe(false);
    expect(state().undoStack).toHaveLength(0);
  });

  it('a multi-page selection is one undo step', () => {
    state().addAnnotations([make(0), make(1)]);
    expect(state().annotations).toHaveLength(2);
    state().undo();
    expect(state().annotations).toHaveLength(0);
    state().redo();
    expect(state().annotations).toHaveLength(2);
  });

  it('recolours via update, and undo/redo restore the colour and modified time', () => {
    const a = make(0, '#FFE74C');
    state().addAnnotations([a]);
    state().updateAnnotation(a.id, { color: '#8CC8FF' });
    expect(state().annotations[0].color).toBe('#8CC8FF');
    expect(state().annotations[0].modified >= a.modified).toBe(true);

    state().undo();
    expect(state().annotations[0].color).toBe('#FFE74C');
    expect(state().annotations[0].modified).toBe(a.modified);

    state().redo();
    expect(state().annotations[0].color).toBe('#8CC8FF');
  });

  it('delete + undo brings the highlight back in the same position', () => {
    const [a, b, c] = [make(), make(), make()];
    state().addAnnotations([a, b, c]);
    state().removeAnnotations([b.id]);
    expect(ids()).toEqual([a.id, c.id]);
    state().undo();
    expect(ids()).toEqual([a.id, b.id, c.id]);
  });

  it('clears the selection when the selected highlight is removed or un-added', () => {
    const a = make();
    state().addAnnotations([a]);
    state().select(a.id);
    state().removeAnnotations([a.id]);
    expect(state().selectedId).toBeNull();

    state().undo(); // restores a
    state().select(a.id);
    state().undo(); // un-adds a
    expect(state().selectedId).toBeNull();
  });

  it('a new action after undo discards the redo branch', () => {
    state().addAnnotations([make()]);
    state().undo();
    expect(state().redoStack).toHaveLength(1);
    state().addAnnotations([make()]);
    expect(state().redoStack).toHaveLength(0);
  });

  it('undo/redo on empty stacks do nothing', () => {
    state().undo();
    state().redo();
    expect(state().annotations).toEqual([]);
    expect(state().dirty).toBe(false);
  });

  it('reset forgets annotations, history and selection', () => {
    const a = make();
    state().addAnnotations([a]);
    state().select(a.id);
    state().reset();
    expect(state().annotations).toEqual([]);
    expect(state().selectedId).toBeNull();
    expect(state().undoStack).toEqual([]);
    expect(state().dirty).toBe(false);
  });

  it('keeps the chosen active colour across reset', () => {
    state().setActiveColor('#FF9EC4');
    state().reset();
    expect(state().activeColor).toBe('#FF9EC4');
  });
});
