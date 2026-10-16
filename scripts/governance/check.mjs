import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, relative, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveOperationalReference } from './operational.mjs';

export const levels = ['low', 'medium', 'high', 'critical'];
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const readJson = (path) => JSON.parse(readFileSync(resolve(root, path), 'utf8'));
const text = (v) => typeof v === 'string' && v.trim().length > 0;

export function validateMap(map) {
  if (map?.version !== 1 || !map.domains || !Object.keys(map.domains).length) throw Error('Invalid domain map');
  for (const [id, d] of Object.entries(map.domains)) {
    if (!levels.includes(d.risk) || !Array.isArray(d.prefixes) || !d.prefixes.length ||
        !d.prefixes.every(p => text(p) && !p.startsWith('/') && !p.includes('..') && !p.includes('\\')) ||
        !Array.isArray(d.reviewers) || !d.reviewers.length || !d.reviewers.every(text) ||
        !Array.isArray(d.consumers) || d.consumers.some(c => !map.domains[c])) throw Error(`Invalid domain: ${id}`);
  }
}

export function plan(paths, map) {
  validateMap(map);
  const direct = new Set(), unknown = [], files = [...new Set(paths)].sort();
  let rank = 0;
  for (const raw of files) {
    const path = raw.replaceAll('\\', '/');
    if (path.startsWith('/') || /^[A-Za-z]:/.test(path) || path.split('/').includes('..')) throw Error(`Unsafe path: ${raw}`);
    // Evidence metadata must not elevate every ordinary change to governance/high.
    // It remains in files and is validated separately by the gate.
    if (/^docs\/governance\/changes\/[^/]+\.json$/.test(path)) continue;
    const matches = Object.entries(map.domains).filter(([, d]) => d.prefixes.some(p =>
      p.endsWith('*') ? path.startsWith(p.slice(0,-1)) : p.endsWith('/') ? path.startsWith(p) : path === p));
    if (['AGENTS.md', 'AGENTS.override.md', 'CLAUDE.md'].includes(basename(path))) {
      if (!map.domains.governance) throw Error('Missing governance domain');
      matches.push(['governance', map.domains.governance]);
    }
    if (!matches.length) unknown.push(path);
    for (const [id, d] of matches) { direct.add(id); rank = Math.max(rank, levels.indexOf(d.risk)); }
  }
  const affected = new Set(direct), queue = [...direct];
  for (let i = 0; i < queue.length; i++) {
    for (const id of map.domains[queue[i]].consumers) if (!affected.has(id)) { affected.add(id); queue.push(id); }
  }
  if (unknown.length) rank = Math.max(rank, 2);
  const reviewers = new Set([...affected].flatMap(id => map.domains[id].reviewers));
  if (affected.size > 1 || rank >= 2) reviewers.add('altan_system_reviewer');
  return {files, direct: [...direct].sort(), domains: [...affected].sort(), risk: levels[rank], reviewers: [...reviewers].sort(), unknown};
}

export function validateRecord(record, impact) {
  const errors = [];
  for (const key of ['summary','operationalImpact','rollback']) if (!text(record?.[key])) errors.push(`Missing ${key}`);
  if (!levels.includes(record?.risk) || levels.indexOf(record.risk) < levels.indexOf(impact.risk)) errors.push('Risk below required minimum');
  if (!Array.isArray(record?.domains) || impact.domains.some(d => !record.domains.includes(d))) errors.push('Missing affected domains');
  if (!Array.isArray(record?.tests) || !record.tests.length || !record.tests.every(text)) errors.push('Missing test evidence');
  if (!Array.isArray(record?.humanDecisions) || !record.humanDecisions.every(text)) errors.push('Invalid humanDecisions');
  return errors;
}

function git(args, cwd = root) { return execFileSync('git', args, {cwd, encoding:'utf8', stdio:['ignore','pipe','pipe'], maxBuffer: 16 * 1024 * 1024}); }
function split(output) { return output.split('\0').filter(Boolean); }
export function changedPaths(base, head, cwd = root, comparison = 'merge-base') {
  // No rename detection: both source and destination must be reviewed, including deletions.
  if (head && !base) throw Error('--head requires --base');
  if (!['merge-base','trees'].includes(comparison)) throw Error('Invalid comparison');
  if (base === '0'.repeat(40)) throw Error('Initial branch push requires an explicit reviewed baseline');
  if (base && (!/^[a-f0-9]{7,40}$/i.test(base) || (head && !/^[a-f0-9]{7,40}$/i.test(head)))) throw Error('Use commit SHA for --base/--head');
  if (base) git(['cat-file','-e',`${base}^{commit}`], cwd);
  const args = ['diff','--name-only','--no-renames','-z'];
  if (base && head) return split(git([...args, ...(comparison === 'trees' ? [base,head] : [`${base}...${head}`]), '--'], cwd));
  const tracked = split(git([...args, base || 'HEAD', '--'], cwd));
  const untracked = split(git(['ls-files','--others','--exclude-standard','-z'], cwd));
  return [...new Set([...tracked,...untracked])];
}

export function checkStructure(map) {
  validateMap(map);
  resolveOperationalReference(root, {fallbackOnly:true});
  for (const path of ['AGENTS.md','docs/governance/POLICY.md','docs/governance/README.md',
    'docs/governance/REVIEW-CONTRACT.md','docs/governance/DEPENDENCIES.md',
    'docs/governance/operational-reference.json','.codex/config.toml',
    'apps/api/AGENTS.md','apps/api/prisma/AGENTS.md','apps/api/src/routes/AGENTS.md',
    'apps/api/src/workers/AGENTS.md','apps/web/AGENTS.md','apps/portal-cliente-web/AGENTS.md','packages/shared/AGENTS.md']) {
    if (!existsSync(resolve(root,path))) throw Error(`Required file missing: ${path}`);
  }
  const names = new Set(['altan_orchestrator','altan_implementer',...Object.values(map.domains).flatMap(d => d.reviewers)]);
  for (const name of names) {
    if (!/^altan_[a-z_]+$/.test(name)) throw Error(`Invalid reviewer name: ${name}`);
    const body = readFileSync(resolve(root,`.codex/agents/${name}.toml`),'utf8');
    if (!body.includes(`name = "${name}"`) || !body.includes('developer_instructions = """')) throw Error(`Invalid profile: ${name}`);
  }
}

function main() {
  const [mode, ...args] = process.argv.slice(2);
  if (!['plan','check'].includes(mode)) throw Error('Usage: node scripts/governance/check.mjs plan|check [--base SHA] [--head SHA] [--comparison merge-base|trees]');
  const options = {};
  for (let i=0; i<args.length; i+=2) {
    if (!['--base','--head','--comparison'].includes(args[i]) || !args[i+1] || options[args[i]]) throw Error('Invalid arguments');
    options[args[i]] = args[i+1];
  }
  const map = readJson('docs/governance/domains.json');
  const impact = plan(changedPaths(options['--base'],options['--head'],root,options['--comparison']),map);
  console.log(JSON.stringify(impact,null,2));
  if (mode === 'plan') return;
  checkStructure(map);
  if (impact.unknown.length) throw Error(`Unmapped paths: ${impact.unknown.join(', ')}`);
  if (impact.files.length) {
    const candidates = impact.files.filter(p => /^docs\/governance\/changes\/[^/]+\.json$/.test(p) && existsSync(resolve(root,p)));
    if (!candidates.length) throw Error('Add/update a change record for this diff');
    const results = candidates.map(p => ({path:p, errors:validateRecord(readJson(p),impact)}));
    if (!results.some(r => !r.errors.length)) throw Error(`No complete impact record: ${JSON.stringify(results)}`);
  }
  console.log('Governance structure and impact record valid; human approval and test execution are not certified.');
}

if (process.argv[1] && relative(resolve(process.argv[1]), fileURLToPath(import.meta.url)) === '') {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
