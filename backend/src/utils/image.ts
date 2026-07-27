import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';

export async function compressProductImage(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.gif') return path.basename(filePath);

  const webpPath = filePath.replace(/\.[^.]+$/, '.webp');
  await sharp(filePath)
    .rotate()
    .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toFile(webpPath);

  if (webpPath !== filePath) {
    await fs.unlink(filePath).catch(() => undefined);
  }

  return path.basename(webpPath);
}

const COMPANY_LOGO_SIZE = 256;

/** Normalize company logos to a square PNG regardless of source format/size. */
export async function processCompanyLogo(filePath: string): Promise<string> {
  const dir = path.dirname(filePath);
  const outName = `${Date.now()}-logo.png`;
  const outPath = path.join(dir, outName);

  await sharp(filePath, { density: 300 })
    .rotate()
    .resize(COMPANY_LOGO_SIZE, COMPANY_LOGO_SIZE, {
      fit: 'contain',
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .png({ compressionLevel: 9 })
    .toFile(outPath);

  await fs.unlink(filePath).catch(() => undefined);
  return outName;
}
