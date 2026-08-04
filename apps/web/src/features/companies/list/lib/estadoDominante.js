// O ESTADO DOMINANTE de uma empresa no fechamento do mês — um chip só, por prioridade.
//
// POR QUE UMA FUNÇÃO SÓ
// O estado vem de DUAS fontes que não se conhecem: o agregado `/firm/companies/fechamento`
// (blockers, check-list, podeFechar, fechado) e o payload da própria empresa (`apuracao.apurada`,
// `empresaZerada`). Card e tabela precisam contar a MESMA história — duas cópias desta cascata
// divergiriam, e aí a mesma empresa apareceria de dois jeitos dependendo da visão.

export const ESTADOS_EMPRESA = {
  fechada:   { chave: "fechada",   rotulo: "Fechada",         icone: "🔒", cor: "var(--state-closed)",  fundo: "var(--state-closed-surface)" },
  pendencia: { chave: "pendencia", rotulo: "Pendência",       icone: "⚠",  cor: "var(--state-danger)",  fundo: "var(--state-danger-surface)" },
  checklist: { chave: "checklist", rotulo: "Falta check-list", icone: "☐",  cor: "var(--state-warn)",    fundo: "var(--state-warn-surface)" },
  apurar:    { chave: "apurar",    rotulo: "Falta apurar",    icone: "○",  cor: "var(--state-neutral)", fundo: "var(--state-neutral-surface)" },
  zerada:    { chave: "zerada",    rotulo: "Zerada",          icone: "◌",  cor: "var(--state-neutral)", fundo: "var(--state-neutral-surface)" },
  pronta:    { chave: "pronta",    rotulo: "Pronta p/ fechar", icone: "✅", cor: "var(--state-ok)",      fundo: "var(--state-ok-surface)" },
};

// Ordem de URGÊNCIA — é ela que ordena a lista por padrão. `fechada` fica por último de propósito:
// está fora do fluxo de trabalho, e o contador não deve tropeçar nela ao procurar o que falta.
export const ORDEM_URGENCIA = ["pendencia", "checklist", "apurar", "zerada", "pronta", "fechada"];

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
  if (trava?.checklistPendentes?.length > 0) return ESTADOS_EMPRESA.checklist;

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
