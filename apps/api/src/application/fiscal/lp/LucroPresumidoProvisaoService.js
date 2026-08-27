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
import { consultarDeclaracaoCompletaLp, emitirDarfDctfweb } from "../serpro/SerproDctfwebService.js";
import { reconciliarLp } from "./LucroPresumidoCalculoService.js";

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
      tributo: d.tributo || null, // PIS | COFINS | IRPJ | CSLL — identifica o lançamento por tributo
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
      // ⚠ SÓ NO `create`. A coluna é `String?` sem `@default`, e esta era a única guia do sistema
      // que nascia NULL — toda outra passa por `GuideService`, que grava "PENDING". O NULL fazia o
      // envio em lote pular a guia em silêncio (`IN` do SQL não casa com NULL).
      //
      // ⚠ E NUNCA no `update`: a recaptura do LP roda de novo sobre a mesma guia, e reescrever o
      // `emailStatus` aqui devolveria para "PENDING" uma guia já enviada — o contador reenviaria
      // o que o cliente já recebeu.
      emailStatus: "PENDING",
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
    const t = c.tributo || CODIGO_TRIBUTO[c.codigo]; // nome do extrato tem prioridade sobre o código
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
/**
 * Aplica na guia o que o DARF (`GERARGUIA31`) devolveu: valor, vencimento, PDF, nº do documento e
 * o acréscimo REAL por tributo (juros/multa — a declaração traz só o principal).
 *
 * ⚠ EXTRAÍDA de `capturarLpDaCompetencia` em 27/08/2026 para o RECÁLCULO reusá-la. Duas cópias
 * divergiriam, e a divergência sairia como guia com PDF novo e valor velho — ou o contrário.
 *
 * ⚠ `valorOriginal` NÃO é tocado, aqui nem lá: ele guarda o principal da PRIMEIRA captura, e é o
 * que permite comparar depois quanto de acréscimo entrou.
 */
async function aplicarDarfNaGuia({ portalClientId, competencia, guideId, darf }) {
  const g = await prisma.guide.findUnique({ where: { id: guideId }, select: { extracted: true } }).catch(() => null);
  const extractedAtual = g?.extracted && typeof g.extracted === "object" ? g.extracted : {};
  await prisma.guide.update({
    where: { id: guideId },
    data: {
      ...(darf.valor != null ? { valor: darf.valor } : {}),
      ...(darf.vencimento ? { vencimento: new Date(darf.vencimento) } : {}),
      // Anexa o PDF do DARF consolidado (GERARGUIA31) → guia baixável e enviável por e-mail.
      ...(darf.pdfBuffer ? { pdfBytes: darf.pdfBuffer } : {}),
      extracted: { ...extractedAtual, numeroDocumento: darf.numeroDocumento },
    },
  }).catch(() => {});
  const valores = {};
  for (const it of darf.composicao?.itens || []) {
    const t = CODIGO_TRIBUTO[String(it.codigo).replace(/\D+/g, "").slice(0, 4)];
    if (t) valores[t] = { principal: it.principal, juros: it.juros, multa: it.multa };
  }
  if (Object.keys(valores).length) {
    await gravarAcrescimoCircular({ client: prisma, portalClientId, competencia, valores }).catch(() => {});
  }
}

/**
 * ⚠⚠ REEMITIR A DARF DO PRESUMIDO — o "Recalcular" da guia do LP.
 *
 * UMA chamada paga (`GERARGUIA31`), não duas: a declaração (`CONSDECCOMPLETA33`) NÃO é consultada
 * de novo. Recalcular pede a GUIA outra vez; a apuração declarada não mudou.
 *
 * ⚠⚠ AQUI A FALHA NÃO É BEST-EFFORT. Na captura, o DARF é opcional — a provisão já aconteceu e o
 * fluxo segue. Aqui, emitir o DARF É a ação: engolir o erro devolveria "recalculado" sobre uma guia
 * que ninguém tocou, e o contador mandaria ao cliente a guia velha achando que é a nova.
 *
 * ⚠⚠ E NÃO ESTÁ CONFIRMADO que o `GERARGUIA31` devolva a DARF com juros e multa quando ela está
 * vencida — o PGDAS-D tem serviço próprio para isso (`GERARDASCOBRANCA17`); a DCTFWeb, até onde
 * este repositório sabe, tem um só. Por isso a `composicao` volta CRUA para quem chamou, e quem lê
 * o que ela diz é `leituraDosAcrescimos` — que tem três respostas, e nunca chama ilegível de
 * "sem acréscimos".
 */
export async function reemitirDarfLp({ portalClientId, competencia, guideId }) {
  const pc = await prisma.portalClient.findUnique({ where: { id: portalClientId }, select: { cnpj: true } });
  if (!pc?.cnpj) {
    const e = new Error("portal_company_not_found");
    e.code = "PORTAL_COMPANY_NOT_FOUND";
    throw e;
  }
  const darf = await emitirDarfDctfweb({ contribuinteCnpj: pc.cnpj, competencia });
  await aplicarDarfNaGuia({ portalClientId, competencia, guideId, darf });
  return {
    guideId,
    valor: darf.valor,
    vencimento: darf.vencimento,
    numeroDocumento: darf.numeroDocumento,
    // ⚠ CRUA, de propósito — a leitura dos acréscimos é regra, e mora em `lib/recalculoDaGuia.js`.
    composicao: darf.composicao,
  };
}

export async function capturarLpDaCompetencia({ portalClientId, competencia }) {
  const pc = await prisma.portalClient.findUnique({ where: { id: portalClientId }, select: { cnpj: true, companyId: true } });
  if (!pc) {
    const e = new Error("portal_company_not_found");
    e.code = "PORTAL_COMPANY_NOT_FOUND";
    throw e;
  }
  // Trava central de regime: Presumido/Real só. NUNCA rodar em empresa do Simples (traria a guia
  // INSS/DCTFWeb como "OUTRA"). Tampa o endpoint manual e qualquer caller futuro num único ponto.
  const legacy = pc.companyId
    ? await prisma.company.findUnique({ where: { id: pc.companyId }, select: { regimeTributario: true, tipoTributario: true } }).catch(() => null)
    : null;
  const regime = String(legacy?.regimeTributario || legacy?.tipoTributario || "").trim().toUpperCase();
  if (regime !== "LUCRO_PRESUMIDO" && regime !== "LUCRO_REAL") {
    const e = new Error(`Consulta do Lucro Presumido não se aplica a este regime (${regime || "indefinido"}).`);
    e.code = "REGIME_INVALIDO_LP";
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

  // Emite o DARF (guia a pagar) — dá o nº do documento (p/ confirmar pagamento via PAGTOWEB)
  // e os juros/multa REAIS (a declaração traz só o principal). Best-effort: se não emitir
  // (ex.: nada a pagar / já pago), a provisão já foi feita e o fluxo segue.
  let darf = null;
  try {
    darf = await emitirDarfDctfweb({ contribuinteCnpj: pc.cnpj, competencia });
  } catch { /* ignore */ }
  if (darf && provisao?.guideId) {
    await aplicarDarfNaGuia({ portalClientId, competencia, guideId: provisao.guideId, darf });
  }

  // Reconciliação (alerta, não bloqueia): calculado (notas × presunção) × débito da DCTFWeb.
  const CODIGO_TRIB = { "8109": "PIS", "2172": "COFINS", "2089": "IRPJ", "2372": "CSLL" };
  const debitosDctfweb = {};
  for (const d of decl.debitos || []) {
    const t = CODIGO_TRIB[String(d.codigoReceita).replace(/\D+/g, "").slice(0, 4)];
    if (t) debitosDctfweb[t] = d.debitoApurado;
  }
  const reconciliacao = await reconciliarLp({ portalClientId, competencia, debitosDctfweb }).catch(() => null);

  return { ok: true, cabecalho: decl.cabecalho, debitos: decl.debitos, totais: decl.totais, provisao, reconciliacao };
}
