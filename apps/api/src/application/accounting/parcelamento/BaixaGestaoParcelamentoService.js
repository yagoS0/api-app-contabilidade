import { createHash, randomUUID } from 'node:crypto';
import { prisma } from '../../../infrastructure/db/prisma.js';
import { carregarGestaoParcelamento, auditarGestao, GestaoParcelamentoError } from './GestaoParcelamentoService.js';
import { competenciasFechadas } from '../fechamentoContabil.js';
import { criarLancamentosIndividuais } from './ParcelamentoV2Service.js';
import { recalcularParcelamento } from './recalculoParcelamento.js';
import { ORIGEM_BAIXA } from '../ancoraBaixa.js';
import { PARCELA_ESTADOS } from './parcelaStateMachine.js';

const fail = message => { throw new GestaoParcelamentoError(message); };
const cents = n => Math.round(Number(n) * 100);
const hash = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');

export function validarLinhasBaixa(linhas, principal) {
  if (!Array.isArray(linhas) || !linhas.length || linhas.length > 100) fail('Confira as linhas da baixa.');
  const keys = new Set();
  const sums = { PARC: 0, JUROS: 0, MULTA: 0, CAIXA: 0 };
  const normalizadas = linhas.map(l => {
    if (!Object.hasOwn(sums,l.tipoLinha) || l.tipo !== (l.tipoLinha === 'CAIXA' ? 'C' : 'D')) fail('Use débito para principal, juros e multa e crédito para pagamento.');
    const valor = Number(l.valor);
    if (!Number.isFinite(valor) || valor <= 0 || Math.abs(valor * 100 - cents(valor)) > 0.00001) fail('Informe valores positivos com até duas casas decimais.');
    // A chave é a mesma usada pelo índice de idempotência das baixas.
    // Não se inventam códigos de receita para permitir uma segunda linha igual.
    if (keys.has(l.tipoLinha)) fail('Agrupe o valor de cada papel em uma linha.');
    keys.add(l.tipoLinha);
    sums[l.tipoLinha] += cents(valor);
    const conta = String(l.conta || '').trim(), historico = String(l.historico || '').trim();
    if (!conta || !historico || conta.length > 100 || historico.length > 2000) fail('Preencha conta e descrição de cada lançamento.');
    return { tipoLinha: l.tipoLinha, tipo: l.tipo, valor, conta, historico };
  });
  if (sums.PARC !== cents(principal)) fail('A baixa deve quitar o principal integral da parcela. Informe acréscimos em juros e multa.');
  if (sums.CAIXA !== sums.PARC + sums.JUROS + sums.MULTA) fail('Débitos e créditos devem ter o mesmo total.');
  return { linhas: normalizadas, total: sums.CAIXA / 100 };
}

export async function preverBaixaGestao(args, db = prisma) {
  const base = await carregarGestaoParcelamento(args, db);
  const { acordo, lancamentos } = base;
  const p = acordo.parcelasContratadas.find(p => p.id === args.parcelaId);
  if (!p) fail('Parcela não encontrada neste contrato.');
  if (acordo.status !== 'ATIVO' || !acordo.aberturaEntryId) fail('É necessário um contrato ativo com provisão de abertura.');
  if (p.origemBaixa || p.guia?.baixada || p.guia?.lancamentoId || lancamentos.some(e => e.tipo === 'BAIXA' && (e.sourceGuideId && e.sourceGuideId === p.guiaId || e.numeroParcela === p.numeroParcela))) fail('Esta parcela já possui baixa. Confira os lançamentos existentes.');
  if (!p.numeroParcela || !(Number(p.valorPrevisto) > 0)) fail('Corrija a numeração e o valor previsto antes da baixa.');
  // A baixa documental continua usando o decompositor de códigos de receita existente.
  // Não substituir sua amortização consolidada por uma declaração de principal nominal.
  if (p.guia?.paymentStatus === 'PAID' || p.pagamentoStatus === 'CONFIRMADO') fail('Há pagamento confirmado: utilize a baixa do comprovante na fila de conferência, que preserva a composição oficial.');
  const data = args.baixa?.dataPagamento;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data || '') || !Number.isFinite(new Date(data).getTime()) || new Date(data).toISOString().slice(0,10) !== data) fail('Informe uma data de pagamento válida.');
  const competencia = data.slice(0,7);
  if ((await competenciasFechadas(args.companyId, [competencia], db)).size) fail(`Mês ${competencia} fechado. Reabra antes de lançar.`);
  const validada = validarLinhasBaixa(args.baixa.linhas, p.valorPrevisto);
  return { ...validada, dataPagamento: data, competencia, parcelaId: p.id, numeroParcela: p.numeroParcela,
    confirmacao: hash([base.revisao, p.id, data, validada]), base };
}

export async function executarBaixaGestao(args, db = prisma) {
  if (!args.userId || !args.confirmacao) fail('Confira os lançamentos antes de confirmar.');
  try {
    return await db.$transaction(async tx => {
      const preview = await preverBaixaGestao(args, tx);
      if (preview.confirmacao !== args.confirmacao) fail('Os dados mudaram. Confira novamente antes de lançar.');
      const { acordo } = preview.base;
      const p = acordo.parcelasContratadas.find(p => p.id === args.parcelaId);
      const data = new Date(`${preview.dataPagamento}T12:00:00Z`);
      if (p.guiaId) {
        const r = await tx.guide.updateMany({ where: { id: p.guiaId, portalClientId: args.companyId, baixada: false, lancamentoId: null }, data: { baixada: true, dataBaixa: data } });
        if (r.count !== 1) fail('A guia foi alterada. Recarregue antes de lançar.');
      } else {
        const r = await tx.parcela.updateMany({ where: { id: p.id, portalClientId: args.companyId, guiaId: null, origemBaixa: null }, data: { origemBaixa: ORIGEM_BAIXA.MANUAL, baixadaEm: data } });
        if (r.count !== 1) fail('A parcela foi alterada. Recarregue antes de lançar.');
      }
      const entries = await criarLancamentosIndividuais(tx, {
        portalClientId: args.companyId, parcelamentoId: acordo.id, numeroParcela: p.numeroParcela,
        linhas: preview.linhas, data, competencia: preview.competencia, tipo: 'BAIXA',
        subtipo: `PARC_${acordo.tipo || acordo.kind || 'OUTRO'}`, origem: 'MANUAL',
        lote: `PARCV2-${acordo.id.slice(0,8)}-PAGM-${randomUUID()}`, historicoBase: '',
        marcaProcedencia: '(declarado)', statusPagamento: 'PAGO',
        openEntryId: acordo.aberturaEntryId, sourceGuideId: p.guiaId,
      });
      if (p.guiaId) await tx.guide.update({ where: { id: p.guiaId }, data: { lancamentoId: entries[0].id, parcelaEstado: PARCELA_ESTADOS.PAGA_A_CONFERIR } });
      await recalcularParcelamento(tx, { portalClientId: args.companyId, parcelamentoId: acordo.id });
      await auditarGestao(tx, { ...args, tipo: 'BAIXA_MANUAL', antes: { parcelaId: p.id }, depois: { parcelaId: p.id, dataPagamento: preview.dataPagamento, total: preview.total, lancamentos: entries.map(e=>e.id) }, motivo: 'Pagamento declarado e contabilizado' });
      return { ok: true, lancamentos: entries.map(e=>e.id), total: preview.total };
    }, { isolationLevel: 'Serializable', timeout: 20000 });
  } catch (e) {
    if (['P2034','P2002'].includes(e.code)) fail('Houve alteração simultânea. Recarregue para conferir a baixa.');
    throw e;
  }
}
