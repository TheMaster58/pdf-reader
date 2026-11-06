/** Largest PNG we will store or write into a PDF (bytes). A signature picture is small. */
export const MAX_PNG_BYTES = 2_000_000;

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PREFIX = 'data:image/png;base64,';

/** Does the data start with the PNG signature? */
export function looksLikePng(bytes: Uint8Array): boolean {
  return bytes.length > PNG_MAGIC.length && PNG_MAGIC.every((b, i) => bytes[i] === b);
}

/**
 * The bytes of a `data:image/png;base64,...` URL, or null if it is anything else (another image
 * type, not base64, not really a PNG, or too big). Data of unknown origin goes through here.
 */
export function dataUrlToPng(dataUrl: unknown): Uint8Array | null {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith(PREFIX)) return null;
  const base64 = dataUrl.slice(PREFIX.length);
  // Base64 is a third bigger than the bytes it stands for.
  if (base64.length > (MAX_PNG_BYTES * 4) / 3 + 8 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64))
    return null;
  let binary: string;
  try {
    binary = atob(base64);
  } catch {
    return null;
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.length <= MAX_PNG_BYTES && looksLikePng(bytes) ? bytes : null;
}

/** A `data:` URL for PNG bytes. */
export function pngToDataUrl(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return PREFIX + btoa(binary);
}

/** The width and height stored in a PNG's header, or null if it is too short or not a PNG. */
export function pngSize(bytes: Uint8Array): [number, number] | null {
  if (!looksLikePng(bytes) || bytes.length < 24) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const w = view.getUint32(16);
  const h = view.getUint32(20);
  return w > 0 && h > 0 && w <= 20_000 && h <= 20_000 ? [w, h] : null;
}
