import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { carregarAmbienteOpenAI } from '../lib/ambienteOpenAI.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
function arquivo(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'altan-openai-test-')), file = path.join(dir, 'fixture.env');
  fs.writeFileSync(file, 'OPENAI_API_KEY=segredo-ficticio\nIA_LEADS_OPENAI=0\nDATABASE_URL=nao-importar\n');
  try { return fn(file); } finally { fs.unlinkSync(file); fs.rmdirSync(dir); }
}
test('carrega apenas configuração OpenAI explicitamente indicada', () => arquivo(file => {
  const env = {}; const args = carregarAmbienteOpenAI([`--env-file=${file}`, '--dry-run'], env);
  assert.deepEqual(args, ['--dry-run']); assert.equal(env.OPENAI_API_KEY, 'segredo-ficticio'); assert.equal(env.DATABASE_URL, undefined);
}));
test('variável já definida vence arquivo sem sobrescrever segredo', () => arquivo(file => {
  const env = { OPENAI_API_KEY: 'existente' }; carregarAmbienteOpenAI([`--env-file=${file}`], env); assert.equal(env.OPENAI_API_KEY, 'existente');
}));
test('sem arquivo explícito não tenta carregar outros ambientes', () => {
  const env = {}; assert.deepEqual(carregarAmbienteOpenAI(['--dry-run'], env), ['--dry-run']); assert.deepEqual(env, {});
});
test('arquivo ausente e duplicidade são recusados', () => {
  assert.throws(() => carregarAmbienteOpenAI(['--env-file=']), /não encontrado/);
  assert.throws(() => carregarAmbienteOpenAI(['--env-file=a', '--env-file=b']), /apenas um/);
});
test('CLI offline não imprime a chave lida do arquivo', () => arquivo(file => {
  const env = { ...process.env }; delete env.OPENAI_API_KEY;
  const r = spawnSync(process.execPath, ['apps/api/scripts/verificar-openai.mjs', `--env-file=${file}`], { cwd: root, env, encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0); const result = JSON.parse(r.stdout); assert.equal(result.chaveConfigurada, true); assert.equal(result.chamadasExternas, 0); assert(!r.stdout.includes('segredo-ficticio'));
}));
test('CLI rejeita chave passada por argumento sem repeti-la no erro', () => {
  const r = spawnSync(process.execPath, ['apps/api/scripts/verificar-openai.mjs', '--api-key=segredo-ficticio'], { cwd: root, encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 1); assert(!`${r.stdout}${r.stderr}`.includes('segredo-ficticio'));
});
test('CLI recusa teste real sem teto antes de fazer requisição', () => {
  const r = spawnSync(process.execPath, ['apps/api/scripts/verificar-openai.mjs', '--live'], { cwd: root, encoding: 'utf8', windowsHide: true, env: { ...process.env, OPENAI_API_KEY: 'ficticia-nunca-enviada' } });
  assert.equal(r.status, 1); const result = JSON.parse(r.stdout); assert.equal(result.codigo, 'TETO_DO_TESTE_INVALIDO'); assert.equal(result.chamadasExternas, 0);
});
