/**
 * Clean-up for pictures of a signature (scans, photos, typed text): make the paper transparent,
 * crop to the ink, and keep the picture small. Works on raw RGBA pixel data, so it is plain
 * functions with no browser needed.
 */

/** Pixels at least this light are paper (fully transparent). */
const PAPER = 235;
/** Pixels at most this light are ink (fully opaque). */
const INK = 140;

const luminance = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

/**
 * Turns a light background into transparency, in place. The darker a pixel, the more opaque it
 * becomes, so the soft edges of pen strokes stay soft instead of getting a white halo. The colour of
 * the ink is kept. An alpha that was already there is respected.
 */
export function whiteToTransparent(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    const lum = luminance(data[i], data[i + 1], data[i + 2]);
    const ink = Math.min(1, Math.max(0, (PAPER - lum) / (PAPER - INK)));
    data[i + 3] = Math.round(data[i + 3] * ink);
  }
}

export interface PixelBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The smallest box holding every pixel that is more than faintly visible, or null if none. */
export function inkBounds(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  minAlpha = 16,
): PixelBox | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > minAlpha) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return maxX < 0
    ? null
    : { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/** The size to scale to so the picture fits inside the limits, keeping its shape. Never enlarges. */
export function fitWithin(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number,
): [number, number] {
  if (width <= 0 || height <= 0) return [1, 1];
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  return [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))];
}

/** Largest size of a stored picture signature, in pixels (a signature is never shown big). */
export const MAX_IMAGE_WIDTH = 600;
export const MAX_IMAGE_HEIGHT = 300;
