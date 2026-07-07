// Copies non-TS assets (icons) from src/ to dist/, preserving relative paths.
// tsc does not emit .svg/.png, so n8n would not find the node icon without this.
import { cp, mkdir, readdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const srcDir = join(root, '..', 'src');
const distDir = join(root, '..', 'dist');
const ASSET_EXTENSIONS = ['.svg', '.png'];

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (ASSET_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      yield full;
    }
  }
}

for await (const file of walk(srcDir)) {
  const target = join(distDir, relative(srcDir, file));
  await mkdir(dirname(target), { recursive: true });
  await cp(file, target);
  console.info(`copied ${relative(srcDir, file)}`);
}
