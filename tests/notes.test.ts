import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  anchorPoint,
  groupByPage,
  hasNote,
  sortAnnotations,
} from '../src/annotations/list';
import {
  createHighlight,
  createNote,
  type Annotation,
  type HighlightAnnotation,
  type NoteAnnotation,
} from '../src/annotations/model';
import { useAnnotations } from '../src/annotations/store';

const state = () => useAnnotations.getState();
const hl = (pageIndex: number, rect: [number, number, number, number]): HighlightAnnotation =>
  createHighlight({ pageIndex, rects: [rect], color: '#FFE74C', text: 'text' });
const note = (pageIndex: number, point: [number, number]): NoteAnnotation =>
  createNote({ pageIndex, point, color: '#FFE74C' });

describe('createNote', () => {
  it('starts empty with matching created/modified times', () => {
    const n = note(2, [100, 200]);
    expect(n.kind).toBe('note');
    expect(n.contents).toBe('');
    expect(n.point).toEqual([100, 200]);
    expect(n.created).toBe(n.modified);
  });
});

describe('annotation ordering', () => {
  it('sorts by page, then top to bottom, then left to right', () => {
    const a = hl(1, [50, 600, 100, 612]); // page 2, lower on the page
    const b = hl(0, [50, 700, 100, 712]); // page 1, top
    const c = note(0, [300, 500]); // page 1, below b
    const d = hl(0, [10, 700, 40, 712]); // page 1, same line as b but further left
    expect(sortAnnotations([a, b, c, d]).map((x) => x.id)).toEqual([d.id, b.id, c.id, a.id]);
  });

  it('does not mutate its input', () => {
    const list = [hl(1, [0, 0, 1, 1]), hl(0, [0, 0, 1, 1])];
    const before = list.map((x) => x.id);
    sortAnnotations(list);
    expect(list.map((x) => x.id)).toEqual(before);
  });

  it('groups by page and skips empty pages', () => {
    const groups = groupByPage([hl(3, [0, 0, 1, 1]), hl(0, [0, 5, 1, 6]), note(3, [0, 100])]);
    expect(groups.map((g) => [g.pageIndex, g.items.length])).toEqual([
      [0, 1],
      [3, 2],
    ]);
  });

  it('anchors at the top-left of a highlight and at the point of a note', () => {
    const h = createHighlight({
      pageIndex: 0,
      rects: [
        [20, 500, 90, 512],
        [10, 480, 60, 492],
      ],
      color: '#FFE74C',
      text: '',
    });
    expect(anchorPoint(h)).toEqual([10, 512]);
    expect(anchorPoint(note(0, [33, 44]))).toEqual([33, 44]);
  });

  it('hasNote ignores whitespace-only comments', () => {
    const n = note(0, [0, 0]);
    expect(hasNote(n)).toBe(false);
    expect(hasNote({ ...n, contents: '   \n ' })).toBe(false);
    expect(hasNote({ ...n, contents: 'hi' })).toBe(true);
  });
});

describe('notes in the store', () => {
  beforeEach(() => state().reset());

  it('places a sticky note, and undo removes it', () => {
    const n = note(0, [100, 100]);
    state().addAnnotations([n]);
    expect(state().annotations).toEqual([n]);
    state().undo();
    expect(state().annotations).toEqual([]);
  });

  it('updates the comment of a highlight too', () => {
    const h = hl(0, [10, 10, 100, 22]);
    state().addAnnotations([h]);
    state().updateAnnotation(h.id, { contents: 'remember this' });
    expect((state().annotations[0] as HighlightAnnotation).contents).toBe('remember this');
  });
});

describe('typing a note (coalesced undo)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    state().reset();
  });
  afterEach(() => vi.useRealTimers());

  const type = (id: string, text: string) =>
    state().updateAnnotation(id, { contents: text }, { coalesce: true });

  it('merges rapid keystrokes into one undo step that restores the original text', () => {
    const n = note(0, [0, 0]);
    state().addAnnotations([n]);
    for (const text of ['h', 'he', 'hel', 'hell', 'hello']) {
      vi.advanceTimersByTime(100);
      type(n.id, text);
    }
    expect(state().annotations[0].contents).toBe('hello');
    expect(state().undoStack).toHaveLength(2); // the add, and one merged edit

    state().undo();
    expect(state().annotations[0].contents).toBe('');
    state().redo();
    expect(state().annotations[0].contents).toBe('hello');
  });

  it('starts a new undo step after a pause', () => {
    const n = note(0, [0, 0]);
    state().addAnnotations([n]);
    type(n.id, 'first');
    vi.advanceTimersByTime(3000);
    type(n.id, 'first second');
    expect(state().undoStack).toHaveLength(3);
    state().undo();
    expect(state().annotations[0].contents).toBe('first');
  });

  it('does not merge edits to different annotations or different fields', () => {
    const a = note(0, [0, 0]);
    const b = note(0, [50, 50]);
    state().addAnnotations([a, b]);
    type(a.id, 'a');
    type(b.id, 'b');
    expect(state().undoStack).toHaveLength(3);

    state().updateAnnotation(b.id, { color: '#8CC8FF' }, { coalesce: true });
    expect(state().undoStack).toHaveLength(4);
  });

  it('a non-coalesced edit never merges', () => {
    const n = note(0, [0, 0]);
    state().addAnnotations([n]);
    state().updateAnnotation(n.id, { color: '#8CC8FF' });
    state().updateAnnotation(n.id, { color: '#FF9EC4' });
    expect(state().undoStack).toHaveLength(3);
  });

  it('clears the redo branch when typing continues after an undo', () => {
    const n = note(0, [0, 0]);
    state().addAnnotations([n]);
    state().addAnnotations([note(1, [0, 0])]);
    state().undo();
    expect(state().redoStack).toHaveLength(1);
    type(n.id, 'x');
    expect(state().redoStack).toHaveLength(0);
  });

  it('keeps the modified timestamp moving while typing', () => {
    const n = note(0, [0, 0]);
    state().addAnnotations([n]);
    vi.advanceTimersByTime(100);
    type(n.id, 'a');
    const t1 = state().annotations[0].modified;
    vi.advanceTimersByTime(100);
    type(n.id, 'ab');
    expect(state().annotations[0].modified > t1).toBe(true);
  });
});

describe('UI state in the store', () => {
  beforeEach(() => state().reset());

  it('reset returns to the select tool and drops note-focus requests, but keeps sidebar choice', () => {
    state().setTool('note');
    state().setSidebarOpen(true);
    state().requestNoteFocus('abc');
    state().reset();
    expect(state().tool).toBe('select');
    expect(state().focusNoteId).toBeNull();
    expect(state().sidebarOpen).toBe(true);
  });
});

// Type-level check that the union is usable generically.
const _exhaustive = (a: Annotation): string => (a.kind === 'highlight' ? a.text : a.contents);
void _exhaustive;
