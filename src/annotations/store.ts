import { create } from 'zustand';
import { applyCommand, invertCommand, removeCommand, type Command } from './history';
import {
  DEFAULT_HIGHLIGHT_COLOR,
  DEFAULT_TEXT_STYLE,
  isPointlessTextBox,
  type Annotation,
  type SignatureArtwork,
  type SignatureVariant,
  type TextStyle,
} from './model';

const MAX_HISTORY = 200;
/** Edits to the same field of the same annotation within this window share one undo step. */
const COALESCE_MS = 1500;

export type Tool = 'select' | 'note' | 'text' | 'sign' | 'edit';

/** The signature or initials waiting to be placed with the next click on a page. */
export interface PendingSignature {
  variant: SignatureVariant;
  artwork: SignatureArtwork;
}

export interface AnnotationState {
  annotations: Annotation[];
  selectedId: string | null;
  undoStack: Command[];
  redoStack: Command[];
  /** True once the user has changed annotations since the document was opened or last saved. */
  dirty: boolean;
  /** Colour used by the next highlight or note (the last one the user picked). */
  activeColor: string;
  /** What a click on a page does: normal selection, place a sticky note, or draw a text box. */
  tool: Tool;
  /** With the sign tool: what the next click places. */
  signing: PendingSignature | null;
  /** The look the next text box gets: whatever the user last chose. */
  textStyle: TextStyle;
  /** The text box whose text is being typed into, if any. */
  editingId: string | null;
  sidebarOpen: boolean;
  /** When set, the popover for this annotation focuses its note field as soon as it appears. */
  focusNoteId: string | null;

  addAnnotations: (anns: Annotation[]) => void;
  removeAnnotations: (ids: string[]) => void;
  /**
   * Takes back an annotation that was only just added and then abandoned (an empty text box): if
   * nothing has happened since it was added, the add disappears from the undo history and the
   * document is as clean as before. Otherwise it is an ordinary removal.
   */
  discardAnnotation: (id: string) => void;
  /** `coalesce: true` merges rapid successive edits (typing) into a single undo step. */
  updateAnnotation: (id: string, patch: Partial<Annotation>, opts?: { coalesce?: boolean }) => void;
  select: (id: string | null) => void;
  setActiveColor: (color: string) => void;
  setTool: (tool: Tool) => void;
  /** Picks up a signature: the next click on a page places it. */
  startSigning: (pending: PendingSignature) => void;
  setTextStyle: (patch: Partial<TextStyle>) => void;
  /** Starts (or, with null, ends) typing into a text box; also selects it. */
  setEditing: (id: string | null) => void;
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
  signing: null as PendingSignature | null,
  focusNoteId: null as string | null,
  editingId: null as string | null,
};

/** Time of the last coalescable edit; lives outside the store because it is not UI state. */
let lastCoalescedAt = 0;

/** The last single annotation added, and whether the document was dirty before that (for discard). */
let lastAdd: { id: string; dirtyBefore: boolean } | null = null;

export const useAnnotations = create<AnnotationState>((set, get) => {
  const keepSelection = (annotations: Annotation[], selectedId: string | null) =>
    annotations.some((a) => a.id === selectedId) ? selectedId : null;

  /** Drops the text box `previous` if it is no longer the selection and is not worth keeping. */
  const dropIfPointless = (previous: string | null, now: string | null) => {
    if (!previous || previous === now) return;
    const left = get().annotations.find((a) => a.id === previous);
    if (left && isPointlessTextBox(left)) get().discardAnnotation(previous);
  };

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
    textStyle: { ...DEFAULT_TEXT_STYLE },
    sidebarOpen: false,

    addAnnotations: (anns) => {
      if (!anns.length) return;
      const dirtyBefore = get().dirty;
      perform({ kind: 'add', anns });
      lastAdd = anns.length === 1 ? { id: anns[0].id, dirtyBefore } : null;
    },

    removeAnnotations: (ids) => {
      const cmd = removeCommand(get().annotations, ids);
      if (cmd) perform(cmd);
    },

    discardAnnotation: (id) => {
      const s = get();
      const top = s.undoStack[s.undoStack.length - 1];
      // Only while that add is still the newest thing in the history: anything later invalidates it.
      if (lastAdd?.id === id && top?.kind === 'add' && top.anns.length === 1 && top.anns[0].id === id) {
        const { dirtyBefore } = lastAdd;
        lastAdd = null;
        const annotations = s.annotations.filter((a) => a.id !== id);
        set({
          annotations,
          undoStack: s.undoStack.slice(0, -1),
          dirty: dirtyBefore,
          selectedId: keepSelection(annotations, s.selectedId),
          editingId: null,
        });
      } else {
        get().removeAnnotations([id]);
      }
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

    // Selecting something else ends text editing, and a text box left behind with nothing worth
    // keeping (empty, or an edit that changed nothing) is dropped: it would otherwise be saved.
    select: (id) => {
      const previous = get().selectedId;
      set((s) => ({ selectedId: id, editingId: s.editingId === id ? id : null }));
      dropIfPointless(previous, id);
    },

    setActiveColor: (color) => set({ activeColor: color }),

    // Leaving the sign tool drops the signature being carried.
    setTool: (tool) => set((s) => ({ tool, signing: tool === 'sign' ? s.signing : null })),

    startSigning: (signing) => set({ tool: 'sign', signing, selectedId: null, editingId: null }),

    setTextStyle: (patch) => set((s) => ({ textStyle: { ...s.textStyle, ...patch } })),

    setEditing: (editingId) => {
      const previous = get().selectedId;
      set(editingId ? { editingId, selectedId: editingId } : { editingId: null });
      if (editingId) dropIfPointless(previous, editingId);
    },

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
      lastAdd = null;
      set({ ...initial, annotations: anns });
    },

    markSaved: (snapshot) => {
      lastAdd = null; // a saved document no longer goes back to "unchanged" by dropping the add
      set((s) => (s.annotations === snapshot ? { dirty: false } : s));
    },

    setHighlightText: (id, text) =>
      set((s) => ({
        annotations: s.annotations.map((a) => (a.id === id && a.kind === 'highlight' && !a.text ? { ...a, text } : a)),
      })),

    reset: () => {
      lastCoalescedAt = 0;
      lastAdd = null;
      set({ ...initial });
    },
  };
});
