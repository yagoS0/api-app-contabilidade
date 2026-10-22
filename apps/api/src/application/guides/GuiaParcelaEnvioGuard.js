import { formaIndicacaoNoMes } from '../accounting/parcelamento/IndicacaoFormaPagamentoService.js';
import { documentoNaoArrecadatorio, STATUS_DOCUMENTO, exigirGuiaArrecadatoria } from './lib/documentoNaoArrecadatorio.js';
import { prisma } from "../../infrastructure/db/prisma.js";

// A conferência é comum à liberação no portal e a todos os transportes de cobrança.
export function bloqueioEnvioParcela(guide) {
  const recusa = (code, message) => ({ code, message, status: 409, guideId: guide?.id });
  if (documentoNaoArrecadatorio(guide)) return recusa(STATUS_DOCUMENTO, 'Documento reclassificado. Consulte Documentos da empresa.');
  if (guide?.extracted?.conferenciaDocumentoPendente === true) return recusa(
    "PARCELA_DOCUMENTO_PENDENTE", "Confira o documento desta parcela na aba Parcelamento antes de liberar ou enviar ao cliente.");
  if (!guide?.parcelamentoId) return null;
  if (guide.paymentStatus === "PAID" || guide.baixada || guide.parcela?.pagamentoStatus === "CONFIRMADO" || guide.parcela?.origemBaixa || guide.parcela?.baixadaEm) return recusa(
    "PARCELA_PAGA", "Esta parcela tem pagamento confirmado e não pode ser enviada como cobrança.");
  if (guide.parcelamento?.formaPagamento === "DEBITO_AUTOMATICO") return recusa(
    "PARCELA_DEBITO_AUTOMATICO", "Este parcelamento está em débito automático. Consulte o pagamento da parcela antes de enviar uma cobrança.");
  if (guide.parcelamento?.status === "EXCLUIDO") return recusa(
    "PARCELAMENTO_EXCLUIDO", "Este parcelamento foi excluído. Confira o contrato antes de enviar a guia.");
  if (!(Number(guide.valor) > 0) || !guide.vencimento || !Number.isFinite(new Date(guide.vencimento).getTime())) return recusa(
    "PARCELA_DOCUMENTO_INCOMPLETO", "Confira o valor e o vencimento do documento desta parcela antes de enviar ao cliente.");
  return null;
}

export const SELECT_PARCELA_ENVIO = {
  parcelamentoId: true, extracted: true,
  parcelamento: { select: { formaPagamento: true, status: true, origem: true } },
  baixada: true, parcela: { select: { pagamentoStatus: true, origemBaixa: true, baixadaEm: true } },
};

export async function conferirParcelasParaEnvio(guias, { client = prisma, atualizar = true } = {}) {
  for (const original of guias || []) {
    exigirGuiaArrecadatoria(original);
    if (!original?.parcelamentoId && !original?.extracted?.indicacaoParcelamentoId && original?.extracted?.conferenciaDocumentoPendente !== true) continue;
    const guide = atualizar ? await client.guide.findFirst({
      where: { id: original.id, portalClientId: original.portalClientId },
      select: { id: true, portalClientId: true, valor: true, vencimento: true, paymentStatus: true, ...SELECT_PARCELA_ENVIO },
    }) : original;
    if (!guide) throw Object.assign(new Error("A guia não está mais disponível. Atualize a lista."), { code: "PARCELA_GUIA_INDISPONIVEL", status: 409 });
    await conferirFormaIndicacaoParaEnvio(guide, client);
    const bloqueio = bloqueioEnvioParcela(guide);
    if (bloqueio) throw Object.assign(new Error(bloqueio.message), bloqueio);
  }
}

export async function conferirFormaIndicacaoParaEnvio(guide, client = prisma) {
    // Após vincular a um contrato real, a declaração da indicação é apenas histórico.
    // Origem ausente não comprova essa transição: preserve a conferência conservadora.
    if (guide.parcelamentoId && guide.parcelamento?.origem && guide.parcelamento.origem !== 'GUIA_AVULSA') return;
    const indicacaoId = guide.extracted?.indicacaoParcelamentoId;
    if (indicacaoId) {
      const indicacao = await client.parcelamentoIndicacao.findFirst({ where: { id: indicacaoId, portalClientId: guide.portalClientId } });
      if (!indicacao) throw Object.assign(new Error('Confira a indicação de origem desta guia.'), { code: 'PARCELA_INDICACAO_INVALIDA', status: 409 });
      const config = await client.appSetting.findUnique({ where: { key: `parcelamento_indicacao_forma:v1:${indicacaoId}` } });
      if (config) {
        const vencimento = guide.vencimento && new Date(guide.vencimento);
        if (!vencimento || !Number.isFinite(vencimento.getTime())) throw Object.assign(new Error('Confira o vencimento antes de enviar esta parcela.'), { code: 'PARCELA_DOCUMENTO_INCOMPLETO', status: 409 });
        if (formaIndicacaoNoMes(config.value, vencimento.toISOString().slice(0, 7))?.formaPagamento === 'DEBITO_AUTOMATICO') throw Object.assign(new Error('A indicação está em débito automático neste mês. Confira o pagamento antes de cobrar.'), { code: 'PARCELA_DEBITO_AUTOMATICO', status: 409 });
      }
    }
}
