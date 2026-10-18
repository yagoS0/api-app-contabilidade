import { PrismaClient } from '@prisma/client';
import { prisma } from './prisma.js';

// Pool pequeno separado: a conexão que conserva o advisory lock nunca ocupa
// a conexão necessária para persistir o vínculo antes do envio fiscal.
const LIMITE_LOCKS = 2;
let pool;
let encerrando = false;
const ocupacao = new WeakMap();
function obterPool() {
  if (encerrando) throw Object.assign(new Error('Controle de emissão indisponível durante encerramento.'), { code: 'NFSE_CONTROLE_OCUPADO', status: 503 });
  if (!pool) {
    const url = new URL(process.env.DATABASE_URL || 'invalid:');
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('DATABASE_URL PostgreSQL exigida para controle de emissão.');
    url.searchParams.set('connection_limit', String(LIMITE_LOCKS));
    url.searchParams.set('pool_timeout', '5');
    pool = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  }
  return pool;
}
export async function comClientEmissaoLocks({ client, lockClient, executar }) {
  // Injeções não podem cair silenciosamente no banco padrão.
  if (!lockClient && client !== prisma) return executar(client);
  const locks = lockClient || obterPool();
  const ativos = ocupacao.get(locks) || 0;
  if (ativos >= LIMITE_LOCKS) {
    throw Object.assign(new Error('A conferência de emissões está ocupada. Tente novamente após atualizar os resultados.'), { code: 'NFSE_CONTROLE_OCUPADO', status: 503 });
  }
  ocupacao.set(locks, ativos + 1);
  try { return await executar(locks); }
  finally { ocupacao.set(locks, (ocupacao.get(locks) || 1) - 1); }
}
export async function encerrarPoolEmissaoLocks() {
  encerrando = true;
  if (pool) { const anterior = pool; pool = undefined; await anterior.$disconnect(); }
}
process.on('beforeExit', () => encerrarPoolEmissaoLocks().catch(() => {}));
