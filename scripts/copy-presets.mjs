import { mkdir, copyFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const srcDir = path.resolve(__dirname, '../src/presets');
const distDir = path.resolve(__dirname, '../dist/presets');

await mkdir(distDir, { recursive: true });
const files = await readdir(srcDir);
for (const file of files) {
  if (file.endsWith('.simf.tmpl')) {
    await copyFile(path.join(srcDir, file), path.join(distDir, file));
  }
}
