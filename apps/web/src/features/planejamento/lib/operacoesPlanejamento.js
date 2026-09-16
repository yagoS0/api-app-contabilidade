import { TRANSICAO } from "./transicaoReforma";
export const numero = v => v == null || v === "" || typeof v === "boolean" || !Number.isFinite(Number(v)) || Number(v) < 0 ? null : Number(v);
export const somar = valores => valores.some(v => v == null || !Number.isFinite(v)) ? null : valores.reduce((s, v) => s + v, 0);
export const dinheiro = v => v == null ? null : Math.round((v + Number.EPSILON) * 100) / 100;
const taxa = v => numero(v) != null && numero(v) <= 100 ? numero(v) : null;
export const TRIBUTOS_OPERACAO = ["ICMS", "ICMS-ST", "DIFAL", "IPI", "PIS", "Cofins"];

// Bases finais informadas: MVA, gross-up, enquadramento e benefícios não são inferidos.
export function calcularOperacoes(linhas = []) {
  const operacoes = linhas.map((l, i) => {
    const base = numero(l.base), aliquota = taxa(l.aliquota), reducao = taxa(l.reducao ?? 0);
    const credito = numero(l.credito ?? 0), fcpPct = taxa(l.fcpPct ?? 0);
    const proprio = l.tributo === "ICMS-ST" ? numero(l.icmsProprio) : 0;
    const interestadual = l.tributo === "DIFAL" ? taxa(l.interestadualPct) : 0;
    const pendencia = !TRIBUTOS_OPERACAO.includes(l.tributo) ? "Selecione o tributo."
      : !["SIMPLES_NACIONAL", "LUCRO_PRESUMIDO", "LUCRO_REAL"].includes(l.regime) ? "Selecione o regime desta operação."
      : !/^2026-(0[1-9]|1[0-2])$/.test(l.competencia || "") ? "Informe a competência de 2026."
      : [base, aliquota, reducao, credito, fcpPct, proprio, interestadual].some(v => v == null) ? "Confira bases, créditos e alíquotas (0 a 100%)."
      : reducao > 0 && !l.fundamento?.trim() ? "Registre o fundamento da redução de base."
      : !l.conferida ? "Confira a incidência, a base final e o direito ao crédito desta operação." : null;
    if (pendencia) return { ...l, indice: i + 1, total: null, pendencia };
    const baseEfetiva = base * (1 - reducao / 100);
    const debito = baseEfetiva * (l.tributo === "DIFAL" ? Math.max(0, aliquota - interestadual) : aliquota) / 100;
    const deducao = proprio + credito;
    const imposto = Math.max(0, debito - deducao);
    const fcp = ["DIFAL", "ICMS-ST"].includes(l.tributo) ? baseEfetiva * fcpPct / 100 : 0;
    return { ...l, indice: i + 1, baseEfetiva, aliquota, debito, deducao, imposto, fcp,
      creditoExcedente: Math.max(0, credito - Math.max(0, debito - proprio)), total: dinheiro(imposto + fcp), pendencia: null };
  });
  const regimes = [...new Set(linhas.map(l => l.regime))];
  return { operacoes, total: linhas.length && regimes.length === 1 ? somar(operacoes.map(l => l.total)) : null,
    totaisPorRegime: Object.fromEntries(regimes.filter(Boolean).map(r => [r, somar(operacoes.filter(l => l.regime === r).map(l => l.total))])),
    subtotalConhecido: dinheiro(operacoes.reduce((s, l) => s + (l.total ?? 0), 0)),
    premissa: "Memória por operação e regime, com bases finais e créditos conferidos. Não somar regimes alternativos. A base final já deve considerar MVA, cálculo por dentro e regras da UF quando aplicáveis. Crédito excedente não reduz FCP e não é transferido entre tributos. Não altera os cards anuais." };
}

export function calcularReformaOperacoes(value = {}) {
  const ano = Number(value.ano || 2027), etapa = TRANSICAO.find(t => t.ano === ano);
  if (!etapa) return { ano, total: null, pendencias: ["Escolha um ano de 2027 a 2033."], operacoes: [], creditos: [] };
  const operacoes = (value.operacoes || []).map((l, i) => {
    const base = numero(l.base), cbsPct = taxa(l.cbsPct), ibsPct = etapa.ibsLegalPct ?? taxa(l.ibsPct);
    const reducao = taxa(l.reducao ?? 0);
    const legado = etapa.legado ? numero(l.legado) : 0;
    const pendencia = [base, cbsPct, ibsPct, reducao, legado].some(x => x == null) ? "Preencha base, taxas e ICMS/ISS atual."
      : reducao > 0 && !l.fundamento?.trim() ? "Identifique o fundamento da redução."
      : !l.conferida ? "Confira o enquadramento e as taxas desta operação." : null;
    return { ...l, indice: i + 1, cbsPct, ibsPct, pendencia,
      cbs: pendencia ? null : dinheiro(base * cbsPct / 100 * (1 - reducao / 100)),
      ibs: pendencia ? null : dinheiro(base * ibsPct / 100 * (1 - reducao / 100)),
      legado: pendencia ? null : dinheiro(legado * etapa.legado) };
  });
  const creditos = (value.creditos || []).map((l, i) => {
    const cbs = numero(l.cbs), ibs = numero(l.ibs);
    const pendencia = !l.fornecedor?.trim() || !l.documento?.trim() ? "Identifique fornecedor e documento."
      : cbs == null || ibs == null ? "Informe créditos de CBS e IBS separadamente, inclusive zero."
      : !l.conferido ? "Confirme a elegibilidade e a disponibilidade do crédito." : null;
    return { ...l, indice: i + 1, cbs, ibs, pendencia };
  });
  const repetidos = new Set();
  for (const l of creditos) {
    const chave = `${l.fornecedor?.trim().toLowerCase()}|${l.documento?.trim().toLowerCase()}`;
    if (repetidos.has(chave)) l.pendencia = "Documento repetido para este fornecedor.";
    repetidos.add(chave);
  }
  const pendencias = [...operacoes, ...creditos].filter(l => l.pendencia).map(l => `${l.indice}: ${l.pendencia}`);
  if (!operacoes.length) pendencias.push("Adicione ao menos uma operação.");
  if (!value.creditosConferidos) pendencias.push("Confirme que a lista de créditos está completa, inclusive quando não houver créditos.");
  const debitoCbs = somar(operacoes.map(l => l.cbs)), debitoIbs = somar(operacoes.map(l => l.ibs));
  const creditoCbs = somar(creditos.map(l => l.cbs)), creditoIbs = somar(creditos.map(l => l.ibs));
  const cbs = pendencias.length ? null : dinheiro(Math.max(0, debitoCbs - creditoCbs));
  const ibs = pendencias.length ? null : dinheiro(Math.max(0, debitoIbs - creditoIbs));
  const legado = somar(operacoes.map(l => l.legado));
  return { ano, operacoes, creditos, pendencias, debitoCbs, debitoIbs, creditoCbs, creditoIbs, cbs, ibs, legado,
    excedenteCbs: pendencias.length ? null : dinheiro(Math.max(0, creditoCbs - debitoCbs)),
    excedenteIbs: pendencias.length ? null : dinheiro(Math.max(0, creditoIbs - debitoIbs)),
    total: pendencias.length ? null : dinheiro(cbs + ibs + legado),
    premissa: "Subtotal de consumo no regime regular. Taxas efetivas futuras e reduções são premissas conferidas; créditos por documento não são inferidos das despesas. Regimes específicos exigem sua própria base final. ICMS/ISS seguem o cronograma de transição. Não inclui IPI, IRPJ, CSLL ou folha, nem calcula DAS." };
}
