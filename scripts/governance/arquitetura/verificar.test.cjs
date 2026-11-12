const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { scan } = require('./verificar.cjs');

function fixture(t, sources) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'altan-arquitetura-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  function write(name, content) {
    const target = path.join(root, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  write('apps/api/prisma/schema.prisma', 'model Guide {\n}\nmodel AccountingEntry {\n}\n');
  for (const [name, content] of Object.entries(sources)) write('apps/api/src/' + name, content);
  return { root, write };
}

test('fachada pública, consulta do próprio adaptador e leitura de DTO são aceitas', t => {
  const { root } = fixture(t, {
    'modules/accounting/public.js': 'export { avaliar } from "./domain/provisao.js";',
    'modules/accounting/domain/provisao.js': 'export const avaliar = dto => dto.guide;',
    'modules/guides/application/corrigir.js': 'import { avaliar } from "@/modules/accounting/public.js";',
    'modules/guides/infrastructure/prisma/gravar.js': 'export const save = db => db.guide.update({});',
  });
  assert.deepEqual(scan(root), {});
});

test('ciclo entre módulos sem ciclo de arquivos, reexport e imports profundos', t => {
  const { root } = fixture(t, {
    'modules/accounting/public.js': 'export const base = 1;',
    'modules/accounting/domain/a.js': 'export * from "../../guides/domain/g.js";',
    'modules/guides/domain/g.js': 'export const g = 1;',
    'modules/guides/application/b.js': 'const f = () => import("@/modules/accounting/public.js");',
  });
  const records = Object.keys(scan(root)).map(key => JSON.parse(key));
  assert.equal(records.filter(([rule]) => rule === 'ciclo-modulo').length, 2);
  assert.equal(records.filter(([rule]) => rule === 'ciclo-arquivo').length, 0);
  assert.deepEqual(records.filter(([rule]) => rule === 'import-profundo'), [
    ['import-profundo','modules/accounting/domain/a.js','modules/guides/domain/g.js'],
  ]);
});

test('detecta ciclo de arquivos, uso repetido de Prisma e escrita de outro dono', t => {
  const { root } = fixture(t, {
    'routes/a.js': 'require("./b"); db.guide.create({}); db.guide.create({});',
    'routes/b.js': 'export * from "./a.js"; db.$executeRaw`select 1`;',
    'modules/accounting/infrastructure/prisma/provisao.js': 'tx["guide"]?.updateMany({});',
    'modules/guides/domain/guia.js': 'import { PrismaClient as Client } from "@prisma/client";',
  });
  const counts = scan(root);
  assert.equal(counts[JSON.stringify(['prisma-chamada','routes/a.js','guide','create','db.guide.create'])], 2);
  const rules = Object.keys(counts).map(key => JSON.parse(key)[0]);
  assert.equal(rules.filter(rule => rule === 'ciclo-arquivo').length, 2);
  assert.ok(rules.includes('prisma-import'));
  assert.ok(rules.includes('escrita-fora-do-piloto'));
  assert.ok(Object.keys(counts).some(key => key.includes('$executeRaw')));
});

test('diagnose descreve acréscimos, check reprova e erros técnicos falham em ambos', t => {
  const { root, write } = fixture(t, { 'routes/api.js': 'db.guide.count();' });
  const candidate = fixture(t, { 'routes/api.js': 'db.guide.count(); db.guide.count();' });
  const script = path.join(__dirname, 'verificar.cjs');
  const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
  const initial = run('snapshot', root);
  assert.equal(initial.status, 0, initial.stderr);
  write('baseline.json', initial.stdout);
  const baseline = path.join(root, 'baseline.json');
  for (const mode of ['diagnose','check']) {
    const result = run(mode, candidate.root, baseline);
    assert.equal(result.status, mode === 'check' ? 1 : 0, result.stderr);
    assert.match(result.stdout, /base=1 candidata=2/);
    assert.match(result.stdout, /Legado \(base\): 1 \| Candidata: 2 \| Acréscimos: 1/);
  }
  candidate.write('apps/api/src/routes/api.js', 'import !');
  assert.equal(run('diagnose', candidate.root, baseline).status, 2);
  write('baseline.json', '[]');
  assert.equal(run('diagnose', root, baseline).status, 2);
});
