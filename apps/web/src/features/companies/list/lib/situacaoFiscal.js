// A RELAÇÃO COM O FISCO — cinco estados, um chip.
//
// Coluna separada da Apuração de propósito: são perguntas diferentes. "Como está o mês?" é trabalho
// nosso; "como está com a Receita?" é dívida do cliente. Empilhar as duas na mesma célula produzia
// combinações que não queriam dizer nada ("Falta apurar" + "Sem pendência" em verde).

import { SITUACAO_FISCAL_SIMBOLO } from "../../../../lib/vocabulario";

// ⚠ DADO VELHO NÃO É GARANTIA. Uma consulta de três meses atrás dizendo "em dia" não prova nada
// sobre hoje — e é justamente o "em dia" que dá permissão para parar de olhar. Por isso o frescor
// rebaixa o chip.
export const DIAS_PARA_ENVELHECER = 30;

export const FISCAL = {
  emDia: { chave: "emDia", rotulo: "Em dia", icone: "✓", cor: "var(--state-ok)", severidade: 2, pill: false },
  pendencia: { chave: "pendencia", rotulo: "Com pendência", icone: SITUACAO_FISCAL_SIMBOLO.COM_PENDENCIA, cor: "var(--state-danger)", fundo: "var(--state-danger-surface)", severidade: 0, pill: true },
  // ⚠ ACENTO, não âmbar nem vermelho: parcelamento em dia é situação GERENCIADA. O cliente
  // negociou, está pagando, e não há nada a fazer neste mês além da parcela — que vive na coluna
  // Guias. Pintar de alarme é dizer que há problema onde há acordo.
  parcelamento: { chave: "parcelamento", rotulo: "Parcelamento", icone: SITUACAO_FISCAL_SIMBOLO.EM_PARCELAMENTO, cor: "var(--accent-purple)", fundo: "rgba(189,147,249,0.14)", severidade: 2, pill: true },
  parcelamentoAtraso: { chave: "parcelamentoAtraso", rotulo: "Parcela atrasada", icone: "⚠", cor: "var(--state-danger)", fundo: "var(--state-danger-surface)", severidade: 0, pill: true },
  consultar: { chave: "consultar", rotulo: "Consultar", icone: "○", cor: "var(--text-faint)", severidade: 2, pill: false },
};

function diasDesde(data) {
  if (!data) return null;
  const d = new Date(data);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

/**
 * @param {object} company linha de `GET /firm/companies`
 * @returns {{estado, rotulo, titulo, dias, precisaConsultar}}
 */
export function situacaoFiscalDaLinha(company) {
  const situacao = String(company?.fiscalSituacao || "").toUpperCase();
  const dias = diasDesde(company?.fiscalCheckedAt);
  const nunca = dias == null;
  const velha = !nunca && dias > DIAS_PARA_ENVELHECER;
  const parc = company?.guideCompliance?.parcDas || null;
  const temParcelamento = Boolean(company?.temParcelamento) || situacao === "EM_PARCELAMENTO" || parc?.required;

  const comIdade = (txt) => (nunca ? `${txt} · nunca consultada` : `${txt} · consultada há ${dias} dia(s)`);

  // ⚠ PENDÊNCIA E ATRASO NÃO ENVELHECEM. O frescor rebaixa só os estados BONS: uma dívida conhecida
  // não some porque a consulta é antiga, e trocar "Com pendência" por "Consultar" esconderia um
  // problema que já sabemos existir. Dado velho vira dúvida sobre o bom, nunca perdão do ruim.
  if (parc?.atrasada) {
    return { estado: FISCAL.parcelamentoAtraso, rotulo: FISCAL.parcelamentoAtraso.rotulo, titulo: comIdade("Parcela do parcelamento vencida e não paga"), dias, precisaConsultar: false };
  }
  if (situacao === "COM_PENDENCIA") {
    return { estado: FISCAL.pendencia, rotulo: FISCAL.pendencia.rotulo, titulo: comIdade("Empresa COM PENDÊNCIA na Receita (SITFIS)"), dias, precisaConsultar: velha };
  }

  // Nunca consultada ou consulta velha: não afirmamos nada sobre o fisco.
  if (nunca || velha) {
    return {
      estado: FISCAL.consultar,
      rotulo: nunca ? "Consultar" : `Consultar (${dias}d)`,
      titulo: nunca
        ? "Situação fiscal nunca consultada para esta empresa"
        : `Última consulta há ${dias} dias — mais de ${DIAS_PARA_ENVELHECER} dias não serve de garantia`,
      dias,
      precisaConsultar: true,
    };
  }

  if (situacao === "PROCESSANDO") {
    return { estado: FISCAL.consultar, rotulo: "Consultando…", titulo: "Consulta em andamento no SERPRO", dias, precisaConsultar: false };
  }

  if (temParcelamento) {
    const n = parc?.numeroParcela;
    const de = parc?.quantidadeParcelas;
    return {
      estado: FISCAL.parcelamento,
      rotulo: n && de ? `Parcelamento ${n}/${de}` : "Parcelamento",
      titulo: comIdade(`Débito parcelado${parc?.tipoParcelamento ? ` (${parc.tipoParcelamento})` : ""} — em dia`),
      dias,
      precisaConsultar: false,
    };
  }

  return { estado: FISCAL.emDia, rotulo: FISCAL.emDia.rotulo, titulo: comIdade("Sem pendência na Receita (SITFIS)"), dias, precisaConsultar: false };
}
