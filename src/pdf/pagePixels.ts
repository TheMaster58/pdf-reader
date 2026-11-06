/** Pixels of a rendered page region: RGBA, row by row. */
export interface RgbaImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface SampledColours {
  /** CSS hex of the colour behind the text. */
  background: string;
  /** CSS hex of the text itself. */
  text: string;
}

const hex = (r: number, g: number, b: number) =>
  '#' +
  [r, g, b]
    .map((v) =>
      Math.round(Math.min(255, Math.max(0, v)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')
    .toUpperCase();

const luminance = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

/** Colours this close to white or black are snapped to it: rendering noise, not a real tint. */
const SNAP = 14;

/**
 * Reads the colour of some text and of what is behind it from a rendering of the area.
 *
 * The background is the most common colour (the page behind a line of text is mostly background).
 * The text colour is the average of the pixels furthest from it: anti-aliasing blends text into
 * the background at the edges, so the extremes are the true ink. If nothing differs from the
 * background (blank area, or white text on white), black or white is chosen for contrast.
 */
export function sampleColours(image: RgbaImage): SampledColours {
  const { data } = image;
  const total = data.length / 4;
  if (total === 0) return { background: '#FFFFFF', text: '#000000' };

  // Most common colour, in 4096 bins (16 levels per channel), then the average colour of that bin.
  const counts = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i < data.length; i += 4) {
    const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
    const bin = counts.get(key);
    if (bin) {
      bin.n++;
      bin.r += data[i];
      bin.g += data[i + 1];
      bin.b += data[i + 2];
    } else {
      counts.set(key, { n: 1, r: data[i], g: data[i + 1], b: data[i + 2] });
    }
  }
  let top = { n: 0, r: 0, g: 0, b: 0 };
  for (const bin of counts.values()) if (bin.n > top.n) top = bin;
  let bg: [number, number, number] = [top.r / top.n, top.g / top.n, top.b / top.n];
  if (bg.every((v) => v >= 255 - SNAP)) bg = [255, 255, 255];
  else if (bg.every((v) => v <= SNAP)) bg = [0, 0, 0];

  // The pixels furthest from the background are the ink.
  const far: { d: number; r: number; g: number; b: number }[] = [];
  for (let i = 0; i < data.length; i += 4) {
    const d = Math.hypot(data[i] - bg[0], data[i + 1] - bg[1], data[i + 2] - bg[2]);
    if (d > 60) far.push({ d, r: data[i], g: data[i + 1], b: data[i + 2] });
  }
  let text: [number, number, number];
  if (far.length === 0) {
    text = luminance(...bg) > 127 ? [0, 0, 0] : [255, 255, 255];
  } else {
    far.sort((p, q) => q.d - p.d);
    const take = far.slice(0, Math.max(3, Math.ceil(far.length * 0.15)));
    text = [
      take.reduce((s, p) => s + p.r, 0) / take.length,
      take.reduce((s, p) => s + p.g, 0) / take.length,
      take.reduce((s, p) => s + p.b, 0) / take.length,
    ];
    if (text.every((v) => v <= SNAP * 2)) text = [0, 0, 0];
    else if (text.every((v) => v >= 255 - SNAP)) text = [255, 255, 255];
  }
  return { background: hex(...bg), text: hex(...text) };
}

/**
 * Reads a region of a canvas (in canvas pixels, clamped to the canvas) as an image. Null if the
 * region is empty or the canvas cannot be read.
 */
export function readCanvasRegion(
  canvas: HTMLCanvasElement,
  left: number,
  top: number,
  width: number,
  height: number,
): RgbaImage | null {
  const x = Math.max(0, Math.floor(left));
  const y = Math.max(0, Math.floor(top));
  const w = Math.min(canvas.width - x, Math.ceil(width));
  const h = Math.min(canvas.height - y, Math.ceil(height));
  if (w < 1 || h < 1) return null;
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    const { data } = ctx.getImageData(x, y, w, h);
    return { data, width: w, height: h };
  } catch {
    return null;
  }
}
