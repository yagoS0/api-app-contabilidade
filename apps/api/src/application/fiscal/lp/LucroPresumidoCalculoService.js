// Módulo Fiscal M2 — cálculo do Lucro Presumido a partir das NOTAS + reconciliação
// contra o débito real da DCTFWeb.
//
// IMPORTANTE (decisão do contador): a PROVISÃO usa o valor real da DCTFWeb (LucroPresumidoProvisaoService).
// Este serviço é a RECONCILIAÇÃO — um CHECK/ALERTA: calcula o esperado (receita × presunção)
// e compara com o débito da declaração. Diverge → alerta (nunca bloqueia a provisão automática).
//
// Presunção padrão Lei 9.249/95 (confirmada com o contador):
//   Serviços em geral: IRPJ 32% / CSLL 32%
//   Comércio/indústria (mercadorias): IRPJ 8% / CSLL 12%
// Casos especiais (transporte, hospitalar, combustível) NÃO cobertos nesta v1 — sinalizar.
// PIS/COFINS cumulativo: 0,65% / 3% sobre a receita bruta.
// IRPJ 15% + adicional 10% sobre o que exceder R$ 60.000 no TRIMESTRE. CSLL 9%.
// PIS/COFINS são MENSAIS; IRPJ/CSLL só fecham no último mês do trimestre (mar/jun/set/dez).

import { prisma } from "../../../infrastructure/db/prisma.js";

const PRESUNCAO = {
  SERVICOS: { irpj: 0.32, csll: 0.32 },
  MERCADORIAS: { irpj: 0.08, csll: 0.12 },
};
const ALIQ = { irpj: 0.15, irpjAdicional: 0.10, adicionalLimiteTrimestral: 60000, csll: 0.09, pis: 0.0065, cofins: 0.03 };

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function rangeMes(competencia) {
  const [y, m] = competencia.split("-").map(Number);
  return { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) };
}

// Receita EMIT autorizada de um mês, separada por natureza (NFS-e = serviço, NF-e = mercadoria).
async function receitaDoMes(portalClientId, competencia) {
  const { gte, lt } = rangeMes(competencia);
  const notas = await prisma.portalInvoice.findMany({
    where: { clientId: portalClientId, papel: "EMIT", statusEfetivo: "autorizada", competencia: { gte, lt } },
    select: { type: true, total: true },
  });
  let servicos = 0, mercadorias = 0;
  for (const n of notas) {
    const v = Number(n.total) || 0;
    if (String(n.type).toUpperCase() === "NFSE") servicos += v;
    else mercadorias += v;
  }
  return { servicos: r2(servicos), mercadorias: r2(mercadorias), total: r2(servicos + mercadorias) };
}

// Meses do trimestre a que a competência pertence (só usado no fechamento trimestral).
function mesesDoTrimestre(competencia) {
  const [y, m] = competencia.split("-").map(Number);
  const q = Math.floor((m - 1) / 3); // 0..3
  const first = q * 3 + 1;
  return [0, 1, 2].map((i) => `${y}-${String(first + i).padStart(2, "0")}`);
}
function isFimDeTrimestre(competencia) {
  const m = Number(competencia.split("-")[1]);
  return [3, 6, 9, 12].includes(m);
}

/**
 * Calcula os tributos esperados do LP para a competência (a partir das notas).
 * @returns {{ competencia, receita, pis, cofins, irpj, csll, trimestre?, observacoes:[] }}
 */
export async function calcularLp({ portalClientId, competencia }) {
  if (!/^\d{4}-\d{2}$/.test(String(competencia || ""))) throw new Error("competência YYYY-MM obrigatória");
  const observacoes = [];

  const receita = await receitaDoMes(portalClientId, competencia);
  // PIS/COFINS — mensais, sobre a receita bruta total.
  const pis = r2(receita.total * ALIQ.pis);
  const cofins = r2(receita.total * ALIQ.cofins);

  let irpj = null, csll = null, trimestre = null;
  if (isFimDeTrimestre(competencia)) {
    // Fechamento trimestral: soma a receita dos 3 meses do trimestre.
    const meses = mesesDoTrimestre(competencia);
    const receitasTri = await Promise.all(meses.map((c) => receitaDoMes(portalClientId, c)));
    const servTri = r2(receitasTri.reduce((s, r) => s + r.servicos, 0));
    const mercTri = r2(receitasTri.reduce((s, r) => s + r.mercadorias, 0));
    const baseIrpj = r2(servTri * PRESUNCAO.SERVICOS.irpj + mercTri * PRESUNCAO.MERCADORIAS.irpj);
    const baseCsll = r2(servTri * PRESUNCAO.SERVICOS.csll + mercTri * PRESUNCAO.MERCADORIAS.csll);
    const irpjNormal = r2(baseIrpj * ALIQ.irpj);
    const adicional = r2(Math.max(0, baseIrpj - ALIQ.adicionalLimiteTrimestral) * ALIQ.irpjAdicional);
    irpj = { base: baseIrpj, normal: irpjNormal, adicional, total: r2(irpjNormal + adicional) };
    csll = { base: baseCsll, total: r2(baseCsll * ALIQ.csll) };
    trimestre = { meses, receitaServicos: servTri, receitaMercadorias: mercTri };
    if (mercTri > 0) observacoes.push("Há receita de mercadorias — presunção 8%/12% aplicada; confira casos especiais (transporte/hospitalar/combustível não cobertos).");
  }

  return {
    competencia, receita,
    presuncao: PRESUNCAO,
    pis, cofins, irpj, csll, trimestre,
    observacoes,
  };
}

// Compara um valor calculado com o débito da DCTFWeb; tolera 2% (arredondamentos/exclusões).
function conferir(calculado, dctfweb) {
  if (dctfweb == null) return { calculado: r2(calculado), dctfweb: null, status: "sem_dctfweb" };
  const c = r2(calculado), d = r2(dctfweb);
  const dif = r2(Math.abs(c - d));
  const tol = Math.max(0.02, d * 0.02);
  return { calculado: c, dctfweb: d, diferenca: dif, status: dif <= tol ? "ok" : "divergente" };
}

/**
 * Reconcilia o calculado × o débito da DCTFWeb (por tributo).
 * @param {Object} opts.debitosDctfweb  { PIS, COFINS, IRPJ, CSLL } (principal) — ex.: da declaração parseada
 */
export async function reconciliarLp({ portalClientId, competencia, debitosDctfweb = {} }) {
  const calc = await calcularLp({ portalClientId, competencia });
  const rec = {
    PIS: conferir(calc.pis, debitosDctfweb.PIS),
    COFINS: conferir(calc.cofins, debitosDctfweb.COFINS),
  };
  if (calc.irpj) rec.IRPJ = conferir(calc.irpj.total, debitosDctfweb.IRPJ);
  if (calc.csll) rec.CSLL = conferir(calc.csll.total, debitosDctfweb.CSLL);

  // Reconciliação reversa (alerta): receita implícita pelo PIS/COFINS × receita das notas.
  const receitaPorPis = debitosDctfweb.PIS != null ? r2(debitosDctfweb.PIS / ALIQ.pis) : null;
  const receitaPorCofins = debitosDctfweb.COFINS != null ? r2(debitosDctfweb.COFINS / ALIQ.cofins) : null;

  const algumaDivergencia = Object.values(rec).some((r) => r.status === "divergente");
  return {
    ...calc,
    reconciliacao: rec,
    receitaImplicita: { porPis: receitaPorPis, porCofins: receitaPorCofins, dasNotas: calc.receita.total },
    alerta: algumaDivergencia,
  };
}

export { PRESUNCAO, ALIQ };
