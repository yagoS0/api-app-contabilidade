// Cronograma RFB atualizado em 03/07/2026, documentado em docs/fontes-fiscais.md.
// Alíquotas efetivas futuras são parâmetros do cenário, não taxas legais presumidas.
export const TRANSICAO = [
  { ano: 2027, legado: 1, ibsLegalPct: 0.1 }, { ano: 2028, legado: 1, ibsLegalPct: 0.1 },
  { ano: 2029, legado: 0.9 }, { ano: 2030, legado: 0.8 }, { ano: 2031, legado: 0.7 },
  { ano: 2032, legado: 0.6 }, { ano: 2033, legado: 0 },
];
const numero = v => v == null || v === "" || !Number.isFinite(Number(v)) || Number(v) < 0 ? null : Number(v);
export function projetarTransicao(valores = {}) {
  return TRANSICAO.map(t => {
    const v = valores[t.ano] || {};
    const receita = numero(v.receita); const cbsPct = numero(v.cbsPct); const ibsPct = t.ibsLegalPct ?? numero(v.ibsPct);
    const creditosCbs = numero(v.creditosCbs); const creditosIbs = numero(v.creditosIbs);
    const issAtual = t.legado === 0 ? 0 : numero(v.issAtual);
    const completa = [receita, cbsPct, ibsPct, creditosCbs, creditosIbs, issAtual].every(x => x != null) && cbsPct <= 100 && ibsPct <= 100;
    if (!completa) return { ...t, incompleta: true, total: null };
    const debitoCbs = receita * cbsPct / 100; const debitoIbs = receita * ibsPct / 100;
    const cbs = Math.max(0, debitoCbs - creditosCbs); const ibs = Math.max(0, debitoIbs - creditosIbs); const iss = issAtual * t.legado;
    return { ...t, receita, cbsPct, ibsPct, creditosCbs, creditosIbs, debitoCbs, debitoIbs, cbs, ibs, iss, total: cbs + ibs + iss,
      creditoExcedenteCbs: Math.max(0, creditosCbs - debitoCbs), creditoExcedenteIbs: Math.max(0, creditosIbs - debitoIbs) };
  });
}
