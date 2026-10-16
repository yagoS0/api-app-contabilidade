import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';

// Runtime prefers the workspace authority; CI must be reproducible in a fresh clone.
export function resolveOperationalReference(governanceRoot, { fallbackOnly = false } = {}) {
  const referencePath = resolve(governanceRoot, 'docs/governance/operational-reference.json');
  if (!existsSync(referencePath)) throw Error('Operational reference missing: ' + referencePath);
  const reference = JSON.parse(readFileSync(referencePath, 'utf8'));
  const valid = value => typeof value === 'string' && value.trim().length > 0;
  if (!valid(reference.repositoryFallback)) throw Error('Operational repository fallback missing');
  const fallback = resolve(governanceRoot, reference.repositoryFallback);
  const within = relative(governanceRoot, fallback);
  if (!within || within.startsWith('..') || isAbsolute(within)) throw Error('Operational fallback must be inside repository');
  const canonical = valid(reference.canonical) ? resolve(governanceRoot, reference.canonical) : null;
  const path = !fallbackOnly && canonical && existsSync(canonical) ? canonical : fallback;
  if (!existsSync(path) || !statSync(path).isFile()) throw Error('Operational document missing: ' + path);
  const bytes = readFileSync(path);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (reference.snapshotSha256 !== undefined && (!/^[a-f0-9]{64}$/i.test(reference.snapshotSha256) || sha256 !== reference.snapshotSha256.toLowerCase())) {
    throw Error('Operational snapshot hash mismatch; reconcile rules before development: ' + path);
  }
  return { path, sha256, content: bytes.toString('utf8'), source: path === canonical && !fallbackOnly ? 'canonical' : 'repositoryFallback' };
}
