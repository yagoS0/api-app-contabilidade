// O que impede o fechamento contábil de uma competência — cálculo PURO, sobre lançamentos já
// carregados.
//
// Existia só dentro de `validateFechamentoContabil` (routes/firm/accountingEntries.js), que faz a
// própria query por empresa. A visão de carteira precisa da mesma resposta para dezenas de empresas
// de uma vez, com UMA query — e uma segunda cópia desta regra é a última coisa que este projeto
// pode ter: as duas telas passariam a discordar sobre se a empresa pode fechar, com o contador no
// meio.
//
// As três regras (e por que elas são assim):
//
//  1. **Lançamento em branco ou com conta vazia bloqueia.** Não dá pra fechar um mês com lançamento
//     que não diz para onde vai.
//  2. **D≠C bloqueia — mas não por lançamento em todo caso.** Parcelamento (Q24) e folha/pró-labore
//     (Q52) nascem como lançamentos de UMA perna que só balanceiam em conjunto; validar cada um
//     isoladamente acusaria erro em lançamento correto. Por isso agrupam por `parcelamentoId` /
//     `loteImportacao`. Conta vazia continua sendo checada lançamento a lançamento, inclusive neles.
//  3. **`tipo="PARCELA"` fica de fora.** É linha leve de rastreio, sem linhas D/C — quem chama já
//     deve tê-la excluído da query; a guarda aqui é redundância barata.

// Checklist de conferência do mês (Q47 + Lote C). Chave da API → coluna do banco. A ordem é a que
// aparece na tela. Mora aqui pelo mesmo motivo dos bloqueios: a aba Lançamentos e a visão de
// carteira precisam responder a MESMA coisa sobre "o que falta confirmar".
export const CHECKLIST_FECHAMENTO = Object.freeze({
  folhaProlabore: { campo: "folhaProlaboreOk", label: "Folha/Pró-labore lançada" },
  despesas:       { campo: "despesasOk",       label: "Despesas lançadas" },
  receitas:       { campo: "receitasOk",       label: "Receitas lançadas" },
  provisoes:      { campo: "provisoesOk",      label: "Provisões lançadas" },
  pagamentos:     { campo: "pagamentosOk",     label: "Pagamentos lançados" },
});

export const CHECKLIST_SELECT = Object.freeze(
  Object.fromEntries(Object.values(CHECKLIST_FECHAMENTO).map((c) => [c.campo, true])),
);

/** Itens ainda não confirmados (`null`/`false`) — o que impede o fechamento pelo lado humano. */
export function checklistPendentes(circular) {
  return Object.entries(CHECKLIST_FECHAMENTO)
    .filter(([, c]) => circular?.[c.campo] !== true)
    .map(([chave, c]) => ({ chave, label: c.label }));
}

const ehFolhaEmLote = (e) => e.tipo === "FOLHA" && /^(FOLHA|PROLABORE)-/.test(String(e.loteImportacao || ""));

function somaDosLados(entries) {
  let totalD = 0;
  let totalC = 0;
  for (const e of entries) {
    for (const l of e.lines || []) {
      if (String(l.tipo).toUpperCase() === "D") totalD += Number(l.valor || 0);
      else if (String(l.tipo).toUpperCase() === "C") totalC += Number(l.valor || 0);
    }
  }
  return { totalD, totalC };
}

/**
 * @param {Array} entries lançamentos da competência, com `lines` carregadas
 * @param {string} competencia usada só nos bloqueios de GRUPO, que não pertencem a um lançamento
 * @returns {{ok: boolean, blockers: Array, totalEntries: number}}
 */
export function computeFechamentoBlockers(entries, competencia) {
  const lista = (entries || []).filter((e) => String(e.tipo || "").toUpperCase() !== "PARCELA");
  const blockers = [];
  const parcByGroup = new Map();
  const folhaByGroup = new Map();

  for (const e of lista) {
    const lines = e.lines || [];
    if (e.parcelamentoId || ehFolhaEmLote(e)) {
      const groups = e.parcelamentoId ? parcByGroup : folhaByGroup;
      const groupKey = e.parcelamentoId || e.loteImportacao;
      if (!groups.has(groupKey)) groups.set(groupKey, []);
      groups.get(groupKey).push(e);
      if (lines.length === 0) {
        blockers.push({ entryId: e.id, competencia: e.competencia, historico: e.historico, motivo: "em_branco" });
      } else if (lines.some((l) => !String(l.conta || "").trim())) {
        blockers.push({ entryId: e.id, competencia: e.competencia, historico: e.historico, motivo: "conta_em_branco" });
      }
      continue;
    }
    if (lines.length === 0) {
      blockers.push({ entryId: e.id, competencia: e.competencia, historico: e.historico, motivo: "em_branco" });
      continue;
    }
    if (lines.some((l) => !String(l.conta || "").trim())) {
      blockers.push({ entryId: e.id, competencia: e.competencia, historico: e.historico, motivo: "conta_em_branco" });
      continue;
    }
    const { totalD, totalC } = somaDosLados([e]);
    if (Math.abs(totalD - totalC) > 0.01) {
      blockers.push({ entryId: e.id, competencia: e.competencia, historico: e.historico, motivo: "desbalanceado", totalD, totalC });
    }
  }

  for (const [parcelamentoId, grupo] of parcByGroup) {
    const { totalD, totalC } = somaDosLados(grupo);
    if (Math.abs(totalD - totalC) > 0.01) {
      blockers.push({ parcelamentoId, competencia, historico: grupo[0]?.historico || "Parcelamento", motivo: "parcelamento_desbalanceado", totalD, totalC });
    }
  }
  for (const [loteImportacao, grupo] of folhaByGroup) {
    const { totalD, totalC } = somaDosLados(grupo);
    if (Math.abs(totalD - totalC) > 0.01) {
      blockers.push({ loteImportacao, competencia, historico: grupo[0]?.historico || "Folha/Pró-labore", motivo: "folha_desbalanceada", totalD, totalC });
    }
  }

  return { ok: blockers.length === 0, blockers, totalEntries: lista.length };
}

/** Campos mínimos para `computeFechamentoBlockers` — evita arrastar a linha inteira da carteira. */
export const SELECT_PARA_BLOQUEIOS = Object.freeze({
  id: true,
  portalClientId: true,
  competencia: true,
  tipo: true,
  historico: true,
  parcelamentoId: true,
  loteImportacao: true,
  lines: { select: { conta: true, tipo: true, valor: true } },
});
