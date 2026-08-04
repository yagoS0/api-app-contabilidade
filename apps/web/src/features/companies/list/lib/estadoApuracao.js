// O PIPELINE DO MÊS — quatro estados, uma fonte só.
//
// POR QUE ESTE ARQUIVO EXISTE
// A mesma pergunta ("como está o mês desta empresa?") era respondida em quatro lugares com quatro
// cálculos diferentes: o chip da coluna Status, os chips de filtro do topo, os segmentos da barra de
// progresso e o peso da ordenação. Quatro cópias divergem — e divergiram: dava para a barra dizer
// "2 prontas" enquanto a coluna mostrava outra coisa na mesma tela.
//
// Aqui é UM enum. Coluna, filtro, barra e ordenação são três representações DELE, nunca cálculos
// paralelos.
//
//   ⚠ problema  →  ○ falta apurar  →  ☑ falta fechar  →  🔒 fechada
//
// ⚠ "FALTA APURAR" É CINZA, E ISSO NÃO É DETALHE. No começo do mês quase toda a carteira está nesse
// estado; em âmbar, a tela inteira alerta e a exceção some. Cor forte só para o que precisa de ação
// agora — e "ainda não chegou a vez" não precisa.

export const APURACAO = {
  problema: {
    chave: "problema",
    rotulo: "Problema",
    icone: "⚠",
    cor: "var(--state-danger)",
    fundo: "var(--state-danger-surface)",
    severidade: 0,
    ajuda: "Lançamento com problema — bloqueia o fechamento",
  },
  fechar: {
    chave: "fechar",
    rotulo: "Falta fechar",
    icone: "☑",
    cor: "var(--state-warn)",
    fundo: "var(--state-warn-surface)",
    severidade: 1,
    ajuda: "Apurada — falta concluir o fechamento do mês",
  },
  apurar: {
    chave: "apurar",
    rotulo: "Falta apurar",
    icone: "○",
    cor: "var(--state-neutral)",
    fundo: "var(--state-neutral-surface)",
    severidade: 2,
    ajuda: "Estado natural do começo do mês",
  },
  fechada: {
    chave: "fechada",
    rotulo: "Fechada",
    icone: "🔒",
    cor: "var(--state-closed)",
    fundo: "var(--state-closed-surface)",
    severidade: 3,
    ajuda: "Mês fechado",
  },
};

/** Ordem de leitura — do que trava ao que já acabou. É ela que ordena os chips e a barra. */
export const ORDEM_APURACAO = ["problema", "fechar", "apurar", "fechada"];

/**
 * O estado do mês para UMA empresa.
 *
 * @param {object} company linha de `GET /firm/companies`
 * @param {object} trava   linha de `GET /firm/companies/fechamento` (pode faltar)
 */
export function estadoApuracao(company, trava) {
  // Fechada VENCE tudo: é terminal. Mostrar "falta apurar" numa empresa já fechada seria apontar
  // trabalho onde não há — mesmo que o check-list dela tenha ficado incompleto no caminho.
  if (trava?.fechado || company?.fechamentoContabil?.fechado) return APURACAO.fechada;

  // Lançamento em branco ou débito ≠ crédito. É o único que trava de verdade, e por isso é o único
  // vermelho desta coluna.
  if (trava?.blockers?.length > 0) return APURACAO.problema;

  // ⚠ SÓ VAI PARA "FALTA FECHAR" COM PROVA DE QUE APUROU.
  //
  // Apuração é ato FISCAL (PGDAS-D transmitido); fechamento é contábil, e `podeFechar` fala só do
  // contábil. Usá-lo como sinal de apuração fazia toda a carteira nascer em "Falta fechar" —
  // âmbar — no dia 1 do mês: o paredão que este redesign existe para derrubar, agora em outra cor.
  // Sem `apurada: true` explícito, o honesto é o estado padrão: ainda não apurou.
  if (company?.apuracao?.apurada) return APURACAO.fechar;

  return APURACAO.apurar;
}

/** O que falta para fechar, em texto — vira o tooltip do chip "Falta fechar". */
export function detalheApuracao(estado, trava) {
  if (estado.chave === "problema") {
    const n = trava?.blockers?.length || 0;
    return `${n} lançamento(s) com problema — corrija antes de fechar`;
  }
  if (estado.chave === "fechar") {
    // ⚠ `checklistPendentes` devolve OBJETOS `{ chave, label }` (ver `fechamentoBlockers.js`), não
    // strings. Um `join` direto imprimia "[object Object] · [object Object]" no tooltip. O fallback
    // aceita as duas formas para o dia em que o backend simplificar o contrato.
    const pend = (trava?.checklistPendentes || []).map((p) => (typeof p === "string" ? p : p?.label || p?.chave)).filter(Boolean);
    return pend.length
      ? `Falta no check-list: ${pend.join(" · ")}`
      : "Check-list completo — pronta para fechar";
  }
  return estado.ajuda;
}

/** Contagem por estado para a barra de progresso e os chips de filtro — a MESMA leitura da coluna. */
export function contarApuracao(companies, travas) {
  const base = { problema: 0, fechar: 0, apurar: 0, fechada: 0, total: 0 };
  for (const c of companies || []) {
    const estado = estadoApuracao(c, travas?.get?.(c.companyId));
    base[estado.chave] += 1;
    base.total += 1;
  }
  return base;
}
