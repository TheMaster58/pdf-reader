import { describe, expect, it } from 'vitest';
import {
  MAX_POINTS_PER_STROKE,
  MAX_STROKES,
  MAX_TOTAL_POINTS,
  aspectOf,
  flatToStrokes,
  normaliseStrokes,
  sanitizeStrokes,
  simplifyStroke,
  strokeSegments,
  strokesBounds,
  strokesToFlat,
  strokesToPdfOps,
  strokesToSvgPath,
  type Stroke,
} from '../src/signature/strokes';

describe('strokeSegments', () => {
  it('is empty for no points', () => {
    expect(strokeSegments([])).toEqual([]);
  });

  it('makes a dot from a single point (a line of almost no length)', () => {
    const s = strokeSegments([[5, 5]]);
    expect(s).toHaveLength(2);
    expect(s[0]).toEqual({ op: 'M', p: [5, 5] });
    expect(s[1].op).toBe('L');
  });

  it('is a straight line for two points', () => {
    expect(
      strokeSegments([
        [0, 0],
        [10, 10],
      ]),
    ).toEqual([
      { op: 'M', p: [0, 0] },
      { op: 'L', p: [10, 10] },
    ]);
  });

  it('curves through the midpoints for three or more points, ending at the last point', () => {
    const s = strokeSegments([
      [0, 0],
      [10, 0],
      [10, 10],
      [20, 10],
    ]);
    expect(s[0]).toEqual({ op: 'M', p: [0, 0] });
    expect(s[1]).toEqual({ op: 'Q', c: [10, 0], p: [10, 5] });
    expect(s[2]).toEqual({ op: 'Q', c: [10, 10], p: [15, 10] });
    expect(s[3]).toEqual({ op: 'L', p: [20, 10] });
  });
});

describe('paths', () => {
  it('writes SVG path data, one subpath per stroke', () => {
    const d = strokesToSvgPath([
      [
        [0, 0],
        [4, 2],
      ],
      [
        [10, 10],
        [20, 10],
        [30, 20],
      ],
    ]);
    expect(d).toBe('M0 0L4 2M10 10Q20 10 25 15L30 20');
  });

  it('writes the same shape as PDF operators, painting each stroke on its own', () => {
    const ops = strokesToPdfOps([
      [
        [0, 0],
        [4, 2],
      ],
      [
        [10, 10],
        [20, 10],
        [30, 20],
      ],
    ]);
    expect(ops.filter((o) => o === 'S')).toHaveLength(2);
    expect(ops[0]).toBe('0 0 m');
    expect(ops[1]).toBe('4 2 l');
    expect(ops[2]).toBe('S');
    expect(ops.some((o) => o.endsWith(' c'))).toBe(true);
    expect(ops.join('\n')).not.toContain('Q');
  });

  it('turns a quadratic into the equivalent cubic (control points a third of the way in)', () => {
    // Q from (0,0) via (30,0) to (30,30): C1 = 2/3 of the way to the control, C2 likewise from the end.
    const ops = strokesToPdfOps([
      [
        [0, 0],
        [30, 0],
        [30, 60],
      ],
    ]);
    // First quadratic is from (0,0) via (30,0) to the midpoint (30,30).
    expect(ops[1]).toBe('20 0 30 10 30 30 c');
  });

  it('writes nothing for an empty stroke', () => {
    expect(strokesToPdfOps([[]])).toEqual([]);
    expect(strokesToSvgPath([[]])).toBe('');
  });
});

describe('bounds, simplify, normalise', () => {
  it('finds the box around the points, or null', () => {
    expect(strokesBounds([])).toBeNull();
    expect(
      strokesBounds([
        [
          [3, 4],
          [10, -2],
        ],
        [[7, 20]],
      ]),
    ).toEqual({ minX: 3, minY: -2, maxX: 10, maxY: 20 });
  });

  it('drops points that are too close together, keeping the ends', () => {
    const s: Stroke = [
      [0, 0],
      [0.1, 0],
      [0.2, 0],
      [5, 0],
      [5.1, 0],
      [10, 0],
    ];
    const out = simplifyStroke(s, 1);
    expect(out[0]).toEqual([0, 0]);
    expect(out[out.length - 1]).toEqual([10, 0]);
    expect(out).toEqual([
      [0, 0],
      [5, 0],
      [10, 0],
    ]);
  });

  it('leaves one and two point strokes alone', () => {
    expect(simplifyStroke([[1, 1]], 5)).toEqual([[1, 1]]);
    expect(
      simplifyStroke(
        [
          [1, 1],
          [1, 1.1],
        ],
        5,
      ),
    ).toEqual([
      [1, 1],
      [1, 1.1],
    ]);
  });

  it('moves the drawing to the corner with room for the pen, and reports its size', () => {
    const n = normaliseStrokes(
      [
        [
          [100, 50],
          [140, 90],
        ],
      ],
      4,
    )!;
    const pad = 4 / 2 + 1;
    expect(n.strokes[0][0]).toEqual([pad, pad]);
    expect(n.strokes[0][1]).toEqual([pad + 40, pad + 40]);
    expect(n.box).toEqual([40 + 2 * pad, 40 + 2 * pad]);
  });

  it('gives a single dot a box big enough to show it', () => {
    const n = normaliseStrokes([[[10, 10]]], 6)!;
    expect(n.box[0]).toBe(2 * (3 + 1));
    expect(n.box[1]).toBe(2 * (3 + 1));
  });

  it('returns null when nothing was drawn', () => {
    expect(normaliseStrokes([], 3)).toBeNull();
    expect(normaliseStrokes([[]], 3)).toBeNull();
  });

  it('computes an aspect ratio, defending against a zero height', () => {
    expect(aspectOf([300, 100])).toBe(3);
    expect(aspectOf([10, 0])).toBe(1);
  });
});

describe('sanitizeStrokes', () => {
  it('accepts well-formed strokes', () => {
    expect(
      sanitizeStrokes([
        [
          [0, 0],
          [1, 1],
        ],
        [[5, 5]],
      ]),
    ).toEqual([
      [
        [0, 0],
        [1, 1],
      ],
      [[5, 5]],
    ]);
  });

  it('rejects anything that is not an array of strokes of number pairs', () => {
    for (const bad of [
      null,
      undefined,
      5,
      'x',
      {},
      [],
      [[]],
      [[[1]]],
      [[[1, 2, 3]]],
      [[['a', 1]]],
      [[[1, null]]],
      [['x']],
      [[{ x: 1, y: 2 }]],
    ]) {
      expect(sanitizeStrokes(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it('rejects non-finite and absurd coordinates', () => {
    expect(sanitizeStrokes([[[NaN, 0]]])).toBeNull();
    expect(sanitizeStrokes([[[Infinity, 0]]])).toBeNull();
    expect(sanitizeStrokes([[[1e9, 0]]])).toBeNull();
  });

  it('enforces the size limits', () => {
    const point = [0, 0];
    expect(sanitizeStrokes(Array.from({ length: MAX_STROKES + 1 }, () => [point]))).toBeNull();
    expect(
      sanitizeStrokes([Array.from({ length: MAX_POINTS_PER_STROKE + 1 }, () => point)]),
    ).toBeNull();
    const perStroke = MAX_POINTS_PER_STROKE;
    const strokes = Array.from({ length: Math.ceil(MAX_TOTAL_POINTS / perStroke) + 1 }, () =>
      Array.from({ length: perStroke }, () => point),
    );
    expect(sanitizeStrokes(strokes)).toBeNull();
  });

  it('copies the data rather than keeping the input', () => {
    const input = [
      [
        [1, 2],
        [3, 4],
      ],
    ];
    const out = sanitizeStrokes(input)!;
    expect(out).toEqual(input);
    expect(out[0]).not.toBe(input[0]);
  });
});

describe('flat encoding (how strokes are stored in a PDF)', () => {
  it('round-trips, rounding to hundredths', () => {
    const strokes: Stroke[] = [
      [
        [1.234, 5.678],
        [9, 10],
      ],
      [[3, 3]],
    ];
    expect(strokesToFlat(strokes)).toEqual([
      [1.23, 5.68, 9, 10],
      [3, 3],
    ]);
    expect(flatToStrokes(strokesToFlat(strokes))).toEqual([
      [
        [1.23, 5.68],
        [9, 10],
      ],
      [[3, 3]],
    ]);
  });

  it('rejects malformed flat data', () => {
    for (const bad of [null, 'x', [], [[]], [[1]], [[1, 2, 3]], [['a', 'b']], [[1, 2], 'x']]) {
      expect(flatToStrokes(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});
