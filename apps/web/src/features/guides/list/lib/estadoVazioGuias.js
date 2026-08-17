// POR QUE NÃO HÁ GUIA NESTE MÊS — a pergunta que a tela respondia com uma frase seca.
//
// O vazio era *"Nenhuma guia encontrada para os filtros atuais."*, e é a mesma classe de defeito de
// `lib/falhaDeCarga.js`: uma frase para situações que exigem ações opostas. Sem guia porque a
// competência **ainda não foi apurada** (falta trabalho nosso) é o contrário de sem guia porque o
// mês foi **declarado sem faturamento** (não há o que pagar) — e as duas são o contrário de o
// servidor **não ter respondido**.
//
// ⚠ E o erro caro é o terceiro. Dizer "não há guia" quando na verdade a consulta falhou faz o
// contador concluir que não há tributo a pagar naquele mês. Ausência nunca é resposta.
//
// ⚠ ESTA REGRA NÃO AFIRMA O QUE NÃO SABE. Estado de apuração desconhecido (enum novo, competência
// nunca tocada) NÃO vira "não apurado": vira o genérico, que não conclui nada. Foi assim que
// `chaveSituacaoFiscal` tratou o mesmo problema — valor estranho cai em `NAO_CONSULTADA`, nunca em
// "sem pendência".

import { lerFalhaDeCarga } from "../../../../lib/falhaDeCarga";

export const VAZIO = Object.freeze({
  /** O servidor não respondeu / recusou. NUNCA se parece com "não há guia". */
  FALHA: "FALHA",
  /** A caixa "Ver todas as competências" está ligada: não há mês único sobre o qual perguntar. */
  TODAS_COMPETENCIAS: "TODAS_COMPETENCIAS",
  /** O contador afirmou que o mês não teve receita. O DAS deixa de ser exigido. */
  SEM_MOVIMENTO: "SEM_MOVIMENTO",
  /** A apuração da competência não foi feita — é o trabalho que falta. */
  NAO_APURADO: "NAO_APURADO",
  /** A competência foi apurada e ainda não há guia gravada. */
  APURADO_SEM_GUIA: "APURADO_SEM_GUIA",
  /** Não sabemos em que ponto a competência está — e a tela diz isso. */
  INDEFINIDO: "INDEFINIDO",
});

// ⚠ LISTAS FECHADAS, e é o que impede a regra de concluir por semelhança. Os valores saem de
// `ApuracaoSnapshot.estado` — os mesmos de `lib/vocabulario.js` (`ESTADOS_APURACAO`). Estado novo
// que apareça amanhã NÃO cai em nenhuma das duas: cai em `INDEFINIDO`, de propósito.
const ESTADOS_NAO_APURADOS = new Set(["aberta", "pendente", "configurando"]);
const ESTADOS_APURADOS = new Set(["calculada", "revisada", "fechada", "transmitida", "confirmada"]);

/**
 * @param {object} entrada
 * @param {string} entrada.competencia          "" quando "Ver todas as competências" está ligado.
 * @param {unknown} entrada.erro                Falha ao consultar o contexto (não a lista de guias).
 * @param {boolean} entrada.semFaturamento      `CompanyMonthlyCircular.semFaturamento === true`.
 * @param {string|null} entrada.estadoApuracao  `ApuracaoSnapshot.estado`.
 * @returns {{chave: string, titulo: string, explicacao: string, acao: {rotulo: string, destino: string}|null}}
 */
export function estadoVazioDasGuias({ competencia, erro, semFaturamento, estadoApuracao } = {}) {
  const falha = lerFalhaDeCarga(erro, { assunto: "o estado desta competência" });
  if (falha) {
    return {
      chave: VAZIO.FALHA,
      titulo: falha.titulo,
      // ⚠ A frase tem de dizer as DUAS coisas: não há guia NA LISTA, e não sabemos se deveria
      // haver. Só a primeira metade é o que fazia a tela parecer estar dando um veredito.
      explicacao: `${falha.motivo} Não há guia nesta lista, e não é possível dizer se deveria haver.`,
      acao: null,
    };
  }

  if (!competencia) {
    return {
      chave: VAZIO.TODAS_COMPETENCIAS,
      titulo: "Nenhuma guia nesta empresa",
      explicacao: "A caixa \"Ver todas as competências\" está ligada — não há guia gravada em mês nenhum.",
      acao: null,
    };
  }

  if (semFaturamento === true) {
    return {
      chave: VAZIO.SEM_MOVIMENTO,
      titulo: `Sem faturamento em ${competencia}`,
      explicacao: "O mês foi declarado sem receita, então o DAS não é exigido. Outras guias "
        + "(INSS, parcelamento) continuam valendo se houver.",
      acao: null,
    };
  }

  const estado = String(estadoApuracao || "").trim().toLowerCase();

  if (ESTADOS_NAO_APURADOS.has(estado)) {
    return {
      chave: VAZIO.NAO_APURADO,
      titulo: `${competencia} ainda não foi apurada`,
      explicacao: "Sem apuração não há DAS a gerar. Isto não diz que não há tributo a pagar.",
      acao: { rotulo: "Ir para Apuração", destino: "apuracao" },
    };
  }

  if (ESTADOS_APURADOS.has(estado)) {
    return {
      chave: VAZIO.APURADO_SEM_GUIA,
      titulo: `${competencia} foi apurada, mas nenhuma guia foi gravada`,
      explicacao: "A guia pode não ter sido buscada no SERPRO, ou precisa ser anexada à mão.",
      acao: { rotulo: "+ Subir guia", destino: "upload" },
    };
  }

  // ⚠ NÃO É "não apurado". É "não sabemos" — e são coisas diferentes.
  return {
    chave: VAZIO.INDEFINIDO,
    titulo: `Nenhuma guia em ${competencia}`,
    explicacao: "Não foi possível dizer em que ponto esta competência está. Confira na aba Apuração "
      + "antes de concluir que não há nada a pagar.",
    acao: { rotulo: "Ir para Apuração", destino: "apuracao" },
  };
}
