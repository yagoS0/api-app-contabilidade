// Módulo Fiscal M2 — provisão do Lucro Presumido POR TRIBUTO, a partir da declaração DCTFWeb.
//
// Decisão do contador: a provisão usa o VALOR ORIGINAL (principal) extraído da declaração
// (parseDctfwebDeclaracao), lançado SEPARADAMENTE por tributo (PIS, COFINS, CSLL, IRPJ).
// A guia (DARF) que vier depois com juros/multa é OUTRA tratativa (na baixa).
//
// Reuso: cria uma guia consolidada (tipo OUTRA) com composição = principal por código e
// delega ao generateProvisionsFromGuide, que já gera 1 lançamento PROVISAO por tributo
// (eventType via código: 8109→PIS, 2172→COFINS, 2089→IRPJ, 2372→CSLL) com contas via
// histórico (PENDENTE até o contador preencher). Idempotente por sourceFileId + (guia,evento).

import { prisma } from "../../../infrastructure/db/prisma.js";
import { generateProvisionsFromGuide } from "../../accounting/GuideToProvisionService.js";
import { gravarAcrescimoCircular } from "../circularAcrescimos.js";
import { consultarDeclaracaoCompletaLp } from "../serpro/SerproDctfwebService.js";

// Código de receita → chave do tributo na circular.acrescimos.
const CODIGO_TRIBUTO = { "8109": "PIS", "2172": "COFINS", "2089": "IRPJ", "2372": "CSLL" };

const onlyDigits = (v) => String(v || "").replace(/\D+/g, "");
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Cria/atualiza a guia LP (composição = principal por código) e gera a provisão por tributo.
 *
 * @param {Object} opts
 * @param {string} opts.portalClientId
 * @param {string} opts.competencia  YYYY-MM
 * @param {string} opts.cnpj
 * @param {Array}  opts.debitos      saída de parseDctfwebDeclaracao().debitos
 *                                   ({ codigoReceita, tributo, descricao, debitoApurado })
 * @param {string|Date|null} [opts.vencimento]
 * @param {number|null} [opts.darfTotal]  total do DARF (com juros/multa), se já emitido — só p/ guide.valor
 * @param {string|null} [opts.numeroRecibo]
 */
export async function provisionarLpDaDeclaracao({
  portalClientId,
  competencia,
  cnpj,
  debitos,
  vencimento = null,
  darfTotal = null,
  numeroRecibo = null,
}) {
  if (!portalClientId) throw new Error("portalClientId obrigatório");
  if (!/^\d{4}-\d{2}$/.test(String(competencia || ""))) throw new Error("competência YYYY-MM obrigatória");

  const composicao = (Array.isArray(debitos) ? debitos : [])
    .filter((d) => Number(d?.debitoApurado) > 0)
    .map((d) => ({
      codigo: onlyDigits(d.codigoReceita).slice(0, 4),
      total: round2(d.debitoApurado), // PRINCIPAL — a provisão usa o valor original
      denominacao: d.descricao || d.tributo || null,
    }));

  if (!composicao.length) return { ok: true, skipped: "sem_debitos", provisao: null };

  const principalTotal = round2(composicao.reduce((s, c) => s + c.total, 0));
  const sourceFileId = `serpro:dctfweb:lp:${onlyDigits(cnpj)}:${competencia}`;
  const extracted = {
    integrationSource: "SERPRO_DCTFWEB_LP",
    sistema: "DCTFWEB",
    servico: "CONSDECCOMPLETA33",
    numeroRecibo: numeroRecibo || null,
    principalTotal,
    composicao,
  };

  const guide = await prisma.guide.upsert({
    where: { sourceFileId },
    create: {
      portalClientId,
      competencia,
      tipo: "OUTRA", // DARF consolidado LP; a composição direciona o tributo de cada provisão
      valor: round2(darfTotal ?? principalTotal),
      valorOriginal: principalTotal, // imutável em recálculos
      vencimento: vencimento ? new Date(vencimento) : null,
      cnpj: onlyDigits(cnpj) || null,
      source: "SERPRO",
      sourceFileId,
      status: "PROCESSED",
      paymentStatus: "OPEN",
      extracted,
    },
    update: {
      // valorOriginal NÃO é reescrito (preserva o principal da 1ª captura).
      valor: round2(darfTotal ?? principalTotal),
      ...(vencimento ? { vencimento: new Date(vencimento) } : {}),
      status: "PROCESSED",
      extracted,
    },
  });

  const provisao = await generateProvisionsFromGuide({ guideId: guide.id });

  // Frente B: grava o split por tributo na circular (principal; juros/multa=0 na apuração —
  // o acréscimo entra depois, quando o DARF é emitido após o vencimento).
  const valores = {};
  for (const c of composicao) {
    const t = CODIGO_TRIBUTO[c.codigo];
    if (t) valores[t] = { principal: c.total, juros: 0, multa: 0 };
  }
  if (Object.keys(valores).length) {
    // garante a circular da competência (LP pode não ter uma ainda) pra segurar os acréscimos.
    await prisma.companyMonthlyCircular.upsert({
      where: { portalClientId_competencia: { portalClientId, competencia } },
      create: { portalClientId, competencia },
      update: {},
    }).catch(() => {});
    await gravarAcrescimoCircular({ client: prisma, portalClientId, competencia, valores }).catch(() => {});
  }

  return { ok: true, guideId: guide.id, principalTotal, composicao, provisao };
}

/**
 * Captura o Lucro Presumido de uma competência: consulta a Declaração Completa DCTFWeb,
 * parseia os débitos (principal por código) e gera a provisão por tributo + o split na circular.
 * @param {Object} opts { portalClientId, competencia }
 */
export async function capturarLpDaCompetencia({ portalClientId, competencia }) {
  const pc = await prisma.portalClient.findUnique({ where: { id: portalClientId }, select: { cnpj: true } });
  if (!pc) {
    const e = new Error("portal_company_not_found");
    e.code = "PORTAL_COMPANY_NOT_FOUND";
    throw e;
  }
  const decl = await consultarDeclaracaoCompletaLp({ contribuinteCnpj: pc.cnpj, competencia });
  const provisao = await provisionarLpDaDeclaracao({
    portalClientId,
    competencia,
    cnpj: pc.cnpj,
    debitos: decl.debitos,
    numeroRecibo: decl.cabecalho?.numeroRecibo,
  });
  return { ok: true, cabecalho: decl.cabecalho, debitos: decl.debitos, totais: decl.totais, provisao };
}
