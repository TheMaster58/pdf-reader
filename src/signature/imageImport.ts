import type { SignatureArtwork } from '../annotations/model';
import {
  MAX_IMAGE_HEIGHT,
  MAX_IMAGE_WIDTH,
  fitWithin,
  inkBounds,
  whiteToTransparent,
} from './imageTools';
import { MAX_PNG_BYTES, dataUrlToPng } from './pngData';

/** Something the user can be told about: the picture could not be used. */
export class PictureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PictureError';
  }
}

/** Pictures are reduced to this long side before looking for the ink: signatures are never big. */
const WORKING_SIDE = 1600;
/** Room left round the ink, in pixels of the final picture. */
const PADDING = 2;

function newCanvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new PictureError('This computer could not prepare the picture.');
  return [canvas, ctx];
}

/**
 * Crops a canvas to its ink (transparent pixels count as paper), scales it down to a sensible size
 * and returns it as picture artwork. Throws PictureError if there is no ink at all.
 */
function canvasToArtwork(canvas: HTMLCanvasElement): SignatureArtwork {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const box = inkBounds(data, canvas.width, canvas.height);
  if (!box) throw new PictureError('No signature was found in the picture: it looks blank.');

  const left = Math.max(0, box.left - PADDING);
  const top = Math.max(0, box.top - PADDING);
  const width = Math.min(canvas.width - left, box.width + 2 * PADDING);
  const height = Math.min(canvas.height - top, box.height + 2 * PADDING);
  const [outW, outH] = fitWithin(width, height, MAX_IMAGE_WIDTH, MAX_IMAGE_HEIGHT);

  const [out, outCtx] = newCanvas(outW, outH);
  outCtx.imageSmoothingEnabled = true;
  outCtx.imageSmoothingQuality = 'high';
  outCtx.drawImage(canvas, left, top, width, height, 0, 0, outW, outH);

  const pngDataUrl = out.toDataURL('image/png');
  const bytes = dataUrlToPng(pngDataUrl);
  if (!bytes || bytes.length > MAX_PNG_BYTES) {
    throw new PictureError(
      'The picture is too detailed to keep as a signature. Try a simpler one.',
    );
  }
  return { type: 'image', pngDataUrl, size: [outW, outH] };
}

/**
 * Turns a picture file (a scan or photo of a signature) into artwork: the paper becomes
 * transparent, the signature is cropped out, and it is made small.
 */
export async function fileToArtwork(file: Blob): Promise<SignatureArtwork> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new PictureError(
      'That file could not be read as a picture. Use a PNG, JPG or WebP image.',
    );
  }
  try {
    const scale = Math.min(1, WORKING_SIDE / Math.max(bitmap.width, bitmap.height));
    const [canvas, ctx] = newCanvas(bitmap.width * scale, bitmap.height * scale);
    // Composite on white first so a picture with transparency is treated like a sheet of paper.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    whiteToTransparent(pixels.data);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.putImageData(pixels, 0, 0);
    return canvasToArtwork(canvas);
  } finally {
    bitmap.close();
  }
}

/** Typed-name styles: script-like fonts that ship with Windows and macOS, then any cursive font. */
export const TYPED_FONTS: readonly { name: string; css: string }[] = [
  { name: 'Script', css: '"Segoe Script", "Snell Roundhand", "Brush Script MT", cursive' },
  { name: 'Handwriting', css: '"Lucida Handwriting", "Bradley Hand", "Comic Sans MS", cursive' },
  { name: 'Brush', css: '"Brush Script MT", "Apple Chancery", "Segoe Script", cursive' },
];

/** Renders a typed name in a script font as picture artwork (transparent background). */
export function textToArtwork(text: string, fontCss: string, color: string): SignatureArtwork {
  const value = text.trim();
  if (!value) throw new PictureError('Type a name first.');
  const size = 140;
  const [probe, probeCtx] = newCanvas(10, 10);
  probeCtx.font = `${size}px ${fontCss}`;
  const width = Math.ceil(probeCtx.measureText(value).width) + size;
  void probe;
  const [canvas, ctx] = newCanvas(width, size * 2);
  ctx.font = `${size}px ${fontCss}`;
  ctx.fillStyle = color;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(value, size / 2, size * 1.3);
  return canvasToArtwork(canvas);
}
