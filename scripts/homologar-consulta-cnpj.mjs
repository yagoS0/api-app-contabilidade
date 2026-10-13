// Validação local com fixtures. Não publica, não migra banco compartilhado e não habilita SERPRO.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--postgres-bin')) {
  throw Error('Uso: node scripts/homologar-consulta-cnpj.mjs [--postgres-bin CAMINHO]');
}
const evidencia = path.join(raiz, 'test-evidence', `cnpj-${new Date().toISOString().replace(/[:.]/g, '-')}`);
fs.mkdirSync(evidencia, { recursive: true });
const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: raiz, encoding: 'utf8', windowsHide: true });
const relatorio = { iniciadoEm: new Date().toISOString(), commitBase: head.status === 0 ? head.stdout.trim() : null,
  modo: 'local-fixtures', producaoAlterada: false, homologacaoExterna: 'NAO_EXECUTADA',
  postgres: args.length ? 'PENDENTE' : 'NAO_EXECUTADO', etapas: [], arquivos: {} };
// Fingerprints dos arquivos locais testados, incluindo mudanças ainda não commitadas. Nunca lê .env.
function registrar(dir) {
  for (const item of fs.readdirSync(path.join(raiz, dir), { withFileTypes: true })) {
    const arquivo = path.join(dir, item.name);
    if (item.isDirectory()) registrar(arquivo);
    else if (/\.(js|mjs|jsx|csv)$/.test(item.name)) relatorio.arquivos[arquivo.replaceAll('\\', '/')] =
      createHash('sha256').update(fs.readFileSync(path.join(raiz, arquivo))).digest('hex');
  }
}
registrar('apps/api/src/application/tomador');
async function executar(nome, comandoArgs) {
  console.log(`Validando ${nome}...`);
  const log = fs.openSync(path.join(evidencia, `${nome}.log`), 'w');
  let timer;
  const inicio = Date.now();
  try {
    const status = await new Promise(resolve => {
      const child = spawn(process.execPath, comandoArgs, { cwd: raiz, windowsHide: true,
        env: { ...process.env, NODE_ENV: 'test' }, stdio: ['ignore', log, log] });
      child.on('error', () => resolve(-1));
      child.on('close', code => resolve(code ?? -1));
      timer = setTimeout(() => { child.kill(); }, 180000);
    });
    const etapa = { nome, passou: status === 0, status, duracaoMs: Date.now() - inicio };
    const json = path.join(evidencia, `${nome}.json`);
    if (fs.existsSync(json)) {
      const jest = JSON.parse(fs.readFileSync(json, 'utf8'));
      etapa.testes = { aprovados: jest.numPassedTests, falhos: jest.numFailedTests, pendentes: jest.numPendingTests };
      etapa.passou = etapa.passou && jest.success === true && jest.numTotalTests > 0 && jest.numPendingTests === 0;
    }
    relatorio.etapas.push(etapa);
    return etapa.passou;
  } finally { clearTimeout(timer); fs.closeSync(log); }
}
try {
  for (const [nome, app, padrao] of [
    ['api', 'api', 'application/tomador|consultaCnpjHttp|publicOnboarding'],
    ['contador', 'web', 'consultaCnpj|onboarding/lib/__tests__'],
    ['portal', 'portal-cliente-web', 'consultaCnpjCentral|reaproveitarNaTela.ligacao'],
  ]) {
    await executar(nome, ['node_modules/jest/bin/jest.js', '--config', `apps/${app}/jest.config.js`,
      '--runInBand', '--testPathPatterns', padrao, '--json', '--outputFile', path.join(evidencia, `${nome}.json`)]);
  }
  if (args.length) relatorio.postgres = await executar('postgres', ['scripts/run-cnpj-postgres.mjs', args[1]]) ? 'APROVADO' : 'FALHOU';
} catch {
  relatorio.erro = 'Execução interrompida; conferir logs locais.';
  process.exitCode = 1;
} finally {
  relatorio.finalizadoEm = new Date().toISOString();
  relatorio.aprovadoLocalmente = !relatorio.erro && relatorio.etapas.length === (args.length ? 4 : 3)
    && relatorio.etapas.every(e => e.passou);
  fs.writeFileSync(path.join(evidencia, 'resumo.json'), JSON.stringify(relatorio, null, 2) + '\n');
  console.log(`Evidência: ${evidencia}`);
  if (!relatorio.aprovadoLocalmente) process.exitCode = 1;
}
