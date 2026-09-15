/**
 * Copy the merge worker's runtime dependencies into public/vendor/.
 *
 * The merge worker is a classic Web Worker served as a static file, so it
 * cannot use bundler imports — it loads sql.js and JSZip with importScripts().
 * Those used to come from unpkg.com, which meant a merge failed on an offline
 * machine, behind a blocking extension, or under a strict Content-Security-
 * Policy. Copying them from node_modules at build time keeps the app
 * self-contained and pins the versions to package.json.
 *
 * public/vendor/ is generated, not committed.
 */
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const vendorDir = join(root, 'public', 'vendor');

const files = [
  ['node_modules/jszip/dist/jszip.min.js', 'jszip.min.js'],
  ['node_modules/sql.js/dist/sql-wasm.js', 'sql-wasm.js'],
  ['node_modules/sql.js/dist/sql-wasm.wasm', 'sql-wasm.wasm'],
];

await rm(vendorDir, { recursive: true, force: true });
await mkdir(vendorDir, { recursive: true });

for (const [from, to] of files) {
  await copyFile(join(root, from), join(vendorDir, to));
}

console.log(`Copied ${files.length} vendored worker dependencies into public/vendor/`);
