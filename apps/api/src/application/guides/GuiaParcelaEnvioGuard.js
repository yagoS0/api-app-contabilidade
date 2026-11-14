import { formaIndicacaoNoMes } from '../accounting/parcelamento/IndicacaoFormaPagamentoService.js';
import { exigirGuiaArrecadatoria } from './lib/documentoNaoArrecadatorio.js';
import { prisma } from "../../infrastructure/db/prisma.js";

import { bloqueioEnvioParcela } from '../../modules/guides/domain/elegibilidadeEnvioParcela.js';
export { bloqueioEnvioParcela } from '../../modules/guides/domain/elegibilidadeEnvioParcela.js';

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
