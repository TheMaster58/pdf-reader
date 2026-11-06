import { create } from 'zustand';
import { applyCommand, invertCommand, removeCommand, type Command } from './history';
import { DEFAULT_HIGHLIGHT_COLOR, type Annotation } from './model';

const MAX_HISTORY = 200;
/** Edits to the same field of the same annotation within this window share one undo step. */
const COALESCE_MS = 1500;

export type Tool = 'select' | 'note';

export interface AnnotationState {
  annotations: Annotation[];
  selectedId: string | null;
  undoStack: Command[];
  redoStack: Command[];
  /** True once the user has changed annotations since the document was opened or last saved. */
  dirty: boolean;
  /** Colour used by the next highlight or note (the last one the user picked). */
  activeColor: string;
  /** What a click on a page does: normal selection, or place a sticky note. */
  tool: Tool;
  sidebarOpen: boolean;
  /** When set, the popover for this annotation focuses its note field as soon as it appears. */
  focusNoteId: string | null;

  addAnnotations: (anns: Annotation[]) => void;
  removeAnnotations: (ids: string[]) => void;
  /** `coalesce: true` merges rapid successive edits (typing) into a single undo step. */
  updateAnnotation: (id: string, patch: Partial<Annotation>, opts?: { coalesce?: boolean }) => void;
  select: (id: string | null) => void;
  setActiveColor: (color: string) => void;
  setTool: (tool: Tool) => void;
  setSidebarOpen: (open: boolean) => void;
  requestNoteFocus: (id: string | null) => void;
  undo: () => void;
  redo: () => void;
  /** Replaces everything with the annotations read from a freshly opened document. */
  loadAnnotations: (anns: Annotation[]) => void;
  /** Marks the document as saved, unless it was edited since `snapshot` was taken. */
  markSaved: (snapshot: Annotation[]) => void;
  /** Fills in the highlighted text of an annotation read from a file. Not an edit: no undo, not dirty. */
  setHighlightText: (id: string, text: string) => void;
  /** Forget everything: used when a different document is opened. */
  reset: () => void;
}

const initial = {
  annotations: [] as Annotation[],
  selectedId: null as string | null,
  undoStack: [] as Command[],
  redoStack: [] as Command[],
  dirty: false,
  tool: 'select' as Tool,
  focusNoteId: null as string | null,
};

/** Time of the last coalescable edit; lives outside the store because it is not UI state. */
let lastCoalescedAt = 0;

export const useAnnotations = create<AnnotationState>((set, get) => {
  const keepSelection = (annotations: Annotation[], selectedId: string | null) =>
    annotations.some((a) => a.id === selectedId) ? selectedId : null;

  /** Applies a new user action: records it for undo and clears the redo branch. */
  const perform = (cmd: Command) =>
    set((s) => {
      const annotations = applyCommand(s.annotations, cmd);
      return {
        annotations,
        undoStack: [...s.undoStack, cmd].slice(-MAX_HISTORY),
        redoStack: [],
        dirty: true,
        selectedId: keepSelection(annotations, s.selectedId),
      };
    });

  return {
    ...initial,
    activeColor: DEFAULT_HIGHLIGHT_COLOR,
    sidebarOpen: false,

    addAnnotations: (anns) => {
      if (anns.length) perform({ kind: 'add', anns });
    },

    removeAnnotations: (ids) => {
      const cmd = removeCommand(get().annotations, ids);
      if (cmd) perform(cmd);
    },

    updateAnnotation: (id, patch, opts) => {
      const current = get().annotations.find((a) => a.id === id);
      if (!current) return;
      const modified = new Date().toISOString();
      const now = Date.now();

      // Typing: fold this edit into the previous undo step if it is the same field, just now.
      const top = get().undoStack[get().undoStack.length - 1];
      if (
        opts?.coalesce &&
        top?.kind === 'update' &&
        top.id === id &&
        now - lastCoalescedAt < COALESCE_MS &&
        Object.keys(patch).every((k) => k in top.after)
      ) {
        lastCoalescedAt = now;
        const merged: Command = { ...top, after: { ...top.after, ...patch, modified } };
        set((s) => ({
          annotations: applyCommand(s.annotations, { kind: 'update', id, before: {}, after: { ...patch, modified } }),
          undoStack: [...s.undoStack.slice(0, -1), merged],
          redoStack: [],
          dirty: true,
        }));
        return;
      }

      const before: Record<string, unknown> = {};
      for (const key of Object.keys(patch)) {
        before[key] = (current as unknown as Record<string, unknown>)[key];
      }
      if (opts?.coalesce) lastCoalescedAt = now;
      perform({
        kind: 'update',
        id,
        before: { ...before, modified: current.modified } as Partial<Annotation>,
        after: { ...patch, modified },
      });
    },

    select: (id) => set({ selectedId: id }),

    setActiveColor: (color) => set({ activeColor: color }),

    setTool: (tool) => set({ tool }),

    setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),

    requestNoteFocus: (focusNoteId) => set({ focusNoteId }),

    undo: () =>
      set((s) => {
        const cmd = s.undoStack[s.undoStack.length - 1];
        if (!cmd) return s;
        const annotations = applyCommand(s.annotations, invertCommand(cmd));
        return {
          annotations,
          undoStack: s.undoStack.slice(0, -1),
          redoStack: [...s.redoStack, cmd],
          dirty: true,
          selectedId: keepSelection(annotations, s.selectedId),
        };
      }),

    redo: () =>
      set((s) => {
        const cmd = s.redoStack[s.redoStack.length - 1];
        if (!cmd) return s;
        const annotations = applyCommand(s.annotations, cmd);
        return {
          annotations,
          undoStack: [...s.undoStack, cmd],
          redoStack: s.redoStack.slice(0, -1),
          dirty: true,
          selectedId: keepSelection(annotations, s.selectedId),
        };
      }),

    loadAnnotations: (anns) => {
      lastCoalescedAt = 0;
      set({ ...initial, annotations: anns });
    },

    markSaved: (snapshot) => set((s) => (s.annotations === snapshot ? { dirty: false } : s)),

    setHighlightText: (id, text) =>
      set((s) => ({
        annotations: s.annotations.map((a) => (a.id === id && a.kind === 'highlight' && !a.text ? { ...a, text } : a)),
      })),

    reset: () => {
      lastCoalescedAt = 0;
      set({ ...initial });
    },
  };
});
