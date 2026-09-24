import { prisma } from "../../../infrastructure/db/prisma.js";
import { TIPOS_PARCELAMENTO, grupoDoParcelamento } from "./contracts.js";

const erro = (code, message, status = 409) => Object.assign(new Error(message), { code, message, status });
export const GUIA_AVULSA = "GUIA_AVULSA";
const numeracao = n => n == null || n === "" ? null : Number(n);

export async function prepararParcelamentoDaGuia({ portalClientId, metadata, guiaExistente, client = prisma }) {
  if (metadata?.isParcelamento !== true) return null;
  const tipo = String(metadata.parcelamentoTipo || "OUTRO").toUpperCase();
  if (!TIPOS_PARCELAMENTO.includes(tipo)) throw erro("MODALIDADE_INVALIDA", "Selecione uma modalidade de parcelamento válida.", 400);
  const numero = numeracao(metadata.numeroParcela);
  if (numero != null && (!Number.isInteger(numero) || numero < 1)) throw erro("PARCELA_INVALIDA", "Informe um número de parcela válido.", 400);
  if (metadata.indicacaoId) {
    const indicacao = await client.parcelamentoIndicacao.findFirst({ where: { id: metadata.indicacaoId, portalClientId } });
    if (!indicacao) throw erro("INDICACAO_NAO_ENCONTRADA", "O aviso não pertence a esta empresa.", 404);
    if (indicacao.modalidade && indicacao.modalidade !== tipo) throw erro("MODALIDADE_DIVERGENTE", "A modalidade da guia não corresponde ao aviso.", 400);
  }
  const id = metadata.parcelamentoId || guiaExistente?.parcelamentoId;
  if (id) {
    const contrato = await client.parcelamento.findFirst({ where: { id, portalClientId, status: { not: "EXCLUIDO" } } });
    if (!contrato) throw erro("CONTRATO_NAO_ENCONTRADO", "Parcelamento não encontrado nesta empresa.", 404);
    if (contrato.tipo !== tipo) throw erro("MODALIDADE_DIVERGENTE", "A modalidade da guia não corresponde ao parcelamento.", 400);
    if (guiaExistente?.parcelamentoId && guiaExistente.parcelamentoId !== id) throw erro("VINCULO_EXISTENTE", "Use Vincular parcelamento para alterar o vínculo desta guia.");
    return contrato;
  }
  // Apenas a identidade interna da guia. Não representa adesão, calendário ou provisão.
  return client.parcelamento.create({ data: { portalClientId, tipo, kind: tipo === "INSS" ? "INSS" : grupoDoParcelamento(tipo) === "sn_mei" ? "SIMPLES" : "OUTRO",
    label: "Guia de parcelamento a vincular", origem: GUIA_AVULSA, grupo: grupoDoParcelamento(tipo),
    fiscalSituacao: GUIA_AVULSA, status: "ATIVO", numeroParcelamento: null,
    numParcelas: null, principalPerParcela: null, principalTotal: null, totalValue: null, competenciaInicial: null } });
}

/** Pode ser reutilizado dentro da ingestão contábil, na mesma transação. */
export async function vincularGuiaParcelamentoTx(tx, { portalClientId, guideId, parcelamentoId, numeroParcela }) {
  const guia = await tx.guide.findFirst({ where: { id: guideId, portalClientId }, include: { parcelamento: true, parcela: true } });
  const destino = await tx.parcelamento.findFirst({ where: { id: parcelamentoId, portalClientId, status: { not: "EXCLUIDO" } } });
  if (!guia || !destino) throw erro("VINCULO_NAO_ENCONTRADO", "Guia e parcelamento devem pertencer a esta empresa.", 404);
  const numero = numeroParcela === undefined ? guia.numeroParcela : numeracao(numeroParcela);
  if (numero != null && (!Number.isInteger(numero) || numero < 1)) throw erro("PARCELA_INVALIDA", "Informe um número de parcela válido.", 400);
  const origem = guia.parcelamento;
  if (guia.parcela && origem?.id === destino.id && (guia.numeroParcela ?? null) === (numero ?? null)) return { guideId: guia.id, parcelamentoId: destino.id, parcelamentoAvulso: destino.origem === GUIA_AVULSA };
  if (origem && origem.id !== destino.id && origem.origem !== GUIA_AVULSA) throw erro("VINCULO_EXISTENTE", "Esta guia já pertence a outro parcelamento. Confira o vínculo existente.");
  if (origem?.tipo && origem.tipo !== destino.tipo) throw erro("MODALIDADE_DIVERGENTE", "Os parcelamentos têm modalidades diferentes.");
  if (guia.baixada || guia.lancamentoId || guia.parcela?.origemBaixa || guia.parcela?.baixadaEm) throw erro("GUIA_CONTABILIZADA", "A guia já possui baixa. Confira os lançamentos antes de alterar o vínculo.");
  const candidato = numero == null ? null : await tx.parcela.findFirst({ where: { parcelamentoId: destino.id, numeroParcela: numero, id: { not: guia.parcela?.id || "" } } });
  const evidencia = p => p?.guiaId || p?.origemBaixa || p?.baixadaEm || p?.pagamentoStatus || p?.pagamentoEvidencia || p?.pagamentoConsultadoEm || p?.pagamentoEm || p?.valorPago != null || p?.pagamentoErro;
  if (candidato && (evidencia(candidato) || (guia.parcela && candidato.origem !== "CONTRATO"))) throw erro("PARCELA_JA_VINCULADA", "Esta prestação já possui guia ou evidência fiscal. Confira-a antes de vincular.");
  const candidatoLivre = candidato && { id: candidato.id, portalClientId, parcelamentoId: destino.id, updatedAt: candidato.updatedAt,
    guiaId: null, origemBaixa: null, baixadaEm: null, pagamentoStatus: null, pagamentoConsultadoEm: null,
    pagamentoEm: null, valorPago: null, pagamentoErro: null };
  const atualizado = await tx.guide.updateMany({ where: { id: guia.id, portalClientId, updatedAt: guia.updatedAt }, data: { parcelamentoId: destino.id, numeroParcela: numero,
    extracted: { ...(guia.extracted || {}), isParcelamento: true, parcelamentoAvulso: destino.origem === GUIA_AVULSA } } });
  if (atualizado.count !== 1) throw erro("GUIA_ALTERADA", "A guia mudou. Atualize a lista e tente novamente.");
  if (guia.parcela) {
    // Só remove a previsão vazia; a linha com evidência fiscal conserva sua identidade e valores.
    if (candidato) {
      const apagada = await tx.parcela.deleteMany({ where: { ...candidatoLivre, origem: "CONTRATO" } });
      if (apagada.count !== 1) throw erro("PARCELA_ALTERADA", "A prestação recebeu uma alteração. Atualize a lista antes de vincular.");
    }
    const movida = await tx.parcela.updateMany({ where: { id: guia.parcela.id, portalClientId, parcelamentoId: guia.parcelamentoId,
      guiaId: guia.id, updatedAt: guia.parcela.updatedAt, origemBaixa: null, baixadaEm: null }, data: { parcelamentoId: destino.id, numeroParcela: numero } });
    if (movida.count !== 1) throw erro("PARCELA_ALTERADA", "A prestação mudou durante o vínculo. Atualize a lista.");
  } else if (candidato) {
    const anexada = await tx.parcela.updateMany({ where: candidatoLivre, data: { guiaId: guia.id, origem: "GUIA" } });
    if (anexada.count !== 1) throw erro("PARCELA_ALTERADA", "A prestação recebeu uma alteração. Atualize a lista antes de vincular.");
  } else {
    await tx.parcela.create({ data: { parcelamentoId: destino.id, portalClientId, guiaId: guia.id, numeroParcela: numero,
      competencia: guia.competencia, anoMesParcela: guia.anoMesParcela || guia.competencia?.replace("-", ""),
      vencimento: guia.vencimento, valorPrevisto: guia.valor, origem: "GUIA" } });
  }
  if (origem?.origem === GUIA_AVULSA && origem.id !== destino.id) {
    const encerrado = await tx.parcelamento.updateMany({ where: { id: origem.id, portalClientId, origem: GUIA_AVULSA, aberturaEntryId: null, updatedAt: origem.updatedAt }, data: { status: "EXCLUIDO" } });
    if (encerrado.count !== 1) throw erro("PARCELAMENTO_ALTERADO", "O parcelamento foi contabilizado ou alterado durante o vínculo. Atualize a lista.");
  }
  return { guideId: guia.id, parcelamentoId: destino.id, parcelamentoAvulso: destino.origem === GUIA_AVULSA };
}

export async function vincularGuiaParcelamento(input) {
  return prisma.$transaction(tx => vincularGuiaParcelamentoTx(tx, input));
}
