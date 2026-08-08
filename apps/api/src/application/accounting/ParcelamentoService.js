// Q9: serviço de Parcelamentos (Simples Nacional, INSS, DARF, OUTRO).
//
// Operações:
//   - createParcelamento: gera cabeçalho + 1 entry de ABERTURA + N entries de provisão de parcela
//   - linkGuideToParcela: associa uma Guide existente a uma parcela específica
//   - confirmParcelaPayment: gera baixa(s) da parcela usando template + juros do mês
//   - rescindirParcelamento: gera entry de RESCISÃO + marca status RESCINDIDO
//   - listParcelamentos / getParcelamento: consultas

import { prisma } from "../../infrastructure/db/prisma.js";
import { applyTemplate, formatCompetenciaLabel, lookupAccountsFromHistorico } from "./AccountingEntryGeneratorService.js";
import { normalizeCompetencia } from "../guides/guideContract.js";
import { avaliarRiscoRescisao } from "./parcelamento/riscoRescisao.js";
import { parcelaQuitada } from "./parcelamento/recalculoParcelamento.js";
import { tipoLinhaDaBaixa } from "./tipoLinhaBaixa.js";

// Q16: contas D/C do parcelamento começam EM BRANCO e são memorizadas por papel de
// linha (igual às guias do Simples). A memória usa AccountingHistorico keyed por
// (empresa, eventType) onde eventType = `PARC_<KIND>_<ROLE>#<ordem>`. NÃO persistimos
// esse eventType no AccountingEntry (pra não colidir com o unique
// [portalClientId, competencia, eventType, origem]) — ele é derivado no read/write.

function parcLineEventType({ kind, role, ordem }) {
  return `PARC_${String(kind).toUpperCase()}_${role}#${ordem}`;
}

// Resolve a conta memorizada pra uma linha (D→contaDebito, C→contaCredito); "" se nunca preenchida.
async function lookupLineConta(tx, { portalClientId, kind, role, ordem, tipo }) {
  const eventType = parcLineEventType({ kind, role, ordem });
  const r = await lookupAccountsFromHistorico(tx, { portalClientId, eventType });
  const conta = String(tipo).toUpperCase() === "D" ? r.debitAccountCode : r.creditAccountCode;
  return conta || "";
}

// Deriva o papel (role) de um entry de parcelamento pra fins de memória.
//  - abertura  → "OPEN"
//  - baixa com "juros" no histórico → "PAY_JUROS"; senão → "PAY_PRINCIPAL"
function deriveParcRole({ entry, parcelamento }) {
  if (parcelamento.aberturaEntryId && entry.id === parcelamento.aberturaEntryId) return "OPEN";
  if (String(entry.tipo).toUpperCase() === "BAIXA") {
    return /juros/i.test(entry.historico || "") ? "PAY_JUROS" : "PAY_PRINCIPAL";
  }
  return null;
}

/**
 * Q16: memoriza as contas D/C preenchidas pelo contador num entry de parcelamento,
 * por papel de linha. Chamado pelo auto-save do PUT /entries quando o entry pertence a
 * um parcelamento. Próxima abertura/baixa da mesma empresa (mesmo kind) auto-preenche.
 * Best-effort — falha aqui nunca derruba o save.
 */
export async function memorizeParcelamentoLineAccounts({ userId, portalClientId, entry }) {
  if (!entry?.parcelamentoId || !Array.isArray(entry.lines) || entry.lines.length === 0) return;
  const parc = await prisma.parcelamento.findUnique({
    where: { id: entry.parcelamentoId },
    select: { id: true, kind: true, aberturaEntryId: true },
  });
  if (!parc) return;
  const role = deriveParcRole({ entry, parcelamento: parc });
  if (!role) return;

  for (const ln of entry.lines) {
    const conta = String(ln.conta || "").trim();
    if (!conta) continue;
    const isD = String(ln.tipo).toUpperCase() === "D";
    const eventType = parcLineEventType({ kind: parc.kind, role, ordem: ln.ordem });
    const existing = await prisma.accountingHistorico.findFirst({
      where: { companyPortalClientId: portalClientId, eventType },
    });
    if (existing) {
      await prisma.accountingHistorico.update({
        where: { id: existing.id },
        data: {
          contaDebito: isD ? conta : existing.contaDebito,
          contaCredito: isD ? existing.contaCredito : conta,
          usageCount: existing.usageCount + 1,
          updatedAt: new Date(),
        },
      });
    } else {
      await prisma.accountingHistorico.create({
        data: {
          createdByUserId: userId || null,
          companyPortalClientId: portalClientId,
          text: entry.historico || eventType,
          eventType,
          contaDebito: isD ? conta : null,
          contaCredito: isD ? null : conta,
        },
      });
    }
  }
}

// Resolve o template OPENING quando o id não veio explícito: prefere global do kind.
async function resolveOpeningTemplate(tx, { templateOpeningFunctionId, kind, portalClientId }) {
  if (templateOpeningFunctionId) {
    return tx.accountingFunction.findUnique({
      where: { id: templateOpeningFunctionId },
      include: { entries: { include: { lines: { orderBy: { ordem: "asc" } } }, orderBy: { ordem: "asc" } } },
    });
  }
  // Fallback: template OPENING do kind (empresa primeiro, depois global).
  return tx.accountingFunction.findFirst({
    where: {
      kind: "PARCELAMENTO_OPENING",
      OR: [{ portalClientId }, { portalClientId: null }],
    },
    include: { entries: { include: { lines: { orderBy: { ordem: "asc" } } }, orderBy: { ordem: "asc" } } },
    orderBy: [{ portalClientId: "desc" }],
  });
}

function addMonths(competenciaInicial, n) {
  // competenciaInicial = YYYY-MM, n = offset (0 = mesma competência)
  const [yyyy, mm] = String(competenciaInicial).split("-").map(Number);
  if (!yyyy || !mm) return competenciaInicial;
  const date = new Date(Date.UTC(yyyy, mm - 1 + n, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function buildDateOfMonth(competencia, dayOfMonth) {
  const [yyyy, mm] = String(competencia).split("-").map(Number);
  if (!yyyy || !mm) return new Date();
  // Se dia não existir (ex: 31 em fev), usa último dia.
  const lastDay = new Date(Date.UTC(yyyy, mm, 0)).getUTCDate();
  const day = Math.min(Math.max(Number(dayOfMonth) || 1, 1), lastDay);
  return new Date(Date.UTC(yyyy, mm - 1, day, 12, 0, 0));
}

function buildContext({ competencia, company, parcelamento, numeroParcela }) {
  return {
    competencia,
    competenciaLabel: formatCompetenciaLabel(competencia),
    companyName: company?.razao || "",
    cnpj: company?.cnpj || "",
    numeroParcela: numeroParcela != null ? numeroParcela : null,
    numParcelas: parcelamento?.numParcelas != null ? parcelamento.numParcelas : null,
    numEntradas: parcelamento?.numEntradas != null ? parcelamento.numEntradas : null,
    numParcelasRestantes: parcelamento && parcelamento.numParcelas != null && parcelamento.numEntradas != null
      ? parcelamento.numParcelas - parcelamento.numEntradas
      : null,
    periodosReferenciados: parcelamento?.periodosReferenciados || "",
  };
}

/**
 * Cria parcelamento + 1 entry de abertura + N entries de provisão de parcela.
 * Se sourceGuideId vier, linka a guia à parcela `linkGuideAsParcelaNum` (default 1 = entrada).
 */
export async function createParcelamento({
  portalClientId, label, kind,
  templateOpeningFunctionId, templatePaymentFunctionId, templateRescisionFunctionId,
  numEntradas = 0, numParcelas,
  principalPerParcela, principalTotal, jurosTotal,
  dataAbertura, competenciaInicial, diaPagamento = 1, periodosReferenciados,
  sourceGuideId, linkGuideAsParcelaNum,
  userId,
}) {
  if (!portalClientId) throw new Error("portal_client_id_required");
  if (!label) throw new Error("label_required");
  if (!kind) throw new Error("kind_required");
  if (!numParcelas || numParcelas < 1) throw new Error("num_parcelas_invalid");
  const normCompetencia = normalizeCompetencia(competenciaInicial);
  if (!normCompetencia) throw new Error("competencia_inicial_invalid");
  const principal = Number(principalPerParcela);
  if (!Number.isFinite(principal) || principal <= 0) throw new Error("principal_per_parcela_invalid");

  const computedPrincipalTotal = Number.isFinite(Number(principalTotal))
    ? Number(principalTotal)
    : null;
  const computedJurosTotal = Number.isFinite(Number(jurosTotal)) ? Number(jurosTotal) : 0;
  // totalValue: prioriza principalTotal+juros (caso abertura tenha juros RFB); fallback = N * principalPerParcela
  const totalValue = computedPrincipalTotal != null
    ? computedPrincipalTotal + computedJurosTotal
    : numParcelas * principal;

  return prisma.$transaction(async (tx) => {
    const company = await tx.portalClient.findUnique({
      where: { id: portalClientId },
      select: { id: true, razao: true, cnpj: true },
    });
    if (!company) throw new Error("company_not_found");

    // 1) Cria cabeçalho
    const parcelamento = await tx.parcelamento.create({
      data: {
        portalClientId, label, kind,
        templateOpeningFunctionId: templateOpeningFunctionId || null,
        templatePaymentFunctionId: templatePaymentFunctionId || null,
        templateRescisionFunctionId: templateRescisionFunctionId || null,
        numEntradas, numParcelas,
        principalPerParcela: principal,
        principalTotal: computedPrincipalTotal,
        jurosTotal: computedJurosTotal,
        totalValue,
        dataAbertura: dataAbertura ? new Date(dataAbertura) : null,
        competenciaInicial: normCompetencia,
        diaPagamento,
        periodosReferenciados: periodosReferenciados || null,
        createdByUserId: userId || null,
      },
    });

    // 2) Gera o ÚNICO entry de provisão da dívida: a ABERTURA (D principal + D juros = C total).
    //    Obrigatória. Contas D/C começam EM BRANCO e vêm da memória por papel de linha
    //    (PARC_<KIND>_OPEN#<ordem>) — preenchidas automaticamente após a 1ª vez (Q16).
    const openingTpl = await resolveOpeningTemplate(tx, {
      templateOpeningFunctionId, kind, portalClientId,
    });
    if (!openingTpl?.entries?.length) throw new Error("opening_template_required");

    // principalTotal sempre definido: deriva do total − juros quando não informado.
    const openPrincipalTotal = computedPrincipalTotal != null
      ? computedPrincipalTotal
      : Math.max(0, totalValue - computedJurosTotal);
    const openTotalValue = openPrincipalTotal + computedJurosTotal;

    const tplEntry = openingTpl.entries[0]; // abertura é sempre 1 entry
    const openCtx = buildContext({ competencia: normCompetencia, company, parcelamento, numeroParcela: null });
    const openHistorico = applyTemplate(tplEntry.historico, openCtx);
    const openData = dataAbertura ? new Date(dataAbertura) : buildDateOfMonth(normCompetencia, diaPagamento);

    // ordem 0 = D principal, ordem 1 = D juros, ordem 2 = C total (convenção do seed).
    const dLines = tplEntry.lines.filter((l) => l.tipo === "D");
    const aberturaLines = [];
    for (const ln of tplEntry.lines) {
      let valor;
      if (ln.tipo === "C") {
        valor = openTotalValue;
      } else {
        const idxD = dLines.findIndex((l) => l.id === ln.id);
        valor = idxD === 0 ? openPrincipalTotal : computedJurosTotal;
      }
      const conta = await lookupLineConta(tx, {
        portalClientId, kind, role: "OPEN", ordem: ln.ordem, tipo: ln.tipo,
      });
      aberturaLines.push({ conta, tipo: ln.tipo, valor: Number(valor) || 0, ordem: ln.ordem });
    }

    const aberturaEntry = await tx.accountingEntry.create({
      data: {
        portalClientId,
        parcelamentoId: parcelamento.id,
        numeroParcela: null, // abertura não é parcela numerada
        data: openData,
        competencia: normCompetencia,
        historico: openHistorico,
        tipo: tplEntry.tipo, // PROVISAO
        // O tipo vem do TEMPLATE: é PROVISAO nos seeds, mas uma função de abertura customizada
        // pode trazer BAIXA, e aí o CHECK `chk_baixa_tipo_linha` cobra o papel.
        tipoLinha: tipoLinhaDaBaixa(tplEntry.tipo),
        subtipo: tplEntry.subtipo || null,
        origem: "MANUAL",
        loteImportacao: `PARC-${parcelamento.id.slice(0, 8)}-ABERTURA`,
        status: "RASCUNHO",
        statusPagamento: "NA", // a dívida é provisionada aqui; baixas vão contra ela
        sourceGuideId: sourceGuideId || null,
        lines: { createMany: { data: aberturaLines } },
      },
    });

    // Atualiza cabeçalho: FK da abertura + valores efetivos da dívida.
    await tx.parcelamento.update({
      where: { id: parcelamento.id },
      data: {
        aberturaEntryId: aberturaEntry.id,
        principalTotal: openPrincipalTotal,
        totalValue: openTotalValue,
      },
    });

    // 3) Gera N LINHAS LEVES de parcela (só rastreio — SEM lançamento contábil).
    //    tipo="PARCELA" + sem lines ⇒ zero impacto em somas/export; serve à UI
    //    (aguardando guia / em aberto / pago). A dívida já foi provisionada na abertura.
    for (let i = 1; i <= numParcelas; i++) {
      const competencia = addMonths(normCompetencia, i - 1);
      const data = buildDateOfMonth(competencia, diaPagamento);
      const isEntrada = numEntradas > 0 && i <= numEntradas;
      const historico = `${isEntrada ? "ENTRADA" : "PARCELA"} ${label} ${String(i).padStart(2, "0")}/${numParcelas} - ${competencia}`;
      const shouldLinkGuide = sourceGuideId && linkGuideAsParcelaNum === i;
      await tx.accountingEntry.create({
        data: {
          portalClientId,
          parcelamentoId: parcelamento.id,
          numeroParcela: i,
          data,
          competencia,
          historico,
          tipo: "PARCELA", // marcador de rastreio (não é provisão/baixa)
          subtipo: `PARC_${kind}`,
          origem: "MANUAL",
          loteImportacao: `PARC-${parcelamento.id.slice(0, 8)}`,
          status: "RASCUNHO",
          statusPagamento: "ABERTO",
          sourceGuideId: shouldLinkGuide ? sourceGuideId : null,
          // sem lines — rastreio puro
        },
      });
    }

    // 4) Se houver guia + número de parcela, linka a guia ao parcelamento
    if (sourceGuideId && linkGuideAsParcelaNum) {
      await tx.guide.update({
        where: { id: sourceGuideId },
        data: { parcelamentoId: parcelamento.id, numeroParcela: linkGuideAsParcelaNum },
      });
    }

    return tx.parcelamento.findUnique({
      where: { id: parcelamento.id },
      include: {
        aberturaEntry: { include: { lines: true } },
        parcelas: { where: { tipo: "PARCELA" }, orderBy: { numeroParcela: "asc" }, include: { lines: true } },
        guides: true,
      },
    });
  });
}

/**
 * Associa uma Guide existente a uma parcela específica.
 *
 * Q11.3 (reforço): se a guia já tinha gerado provisão automática via
 * GuideToProvisionService (caso comum: contador sobe guia → entry de provisão é criada
 * imediatamente; só DEPOIS o contador linka ao parcelamento), apaga essas entries pra
 * evitar provisão duplicada. A provisão correta é a que foi criada no createParcelamento.
 *
 * Não toca em entries de outras origens (manuais, baixas etc).
 */
export async function linkGuideToParcela({ portalClientId, guideId, parcelamentoId, numeroParcela }) {
  const parc = await prisma.parcelamento.findFirst({
    where: { id: parcelamentoId, portalClientId },
  });
  if (!parc) throw new Error("parcelamento_not_found");
  if (numeroParcela < 1 || numeroParcela > parc.numParcelas) {
    throw new Error("numero_parcela_out_of_range");
  }
  const guide = await prisma.guide.findFirst({
    where: { id: guideId, portalClientId },
  });
  if (!guide) throw new Error("guide_not_found");

  return prisma.$transaction(async (tx) => {
    // 1) Linka a guia ao parcelamento + número da parcela
    const updated = await tx.guide.update({
      where: { id: guideId },
      data: { parcelamentoId, numeroParcela },
    });

    // 2) Apaga entries de provisão que possam ter sido auto-criadas por GuideToProvisionService
    // pra essa guia. Filtro: sourceGuideId = guideId AND NÃO pertence a esse parcelamento
    // (entries do parcelamento têm parcelamentoId setado e não vêm com sourceGuideId).
    const deletable = await tx.accountingEntry.findMany({
      where: {
        sourceGuideId: guideId,
        parcelamentoId: null,
        status: { not: "EXPORTADO" }, // não apaga se já foi exportado pro contábil
      },
      select: { id: true },
    });
    if (deletable.length > 0) {
      await tx.accountingEntry.deleteMany({
        where: { id: { in: deletable.map((e) => e.id) } },
      });
    }

    return updated;
  });
}

/**
 * Confirma pagamento de uma parcela.
 * Usa template PARCELAMENTO_PAYMENT (2 entries: principal + juros). Principal vem fixo
 * de parc.principalPerParcela; juros vem do input. Se juros=0, só cria a baixa do principal.
 * Cria entries de BAIXA com openEntryId apontando para a provisão da parcela.
 */
export async function confirmParcelaPayment({
  portalClientId, parcelamentoId, numeroParcela,
  jurosValor = 0, dataPagamento, userId,
}) {
  const parc = await prisma.parcelamento.findFirst({
    where: { id: parcelamentoId, portalClientId },
    include: {
      templatePayment: { include: { entries: { include: { lines: { orderBy: { ordem: "asc" } } }, orderBy: { ordem: "asc" } } } },
      parcelas: { where: { numeroParcela, tipo: "PARCELA" }, include: { lines: true } },
      portalClient: { select: { razao: true, cnpj: true } },
    },
  });
  if (!parc) throw new Error("parcelamento_not_found");
  if (parc.status !== "ATIVO") throw new Error("parcelamento_not_active");
  const provEntry = parc.parcelas[0];
  if (!provEntry) throw new Error("parcela_not_found");
  if (provEntry.statusPagamento === "PAGO") throw new Error("parcela_already_paid");
  if (!parc.templatePayment) throw new Error("payment_template_not_configured");

  const principal = Number(parc.principalPerParcela);
  const juros = Number(jurosValor) || 0;
  const dataPgto = dataPagamento ? new Date(dataPagamento) : new Date();
  const ctx = buildContext({
    competencia: provEntry.competencia,
    company: parc.portalClient,
    parcelamento: parc,
    numeroParcela,
  });

  return prisma.$transaction(async (tx) => {
    const createdBaixas = [];

    for (const tplEntry of parc.templatePayment.entries) {
      // Decide se é a entry de "principal" ou "juros" pelo texto/ordem
      const isJurosEntry = /juros/i.test(tplEntry.historico);
      const valor = isJurosEntry ? juros : principal;

      // Pula a baixa de juros se juros == 0
      if (isJurosEntry && valor <= 0) continue;

      const historico = applyTemplate(tplEntry.historico, ctx);
      const role = isJurosEntry ? "PAY_JUROS" : "PAY_PRINCIPAL";
      // Contas D/C em branco na 1ª vez; memorizadas por papel de linha (Q16).
      const baixaLines = [];
      for (const ln of tplEntry.lines) {
        const conta = await lookupLineConta(tx, {
          portalClientId, kind: parc.kind, role, ordem: ln.ordem, tipo: ln.tipo,
        });
        baixaLines.push({ conta, tipo: ln.tipo, valor, ordem: ln.ordem });
      }

      const baixa = await tx.accountingEntry.create({
        data: {
          portalClientId,
          parcelamentoId: parc.id,
          numeroParcela,
          data: dataPgto,
          competencia: provEntry.competencia,
          historico,
          tipo: "BAIXA",
          // O papel já era decidido acima (`isJurosEntry`, que também escolhe o valor e a memória
          // de contas PAY_JUROS/PAY_PRINCIPAL) — aqui ele só sobe para a coluna que o CHECK
          // `chk_baixa_tipo_linha` cobra. Sem `sourceGuideId`, estas linhas ficam fora do índice.
          tipoLinha: isJurosEntry ? "JUROS" : "PRINCIPAL",
          subtipo: tplEntry.subtipo || provEntry.subtipo,
          origem: "MANUAL",
          loteImportacao: `PARC-${parc.id.slice(0, 8)}-PAGTO-${String(numeroParcela).padStart(2, "0")}`,
          status: "RASCUNHO",
          statusPagamento: "NA",
          // openEntryId aponta pra LINHA DA PARCELA (rastreio) — é o vínculo de auditoria
          // "baixa desta parcela". A redução da dívida é o próprio lançamento D=553/C=caixa.
          openEntryId: provEntry.id,
          lines: { createMany: { data: baixaLines } },
        },
      });
      createdBaixas.push(baixa);
    }

    // Marca provisão como PAGA
    await tx.accountingEntry.update({
      where: { id: provEntry.id },
      data: { statusPagamento: "PAGO" },
    });

    // Verifica se TODAS as parcelas estão pagas → marca parcelamento como QUITADO
    const remaining = await tx.accountingEntry.count({
      where: {
        parcelamentoId: parc.id,
        tipo: "PARCELA", // só linhas de rastreio contam pra QUITADO (não baixas/abertura)
        numeroParcela: { not: null },
        statusPagamento: { not: "PAGO" },
      },
    });
    if (remaining === 0) {
      await tx.parcelamento.update({
        where: { id: parc.id },
        data: { status: "QUITADO" },
      });
    }

    return { ok: true, baixas: createdBaixas, parcelaPaga: numeroParcela };
  });
}

/**
 * Rescinde parcelamento: gera entry de RESCISÃO + marca status RESCINDIDO.
 * Valores remanescentes (parcelas ainda em aberto) são computados automaticamente.
 */
export async function rescindirParcelamento({ portalClientId, parcelamentoId, dataRescisao, observacoes, rescisaoLines, userId }) {
  const parc = await prisma.parcelamento.findFirst({
    where: { id: parcelamentoId, portalClientId },
    include: {
      templateRescision: { include: { entries: { include: { lines: { orderBy: { ordem: "asc" } } }, orderBy: { ordem: "asc" } } } },
      parcelas: { where: { tipo: "PARCELA" }, include: { lines: true } },
      aberturaEntry: { include: { lines: { orderBy: { ordem: "asc" } } } },
      portalClient: { select: { razao: true, cnpj: true } },
    },
  });
  if (!parc) throw new Error("parcelamento_not_found");
  if (parc.status !== "ATIVO") throw new Error("parcelamento_not_active");

  let historico;
  let lines;
  let tipoEntry = "PROVISAO";
  let subtipoEntry = null;
  let totalRemanescente = 0;
  let parcelasAbertasCount = 0;

  // Q31: rescisão com linhas vindas do modal (estorno reverso editável). 1 lançamento por linha (single-leg).
  const customLines = Array.isArray(rescisaoLines) && rescisaoLines.length > 0;

  if (customLines) {
    historico = `RESCISÃO ${parc.tipo || parc.kind || ""}${parc.numeroParcelamento ? ` Nº ${parc.numeroParcelamento}` : ""}`.trim();
    subtipoEntry = `PARC_${parc.tipo || "OUTRO"}`;
    lines = rescisaoLines
      .filter((l) => String(l.conta || "").trim() || Number(l.valor))
      .map((l, i) => ({
        conta: String(l.conta || "").trim(),
        tipo: String(l.tipo).toUpperCase() === "C" ? "C" : "D",
        valor: Number(l.valor) || 0,
        ordem: i,
        tipoLinha: l.tipoLinha || null,
        codigoTributo: l.codigoTributo || null,
      }));
    totalRemanescente = lines.filter((l) => l.tipo === "D").reduce((s, l) => s + l.valor, 0);
  } else if (parc.templateRescision) {
    // Q16 (legado, com template): remanescente = parcelas ABERTAS x principal + juros proporcional.
    const parcelasAbertas = parc.parcelas.filter((p) => p.statusPagamento === "ABERTO" && p.numeroParcela != null);
    parcelasAbertasCount = parcelasAbertas.length;
    const principalRemanescente = parcelasAbertas.length * Number(parc.principalPerParcela);
    const jurosRemanescente = parc.jurosTotal && parc.numParcelas
      ? Number(parc.jurosTotal) * (parcelasAbertas.length / parc.numParcelas)
      : 0;
    totalRemanescente = principalRemanescente + jurosRemanescente;

    const tplEntry = parc.templateRescision.entries[0];
    tipoEntry = tplEntry.tipo;
    subtipoEntry = tplEntry.subtipo || null;
    const ctx = buildContext({ competencia: parc.competenciaInicial, company: parc.portalClient, parcelamento: parc, numeroParcela: null });
    historico = applyTemplate(tplEntry.historico, ctx);
    lines = tplEntry.lines.map((ln) => {
      let valor;
      if (ln.tipo === "C") {
        valor = totalRemanescente;
      } else {
        const dLines = tplEntry.lines.filter((l) => l.tipo === "D");
        const idxD = dLines.findIndex((l) => l.id === ln.id);
        valor = idxD === 0 ? principalRemanescente : jurosRemanescente;
      }
      return { conta: ln.conta || "", tipo: ln.tipo, valor: Number(valor) || 0, ordem: ln.ordem };
    });
  } else {
    // Q24 — parcelamento v2 (sem template): ESTORNA a provisão invertendo D↔C de TODAS as suas
    // pernas (a provisão agora são N lançamentos individuais). Sem provisão → só marca RESCINDIDO.
    const provisaoEntries = await prisma.accountingEntry.findMany({
      where: { parcelamentoId: parc.id, tipo: "PROVISAO" },
      include: { lines: true },
    });
    const provLines = provisaoEntries.flatMap((e) => e.lines || []);
    if (provLines.length) {
      historico = `ESTORNO/RESCISÃO ${parc.tipo || parc.kind || ""}${parc.numeroParcelamento ? ` Nº ${parc.numeroParcelamento}` : ""}`.trim();
      subtipoEntry = `PARC_${parc.tipo || "OUTRO"}`;
      lines = provLines.map((ln, i) => ({
        conta: ln.conta || "",
        tipo: ln.tipo === "D" ? "C" : "D", // inverte pra estornar
        valor: Number(ln.valor) || 0,
        ordem: i,
        tipoLinha: ln.tipoLinha || null,
        codigoTributo: ln.codigoTributo || null,
      }));
      totalRemanescente = lines.filter((l) => l.tipo === "D").reduce((s, l) => s + l.valor, 0);
    } else {
      lines = [];
    }
  }

  const isV2 = customLines || !parc.templateRescision;
  const LABEL = { PARC: "parcelamento a pagar", PRINCIPAL: "principal", PARC_DAS: "principal", MULTA: "multa", JUROS: "juros", TOTAL: "total" };
  const dataEntry = dataRescisao ? new Date(dataRescisao) : new Date();
  const loteRescisao = `PARC-${parc.id.slice(0, 8)}-RESCISAO`;

  return prisma.$transaction(async (tx) => {
    let rescisaoEntry = null;
    if (lines && lines.length && isV2) {
      // Q24: estorno v2 = um lançamento individual por linha (1 perna). Balanço fecha no conjunto.
      const created = [];
      for (const ln of lines) {
        const label = LABEL[ln.tipoLinha] || (ln.tipo === "C" ? "crédito" : "débito");
        // eslint-disable-next-line no-await-in-loop
        const e = await tx.accountingEntry.create({
          data: {
            portalClientId, parcelamentoId: parc.id, numeroParcela: null,
            data: dataEntry, competencia: parc.competenciaInicial,
            historico: `${historico} — ${label}`,
            tipo: tipoEntry, subtipo: subtipoEntry, origem: "MANUAL",
            // `tipoEntry` vem do template de rescisão quando existe — pode ser BAIXA.
            tipoLinha: ln.tipoLinha || tipoLinhaDaBaixa(tipoEntry),
            codigoTributo: ln.codigoTributo || null,
            loteImportacao: loteRescisao,
            status: "RASCUNHO", statusPagamento: "NA",
            lines: { createMany: { data: [{ conta: ln.conta || "", tipo: ln.tipo, valor: Number(ln.valor) || 0, ordem: 0, tipoLinha: ln.tipoLinha || null, codigoTributo: ln.codigoTributo || null }] } },
          },
        });
        created.push(e);
      }
      rescisaoEntry = created[0] || null;
    } else if (lines && lines.length) {
      // Q16 (legado, com template): um único lançamento multi-linha.
      rescisaoEntry = await tx.accountingEntry.create({
        data: {
          portalClientId, parcelamentoId: parc.id, numeroParcela: null,
          data: dataEntry, competencia: parc.competenciaInicial,
          historico, tipo: tipoEntry, subtipo: subtipoEntry, origem: "MANUAL",
          tipoLinha: tipoLinhaDaBaixa(tipoEntry),
          loteImportacao: loteRescisao,
          status: "RASCUNHO", statusPagamento: "NA",
          lines: { createMany: { data: lines } },
        },
      });
    }

    await tx.parcelamento.update({
      where: { id: parc.id },
      data: {
        status: "RESCINDIDO",
        observacoes: observacoes || parc.observacoes,
      },
    });

    return { ok: true, rescisaoEntry, totalRemanescente, parcelasAbertas: parcelasAbertasCount };
  });
}

// Q16: enriquece o parcelamento com saldo/quanto-falta. Parcelas são linhas leves
// (tipo="PARCELA"); pagas = statusPagamento PAGO. Saldo = total − principais já baixados.
function decorateParcelamento(parc) {
  if (!parc) return parc;
  const parcelas = Array.isArray(parc.parcelas) ? parc.parcelas : [];
  const guides = Array.isArray(parc.guides) ? parc.guides : [];
  // Q24: v2 não usa linhas tipo=PARCELA — as parcelas são as guias vinculadas. Conta pagas pelas
  // guias baixadas/PAID quando não há linhas de rastreio (compat com o modelo Q16 legado).
  const isV2 = parcelas.length === 0 && guides.length > 0;
  const parcelasPagas = isV2
    ? guides.filter(parcelaQuitada).length
    : parcelas.filter((p) => p.statusPagamento === "PAGO").length;
  const principalPerParcela = Number(parc.principalPerParcela) || 0;
  const principalPago = parcelasPagas * principalPerParcela;
  const totalValue = Number(parc.totalValue) || 0;
  const saldoRestante = Math.max(0, totalValue - principalPago);

  // ⚠ RISCO DE RESCISÃO — a informação que muda o dia do contador. Rescindido, o saldo vai para a
  // Dívida Ativa e as reduções de multa da adesão são restabelecidas; e isso chega por acúmulo
  // silencioso, sem ninguém decidir nada.
  //
  // ⚠ DERIVA DE `vencimento` + PAGAMENTO, não de `parcelaEstado`. A coluna depende de um recálculo
  // periódico, e recálculo que não rodou mostraria "tudo em dia" justamente na empresa que está a
  // uma prestação da rescisão. Aqui não há como o dado envelhecer.
  //
  // ⚠ `quitada` inclui `baixada` de propósito: pagamento parcial NÃO quita a prestação, e quem
  // marca parcial não marca PAID. Parcelamento já rescindido não é avaliado — não há mais o que
  // prevenir.
  //
  // ⚠ O PREDICADO VEM DE FORA (`parcelaQuitada`, em `parcelamento/recalculoParcelamento.js`). Ele
  // estava escrito aqui, duas vezes, e o estorno precisava da MESMA resposta na hora de desfazer a
  // baixa. Uma terceira cópia faria a listagem e o estorno discordarem sobre quantas prestações
  // estão quitadas — que é o número de onde sai o alerta de rescisão.
  const risco = parc.status === "RESCINDIDO"
    ? null
    : avaliarRiscoRescisao({
      parcelas: guides.map((g) => ({
        numeroParcela: g.numeroParcela ?? null,
        vencimento: g.vencimento,
        quitada: parcelaQuitada(g),
      })),
    });

  return {
    ...parc,
    parcelasPagas,
    parcelasTotal: isV2 ? guides.length : parcelas.length,
    principalPago,
    saldoRestante,
    risco,
  };
}

/**
 * Lista parcelamentos da empresa com parcelas embedded.
 */
export async function listParcelamentos({ portalClientId, status }) {
  const rows = await prisma.parcelamento.findMany({
    where: { portalClientId, ...(status ? { status } : {}) },
    include: {
      aberturaEntry: { include: { lines: { orderBy: { ordem: "asc" } } } },
      parcelas: {
        where: { tipo: "PARCELA" },
        orderBy: { numeroParcela: "asc" },
        include: {
          lines: { orderBy: { ordem: "asc" } },
          baixas: { include: { lines: true } },
        },
      },
      // ⚠ `vencimento` é o que decide se uma parcela está EM ATRASO — sem ele o risco de rescisão
      // não tem como ser calculado e sairia como "não avaliável" em toda empresa.
      guides: { select: { id: true, numeroParcela: true, valor: true, paymentStatus: true, baixada: true, competencia: true, anoMesParcela: true, vencimento: true } },
      templateOpening: { select: { id: true, name: true } },
      templatePayment: { select: { id: true, name: true } },
      templateRescision: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(decorateParcelamento);
}

export async function getParcelamento({ portalClientId, parcelamentoId }) {
  const parc = await prisma.parcelamento.findFirst({
    where: { id: parcelamentoId, portalClientId },
    include: {
      aberturaEntry: { include: { lines: true } },
      parcelas: {
        where: { tipo: "PARCELA" },
        orderBy: { numeroParcela: "asc" },
        include: { lines: true, baixas: { include: { lines: true } } },
      },
      guides: true,
      templateOpening: true,
      templatePayment: true,
      templateRescision: true,
    },
  });
  return decorateParcelamento(parc);
}
