// Banco descartável e dados fictícios; nunca carrega .env nem acessa provedores fiscais.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
const url = new URL(process.env.DATABASE_URL || 'invalid:');
assert(url.hostname === '127.0.0.1' && url.port === '55444' && url.pathname === '/altan_parcelamento_test' && url.username === 'altan_test');
process.env.PARCELAMENTO_ORIGENS_ENABLED = 'true';
const semRede = () => { throw Error('Rede externa proibida no ensaio'); };
globalThis.fetch = http.request = http.get = https.request = https.get = semRede;
const { prisma: db } = await import('../src/infrastructure/db/prisma.js');
const { candidatosComposicao, incluirComposicaoTx, enriquecerOrigens } = await import('../src/application/accounting/parcelamento/ComposicaoParcelamentoService.js');
const { ingestParcelamentoFromGuide, gerarPagamentoParcelaManual } = await import('../src/application/accounting/parcelamento/ParcelamentoV2Service.js');
const { buildDTOsFromManual } = await import('../src/application/accounting/parcelamento/entradaManual.js');
const { gerarCronogramaComEntrada } = await import('../../../packages/shared/src/accounting/cronogramaParcelamento.js');
const { projetarPendenciasContabeis, pagamentosDisponiveis } = await import('../../../packages/shared/src/fiscal/pendenciasContabeis.js');
const companies = [];
let checks = 0;
const ok = s => console.log(`PASS ${++checks}: ${s}`);
const tx = fn => db.$transaction(fn, { timeout: 20000, maxWait: 10000 });
async function fixture() {
  const company = await db.portalClient.create({ data: { razao: 'Ensaio origens', cnpj: randomUUID() } });
  companies.push(company.id);
  const entry = await db.accountingEntry.create({ data: { portalClientId: company.id, tipo: 'PROVISAO', subtipo: 'PIS', competencia: '2026-01', data: new Date('2026-01-31T12:00:00Z'), historico: 'PIS janeiro fictício', statusPagamento: 'ABERTO', lines: { create: [{ tipo: 'D', conta: 'despesa', valor: 100 }, { tipo: 'C', conta: 'pis-pagar', valor: 100 }] } } });
  const contract = () => db.parcelamento.create({ data: { portalClientId: company.id, label: 'Acordo fictício', kind: 'DARF', tipo: 'LUCRO_PRESUMIDO', status: 'ATIVO', principalTotal: 100, numeroParcelamento: randomUUID() } });
  const p = await contract();
  const lines = [{ tipo: 'D', tipoLinha: 'PRINCIPAL', conta: 'pis-pagar', codigoTributo: '8109', valor: 100 }, { tipo: 'C', tipoLinha: 'PARC', conta: 'parc-pagar', valor: 100 }];
  const origens = await candidatosComposicao({ portalClientId: company.id, tipo: p.tipo }, db);
  const input = { portalClientId: company.id, parcelamento: p, origens, provisaoLines: lines };
  return { company, entry, p, contract, input };
}
try {
  const f = await fixture();
  const other = await f.contract();
  const race = await Promise.allSettled([f.p, other].map(parcelamento => tx(t => incluirComposicaoTx(t, { ...f.input, parcelamento }))));
  assert.equal(race.filter(r => r.status === 'fulfilled').length, 1);
  const origins = await db.parcelamentoDebitoOrigem.findMany({ where: { portalClientId: f.company.id } });
  assert.equal(origins.length, 1);
  const winner = origins[0].parcelamentoId === f.p.id ? f.p : other;
  await tx(t => incluirComposicaoTx(t, { ...f.input, parcelamento: winner }));
  assert.equal(await db.parcelamentoDebitoOrigem.count({ where: { portalClientId: f.company.id } }), 1);
  ok('concorrência entre acordos e reenvio idempotente: uma origem, um acordo');

  await assert.rejects(db.accountingEntryLine.updateMany({ where: { entryId: f.entry.id }, data: { valor: 99 } }), /DIVIDA_PARCELADA/);
  await assert.rejects(db.accountingEntry.create({ data: { portalClientId: f.company.id, tipo: 'BAIXA', tipoLinha: 'TOTAL', openEntryId: f.entry.id, competencia: '2026-10', data: new Date(), historico: 'baixa concorrente', lines: { create: [{ tipo: 'D', conta: 'pis-pagar', valor: 100 }] } } }), /DIVIDA_PARCELADA/);
  await assert.rejects(db.accountingEntry.delete({ where: { id: f.entry.id } }), /DIVIDA_PARCELADA/);
  assert.equal((await db.accountingEntry.findUnique({ where: { id: f.entry.id } })).statusPagamento, 'ABERTO');
  ok('origem preservada: editar linhas, excluir ou baixar diretamente é recusado pelo banco');

  const original = await db.accountingEntry.findUnique({ where: { id: f.entry.id } });
  const projected = await enriquecerOrigens(db, f.company.id, [{ ...original, saldo: 100 }]);
  assert.equal(pagamentosDisponiveis(projected, '2026-10').length, 0);
  assert.equal(projetarPendenciasContabeis(projected)[0].estado, 'PARCELADO');
  await db.parcelamento.update({ where: { id: winner.id }, data: { status: 'RESCINDIDO' } });
  const rescindido = projetarPendenciasContabeis(await enriquecerOrigens(db, f.company.id, [original]))[0];
  assert.equal(rescindido.estado, 'A_CONCILIAR');
  assert.equal(rescindido.total, null);
  ok('Circular, pagamentos e situação fiscal usam composição; rescisão não inventa saldo');

  const rollback = await fixture();
  await assert.rejects(tx(async t => { await incluirComposicaoTx(t, rollback.input); throw Error('falha posterior à composição'); }), /falha posterior/);
  assert.equal(await db.parcelamentoDebitoOrigem.count({ where: { portalClientId: rollback.company.id } }), 0);
  ok('falha posterior desfaz toda a composição');

  const stale = await fixture();
  await db.accountingEntryLine.updateMany({ where: { entryId: stale.entry.id }, data: { valor: 80 } });
  await assert.rejects(tx(t => incluirComposicaoTx(t, stale.input)), /mudou/);
  assert.equal(await db.parcelamentoDebitoOrigem.count({ where: { portalClientId: stale.company.id } }), 0);
  ok('saldo alterado após seleção recusa sem gravar');

  const completo = await fixture();
  const request = { portalClientId: completo.company.id, parcelamentoDTO: { tipo: 'LUCRO_PRESUMIDO', numeroParcelamento: randomUUID(), valorPrincipal: 100, valorTotal: 100, valorJuros: 0, valorMulta: 0, quantidadeParcelas: 2, dataAdesao: '2026-10-07', origem: 'MANUAL' }, parcelaDTO: { numeroParcela: 1, quantidadeParcelas: 2, anoMesParcela: '202610', valorTotal: 50, tributos: [] }, provisaoLines: completo.input.provisaoLines, origensCircular: completo.input.origens, descricao: 'PIS — 01/2026' };
  const result = await ingestParcelamentoFromGuide(request);
  const opening = await db.accountingEntry.findMany({ where: { parcelamentoId: result.parcelamentoId }, include: { lines: true } });
  assert.equal(opening.length, 2);
  assert(opening.every(e => e.lines.length === 1));
  assert.equal(opening.flatMap(e => e.lines).reduce((s, l) => s + (l.tipo === 'D' ? 1 : -1) * Number(l.valor), 0), 0);
  assert.equal(await db.parcelamentoDebitoOrigem.count({ where: { parcelamentoId: result.parcelamentoId } }), 1);
  assert.equal((await ingestParcelamentoFromGuide(request)).parcelamentoId, result.parcelamentoId);
  assert.equal(await db.accountingEntry.count({ where: { parcelamentoId: result.parcelamentoId } }), 2);
  ok('ingestão real cria acordo, composição e abertura balanceada sem duplicar no reenvio');

  const fechado=await fixture();
  await db.companyMonthlyCircular.create({data:{portalClientId:fechado.company.id,competencia:'2026-10',fechadoContabilEm:new Date()}});
  await assert.rejects(ingestParcelamentoFromGuide({...request,portalClientId:fechado.company.id,origensCircular:fechado.input.origens}),/fechada/);
  assert.equal(await db.parcelamentoDebitoOrigem.count({where:{portalClientId:fechado.company.id}}),0);
  assert.equal(await db.parcelamento.count({where:{portalClientId:fechado.company.id}}),1);
  ok('mês fechado recusa abertura e reverte o contrato novo');

  const legado=await fixture();
  await db.accountingEntry.update({where:{id:legado.entry.id},data:{parcelamentoId:legado.p.id}});
  const antes=await db.accountingEntryLine.findMany({where:{entryId:legado.entry.id},orderBy:{id:'asc'}});
  const selecionadas=await candidatosComposicao({portalClientId:legado.company.id,tipo:legado.p.tipo,parcelamentoId:legado.p.id},db);
  await tx(t=>incluirComposicaoTx(t,{...legado.input,origens:selecionadas,permitirExistente:true}));
  assert.equal((await db.accountingEntry.findUnique({where:{id:legado.entry.id}})).parcelamentoId,null);
  assert.deepEqual(await db.accountingEntryLine.findMany({where:{entryId:legado.entry.id},orderBy:{id:'asc'}}),antes);
  const convertido=await db.parcelamentoDebitoOrigem.findFirst({where:{entryId:legado.entry.id}});
  assert.equal(convertido.snapshot.legado,legado.p.id);
  ok('conversão explícita do legado preserva linhas e registra vínculo anterior');
  for (const tipo of ['PARCSN', 'LUCRO_PRESUMIDO']) {
    const f = await fixture();
    await db.accountingEntry.update({ where: { id: f.entry.id }, data: { subtipo: tipo === 'PARCSN' ? 'DAS' : 'PIS' } });
    await db.accountingEntryLine.updateMany({ where: { entryId: f.entry.id }, data: { valor: 10000 } });
    const origens = await candidatosComposicao({ portalClientId: f.company.id, tipo }, db);
    const cronogramaParcelas = gerarCronogramaComEntrada({ numEntradas: 1, valorEntrada: 3000, competenciaEntrada: '2026-10', diaEntrada: 15, totalParcelas: 11, valorParcela: 700, competenciaRegular: '2026-11', diaRegular: 20 });
    const dtos = buildDTOsFromManual({ header: { tipo, numeroParcelamento: randomUUID(), quantidadeParcelas: 11, numeroParcela: 1, valorPrincipal: 10000, valorTotal: 10000, valorParcela: 700, anoMesParcela: '202610', dataAdesao: '2026-10-07', diaPagamento: 20, cronogramaParcelas } });
    const pedido = { ...dtos, portalClientId: f.company.id, origensCircular: origens, provisaoLines: f.input.provisaoLines.map(l => ({ ...l, valor: 10000, codigoTributo: tipo === 'PARCSN' ? null : l.codigoTributo })), pagamentoLines: [{ tipo: 'D', tipoLinha: 'PARC', conta: 'parc-pagar' }, { tipo: 'C', tipoLinha: 'CAIXA', conta: 'banco' }] };
    const created = await ingestParcelamentoFromGuide(pedido);
    const contrato = await db.parcelamento.findUnique({ where: { id: created.parcelamentoId } });
    assert.equal(Number(contrato.valorParcelaReferencia), 700);
    assert.equal(contrato.numEntradas, 1);
    const rows = await db.parcela.findMany({ where: { parcelamentoId: contrato.id }, orderBy: { numeroParcela: 'asc' } });
    assert.equal(rows.length, 11);
    assert.equal(Number(rows[0].valorPrevisto), 3000);
    assert(rows.slice(1).every(p => Number(p.valorPrevisto) === 700));
    assert.equal(rows[0].vencimento.toISOString().slice(0,10), '2026-10-15');
    assert.equal(rows[1].vencimento.toISOString().slice(0,10), '2026-11-20');
    for (const [i, valor] of [[0, 3000], [1, 700]]) {
      const baixa = await gerarPagamentoParcelaManual({ portalClientId: f.company.id, parcelaId: rows[i].id, valorJuros: 0, valorMulta: 0, totalConferido: valor, dataPagamento: rows[i].vencimento.toISOString() });
      assert(!baixa.skipped, JSON.stringify(baixa));
      const entries = await db.accountingEntry.findMany({ where: { parcelamentoId: contrato.id, tipo: 'BAIXA', numeroParcela: i + 1 }, include: { lines: true } });
      assert.equal(entries.flatMap(e => e.lines).filter(l => l.tipo === 'D').reduce((s,l) => s + Number(l.valor), 0), valor);
    }
    await ingestParcelamentoFromGuide(pedido);
    assert.equal(await db.parcela.count({ where: { parcelamentoId: contrato.id, origemBaixa: { not: null } } }), 2);
    assert.equal(await db.parcela.count({ where: { parcelamentoId: contrato.id } }), 11);
    await assert.rejects(ingestParcelamentoFromGuide({ ...pedido, parcelamentoDTO: { ...pedido.parcelamentoDTO, cronogramaParcelas: cronogramaParcelas.map((p,i) => i ? p : { ...p, valorPrevisto: 3100 }) } }), /cronograma/);
    ok(`${tipo}: origem da Circular, entrada 3000 + 10x700, baixa individual e reenvio preservam valores/pagamentos`);
  }
} finally {
  for (const portalClientId of companies) {
    await db.parcelamentoDebitoOrigem.deleteMany({ where: { portalClientId } });
    await db.portalClient.delete({ where: { id: portalClientId } });
  }
  await db.$disconnect();
}
