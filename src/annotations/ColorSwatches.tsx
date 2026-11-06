import { HIGHLIGHT_COLORS } from './model';

/** Row of colour buttons. Used by the selection toolbar and the highlight popover. */
export function ColorSwatches({
  value,
  label,
  onPick,
}: {
  /** The currently chosen colour, drawn with a ring. */
  value?: string;
  /** Prefix for accessible names, e.g. "Highlight" -> "Highlight yellow". */
  label: string;
  onPick: (color: string) => void;
}) {
  return (
    <div className="swatches" role="group" aria-label={`${label} colour`}>
      {HIGHLIGHT_COLORS.map((c) => (
        <button
          key={c.value}
          type="button"
          className={'swatch' + (value?.toLowerCase() === c.value.toLowerCase() ? ' current' : '')}
          style={{ background: c.value }}
          aria-label={`${label} ${c.name.toLowerCase()}`}
          aria-pressed={value ? value.toLowerCase() === c.value.toLowerCase() : undefined}
          title={c.name}
          onClick={() => onPick(c.value)}
        />
      ))}
    </div>
  );
}
