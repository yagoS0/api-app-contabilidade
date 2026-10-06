// A RELAÇÃO COM O FISCO — cinco estados, um chip.
//
// Coluna separada da Apuração de propósito: são perguntas diferentes. "Como está o mês?" é trabalho
// nosso; "como está com a Receita?" é dívida do cliente. Empilhar as duas na mesma célula produzia
// combinações que não queriam dizer nada ("Falta apurar" + "Sem pendência" em verde).

import { SITUACAO_FISCAL_SIMBOLO } from "../../../../lib/vocabulario";
import { temPendenciaParcelamento } from "./pendenciaParcelamento";

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
  const situacao = String(company?.fiscalSituacao || '').toUpperCase();
  const dias = diasDesde(company?.fiscalCheckedAt);
  const antiga = dias != null && dias > DIAS_PARA_ENVELHECER;
  const parc = company?.guideCompliance?.parcDas;
  const tem = company?.temParcelamento || situacao === 'EM_PARCELAMENTO' || parc?.required;
  const parcelamento = tem ? parc?.atrasada ? 'Parcelamento · parcela atrasada' : temPendenciaParcelamento(company) ? 'Parcelamento · a conferir' : 'Parcelamento' : null;
  const detalhe = dias == null ? 'Sem consulta registrada' : `Consulta há ${dias} dia(s)`;
  const base = { dias, parcelamento, titulo: detalhe, precisaConsultar: false };
  if (situacao === 'COM_PENDENCIA' || parc?.atrasada) return { ...base, estado: FISCAL.pendencia, rotulo: 'Pendência', titulo: `Pendência conhecida · ${detalhe}`, precisaConsultar: antiga };
  if (situacao === 'PROCESSANDO') return { ...base, estado: FISCAL.consultar, rotulo: 'Consultando…' };
  if (situacao === 'INCONCLUSIVO') return { ...base, estado: FISCAL.consultar, rotulo: 'Conferir relatório', precisaConsultar: true };
  if (dias == null) return { ...base, estado: FISCAL.consultar, rotulo: 'Sem consulta', precisaConsultar: true };
  if (antiga) return { ...base, estado: FISCAL.consultar, rotulo: 'Consulta antiga', precisaConsultar: true };
  // Parcelamento é dimensão independente; sozinho não comprova ausência de outras pendências.
  if (['REGULAR','SEM_PENDENCIA','EM_DIA'].includes(situacao)) return { ...base, estado: FISCAL.emDia, rotulo: 'Em dia' };
  return { ...base, estado: FISCAL.consultar, rotulo: 'Conferir relatório', precisaConsultar: true };
}
