// Copies the static PDF.js resources (CJK cmaps, standard fonts, wasm decoders, ICC profiles)
// into public/pdfjs so they are served next to the app. Runs before dev and build.
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', 'pdfjs-dist');
const dest = join(root, 'public', 'pdfjs');

if (!existsSync(src)) {
  console.error('pdfjs-dist not installed; run npm install first');
  process.exit(1);
}
rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  if (existsSync(join(src, dir))) cpSync(join(src, dir), join(dest, dir), { recursive: true });
}
console.log('Copied PDF.js assets to public/pdfjs');
