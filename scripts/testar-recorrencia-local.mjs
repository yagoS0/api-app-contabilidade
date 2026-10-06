import dotenv from 'dotenv';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
dotenv.config({ path: 'apps/api/.env', quiet: true });
const url = new URL(process.env.DATABASE_URL);
if (url.hostname !== '127.0.0.1' || url.port !== '5433' || url.pathname !== '/contabilidade_dev' || process.env.NFSE_ENV !== 'homolog') throw Error('Fora do ambiente local de homologação');
const { prisma } = await import('../apps/api/src/infrastructure/db/prisma.js');
const { executarRecorrencia } = await import('../apps/api/src/application/nfse/NfseRecorrenciaService.js');
const id = randomUUID();
let chamadas = 0;
try {
  const item = await prisma.nfseRecorrencia.create({ data: { id, companyId: 'teste-local-recorrencia', autorizadoPor: 'teste-local', ambiente: 'homolog', dia: 31, proximaData: '2026-10-31', modelo: { companyId: 'teste-local-recorrencia', tomador: { doc: '11222333000181', nome: 'Tomador sintético' }, servico: { descricao: 'Teste sem transmissão', valorServicos: 1234.56 } } } });
  const emitir = async ({ data, antesDeEnviar }) => {
    assert.equal(data.servico.valorServicos, 1234.56);
    assert.equal(data.tomador.doc, '11222333000181');
    chamadas++;
    await antesDeEnviar('registro-sintetico');
    return { status: 'issued', nfse: { id: 'registro-sintetico' } };
  };
  const options = { now: new Date('2026-10-31T15:00:00Z'), autorizar: async () => true, emitir };
  await Promise.all(Array.from({ length: 12 }, () => executarRecorrencia(item, options)));
  assert.equal(chamadas, 1);
  assert.equal(await prisma.nfseRecorrenciaExecucao.count({ where: { recorrenciaId: id } }), 1);
  let atual = await prisma.nfseRecorrencia.findUnique({ where: { id } });
  assert.equal(atual.proximaData, '2026-11-30');
  await executarRecorrencia(atual, options);
  assert.equal(chamadas, 1);
  await executarRecorrencia(atual, { ...options, now: new Date('2026-11-30T15:00:00Z') });
  assert.equal(chamadas, 2);
  atual = await prisma.nfseRecorrencia.findUnique({ where: { id } });
  assert.equal(atual.proximaData, '2026-12-31');
  await executarRecorrencia(atual, { ...options, now: new Date('2026-12-31T15:00:00Z'), emitir: async () => { throw Error('timeout sintético'); } });
  assert.equal((await prisma.nfseRecorrencia.findUnique({ where: { id } })).ativa, false);
  console.log('PASS: 12 workers concorrentes geraram uma única tentativa; mês seguinte, calendário, vínculo pré-envio e pausa após timeout verificados. Zero chamadas fiscais.');
} finally {
  await prisma.nfseRecorrenciaExecucao.deleteMany({ where: { recorrenciaId: id } });
  await prisma.nfseRecorrencia.deleteMany({ where: { id, companyId: 'teste-local-recorrencia' } });
  await prisma.$disconnect();
}
