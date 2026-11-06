import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { hasUnsupportedCharacters } from '../text/fontMetrics';
import {
  LINE_HEIGHT,
  TEXT_PADDING,
  BORDER_WIDTH,
  heightForLines,
  layoutLines,
  minBoxWidth,
} from '../text/textLayout';
import { HANDLES, resizeFraction } from './boxGeometry';
import { pdfToFraction } from './geometry';
import {
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  TEXT_COLORS,
  TEXT_FILLS,
  TEXT_FONTS,
  type TextAlign,
  type TextBoxAnnotation,
} from './model';
import type { PageHost } from './pageHosts';
import { useAnnotations } from './store';
import { editTextBox, finishEditing } from './textBoxActions';
import { useBoxGesture } from './useBoxGesture';

const pct = (v: number) => `${(v * 100).toFixed(4)}%`;

/**
 * A length in PDF points, as CSS that follows the page's zoom: the matching share of the overlay's
 * width (the overlay layer is a size container, see styles.css). PDF.js rounds a page's width down
 * to whole device pixels but leaves its own scale variable unrounded, so sizing text from that
 * variable would come out about half a percent larger than the box it sits in.
 */
const ptToCss = (points: number, pageWidthPt: number) =>
  `${((points / pageWidthPt) * 100).toFixed(5)}cqw`;

/**
 * A text box on a page: shown as text, moved and resized with the pointer when selected, and typed
 * into when editing. Sits in the page's interactive layer, so it takes the mouse itself.
 */
export function TextBoxView({ ann, host }: { ann: TextBoxAnnotation; host: PageHost }) {
  const selected = useAnnotations((s) => s.selectedId === ann.id);
  const editing = useAnnotations((s) => s.editingId === ann.id);
  const vp = host.viewport;

  // Moving and resizing with the pointer (shared with signatures); a drag is one undo step.
  const { frame, begin, track, end } = useBoxGesture({
    id: ann.id,
    host,
    rect: ann.rect,
    resize: (start, handle, dx, dy) => resizeFraction(start, handle, dx, dy, minFrame()),
    onCommit: (rect) => editTextBox(ann.id, { rect }),
    // A plain click on a box that is already selected goes into it to type.
    onClickSelected: () => useAnnotations.getState().setEditing(ann.id),
  });
  const widthPt = (frame.right - frame.left) * vp.width;
  // Only the fields that change how text wraps matter, not the colour or position.
  const lines = useMemo(
    () => layoutLines(ann, widthPt),
    [ann.contents, ann.fontFamily, ann.fontSize, ann.bold, ann.italic, widthPt],
  );
  const fontCss = TEXT_FONTS.find((f) => f.value === ann.fontFamily)?.css;

  // The frame is just the geometry; the body inside it carries the look and clips overflowing text
  // (as the saved appearance does), so the handles on the frame's edge are never clipped.
  const frameStyle: CSSProperties = {
    left: pct(frame.left),
    top: pct(frame.top),
    width: pct(frame.right - frame.left),
    height: pct(frame.bottom - frame.top),
  };
  const pt = (points: number) => ptToCss(points, vp.width);
  const bodyStyle: CSSProperties = {
    padding: pt(TEXT_PADDING),
    color: ann.color,
    fontFamily: fontCss,
    fontWeight: ann.bold ? 700 : 400,
    fontStyle: ann.italic ? 'italic' : 'normal',
    fontSize: pt(ann.fontSize),
    lineHeight: LINE_HEIGHT,
    textAlign: ann.align,
    background: ann.fill ?? 'transparent',
    // The outline is drawn inside the box without taking room from the text, as in the saved file.
    boxShadow: ann.border ? `inset 0 0 0 ${pt(BORDER_WIDTH)} ${ann.color}` : undefined,
  };

  function minFrame() {
    return {
      width: minBoxWidth(ann.fontSize) / vp.width,
      height: heightForLines(ann.fontSize, 1) / vp.height,
    };
  }

  return (
    <div
      className={'text-box' + (selected ? ' selected' : '') + (editing ? ' editing' : '')}
      data-annotation-id={ann.id}
      style={frameStyle}
      onPointerDown={editing ? undefined : (e) => begin(e, 'move')}
      onPointerMove={track}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={() => useAnnotations.getState().setEditing(ann.id)}
    >
      <div className="text-box-body" style={bodyStyle}>
        {editing ? (
          <TextEditor ann={ann} />
        ) : (
          <div className="text-box-lines" aria-label={ann.contents || 'Empty text box'}>
            {lines.map((line, i) => (
              // A zero-width space keeps blank lines their full height.
              <div key={i}>{line || '​'}</div>
            ))}
          </div>
        )}
      </div>
      {selected &&
        !editing &&
        HANDLES.map((h) => (
          <span
            key={h}
            className={`text-handle h-${h}`}
            onPointerDown={(e) => begin(e, h)}
            aria-hidden="true"
          />
        ))}
    </div>
  );
}

/** The textarea shown while typing. It uses the same font, size and padding as the finished text. */
function TextEditor({ ann }: { ann: TextBoxAnnotation }) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Start with the cursor at the end of the existing text.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  return (
    <textarea
      ref={ref}
      className="text-box-editor"
      aria-label="Text box"
      spellCheck={false}
      value={ann.contents}
      onChange={(e) => editTextBox(ann.id, { contents: e.target.value }, { coalesce: true })}
      onBlur={() => finishEditing(ann.id, false)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          finishEditing(ann.id, true);
        }
      }}
    />
  );
}

const ALIGNMENTS: { value: TextAlign; label: string; lines: [number, number][] }[] = [
  {
    value: 'left',
    label: 'Align left',
    lines: [
      [2, 14],
      [2, 10],
      [2, 14],
      [2, 8],
    ],
  },
  {
    value: 'center',
    label: 'Align centre',
    lines: [
      [2, 14],
      [4, 12],
      [2, 14],
      [5, 11],
    ],
  },
  {
    value: 'right',
    label: 'Align right',
    lines: [
      [2, 14],
      [6, 14],
      [2, 14],
      [8, 14],
    ],
  },
];

function AlignIcon({ lines }: { lines: [number, number][] }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      {lines.map(([x1, x2], i) => (
        <path
          key={i}
          d={`M${x1} ${3.5 + i * 3}H${x2}`}
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}

const BAR_WIDTH = 520;
const BAR_GAP = 8;

/**
 * Formatting for the selected text box: font, size, colour, alignment, background, outline, and
 * delete. Floats above the box (below it when there is no room above) at a fixed pixel size.
 */
export function TextFormatBar({ ann, host }: { ann: TextBoxAnnotation; host: PageHost }) {
  const remove = useAnnotations((s) => s.removeAnnotations);
  const rootRef = useRef<HTMLDivElement>(null);
  const [below, setBelow] = useState(false);
  const frame = pdfToFraction(host.viewport, ann.rect);

  // Open below the box when the bar wouldn't fit above it inside the page; re-check when the page
  // is resized (zoom), since the box's position is a fraction of the page.
  useLayoutEffect(() => {
    const measure = () => {
      const root = rootRef.current;
      if (!root) return;
      setBelow(frame.top * host.el.clientHeight - root.offsetHeight - BAR_GAP < 0);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host.el);
    return () => observer.disconnect();
  }, [host.el, frame.top]);

  const set = (patch: Parameters<typeof editTextBox>[1]) => editTextBox(ann.id, patch);
  // Read the box as it is *now*, not as of the last render, so quick successive clicks compound.
  const latest = (): TextBoxAnnotation => {
    const current = useAnnotations.getState().annotations.find((a) => a.id === ann.id);
    return current?.kind === 'textbox' ? current : ann;
  };
  // Buttons must not steal focus from the text being typed.
  const keepFocus = (e: React.MouseEvent) => e.preventDefault();

  return (
    <div
      ref={rootRef}
      className="hl-popover text-format-bar"
      role="toolbar"
      aria-label="Text box formatting"
      style={{
        left: `clamp(0%, ${pct(frame.left)}, calc(100% - ${BAR_WIDTH}px))`,
        ...(below
          ? { top: `calc(${pct(frame.bottom)} + ${BAR_GAP}px)` }
          : { top: `calc(${pct(frame.top)} - ${BAR_GAP}px)`, transform: 'translateY(-100%)' }),
      }}
    >
      <select
        aria-label="Font"
        value={ann.fontFamily}
        onChange={(e) => set({ fontFamily: e.target.value as TextBoxAnnotation['fontFamily'] })}
      >
        {TEXT_FONTS.map((f) => (
          <option key={f.value} value={f.value}>
            {f.label}
          </option>
        ))}
      </select>

      <span className="size-field">
        <button
          type="button"
          aria-label="Smaller text"
          disabled={ann.fontSize <= MIN_FONT_SIZE}
          onMouseDown={keepFocus}
          onClick={() => set({ fontSize: Math.max(MIN_FONT_SIZE, latest().fontSize - 1) })}
        >
          -
        </button>
        <SizeInput value={ann.fontSize} onCommit={(v) => set({ fontSize: v })} />
        <button
          type="button"
          aria-label="Larger text"
          disabled={ann.fontSize >= MAX_FONT_SIZE}
          onMouseDown={keepFocus}
          onClick={() => set({ fontSize: Math.min(MAX_FONT_SIZE, latest().fontSize + 1) })}
        >
          +
        </button>
      </span>

      <div className="swatches" role="group" aria-label="Text colour">
        {TEXT_COLORS.map((c) => (
          <button
            key={c.value}
            type="button"
            className={
              'swatch' + (ann.color.toLowerCase() === c.value.toLowerCase() ? ' current' : '')
            }
            style={{ background: c.value }}
            aria-label={`Text ${c.name.toLowerCase()}`}
            aria-pressed={ann.color.toLowerCase() === c.value.toLowerCase()}
            title={`Text: ${c.name}`}
            onMouseDown={keepFocus}
            onClick={() => set({ color: c.value })}
          />
        ))}
      </div>

      <div className="align-group" role="group" aria-label="Font style">
        <button
          type="button"
          className="style-bold"
          aria-label="Bold"
          title="Bold"
          aria-pressed={ann.bold}
          onMouseDown={keepFocus}
          onClick={() => set({ bold: !latest().bold })}
        >
          B
        </button>
        <button
          type="button"
          className="style-italic"
          aria-label="Italic"
          title="Italic"
          aria-pressed={ann.italic}
          onMouseDown={keepFocus}
          onClick={() => set({ italic: !latest().italic })}
        >
          I
        </button>
      </div>

      <div className="align-group" role="group" aria-label="Alignment">
        {ALIGNMENTS.map((a) => (
          <button
            key={a.value}
            type="button"
            aria-label={a.label}
            title={a.label}
            aria-pressed={ann.align === a.value}
            onMouseDown={keepFocus}
            onClick={() => set({ align: a.value })}
          >
            <AlignIcon lines={a.lines} />
          </button>
        ))}
      </div>

      <div className="swatches" role="group" aria-label="Background">
        {TEXT_FILLS.map((f) => {
          const current = (ann.fill ?? null)?.toLowerCase() === (f.value ?? null)?.toLowerCase();
          return (
            <button
              key={f.name}
              type="button"
              className={'swatch' + (f.value ? '' : ' swatch-none') + (current ? ' current' : '')}
              style={f.value ? { background: f.value } : undefined}
              aria-label={f.name}
              aria-pressed={current}
              title={f.name}
              onMouseDown={keepFocus}
              onClick={() => set({ fill: f.value })}
            />
          );
        })}
      </div>

      <button
        type="button"
        aria-pressed={ann.border}
        title="Outline"
        onMouseDown={keepFocus}
        onClick={() => set({ border: !latest().border })}
      >
        Outline
      </button>
      <button
        type="button"
        className="danger"
        onMouseDown={keepFocus}
        title={ann.replaces ? 'Remove this edit and show the original text again' : undefined}
        onClick={() => remove([ann.id])}
      >
        {ann.replaces ? 'Revert to original' : 'Delete'}
      </button>

      {ann.replaces && (
        <p className="text-format-note">
          Edited text. The original is still in the file under this box: it is covered, not removed.
        </p>
      )}

      {hasUnsupportedCharacters(ann.contents) && (
        <p className="text-format-warning" role="status">
          Some characters can&apos;t be saved with these fonts and will become &ldquo;?&rdquo;.
        </p>
      )}
    </div>
  );
}

/**
 * Number field that lets you type freely (so "1" on the way to "14" isn't rejected) and applies the
 * size when you press Enter or leave the field.
 */
function SizeInput({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    const v = Number(draft);
    if (draft !== null && draft.trim() !== '' && Number.isFinite(v)) {
      onCommit(Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(v * 2) / 2)));
    }
    setDraft(null);
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label="Font size"
      value={draft ?? String(value)}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        } else if (e.key === 'Escape') {
          setDraft(null);
        }
      }}
    />
  );
}
