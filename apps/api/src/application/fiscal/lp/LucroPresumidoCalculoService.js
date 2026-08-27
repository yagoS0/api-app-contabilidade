// Módulo Fiscal M2 — cálculo do Lucro Presumido a partir das NOTAS + reconciliação
// contra o débito real da DCTFWeb.
//
// IMPORTANTE (decisão do contador): a PROVISÃO usa o valor real da DCTFWeb (LucroPresumidoProvisaoService).
// Este serviço é a RECONCILIAÇÃO — um CHECK/ALERTA: calcula o esperado (receita × presunção)
// e compara com o débito da declaração. Diverge → alerta (nunca bloqueia a provisão automática).
//
// ⚠⚠ A REGRA SAIU DAQUI EM 27/08/2026 e mora em `lib/apuracaoPresumido.js`, PURA e com teste
// próprio. Este arquivo carrega o Prisma no topo, e era por isso que a apuração do Presumido nunca
// teve um único teste em 44 dias de vida. O que sobrou aqui é o que só o banco sabe: **qual é a
// receita** e **qual é a DARF**. As presunções, as alíquotas, a regra dos R$ 120.000, a alíquota
// efetiva e os casos não cobertos (transporte, hospitalar, combustível) moram todos lá.
//
// ⚠ SÓ LEITURA, ZERO CHAMADA EXTERNA. Não fala com SERPRO, ADN nem SEFAZ: lê o que já está no
// banco. Quem gasta chamada paga é a captura ("Buscar tributos do Presumido"), não este cálculo.

import { prisma } from "../../../infrastructure/db/prisma.js";
import {
  PRESUNCAO, ALIQ, SERVICOS_16, TRIBUTOS_NAO_CALCULADOS,
  apurarPresumido, isFimDeTrimestre, mesesDoTrimestre, debitosPorTributo,
} from "./lib/apuracaoPresumido.js";

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

/**
 * A composição da DARF consolidada do LP daquela competência — a lista `{codigo, tributo, total}`
 * que `LucroPresumidoProvisaoService` grava em `Guide.extracted`.
 *
 * ⚠⚠ O RECORTE É O `sourceFileId`, NÃO `tipo: "OUTRA"`. A DARF do LP e a guia de INSS/DCTFWeb são
 * **as duas** `tipo: "OUTRA"` com `source: "SERPRO"` — filtrar por tipo traria a guia errada, e a
 * composição dela alimentaria o aviso de quota com um débito que não é de IRPJ/CSLL do Presumido.
 * O prefixo `serpro:dctfweb:lp:` é escrito num lugar só, na provisão.
 *
 * ⚠ Ausência devolve `[]`, e isso é honesto: "não há DARF capturada" não é "não há débito". Quem
 * lê isto é o aviso de quota, que só ACRESCENTA informação — ele nunca afirma ausência de débito.
 */
async function darfDoPresumido(portalClientId, competencia) {
  const guia = await prisma.guide.findFirst({
    where: {
      portalClientId,
      competencia,
      sourceFileId: { startsWith: "serpro:dctfweb:lp:", endsWith: `:${competencia}` },
    },
    select: { id: true, extracted: true, valor: true, vencimento: true, paymentStatus: true },
  });
  const extracted = guia?.extracted && typeof guia.extracted === "object" ? guia.extracted : {};
  return {
    // ⚠ `valor` é `Decimal` no Prisma: serializado cru ele vira objeto no JSON da rota.
    guia: guia
      ? {
        id: guia.id,
        valor: guia.valor == null ? null : r2(guia.valor),
        vencimento: guia.vencimento,
        paymentStatus: guia.paymentStatus,
      }
      : null,
    composicao: Array.isArray(extracted.composicao) ? extracted.composicao : [],
  };
}

/**
 * Calcula os tributos esperados do LP para a competência (a partir das notas).
 *
 * @param {Object} p
 * @param {string} p.portalClientId
 * @param {string} p.competencia         "YYYY-MM"
 * @param {boolean|null} [p.servicos16]  a confirmação do art. 15, § 4º. ⚠ `null` = não perguntado,
 *   e o resultado é o de sempre (32%). Ver `presuncaoIrpjDeServicos`.
 */
export async function calcularLp({ portalClientId, competencia, servicos16 = null }) {
  if (!/^\d{4}-\d{2}$/.test(String(competencia || ""))) throw new Error("competência YYYY-MM obrigatória");

  const receita = await receitaDoMes(portalClientId, competencia);

  // ⚠ As receitas do trimestre só são buscadas no mês que FECHA — nos outros a regra não as usa, e
  // ir ao banco por elas seriam três consultas para um resultado descartado.
  const receitasDoTrimestre = isFimDeTrimestre(competencia)
    ? await Promise.all(mesesDoTrimestre(competencia).map((c) => receitaDoMes(portalClientId, c)))
    : [];

  const { guia, composicao } = await darfDoPresumido(portalClientId, competencia);

  return {
    ...apurarPresumido({ competencia, receita, receitasDoTrimestre, servicos16, composicaoDaGuia: composicao }),
    guia,
    // ⚠ O que a DECLARAÇÃO diz, por tributo — é contra isto que `reconciliarLp` confere.
    debitosDaGuia: debitosPorTributo(composicao),
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
export async function reconciliarLp({ portalClientId, competencia, debitosDctfweb = null, servicos16 = null }) {
  const calc = await calcularLp({ portalClientId, competencia, servicos16 });

  // ⚠⚠ SEM `debitosDctfweb`, A DECLARAÇÃO JÁ CAPTURADA É A FONTE. Até 27/08/2026 o default era
  // `{}` e o único chamador era a própria captura, que os passa recém-parseados — ou seja, a
  // reconciliação era **inalcançável** por qualquer outro caminho: uma tela que a pedisse receberia
  // `sem_dctfweb` nos quatro tributos. A composição da guia É o débito declarado, por tributo.
  //
  // ⚠ Quem PASSA os débitos continua vencendo: na captura eles são mais frescos que a guia.
  const debitos = debitosDctfweb && Object.keys(debitosDctfweb).length ? debitosDctfweb : calc.debitosDaGuia;

  const rec = {
    PIS: conferir(calc.pis, debitos.PIS),
    COFINS: conferir(calc.cofins, debitos.COFINS),
  };
  if (calc.irpj) rec.IRPJ = conferir(calc.irpj.total, debitos.IRPJ);
  if (calc.csll) rec.CSLL = conferir(calc.csll.total, debitos.CSLL);

  // Reconciliação reversa (alerta): receita implícita pelo PIS/COFINS × receita das notas.
  const receitaPorPis = debitos.PIS != null ? r2(debitos.PIS / ALIQ.pis) : null;
  const receitaPorCofins = debitos.COFINS != null ? r2(debitos.COFINS / ALIQ.cofins) : null;

  const algumaDivergencia = Object.values(rec).some((r) => r.status === "divergente");
  return {
    ...calc,
    reconciliacao: rec,
    receitaImplicita: { porPis: receitaPorPis, porCofins: receitaPorCofins, dasNotas: calc.receita.total },
    alerta: algumaDivergencia,
  };
}

export { PRESUNCAO, ALIQ, SERVICOS_16, TRIBUTOS_NAO_CALCULADOS, isFimDeTrimestre, mesesDoTrimestre, debitosPorTributo };
