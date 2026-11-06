import type { Stroke } from '../signature/strokes';

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

/** The standard PDF fonts text boxes can use. They need no font file inside the PDF. */
export type TextFontFamily = 'Helvetica' | 'Times' | 'Courier';

export const TEXT_FONTS: readonly { value: TextFontFamily; label: string; css: string }[] = [
  { value: 'Helvetica', label: 'Sans-serif', css: 'Arial, Helvetica, sans-serif' },
  { value: 'Times', label: 'Serif', css: '"Times New Roman", Times, serif' },
  { value: 'Courier', label: 'Monospace', css: '"Courier New", Courier, monospace' },
];

export type TextAlign = 'left' | 'center' | 'right';

/** How the text in a text box looks. The last style the user chose is used for the next box. */
export interface TextStyle {
  fontFamily: TextFontFamily;
  /** In PDF points. */
  fontSize: number;
  /** Text colour, CSS hex. */
  color: string;
  align: TextAlign;
  /** Bold and italic (the bold, oblique and bold-oblique cuts of the standard fonts). */
  bold: boolean;
  italic: boolean;
  /** Background colour, or null for none. */
  fill: string | null;
  /** A thin outline in the text colour. */
  border: boolean;
}

export const DEFAULT_TEXT_STYLE: TextStyle = {
  fontFamily: 'Helvetica',
  fontSize: 12,
  color: '#000000',
  align: 'left',
  bold: false,
  italic: false,
  fill: null,
  border: false,
};

export const MIN_FONT_SIZE = 6;
export const MAX_FONT_SIZE = 96;

export const TEXT_COLORS: readonly HighlightColor[] = [
  { name: 'Black', value: '#000000' },
  { name: 'Red', value: '#D32F2F' },
  { name: 'Blue', value: '#1565C0' },
  { name: 'Green', value: '#2E7D32' },
  { name: 'Grey', value: '#616161' },
];

export const TEXT_FILLS: readonly { name: string; value: string | null }[] = [
  { name: 'No background', value: null },
  { name: 'White', value: '#FFFFFF' },
  { name: 'Yellow', value: '#FFF59D' },
  { name: 'Light blue', value: '#BBDEFB' },
];

/**
 * Text placed on the page. Saved as a standard /FreeText annotation, so other readers show it.
 * `contents` is the text and `color` is the text colour, matching the other kinds (the PDF calls the
 * text /Contents too).
 */
export interface TextBoxAnnotation extends TextStyle {
  id: string;
  kind: 'textbox';
  pageIndex: number;
  /** The box in PDF user space. On a rotated page it is still drawn upright on screen. */
  rect: PdfRect;
  contents: string;
  /** Alias of the text colour: lets generic code treat every annotation as having a colour. */
  color: string;
  /**
   * Set when this box was made by editing text that is already in the PDF: the box covers the old
   * text (its fill hides it) and shows the new. `text` is the original, `rect` where it was. The
   * old text is still in the file underneath: this is not a redaction.
   */
  replaces?: { rect: PdfRect; text: string };
  author: string;
  created: string;
  modified: string;
}

export type SignatureVariant = 'signature' | 'initials';

/**
 * What a signature looks like. A drawn one is kept as strokes (so it stays sharp at any size); a
 * typed name or an imported picture is a PNG with a transparent background.
 */
export type SignatureArtwork =
  | {
      type: 'strokes';
      strokes: Stroke[];
      /** Ink colour, CSS hex. */
      color: string;
      /** Pen width, in the same units as the stroke points. */
      width: number;
      /** Size of the drawing in those units (its aspect ratio is the signature's). */
      box: [number, number];
    }
  | {
      type: 'image';
      pngDataUrl: string;
      /** Size of the picture in pixels (its aspect ratio is the signature's). */
      size: [number, number];
    };

/** The default width of a placed signature or initials, in PDF points. */
export const SIGNATURE_DEFAULT_WIDTH: Record<SignatureVariant, number> = {
  signature: 150,
  initials: 60,
};

/**
 * A signature (or initials) placed on a page. A *visual* signature only: saved as a stamp that
 * shows the drawing, with no certificate behind it. Its shape keeps the artwork's aspect ratio.
 */
export interface SignatureAnnotation {
  id: string;
  kind: 'signature';
  pageIndex: number;
  /** The box in PDF user space. On a rotated page it is still drawn upright on screen. */
  rect: PdfRect;
  variant: SignatureVariant;
  artwork: SignatureArtwork;
  author: string;
  created: string;
  modified: string;
}

/** Everything the app can annotate with. */
export type Annotation =
  HighlightAnnotation | NoteAnnotation | TextBoxAnnotation | SignatureAnnotation;

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

export function createTextBox(input: {
  pageIndex: number;
  rect: PdfRect;
  style?: Partial<TextStyle>;
  contents?: string;
  replaces?: { rect: PdfRect; text: string };
  author?: string;
}): TextBoxAnnotation {
  const now = new Date().toISOString();
  return {
    ...DEFAULT_TEXT_STYLE,
    ...input.style,
    id: crypto.randomUUID(),
    kind: 'textbox',
    pageIndex: input.pageIndex,
    rect: input.rect,
    contents: input.contents ?? '',
    ...(input.replaces ? { replaces: input.replaces } : {}),
    author: input.author ?? '',
    created: now,
    modified: now,
  };
}

/**
 * Is this a text box that should not be kept? A plain box with no text is just an empty click. A
 * box that replaces existing text is pointless only while its text is unchanged (the original is
 * already there); emptying it is a real edit: it erases the line.
 */
export function isPointlessTextBox(a: Annotation): boolean {
  if (a.kind !== 'textbox') return false;
  return a.replaces ? a.contents === a.replaces.text : a.contents.trim() === '';
}

export function createSignature(input: {
  pageIndex: number;
  rect: PdfRect;
  variant: SignatureVariant;
  artwork: SignatureArtwork;
  author?: string;
}): SignatureAnnotation {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    kind: 'signature',
    pageIndex: input.pageIndex,
    rect: input.rect,
    variant: input.variant,
    artwork: input.artwork,
    author: input.author ?? '',
    created: now,
    modified: now,
  };
}

/** Width divided by height of a signature's artwork. */
export function artworkAspect(artwork: SignatureArtwork): number {
  const [w, h] = artwork.type === 'strokes' ? artwork.box : artwork.size;
  return h > 0 ? w / h : 1;
}
