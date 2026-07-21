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
