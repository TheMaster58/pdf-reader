/** [x1, y1, x2, y2] in PDF user space (origin bottom-left, y up), normalised so x1 < x2, y1 < y2. */
export type PdfRect = [number, number, number, number];

export interface HighlightAnnotation {
  id: string;
  kind: 'highlight';
  /** Zero-based page index. */
  pageIndex: number;
  /** One rect per highlighted line, in PDF user space. QuadPoints are derived from these on save. */
  rects: PdfRect[];
  /** CSS hex colour, e.g. '#FFE74C'. */
  color: string;
  /** The highlighted text (for the sidebar and as a fallback label). */
  text: string;
  /** The note attached to the highlight (empty until the user writes one). */
  contents: string;
  author: string;
  /** ISO 8601 timestamps. */
  created: string;
  modified: string;
}

/** A sticky note: an icon at a point on the page that holds a comment. */
export interface NoteAnnotation {
  id: string;
  kind: 'note';
  pageIndex: number;
  /**
   * PDF user-space position of the icon's top-left corner as it appears on screen. The icon has a
   * fixed pixel size, so it stays the same size at every zoom.
   */
  point: [number, number];
  color: string;
  /** The comment text. */
  contents: string;
  author: string;
  created: string;
  modified: string;
}

/** Everything the app can annotate with. */
export type Annotation = HighlightAnnotation | NoteAnnotation;

/** Side of a sticky-note icon, in CSS pixels. */
export const NOTE_ICON_PX = 24;

/**
 * The small speech-bubble drawn on a highlight that carries a comment, in CSS pixels relative to the
 * top-right corner of the highlight's first line. Shared by the overlay (drawing) and hit testing.
 */
export const NOTE_MARKER = { size: 16, dx: -2, dy: -8 } as const;

export interface HighlightColor {
  name: string;
  value: string;
}

export const HIGHLIGHT_COLORS: readonly HighlightColor[] = [
  { name: 'Yellow', value: '#FFE74C' },
  { name: 'Green', value: '#8FE388' },
  { name: 'Blue', value: '#8CC8FF' },
  { name: 'Pink', value: '#FF9EC4' },
  { name: 'Orange', value: '#FFBE76' },
];

export const DEFAULT_HIGHLIGHT_COLOR = HIGHLIGHT_COLORS[0].value;

export function createNote(input: {
  pageIndex: number;
  point: [number, number];
  color: string;
  author?: string;
}): NoteAnnotation {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    kind: 'note',
    pageIndex: input.pageIndex,
    point: input.point,
    color: input.color,
    contents: '',
    author: input.author ?? '',
    created: now,
    modified: now,
  };
}

export function createHighlight(input: {
  pageIndex: number;
  rects: PdfRect[];
  color: string;
  text: string;
  author?: string;
}): HighlightAnnotation {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    kind: 'highlight',
    pageIndex: input.pageIndex,
    rects: input.rects,
    color: input.color,
    text: input.text,
    contents: '',
    author: input.author ?? '',
    created: now,
    modified: now,
  };
}
