// Ensaio sobre schema REAL já migrado. Não carrega .env e não chama provedores.
// node scripts/verify-calendar-series-postgres.js --url "$DATABASE_URL"
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const arg = process.argv.indexOf('--url');
const url = new URL((arg >= 0 ? process.argv[arg + 1] : process.env.DATABASE_URL) || 'invalid:');
if (!['postgresql:', 'postgres:'].includes(url.protocol)
  || !['127.0.0.1', 'localhost'].includes(url.hostname)
  || !/^\/[a-zA-Z0-9_]+_check$/.test(url.pathname)) {
  throw new Error('Use somente PostgreSQL descartável local com nome terminado em _check, via --url ou DATABASE_URL.');
}
// Definir antes dos imports impede o singleton de usar outra configuração.
url.searchParams.set('connection_limit', '12');
process.env.DATABASE_URL = url.href;
globalThis.fetch = async () => { throw new Error('Provedores externos proibidos neste ensaio.'); };
const { prisma } = await import('../src/infrastructure/db/prisma.js');
const { sincronizarOcorrencias, excluirOcorrencia, atualizarOcorrencia, concluir, ocorrenciasDoPeriodo } = await import('../src/application/obrigacoes/ObrigacoesService.js');
const prefix = `calendar-check-${randomUUID()}`;
const companyId = `${prefix}-empresa`;
const janela = { modo: 'DIAS_DO_CICLO', diaInicio: 10, diaFim: 15, deslocamentoFim: 0 };
const iso = data => data.toISOString().slice(0, 10);
const listar = id => prisma.ocorrenciaObrigacao.findMany({ where: { obrigacaoId: id }, orderBy: { cicloChave: 'asc' } });
const sync = id => sincronizarOcorrencias(id, prisma, { incluirVencidoDoMes: true });
let checks = 0;
const ok = nome => { checks++; console.log(`PASS ${checks}: ${nome}`); };
const criar = nome => prisma.obrigacao.create({ data: {
  id: `${prefix}-${nome}`, portalClientId: companyId, nome: `EFD ensaio ${nome}`,
  periodicidade: 'MENSAL', diaVencimento: 20, ajusteDiaUtil: 'MANTER',
  defasagemMeses: 1, janelaTrabalho: janela,
} });

try {
  await prisma.portalClient.create({ data: { id: companyId, razao: 'Empresa descartável calendário', cnpj: prefix } });
  const serie = await criar('somente-esta');
  await Promise.all(Array.from({ length: 6 }, () => sync(serie.id)));
  const iniciais = await listar(serie.id);
  assert.equal(iniciais.length, 12);
  assert.equal(new Set(iniciais.map(o => o.cicloChave)).size, 12);
  for (const oc of iniciais) {
    assert.equal(iso(oc.dataInicio), `${oc.cicloChave}-10`);
    assert.equal(iso(oc.dataFim), `${oc.cicloChave}-15`);
    assert.equal(iso(oc.dataVencimento), `${oc.cicloChave}-20`);
    assert.equal((oc.dataFim - oc.dataInicio) / 86400000 + 1, 6);
  }
  ok('seis workers concorrentes geram 12 ciclos únicos; janela inclusiva 10–15 preserva prazo dia 20');

  await assert.rejects(excluirOcorrencia({ portalIds: ['empresa-fora-da-carteira'], ocorrenciaId: iniciais[0].id }), e => e.status === 404);
  assert.equal((await listar(serie.id)).filter(o => o.canceladaEm).length, 0);
  ok('exclusão fora da carteira não altera a série');

  await Promise.all([
    excluirOcorrencia({ portalIds: [companyId], ocorrenciaId: iniciais[1].id, alcance: 'ESTA', userId: prefix }),
    ...Array.from({ length: 6 }, () => sync(serie.id)),
  ]);
  await sync(serie.id);
  const depois = await listar(serie.id);
  assert.equal(depois.length, 12);
  assert.deepEqual(depois.map(o => o.id), iniciais.map(o => o.id));
  assert.deepEqual(depois.filter(o => o.canceladaEm).map(o => o.id), [iniciais[1].id]);
  assert.equal(depois[1].canceladaPorId, prefix);
  assert.equal((await prisma.obrigacao.findUnique({ where: { id: serie.id } })).encerradaAPartirDe, null);
  ok('somente esta concorre com workers e deixa tombstone durável sem cancelar meses seguintes');

  // Versão aplicada pelo serviço real: competência, prazo fiscal e histórico concluído intactos.
  await concluir({ portalIds: [companyId], ocorrenciaId: iniciais[3].id, userId: prefix });
  const concluida = await prisma.ocorrenciaObrigacao.findUnique({ where: { id: iniciais[3].id } });
  await atualizarOcorrencia({ portalIds: [companyId], ocorrenciaId: iniciais[2].id, userId: prefix,
    dados: { alcance: 'ESTA_E_PROXIMAS', janelaTrabalho: { ...janela, diaInicio: 11, diaFim: 16 } } });
  await sync(serie.id);
  const versionadas = await listar(serie.id);
  assert.equal(iso(versionadas[0].dataInicio), `${versionadas[0].cicloChave}-10`);
  assert.equal(iso(versionadas[2].dataInicio), `${versionadas[2].cicloChave}-11`);
  assert.equal(iso(versionadas[2].dataFim), `${versionadas[2].cicloChave}-16`);
  assert.equal(iso(versionadas[2].dataVencimento), `${versionadas[2].cicloChave}-20`);
  assert.equal(versionadas[2].competenciaRef, iniciais[2].competenciaRef);
  assert.deepEqual(versionadas[3], concluida);
  assert.ok(versionadas[1].canceladaEm);
  const versao = await prisma.obrigacao.findUnique({ where: { id: serie.id } });
  assert.ok(versao.agendaVersoes.some(v => v.aPartirDe === iniciais[2].cicloChave));
  ok('edição futura persiste versão sem alterar prazo, competência, concluída ou tombstone');

  const futura = await criar('esta-e-proximas');
  await sync(futura.id);
  const antes = await listar(futura.id);
  await concluir({ portalIds: [companyId], ocorrenciaId: antes[4].id, userId: prefix });
  const historico = await prisma.ocorrenciaObrigacao.findUnique({ where: { id: antes[4].id } });
  await Promise.all([
    excluirOcorrencia({ portalIds: [companyId], ocorrenciaId: antes[2].id, alcance: 'ESTA_E_PROXIMAS', userId: prefix }),
    ...Array.from({ length: 6 }, () => sync(futura.id)),
  ]);
  await Promise.all([sync(futura.id), sync(futura.id)]);
  const encerrada = await prisma.obrigacao.findUnique({ where: { id: futura.id } });
  const final = await listar(futura.id);
  assert.equal(encerrada.encerradaAPartirDe, antes[2].cicloChave);
  assert.equal(final.length, 12);
  assert.deepEqual(final.map(o => o.id), antes.map(o => o.id));
  assert.equal(final.filter(o => o.canceladaEm).length, 9);
  assert.deepEqual(final[4], historico);
  assert.ok(final.slice(0, 2).every(o => !o.canceladaEm));
  assert.ok(final.filter(o => o.cicloChave >= encerrada.encerradaAPartirDe && o.status === 'PENDENTE').every(o => o.canceladaEm));
  const repetida = await excluirOcorrencia({ portalIds: [companyId], ocorrenciaId: antes[2].id, alcance: 'ESTA_E_PROXIMAS' });
  assert.equal(repetida.canceladas, 0);
  assert.equal(repetida.concluidasPreservadas, 1);
  ok('esta e próximas concorrente deixa corte durável, não recria ciclos e conserva concluída futura integralmente');

  const frequencia = await criar('frequencia');
  await sync(frequencia.id);
  const base = await listar(frequencia.id);
  await concluir({ portalIds: [companyId], ocorrenciaId: base[2].id });
  await atualizarOcorrencia({ portalIds: [companyId], ocorrenciaId: base[3].id, dados: { dataInicio: iso(base[3].dataInicio), dataFim: iso(base[3].dataFim) } });
  await excluirOcorrencia({ portalIds: [companyId], ocorrenciaId: base[5].id });
  const preservadas = await listar(frequencia.id);
  const regra = { periodicidade: 'TRIMESTRAL', mesReferencia: Number(base[1].cicloChave.slice(5)), diaVencimento: 25, ajusteDiaUtil: 'MANTER', defasagemMeses: 1, diasPreparacao: 0 };
  await Promise.all([
    atualizarOcorrencia({ portalIds: [companyId], ocorrenciaId: base[1].id, dados: { alcance: 'ESTA_E_PROXIMAS', janelaTrabalho: janela, regra } }),
    ...Array.from({ length: 4 }, () => sync(frequencia.id)),
  ]);
  const trimestrais = await listar(frequencia.id);
  assert.equal(trimestrais.find(o => o.id === base[6].id).foraDaRecorrencia, true);
  assert.equal(iso(trimestrais.find(o => o.id === base[1].id).dataVencimento).slice(-2), '25');
  for (const i of [0, 2, 3, 5]) assert.deepEqual(trimestrais.find(o => o.id === base[i].id), preservadas[i]);
  await atualizarOcorrencia({ portalIds: [companyId], ocorrenciaId: base[1].id, dados: { alcance: 'ESTA_E_PROXIMAS', janelaTrabalho: null, regra: { ...regra, periodicidade: 'MENSAL', diasPreparacao: 4 } } });
  await sync(frequencia.id);
  const mensais = await listar(frequencia.id);
  assert.equal(mensais.find(o => o.id === base[6].id).foraDaRecorrencia, false);
  assert.equal(iso(mensais.find(o => o.id === base[6].id).dataInicio).slice(-2), '21');
  for (const i of [0, 2, 3, 5]) assert.deepEqual(mensais.find(o => o.id === base[i].id), preservadas[i]);
  assert.equal(new Set(mensais.map(o => o.cicloChave)).size, mensais.length);
  ok('frequência e prazo versionados concorrem com worker; retorno mensal reativa IDs sem ressuscitar exclusões');

  const conflito = await criar('conflito-versionamento');
  await prisma.obrigacao.update({ where: { id: conflito.id }, data: { tipo: 'TAREFA' } });
  await sync(conflito.id);
  const conflitantes = await listar(conflito.id);
  await atualizarOcorrencia({ portalIds: [companyId], ocorrenciaId: conflitantes[1].id,
    dados: { dataInicio: conflitantes[0].cicloChave + '-10', dataFim: conflitantes[0].cicloChave + '-25' } });
  const antesDoConflito = await listar(conflito.id);
  await assert.rejects(atualizarOcorrencia({ portalIds: [companyId], ocorrenciaId: conflitantes[0].id,
    dados: { alcance: 'ESTA_E_PROXIMAS', janelaTrabalho: janela, regra: { ...regra, periodicidade: 'MENSAL' } } }), e => e.status === 409);
  assert.deepEqual(await listar(conflito.id), antesDoConflito);
  assert.deepEqual((await prisma.obrigacao.findUnique({ where: { id: conflito.id } })).agendaVersoes, []);
  ok('conflito com exceção preservada desfaz também a versão em transação');

  // Reutiliza série com concluída, personalizada, cancelada e meses retirados por frequência.
  await atualizarOcorrencia({ portalIds: [companyId], ocorrenciaId: base[1].id,
    dados: { alcance: 'ESTA_E_PROXIMAS', janelaTrabalho: janela, regra } });
  const antesDaPausa = await listar(frequencia.id);
  assert.ok(antesDaPausa.some(o => o.foraDaRecorrencia));
  await prisma.obrigacao.update({ where: { id: frequencia.id }, data: { ativa: false } });
  await sync(frequencia.id);
  assert.deepEqual(await listar(frequencia.id), antesDaPausa);
  const periodo = { portalIds: [companyId], inicio: new Date(base[0].cicloChave + '-01T00:00:00Z'), fim: new Date(base[11].cicloChave + '-28T00:00:00Z') };
  const inativasNoCalendario = await ocorrenciasDoPeriodo(periodo);
  assert.ok(!inativasNoCalendario.some(o => o.obrigacaoId === frequencia.id));
  await prisma.obrigacao.update({ where: { id: frequencia.id }, data: { ativa: true } });
  await sync(frequencia.id);
  assert.deepEqual(await listar(frequencia.id), antesDaPausa);
  ok('inativar/reativar conserva integralmente IDs e exceções, sem vazar série inativa no calendário');

  console.log(`PASS: ${checks} cenários sobre PostgreSQL real com migrations aplicadas.`);
} finally {
  // Limpeza estritamente limitada ao UUID criado por esta execução; cascade remove só suas fixtures.
  try {
    await prisma.portalClient.deleteMany({ where: { id: companyId } });
  } finally {
    await prisma.$disconnect();
  }
}
