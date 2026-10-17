import { snapshotMesTx, registrarAlteracaoTx } from './CorrecaoMesContabilService.js';
import { gerarPagamentoInssFromGuideTx } from './InssPagamentoService.js';
import { gerarPagamentoParcelaFromGuideTx } from './parcelamento/ParcelamentoV2Service.js';
import { lookupAccountsFromHistorico, resolveRule } from './AccountingEntryGeneratorService.js';
import { CODIGO_RECEITA_TO_EVENT } from './GuideToProvisionService.js';
import { CONTA_JUROS, CONTA_MULTA } from './contasAcrescimo.js';
import { computeSaldoProvisao } from './saldoProvisao.js';

const recusar = motivo => { throw Object.assign(new Error(motivo), { pendencia: motivo }); };
const centavos = value => value == null || value === '' || !Number.isFinite(Number(value)) || Number(value) < 0
  ? null : Math.round(Number(value) * 100);
const somar = rows => Object.fromEntries(['principal', 'juros', 'multa', 'total'].map(key =>
  [key, rows.reduce((sum, row) => sum + row[key], 0)]));

export function composicaoConfirmada(guide) {
  const e = guide.extracted || {};
  const rows = Array.isArray(e.composicao) && e.composicao.length ? e.composicao
    : Array.isArray(e.fields?.composicao) && e.fields.composicao.length ? e.fields.composicao
      : [e.fields || e];
  const partes = rows.map(row => ({ codigo: String(row.codigoTributo || row.codigo || '').replace(/\D/g, '').slice(0, 4),
    principal: centavos(row.principal ?? row.valorPrincipal), juros: centavos(row.juros ?? row.valorJuros),
    multa: centavos(row.multa ?? row.valorMulta), total: centavos(row.total ?? row.valorTotal) }));
  if (partes.some(p => [p.principal, p.juros, p.multa, p.total].some(v => v == null)
    || p.total <= 0 || Math.abs(p.principal + p.juros + p.multa - p.total) > 1)) recusar('COMPOSICAO_A_CONFERIR');
  const total = somar(partes);
  if (centavos(guide.valor) == null || Math.abs(total.total - centavos(guide.valor)) > 1) recusar('COMPOSICAO_A_CONFERIR');
  return { partes, ...total };
}

async function validarContas(tx, companyId, lines) {
  const codigos = [...new Set(lines.map(l => String(l.conta || '').trim()))];
  if (codigos.some(c => !c)) recusar('CONTAS_AUSENTES');
  const contas = await tx.chartOfAccount.findMany({ where: { codigo: { in: codigos },
    OR: [{ portalClientId: companyId }, { portalClientId: null }] } });
  const mapa = new Map();
  for (const c of contas.filter(c => !c.portalClientId)) mapa.set(c.codigo, c);
  for (const c of contas.filter(c => c.portalClientId === companyId)) mapa.set(c.codigo, c);
  if (codigos.some(c => !mapa.has(c) || mapa.get(c).analitica === false)) recusar('CONTAS_AUSENTES');
}

// Confronta o que foi realmente lançado, inclusive fontes documentais precedentes do adaptador.
function conferirLancamentos(entries, composicao) {
  const totals = { principal: 0, juros: 0, multa: 0, total: 0 };
  const papeis = { PARC: 'principal', PRINCIPAL: 'principal', JUROS: 'juros', MULTA: 'multa' };
  if (!entries.length) recusar('COMPOSICAO_A_CONFERIR');
  for (const entry of entries) {
    if (!entry.lines?.length) recusar('COMPOSICAO_A_CONFERIR');
    for (const line of entry.lines) {
      const value = centavos(line.valor);
      if (value == null || value <= 0) recusar('COMPOSICAO_A_CONFERIR');
      if (line.tipo === 'C') totals.total += value;
      else if (line.tipo === 'D' && papeis[entry.tipoLinha]) totals[papeis[entry.tipoLinha]] += value;
      else recusar('COMPOSICAO_A_CONFERIR');
    }
  }
  if (Object.keys(totals).some(k => Math.abs(totals[k] - composicao[k]) > 1)
    || Math.abs(totals.principal + totals.juros + totals.multa - totals.total) > 1) recusar('COMPOSICAO_A_CONFERIR');
}

export async function executarBaixaClienteTx(tx, { guide, confirmacao, userId }) {
  const portalClientId = confirmacao.companyId;
  if (guide.portalClientId !== portalClientId || guide.paymentStatus !== 'PAID') recusar('GUIA_INCOMPATIVEL');
  const anteriores = await tx.accountingEntry.findMany({ where: { portalClientId, tipo: 'BAIXA', sourceGuideId: guide.id }, include: { lines: true } });
  if (guide.baixada || guide.lancamentoId || anteriores.length) {
    if (!anteriores.length || !guide.baixada || !guide.lancamentoId) recusar('BAIXA_A_CONCILIAR');
    const debitos = anteriores.flatMap(e => e.lines || []).filter(l => l.tipo === 'D').map(l => centavos(l.valor));
    if (!debitos.length || debitos.some(v => v == null) || centavos(guide.valor) == null
      || Math.abs(debitos.reduce((a, b) => a + b, 0) - centavos(guide.valor)) > 1
      || anteriores.some(e => new Date(e.data).toISOString().slice(0, 10) !== confirmacao.pagoEm.slice(0, 10))) recusar('BAIXA_A_CONCILIAR');
    return { entryIds: anteriores.map(e => e.id), competencia: anteriores[0].competencia, existente: true };
  }
  const competencia = confirmacao.pagoEm.slice(0, 7);
  const circular = await tx.companyMonthlyCircular.findUnique({ where: { portalClientId_competencia: { portalClientId, competencia } } });
  if (circular?.fechadoContabilEm) throw Object.assign(new Error('Mês fechado.'), { code: 'MES_FECHADO' });
  const composicao = composicaoConfirmada(guide);
  const autorAuditoria = { ...confirmacao.autor, id: userId || confirmacao.autor?.userId || confirmacao.autor?.contatoId || 'automacao',
    confirmadoPor: confirmacao.autor || null, confirmacaoId: confirmacao.id, canal: confirmacao.canal, origem: 'CLIENTE' };
  const args = { origem: 'CLIENTE', portalClientId, guideId: guide.id, dataPagamento: new Date(confirmacao.pagoEm), userId };
  if (guide.parcelamentoId || String(guide.tipo).toUpperCase() === 'INSS') {
    const antes = await snapshotMesTx(tx, portalClientId, competencia);
    const r = guide.parcelamentoId ? await gerarPagamentoParcelaFromGuideTx(tx, args)
      : await gerarPagamentoInssFromGuideTx(tx, { ...args,
        rateio: Object.fromEntries(['principal', 'juros', 'multa', 'total'].map(k => [k, composicao[k] / 100])) });
    if (!r?.ok) recusar(r?.reason || 'BAIXA_A_CONFERIR');
    const entries = await tx.accountingEntry.findMany({ where: { portalClientId, sourceGuideId: guide.id, tipo: 'BAIXA' }, include: { lines: true } });
    conferirLancamentos(entries, composicao);
    await validarContas(tx, portalClientId, entries.flatMap(e => e.lines));
    await registrarAlteracaoTx(tx, { companyId: portalClientId, competencia,
      autor: autorAuditoria, metadados: { confirmacaoId: confirmacao.id || null }, antes,
      depois: await snapshotMesTx(tx, portalClientId, competencia) });
    return { entryIds: entries.map(e => e.id), competencia, ...Object.fromEntries(['principal', 'juros', 'multa', 'total'].map(k => [k, composicao[k] / 100])) };
  }
  // DAS pode ter sido provisionado pelo extrato, sem sourceGuideId. O vínculo é exato por competência.
  const entries = await tx.accountingEntry.findMany({ where: { portalClientId, tipo: 'PROVISAO',
    OR: [{ sourceGuideId: guide.id }, ...(guide.tipo === 'SIMPLES' ? [{ competencia: guide.competencia, eventType: 'DAS_SIMPLES', sourceGuideId: null }] : [])] },
    include: { lines: true, baixas: { include: { lines: true } } } });
  if (!entries.length) recusar('PROVISAO_AUSENTE');
  const planos = [];
  const usadas = new Set();
  for (const entry of entries) {
    const partes = entries.length === 1 ? composicao.partes : composicao.partes.filter(p => CODIGO_RECEITA_TO_EVENT[p.codigo] === entry.eventType);
    if (!partes.length || partes.some(p => usadas.has(p))) recusar('COMPOSICAO_A_CONFERIR');
    partes.forEach(p => usadas.add(p));
    const valores = somar(partes);
    const saldo = computeSaldoProvisao(entry);
    if (Math.abs(Math.round(saldo.saldo * 100) - valores.principal) > 1) recusar('SALDO_A_CONFERIR');
    const eventType = entry.eventType ? `BAIXA_${entry.eventType}` : entry.subtipo ? `BAIXA_${entry.subtipo}` : null;
    if (!eventType) recusar('CONTAS_AUSENTES');
    const mem = await lookupAccountsFromHistorico(tx, { portalClientId, eventType });
    const regra = await resolveRule(tx, { portalClientId, eventType });
    const debito = mem?.debitAccountCode || regra?.debitAccountCode;
    const credito = mem?.creditAccountCode || regra?.creditAccountCode;
    const lines = [
      { tipo: 'D', conta: debito, valor: valores.principal / 100, papel: 'PRINCIPAL' },
      { tipo: 'D', conta: CONTA_JUROS, valor: valores.juros / 100, papel: 'JUROS' },
      { tipo: 'D', conta: CONTA_MULTA, valor: valores.multa / 100, papel: 'MULTA' },
      { tipo: 'C', conta: credito, valor: valores.total / 100 },
    ].filter(l => l.valor > 0).map((l, ordem) => ({ ...l, ordem }));
    await validarContas(tx, portalClientId, lines);
    planos.push({ entryId: entry.id, codigoTributo: partes.length === 1 ? partes[0].codigo || null : null, lines, historico: `PAGAMENTO ${entry.subtipo || entry.eventType} - confirmado pelo cliente` });
  }
  if (usadas.size !== composicao.partes.length) recusar('COMPOSICAO_A_CONFERIR');
  const { executarBaixaProvisaoTx } = await import('./BaixaProvisaoService.js');
  const entryIds = [];
  for (const plano of planos) {
    const baixa = await executarBaixaProvisaoTx(tx, { ...plano, origem: 'CLIENTE', autorAuditoria, portalClientId, sourceGuideId: guide.id, dataPagamento: args.dataPagamento, userId });
    entryIds.push(...baixa.entryIds);
  }
  const reserva = await tx.guide.updateMany({ where: { id: guide.id, portalClientId, baixada: false, lancamentoId: null },
    data: { baixada: true, dataBaixa: args.dataPagamento, lancamentoId: entryIds[0] } });
  if (reserva.count !== 1) throw Object.assign(new Error('Baixa concorrente.'), { code: 'P2034' });
  return { entryIds, competencia, ...Object.fromEntries(['principal', 'juros', 'multa', 'total'].map(k => [k, composicao[k] / 100])) };
}
