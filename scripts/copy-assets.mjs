// Copies non-TS assets (icons) into dist/, preserving each file's path relative
// to the project root (e.g. nodes/Servicely/servicely.svg -> dist/nodes/Servicely/…).
// tsc does not emit .svg/.png, so n8n would not find the node icon without this.
import { cp, mkdir, readdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = join(projectRoot, 'dist');
// Directories whose non-TS assets (icons) must be mirrored into dist/.
const SOURCE_DIRS = ['nodes', 'credentials', 'icons'];
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

for (const srcDir of SOURCE_DIRS) {
  for await (const file of walk(join(projectRoot, srcDir))) {
    const rel = relative(projectRoot, file);
    const target = join(distDir, rel);
    await mkdir(dirname(target), { recursive: true });
    await cp(file, target);
    console.info(`copied ${rel}`);
  }
}
