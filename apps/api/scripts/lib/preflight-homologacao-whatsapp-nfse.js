import { validarAmbienteNfse } from '../../src/application/nfse/ambienteNfse.js';

function exigir(condicao, code) {
  if (!condicao) throw Object.assign(new Error(code), { code });
}

// Entrada explícita: nunca lê .env, certificados, tokens ou configuração de produção.
export function preflightHomologacao({ databaseUrl, ambiente, baseUrl, transporte, confirmacao } = {}) {
  exigir(confirmacao === 'BANCO_DESCARTAVEL_SEM_REDE_EXTERNA', 'HOMOLOG_CONFIRMACAO_OBRIGATORIA');
  exigir(transporte === 'fake', 'HOMOLOG_TRANSPORTE_REAL_PROIBIDO');
  exigir(ambiente === 'homolog', 'HOMOLOG_AMBIENTE_OBRIGATORIO');
  const fiscal = validarAmbienteNfse({ ambiente, baseUrl });
  let database;
  try { database = new URL(databaseUrl); } catch { exigir(false, 'HOMOLOG_DATABASE_INVALIDO'); }
  exigir(['postgres:', 'postgresql:'].includes(database.protocol), 'HOMOLOG_POSTGRES_OBRIGATORIO');
  // IP literal: nem DNS nem alias/localhost com resolução controlada externamente.
  exigir(database.hostname === '127.0.0.1', 'HOMOLOG_LOOPBACK_OBRIGATORIO');
  exigir(/^\/[a-zA-Z0-9_]+_governance_test$/.test(database.pathname), 'HOMOLOG_BANCO_DESCARTAVEL_OBRIGATORIO');
  exigir(!database.search && !database.hash, 'HOMOLOG_PARAMETROS_DATABASE_PROIBIDOS');
  return Object.freeze({ databaseUrl: database.href, databaseName: database.pathname.slice(1),
    fiscalHost: fiscal.hostname, transporte: 'fake', externaValidada: false });
}

// Allowlist de ambiente do processo filho. Não herdar tokens, proxies, NODE_OPTIONS,
// URLs auxiliares, certificados, flags ou configuração de Prisma de outra execução.
export function ambienteDoHarness(preflight, sistema = {}, dotenvPath) {
  const env = {};
  for (const key of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR']) {
    if (sistema[key]) env[key] = sistema[key];
  }
  return { ...env, DATABASE_URL: preflight.databaseUrl, DIRECT_URL: preflight.databaseUrl,
    DOTENV_CONFIG_PATH: dotenvPath, NODE_ENV: 'test', LOG_LEVEL: 'fatal',
    NFSE_ENV: 'homolog', NFSE_BASE_URL: `https://${preflight.fiscalHost}/SefinNacional`,
    AWS_EC2_METADATA_DISABLED: 'true' };
}
