/**
 * Drawn signatures are kept as strokes: lists of points. They are turned into smooth curves when
 * drawn, so they stay sharp at any size, zoom or print resolution.
 */
export type Point = [number, number];
export type Stroke = Point[];

/** Limits that keep stored or imported data from being absurdly large. */
export const MAX_STROKES = 200;
export const MAX_POINTS_PER_STROKE = 4000;
export const MAX_TOTAL_POINTS = 20_000;

export type Segment =
  { op: 'M'; p: Point } | { op: 'L'; p: Point } | { op: 'Q'; c: Point; p: Point };

const mid = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

/**
 * The path of one stroke: lines for one or two points, and for more, quadratic curves that pass
 * through the midpoints between neighbouring points with the points themselves as controls. That
 * smooths out the jitter of a hand-drawn line without drifting away from it.
 */
export function strokeSegments(stroke: Stroke): Segment[] {
  const n = stroke.length;
  if (n === 0) return [];
  const first = stroke[0];
  // A single point is a dot: a line of almost no length, which a round cap turns into a circle.
  if (n === 1) {
    return [
      { op: 'M', p: first },
      { op: 'L', p: [first[0] + 0.01, first[1]] },
    ];
  }
  const segments: Segment[] = [{ op: 'M', p: first }];
  if (n === 2) {
    segments.push({ op: 'L', p: stroke[1] });
    return segments;
  }
  for (let i = 1; i < n - 1; i++) {
    segments.push({ op: 'Q', c: stroke[i], p: mid(stroke[i], stroke[i + 1]) });
  }
  segments.push({ op: 'L', p: stroke[n - 1] });
  return segments;
}

const fmt = (v: number) => String(Math.round(v * 1000) / 1000);

/** SVG path data for the strokes (the path is open and unfilled). */
export function strokesToSvgPath(strokes: Stroke[]): string {
  const parts: string[] = [];
  for (const stroke of strokes) {
    for (const s of strokeSegments(stroke)) {
      if (s.op === 'M') parts.push(`M${fmt(s.p[0])} ${fmt(s.p[1])}`);
      else if (s.op === 'L') parts.push(`L${fmt(s.p[0])} ${fmt(s.p[1])}`);
      else parts.push(`Q${fmt(s.c[0])} ${fmt(s.c[1])} ${fmt(s.p[0])} ${fmt(s.p[1])}`);
    }
  }
  return parts.join('');
}

/**
 * The same path as PDF operators. PDF has no quadratic curve, so each one becomes the equivalent
 * cubic. Each stroke is painted separately, so a dot or a lift of the pen never joins two strokes.
 */
export function strokesToPdfOps(strokes: Stroke[]): string[] {
  const ops: string[] = [];
  for (const stroke of strokes) {
    let current: Point = [0, 0];
    for (const s of strokeSegments(stroke)) {
      if (s.op === 'M') {
        ops.push(`${fmt(s.p[0])} ${fmt(s.p[1])} m`);
      } else if (s.op === 'L') {
        ops.push(`${fmt(s.p[0])} ${fmt(s.p[1])} l`);
      } else {
        const c1: Point = [
          current[0] + (2 / 3) * (s.c[0] - current[0]),
          current[1] + (2 / 3) * (s.c[1] - current[1]),
        ];
        const c2: Point = [
          s.p[0] + (2 / 3) * (s.c[0] - s.p[0]),
          s.p[1] + (2 / 3) * (s.c[1] - s.p[1]),
        ];
        ops.push(
          `${fmt(c1[0])} ${fmt(c1[1])} ${fmt(c2[0])} ${fmt(c2[1])} ${fmt(s.p[0])} ${fmt(s.p[1])} c`,
        );
      }
      current = s.p;
    }
    if (stroke.length) ops.push('S');
  }
  return ops;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** The box around every point, or null if there are none. */
export function strokesBounds(strokes: Stroke[]): Bounds | null {
  let b: Bounds | null = null;
  for (const stroke of strokes) {
    for (const [x, y] of stroke) {
      if (!b) b = { minX: x, minY: y, maxX: x, maxY: y };
      else {
        b.minX = Math.min(b.minX, x);
        b.minY = Math.min(b.minY, y);
        b.maxX = Math.max(b.maxX, x);
        b.maxY = Math.max(b.maxY, y);
      }
    }
  }
  return b;
}

/** Drops points closer than `minDist` to the last kept one (always keeping the last point). */
export function simplifyStroke(stroke: Stroke, minDist: number): Stroke {
  if (stroke.length <= 2) return stroke.map((p) => [p[0], p[1]]);
  const out: Stroke = [stroke[0]];
  for (let i = 1; i < stroke.length - 1; i++) {
    const last = out[out.length - 1];
    if (Math.hypot(stroke[i][0] - last[0], stroke[i][1] - last[1]) >= minDist) out.push(stroke[i]);
  }
  out.push(stroke[stroke.length - 1]);
  return out;
}

export interface NormalisedStrokes {
  strokes: Stroke[];
  /** Size of the drawing in the same units as the points. */
  box: [number, number];
}

/**
 * Moves the strokes to the top-left corner with room for the pen's width around them, and reports
 * the size of the result. A placed signature then has no empty margin, whatever part of the drawing
 * area it was signed in. Null when there is nothing drawn.
 */
export function normaliseStrokes(strokes: Stroke[], lineWidth: number): NormalisedStrokes | null {
  const bounds = strokesBounds(strokes);
  if (!bounds) return null;
  const pad = lineWidth / 2 + 1;
  const dx = pad - bounds.minX;
  const dy = pad - bounds.minY;
  const round = (v: number) => Math.round(v * 100) / 100;
  return {
    strokes: strokes
      .filter((s) => s.length > 0)
      .map((s) => s.map(([x, y]): Point => [round(x + dx), round(y + dy)])),
    box: [round(bounds.maxX - bounds.minX + 2 * pad), round(bounds.maxY - bounds.minY + 2 * pad)],
  };
}

/** Width divided by height of a box. */
export function aspectOf(box: readonly [number, number]): number {
  return box[1] > 0 ? box[0] / box[1] : 1;
}

/**
 * Checks data of unknown origin (local storage, a PDF file) and returns clean strokes, or null if it
 * is not a sensible set of strokes: every coordinate a finite number of reasonable size, and no more
 * strokes or points than the limits allow.
 */
export function sanitizeStrokes(raw: unknown): Stroke[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_STROKES) return null;
  const out: Stroke[] = [];
  let total = 0;
  for (const s of raw) {
    if (!Array.isArray(s) || s.length === 0 || s.length > MAX_POINTS_PER_STROKE) return null;
    const stroke: Stroke = [];
    for (const p of s) {
      if (!Array.isArray(p) || p.length !== 2) return null;
      const [x, y] = p;
      if (typeof x !== 'number' || typeof y !== 'number') return null;
      if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 1e5 || Math.abs(y) > 1e5)
        return null;
      stroke.push([x, y]);
    }
    total += stroke.length;
    if (total > MAX_TOTAL_POINTS) return null;
    out.push(stroke);
  }
  return out;
}

/** Strokes as flat number lists, which is how they are stored inside a PDF (compact JSON). */
export function strokesToFlat(strokes: Stroke[]): number[][] {
  return strokes.map((s) =>
    s.flatMap(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]),
  );
}

/** The reverse of strokesToFlat, validated. Null if the data is not usable. */
export function flatToStrokes(raw: unknown): Stroke[] | null {
  if (!Array.isArray(raw)) return null;
  const strokes: unknown[] = [];
  for (const flat of raw) {
    if (!Array.isArray(flat) || flat.length === 0 || flat.length % 2 !== 0) return null;
    const pts: unknown[] = [];
    for (let i = 0; i < flat.length; i += 2) pts.push([flat[i], flat[i + 1]]);
    strokes.push(pts);
  }
  return sanitizeStrokes(strokes);
}
