// Dev launcher: builds the node, links it into n8n's custom-nodes directory
// (~/.n8n/custom/node_modules/<pkg>), then starts n8n so the node is loaded.
//
// n8n discovers community nodes linked under ~/.n8n/custom at startup. We create
// a direct junction/symlink there (equivalent to `npm link <pkg>` but without
// touching the global npm prefix), so `npm run dev` is a one-shot "boot n8n with
// this node" command. n8n loads nodes at startup, so re-run this after a rebuild
// to pick up code changes.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, '..');
const pkgName = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')).name;

const customDir = join(homedir(), '.n8n', 'custom');
const customModules = join(customDir, 'node_modules');
const linkPath = join(customModules, pkgName);

function run(label, cmd, args) {
  console.info(`\n▸ ${label}`);
  const result = spawnSync(cmd, args, { cwd: projectRoot, stdio: 'inherit', shell: true });
  if (result.status !== 0) {
    console.error(`\n✖ ${label} failed (exit ${result.status ?? 'null'}).`);
    process.exit(result.status ?? 1);
  }
}

/** Point ~/.n8n/custom/node_modules/<pkg> at this project (idempotent). */
function linkIntoCustomDir() {
  mkdirSync(customModules, { recursive: true });

  // n8n's custom dir expects to look like an npm package folder.
  const customPkgJson = join(customDir, 'package.json');
  if (!existsSync(customPkgJson)) {
    writeFileSync(customPkgJson, `${JSON.stringify({ name: 'n8n-custom', private: true }, null, 2)}\n`);
  }

  if (existsSync(linkPath)) {
    const already = lstatSync(linkPath).isSymbolicLink() && realpathSync(linkPath) === realpathSync(projectRoot);
    if (already) {
      console.info(`▸ Link already in place: ${linkPath}`);
      return;
    }
    rmSync(linkPath, { recursive: true, force: true });
  }

  // Scoped package names (@scope/name) nest under a scope directory that must
  // exist before the link is created.
  mkdirSync(dirname(linkPath), { recursive: true });

  // 'junction' works on Windows without admin rights; it is ignored elsewhere.
  symlinkSync(projectRoot, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
  console.info(`▸ Linked ${pkgName} → ${linkPath}`);
}

/**
 * Locate the globally-installed n8n entry point.
 *
 * We deliberately do NOT rely on a bare `n8n` PATH lookup: `npm run` prepends
 * every parent `node_modules/.bin` to PATH, and an orphaned n8n shim in a parent
 * folder can shadow the real global install. Resolving the global package's bin
 * explicitly (and running it with the current Node) sidesteps that entirely.
 */
function resolveN8nEntry() {
  try {
    const globalRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8', shell: true }).trim();
    const entry = join(globalRoot, 'n8n', 'bin', 'n8n');
    if (existsSync(entry)) {
      return entry;
    }
  } catch {
    // fall through to PATH-based launch
  }
  return null;
}

run('Building node (tsc + assets)', 'npm', ['run', 'build']);
linkIntoCustomDir();

console.info('\n▸ Starting n8n — open http://localhost:5678 (Ctrl+C to stop)\n');
const entry = resolveN8nEntry();
const child = entry
  ? spawn(process.execPath, [entry, 'start'], { stdio: 'inherit' })
  : spawn('n8n', ['start'], { stdio: 'inherit', shell: true });
child.on('error', (err) => {
  console.error(`\n✖ Could not start n8n: ${err.message}`);
  console.error('  Install it first:  npm install -g n8n');
  process.exit(1);
});
child.on('exit', (code) => process.exit(code ?? 0));
