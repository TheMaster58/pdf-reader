import type { Annotation } from './model';

/**
 * An undoable change to the annotation list. Commands are plain data so they can be inverted and
 * replayed without the store: undo applies invert(cmd), redo applies cmd again.
 */
export type Command =
  /** Append new annotations (e.g. a highlight, or one per page for a multi-page selection). */
  | { kind: 'add'; anns: Annotation[] }
  /** Remove annotations. `index` is where each one was, so undo can put it back in place. */
  | { kind: 'remove'; items: { ann: Annotation; index: number }[] }
  /** Re-insert removed annotations at their old positions (the inverse of 'remove'). */
  | { kind: 'restore'; items: { ann: Annotation; index: number }[] }
  /** Change fields of one annotation. */
  | { kind: 'update'; id: string; before: Partial<Annotation>; after: Partial<Annotation> };

export function applyCommand(list: Annotation[], cmd: Command): Annotation[] {
  switch (cmd.kind) {
    case 'add':
      return [...list, ...cmd.anns];
    case 'remove': {
      const ids = new Set(cmd.items.map((i) => i.ann.id));
      return list.filter((a) => !ids.has(a.id));
    }
    case 'restore': {
      const next = [...list];
      // Ascending index order puts each item back exactly where it was.
      for (const { ann, index } of [...cmd.items].sort((a, b) => a.index - b.index)) {
        next.splice(Math.min(index, next.length), 0, ann);
      }
      return next;
    }
    case 'update':
      return list.map((a) => (a.id === cmd.id ? ({ ...a, ...cmd.after } as Annotation) : a));
  }
}

export function invertCommand(cmd: Command): Command {
  switch (cmd.kind) {
    case 'add':
      return { kind: 'remove', items: cmd.anns.map((ann) => ({ ann, index: -1 })) };
    case 'remove':
      return { kind: 'restore', items: cmd.items };
    case 'restore':
      return { kind: 'remove', items: cmd.items };
    case 'update':
      return { kind: 'update', id: cmd.id, before: cmd.after, after: cmd.before };
  }
}

/** Builds the 'remove' command for the given ids against the current list. */
export function removeCommand(list: Annotation[], ids: string[]): Command | null {
  const wanted = new Set(ids);
  const items = list
    .map((ann, index) => ({ ann, index }))
    .filter(({ ann }) => wanted.has(ann.id));
  return items.length ? { kind: 'remove', items } : null;
}
