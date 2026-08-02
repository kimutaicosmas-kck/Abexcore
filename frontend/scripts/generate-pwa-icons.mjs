/**
 * Rasterize AbexCore PWA / install icons from the branded SVG wordmark.
 * Run: node scripts/generate-pwa-icons.mjs  (from frontend/, requires sharp)
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');
const svgPath = join(publicDir, 'abexcore-wordmark.svg');

const require = createRequire(import.meta.url);
let sharp;
try {
  sharp = require('sharp');
} catch {
  try {
    sharp = createRequire(join(__dirname, '../../backend/package.json'))('sharp');
  } catch {
    console.error('Install sharp in backend (or frontend) then re-run.');
    process.exit(1);
  }
}

const svg = readFileSync(svgPath);

async function writePng(name, size) {
  const buf = await sharp(svg).resize(size, size).png().toBuffer();
  writeFileSync(join(publicDir, name), buf);
  console.log(`Wrote ${name} (${size}x${size})`);
}

await writePng('pwa-192.png', 192);
await writePng('pwa-512.png', 512);
await writePng('apple-touch-icon.png', 180);
await writePng('abexcore-logo.png', 512);
console.log('Done — ABEXCORE install icons ready.');
