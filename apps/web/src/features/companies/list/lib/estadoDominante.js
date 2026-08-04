// O ESTADO DOMINANTE de uma empresa no fechamento do mês — um chip só, por prioridade.
//
// POR QUE UMA FUNÇÃO SÓ
// O estado vem de DUAS fontes que não se conhecem: o agregado `/firm/companies/fechamento`
// (blockers, check-list, podeFechar, fechado) e o payload da própria empresa (`apuracao.apurada`,
// `empresaZerada`). Card e tabela precisam contar a MESMA história — duas cópias desta cascata
// divergiriam, e aí a mesma empresa apareceria de dois jeitos dependendo da visão.

import {
  SITUACAO_FISCAL_SIMBOLO, SITUACAO_FISCAL_TEXTO, SITUACAO_FISCAL_COR, chaveSituacaoFiscal,
} from "../../../../lib/vocabulario";

export const ESTADOS_EMPRESA = {
  fechada:   { chave: "fechada",   rotulo: "Fechada",         icone: "🔒", cor: "var(--state-closed)",  fundo: "var(--state-closed-surface)" },
  pendencia: { chave: "pendencia", rotulo: "Pendência",       icone: "⚠",  cor: "var(--state-danger)",  fundo: "var(--state-danger-surface)" },
  fiscal:    { chave: "fiscal",    rotulo: "Pendência fiscal", icone: "⚠",  cor: "var(--state-danger)",  fundo: "var(--state-danger-surface)" },
  apurar:    { chave: "apurar",    rotulo: "Falta apurar",    icone: "○",  cor: "var(--state-neutral)", fundo: "var(--state-neutral-surface)" },
  zerada:    { chave: "zerada",    rotulo: "Zerada",          icone: "◌",  cor: "var(--state-neutral)", fundo: "var(--state-neutral-surface)" },
  pronta:    { chave: "pronta",    rotulo: "Pronta p/ fechar", icone: "✅", cor: "var(--state-ok)",      fundo: "var(--state-ok-surface)" },
};

// Ordem de URGÊNCIA — é ela que ordena a lista por padrão. `fechada` fica por último de propósito:
// está fora do fluxo de trabalho, e o contador não deve tropeçar nela ao procurar o que falta.
export const ORDEM_URGENCIA = ["pendencia", "fiscal", "apurar", "zerada", "pronta", "fechada"];

/**
 * @param {object} company linha de `GET /firm/companies`
 * @param {object} trava   linha de `GET /firm/companies/fechamento` (pode faltar)
 * @returns {object} um dos `ESTADOS_EMPRESA`
 */
export function estadoDominante(company, trava) {
  // Fechada VENCE tudo: é terminal. Mostrar "falta apurar" numa empresa já fechada seria dizer que
  // há trabalho onde não há — mesmo que o check-list dela tenha ficado incompleto no caminho.
  if (trava?.fechado || company?.fechamentoContabil?.fechado) return ESTADOS_EMPRESA.fechada;

  if (trava?.blockers?.length > 0) return ESTADOS_EMPRESA.pendencia;

  // ⚠ Aqui morava "Falta check-list". Ele saiu a pedido do dono e deu lugar à SITUAÇÃO FISCAL, que
  // é o que ele quer ver de relance nesta coluna: débito junto à Receita.
  //
  // Só `COM_PENDENCIA` ocupa o degrau. Os outros valores (regular, em parcelamento, processando,
  // nunca consultada) NÃO exigem ação e por isso não podem passar na frente de "falta apurar" —
  // mostrar "✓ Sem pendência" como estado dominante numa empresa que ninguém apurou seria trocar
  // uma informação útil por outra que engana. Eles aparecem na segunda linha da célula (ver
  // `situacaoFiscalDaEmpresa`), que informa sem competir.
  //
  // O sinal do check-list não se perdeu: o chip de filtro "☐ Falta check-list · N" no topo e o
  // fechamento em lote leem `trava.checklistPendentes` direto, não esta função.
  if (company?.fiscalSituacao === "COM_PENDENCIA") return ESTADOS_EMPRESA.fiscal;

  // "Falta apurar" vem do payload da empresa, não do agregado — são coisas diferentes: apuração é
  // ato fiscal (PGDAS-D transmitido), fechamento é contábil.
  if (company?.apuracao && !company.apuracao.apurada) return ESTADOS_EMPRESA.apurar;

  // Zerada é informativo: não exige ação, então fica ABAIXO do que exige.
  if (company?.empresaZerada) return ESTADOS_EMPRESA.zerada;

  if (trava?.podeFechar) return ESTADOS_EMPRESA.pronta;

  // Sem agregado (a chamada falhou) e sem nada a dizer: trata como o estado padrão do mês.
  return ESTADOS_EMPRESA.apurar;
}

/** Índice de urgência para ordenar. Menor = mais urgente. */
export function pesoUrgencia(company, trava) {
  const i = ORDEM_URGENCIA.indexOf(estadoDominante(company, trava).chave);
  return i < 0 ? ORDEM_URGENCIA.length : i;
}

/**
 * A situação fiscal para a SEGUNDA linha da coluna Status — o que o chip dominante não disse.
 *
 * Devolve `null` quando não há nada a acrescentar (a empresa já está com o chip de pendência
 * fiscal: repetir a mesma frase logo abaixo é ruído).
 *
 * ⚠ `fiscalSituacao: null` vira `NAO_CONSULTADA`, NUNCA "sem pendência". A diferença entre "olhamos
 * e não há débito" e "ninguém olhou" é a diferença entre uma informação e uma suposição.
 */
export function situacaoFiscalDaEmpresa(company) {
  const chave = chaveSituacaoFiscal(company?.fiscalSituacao);
  if (chave === "COM_PENDENCIA") return null;
  return {
    chave,
    rotulo: `${SITUACAO_FISCAL_SIMBOLO[chave]} ${SITUACAO_FISCAL_TEXTO[chave]}`,
    cor: SITUACAO_FISCAL_COR[chave],
    em: company?.fiscalCheckedAt || null,
  };
}

/**
 * Empresa ZERADA não tem guia — e dizer isso é diferente de não mostrar nada.
 *
 * A regra existia só no card. Como a tabela virou o padrão no desktop, a mesma empresa aparecia sem
 * chips num lugar e com seis chips vermelhos no outro. Uma função só para as duas visões: o que se
 * mostra ali é a AFIRMAÇÃO "empresa zerada", não a ausência de informação.
 */
export function empresaSemObrigacoes(company) {
  return Boolean(company?.empresaZerada);
}

export const TITULO_ZERADA = "Empresa zerada (sem movimento) — sem guias/impostos; enviamos apenas obrigações zeradas";
