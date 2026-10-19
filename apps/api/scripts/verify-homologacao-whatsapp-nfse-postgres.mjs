// Preparação local, não um cliente de homologação externa. Sem reset/migration/seed.
import { preflightHomologacao, ambienteDoHarness } from './lib/preflight-homologacao-whatsapp-nfse.js';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import dgram from 'node:dgram';
import { syncBuiltinESMExports } from 'node:module';

const suites = Object.freeze({
  fiscal: null,
  emissao: './verify-auditoria-emissao-whatsapp-postgres.mjs',
  danfse: './verify-whatsapp-danfse-postgres.mjs',
  ciclo: './verify-homologacao-whatsapp-nfse-ciclo-postgres.mjs',
});

async function main() {
  const args = process.argv.slice(2);
  const child = args[0] === '--internal';
  if (args.length !== (child ? 2 : 1) ||
      (!child && !['--preflight', '--execute'].includes(args[0])) ||
      (child && !Object.hasOwn(suites, args[1]))) throw Error('HOMOLOG_ARGUMENTOS_INVALIDOS');
  const checked = preflightHomologacao({
    databaseUrl: process.env.HOMOLOGACAO_DATABASE_URL,
    ambiente: process.env.NFSE_ENV, baseUrl: process.env.NFSE_BASE_URL,
    transporte: 'fake', confirmacao: process.env.HOMOLOGACAO_CONFIRMACAO,
  });
  // Nenhuma URL de banco/credencial é impressa, nem em caso de erro.
  if (args[0] === '--preflight') {
    console.log('PREFLIGHT LOCAL OK: configuração validada; banco não conectado; homologação externa não validada.');
    return;
  }
  const dotenvPath = join(tmpdir(), `altan-homolog-no-env-${randomUUID()}`);
  if (existsSync(dotenvPath)) throw Error('HOMOLOG_DOTENV_PATH_EXISTENTE');
  const env = ambienteDoHarness(checked, process.env, dotenvPath);
  if (child) {
    // Antes de importar qualquer módulo do produto. O único acesso de banco é
    // o engine nativo Prisma, com URL loopback validada; não é rede zero absoluta.
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, env);
    const deny = () => { throw Error('HOMOLOG_REDE_JS_PROIBIDA'); };
    globalThis.fetch = deny;
    http.request = http.get = https.request = https.get = deny;
    net.connect = net.createConnection = net.Socket.prototype.connect = tls.connect = deny;
    dgram.createSocket = deny;
    syncBuiltinESMExports();
    if (args[1] === 'fiscal') {
      const { runCLI } = await import('@jest/core');
      const { results } = await runCLI({ runInBand: true, runTestsByPath: true,
        _: [
          'src/application/nfse/__tests__/ambienteNfse.test.js',
          'src/application/nfse/__tests__/ambienteNfseAntesDosEfeitos.test.js',
          'scripts/lib/__tests__/preflight-homologacao-whatsapp-nfse.test.js',
          'src/application/nfse/__tests__/emissaoDps.test.js',
          'src/application/nfse/__tests__/cancelamentoEvento.test.js',
          'src/application/nfse/__tests__/conciliacaoDps.test.js',
        ], $0: 'harness-local', watch: false, watchAll: false,
      }, [process.cwd()]);
      if (!results.success) throw Error('HOMOLOG_TESTES_FISCAIS_FALHARAM');
      return;
    }
    await import(suites[args[1]]);
    return;
  }
  for (const suite of Object.keys(suites)) {
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--internal', suite], {
      cwd: fileURLToPath(new URL('../', import.meta.url)), shell: false, timeout: 180000,
      env: { ...env, HOMOLOGACAO_DATABASE_URL: checked.databaseUrl,
        HOMOLOGACAO_CONFIRMACAO: 'BANCO_DESCARTAVEL_SEM_REDE_EXTERNA' }, stdio: 'inherit',
    });
    if (result.error || result.status !== 0) throw Error(`HOMOLOG_SUITE_FALHOU_${suite}`);
  }
  console.log('ENSAIOS LOCAIS CONCLUÍDOS: ciclo R$1, DANFSe e cancelamento encadeados em PostgreSQL descartável, com fronteiras fiscal/Meta simuladas. Não comprova emissão/cancelamento fiscal externo, certificado ou entrega real no WhatsApp.');
}

main().catch(error => {
  // Erros de drivers podem carregar connection strings: não publicar stack/mensagem.
  const candidate = error?.code || error?.message;
  const code = /^(?:HOMOLOG|NFSE)_[A-Z_]+$/.test(candidate) ? candidate : 'HOMOLOG_FALHA_LOCAL';
  console.error(`${code}: homologação local bloqueada; conferir requisitos e resultado das suítes. Sem autorização externa.`);
  process.exitCode = 1;
});
