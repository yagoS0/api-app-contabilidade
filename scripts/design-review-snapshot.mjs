import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const args = process.argv.slice(2);
const root = path.resolve(args.find(a => !a.startsWith('--')) || fileURLToPath(new URL('../', import.meta.url)));
const statePath = path.join(root, 'test-evidence/design-review-state.json');
const files = {};
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!['node_modules', '__tests__', 'dist'].includes(entry.name)) await walk(target);
    } else if (/\.(jsx?|tsx?|css|html)$/.test(entry.name)) {
      files[path.relative(root, target).replaceAll('\\', '/')] = createHash('sha256').update(await readFile(target)).digest('hex');
    }
  }
}
for (const source of ['apps/web/src', 'apps/portal-cliente-web/src', 'packages/shared/src']) {
  try { await walk(path.join(root, source)); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
let previous;
try { previous = JSON.parse(await readFile(statePath, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const changed = Object.keys(files).filter(file => previous?.files[file] !== files[file]);
const deleted = Object.keys(previous?.files || {}).filter(file => !(file in files));
console.log(JSON.stringify({ root, previousObservation: previous?.observedAt || null, initialInventory: !previous, changed, deleted }, null, 2));
if (args.includes('--save')) {
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(statePath, JSON.stringify({ observedAt: new Date().toISOString(), files }, null, 2));
}
