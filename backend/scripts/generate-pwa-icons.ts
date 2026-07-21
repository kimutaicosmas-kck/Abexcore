import sharp from 'sharp';
import path from 'path';

const outDir = path.resolve(__dirname, '../../frontend/public');

async function main() {
  for (const size of [192, 512]) {
    await sharp({
      create: {
        width: size,
        height: size,
        channels: 4,
        background: { r: 79, g: 70, b: 229, alpha: 1 },
      },
    })
      .png()
      .toFile(path.join(outDir, `pwa-${size}.png`));
    console.log(`Created pwa-${size}.png`);
  }
}

main().catch(console.error);
