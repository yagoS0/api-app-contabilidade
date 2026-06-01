// Q9: serviço de Parcelamentos (Simples Nacional, INSS, DARF, OUTRO).
//
// Operações:
//   - createParcelamento: gera cabeçalho + 1 entry de ABERTURA + N entries de provisão de parcela
//   - linkGuideToParcela: associa uma Guide existente a uma parcela específica
//   - confirmParcelaPayment: gera baixa(s) da parcela usando template + juros do mês
//   - rescindirParcelamento: gera entry de RESCISÃO + marca status RESCINDIDO
//   - listParcelamentos / getParcelamento: consultas

import { prisma } from "../../infrastructure/db/prisma.js";
import { applyTemplate, formatCompetenciaLabel } from "./AccountingEntryGeneratorService.js";
import { normalizeCompetencia } from "../guides/guideContract.js";

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

    // 2) Gera entry de ABERTURA (usando template OPENING se houver)
    let aberturaEntry = null;
    if (templateOpeningFunctionId && computedPrincipalTotal != null) {
      const openingTpl = await tx.accountingFunction.findUnique({
        where: { id: templateOpeningFunctionId },
        include: { entries: { include: { lines: { orderBy: { ordem: "asc" } } }, orderBy: { ordem: "asc" } } },
      });
      if (openingTpl?.entries?.length) {
        const tplEntry = openingTpl.entries[0]; // abertura é sempre 1 entry
        const ctx = buildContext({
          competencia: normCompetencia,
          company,
          parcelamento,
          numeroParcela: null,
        });
        const historico = applyTemplate(tplEntry.historico, ctx);
        const data = dataAbertura ? new Date(dataAbertura) : buildDateOfMonth(normCompetencia, diaPagamento);

        // Mapeia ordem da linha → valor (convenção do seed Simples):
        //   ordem 0 = D principal (principalTotal)
        //   ordem 1 = D juros (jurosTotal)
        //   ordem 2 = C total (totalValue)
        // Para outros tipos: 1ª D = principal, 2ª D = juros (se houver), última C = total.
        const aberturaLines = tplEntry.lines.map((ln) => {
          let valor;
          if (ln.tipo === "C") {
            valor = totalValue;
          } else {
            // D — primeira é principal, segunda é juros
            const dLines = tplEntry.lines.filter((l) => l.tipo === "D");
            const idxD = dLines.findIndex((l) => l.id === ln.id);
            valor = idxD === 0 ? computedPrincipalTotal : computedJurosTotal;
          }
          return { conta: ln.conta || "", tipo: ln.tipo, valor: Number(valor) || 0, ordem: ln.ordem };
        });

        aberturaEntry = await tx.accountingEntry.create({
          data: {
            portalClientId,
            parcelamentoId: parcelamento.id,
            numeroParcela: null, // abertura não é parcela numerada
            data,
            competencia: normCompetencia,
            historico,
            tipo: tplEntry.tipo,
            subtipo: tplEntry.subtipo || null,
            origem: "MANUAL",
            loteImportacao: `PARC-${parcelamento.id.slice(0, 8)}-ABERTURA`,
            status: "RASCUNHO",
            statusPagamento: "NA", // abertura não é provisão pagável (provisão por parcela é separada)
            sourceGuideId: sourceGuideId || null,
            lines: { createMany: { data: aberturaLines } },
          },
        });

        // Update FK 1:1
        await tx.parcelamento.update({
          where: { id: parcelamento.id },
          data: { aberturaEntryId: aberturaEntry.id },
        });
      }
    }

    // 3) Gera N entries de provisão (1 por parcela)
    const paymentTpl = templatePaymentFunctionId
      ? await tx.accountingFunction.findUnique({
          where: { id: templatePaymentFunctionId },
          include: { entries: { include: { lines: { orderBy: { ordem: "asc" } } }, orderBy: { ordem: "asc" } } },
        })
      : null;

    for (let i = 1; i <= numParcelas; i++) {
      const competencia = addMonths(normCompetencia, i - 1);
      const data = buildDateOfMonth(competencia, diaPagamento);
      const ctx = buildContext({ competencia, company, parcelamento, numeroParcela: i });

      // Histórico padrão se template não fornecer
      let historico = `PROVISAO ${label} PARC ${String(i).padStart(2, "0")}/${numParcelas} - ${competencia}`;
      let lines = [
        { conta: "", tipo: "D", valor: principal, ordem: 0 },
        { conta: "", tipo: "C", valor: principal, ordem: 1 },
      ];

      // Se template de payment foi escolhido, usa a 1ª entry dele (principal) como provisão.
      // O template tem 2 entries: principal+juros — para provisão usamos só o principal.
      if (paymentTpl?.entries?.length) {
        const tplPrincipalEntry = paymentTpl.entries.find((e) => /PARC|principal/i.test(e.historico) || !/juros/i.test(e.historico)) || paymentTpl.entries[0];
        const provHistorico = tplPrincipalEntry.historico.replace(/^PAGO\s+/i, "PROVISAO ");
        historico = applyTemplate(provHistorico, ctx);
        lines = tplPrincipalEntry.lines.map((ln) => ({
          conta: ln.conta || "",
          tipo: ln.tipo,
          valor: principal,
          ordem: ln.ordem,
        }));
      }

      const subtipo = `PARC_${kind}`;
      const shouldLinkGuide = sourceGuideId && linkGuideAsParcelaNum === i;
      await tx.accountingEntry.create({
        data: {
          portalClientId,
          parcelamentoId: parcelamento.id,
          numeroParcela: i,
          data,
          competencia,
          historico,
          tipo: "PROVISAO",
          subtipo,
          origem: "MANUAL",
          loteImportacao: `PARC-${parcelamento.id.slice(0, 8)}`,
          status: "RASCUNHO",
          statusPagamento: "ABERTO",
          sourceGuideId: shouldLinkGuide ? sourceGuideId : null,
          lines: { createMany: { data: lines } },
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
        parcelas: { orderBy: { numeroParcela: "asc" }, include: { lines: true } },
        guides: true,
      },
    });
  });
}

/**
 * Associa uma Guide existente a uma parcela específica.
 * Não modifica entries — só seta Guide.parcelamentoId/numeroParcela.
 * UI deriva "viva" a partir disso (parcela com guia linkada == viva).
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

  return prisma.guide.update({
    where: { id: guideId },
    data: { parcelamentoId, numeroParcela },
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
      parcelas: { where: { numeroParcela }, include: { lines: true } },
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
      const baixaLines = tplEntry.lines.map((ln) => ({
        conta: ln.conta || "",
        tipo: ln.tipo,
        valor,
        ordem: ln.ordem,
      }));

      const baixa = await tx.accountingEntry.create({
        data: {
          portalClientId,
          parcelamentoId: parc.id,
          numeroParcela,
          data: dataPgto,
          competencia: provEntry.competencia,
          historico,
          tipo: "BAIXA",
          subtipo: tplEntry.subtipo || provEntry.subtipo,
          origem: "MANUAL",
          loteImportacao: `PARC-${parc.id.slice(0, 8)}-PAGTO-${String(numeroParcela).padStart(2, "0")}`,
          status: "RASCUNHO",
          statusPagamento: "NA",
          openEntryId: provEntry.id, // vincula BAIXA → PROVISAO
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
export async function rescindirParcelamento({ portalClientId, parcelamentoId, dataRescisao, observacoes, userId }) {
  const parc = await prisma.parcelamento.findFirst({
    where: { id: parcelamentoId, portalClientId },
    include: {
      templateRescision: { include: { entries: { include: { lines: { orderBy: { ordem: "asc" } } }, orderBy: { ordem: "asc" } } } },
      parcelas: { include: { lines: true } },
      portalClient: { select: { razao: true, cnpj: true } },
    },
  });
  if (!parc) throw new Error("parcelamento_not_found");
  if (parc.status !== "ATIVO") throw new Error("parcelamento_not_active");
  if (!parc.templateRescision) throw new Error("rescision_template_not_configured");

  // Computa remanescente: parcelas ABERTAS x principalPerParcela + saldo proporcional de juros
  const parcelasAbertas = parc.parcelas.filter((p) => p.statusPagamento === "ABERTO" && p.numeroParcela != null);
  const principalRemanescente = parcelasAbertas.length * Number(parc.principalPerParcela);
  const jurosRemanescente = parc.jurosTotal && parc.numParcelas
    ? Number(parc.jurosTotal) * (parcelasAbertas.length / parc.numParcelas)
    : 0;
  const totalRemanescente = principalRemanescente + jurosRemanescente;

  const tplEntry = parc.templateRescision.entries[0];
  const ctx = buildContext({
    competencia: parc.competenciaInicial,
    company: parc.portalClient,
    parcelamento: parc,
    numeroParcela: null,
  });
  const historico = applyTemplate(tplEntry.historico, ctx);
  const lines = tplEntry.lines.map((ln) => {
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

  return prisma.$transaction(async (tx) => {
    const rescisaoEntry = await tx.accountingEntry.create({
      data: {
        portalClientId,
        parcelamentoId: parc.id,
        numeroParcela: null,
        data: dataRescisao ? new Date(dataRescisao) : new Date(),
        competencia: parc.competenciaInicial,
        historico,
        tipo: tplEntry.tipo,
        subtipo: tplEntry.subtipo || null,
        origem: "MANUAL",
        loteImportacao: `PARC-${parc.id.slice(0, 8)}-RESCISAO`,
        status: "RASCUNHO",
        statusPagamento: "NA",
        lines: { createMany: { data: lines } },
      },
    });

    await tx.parcelamento.update({
      where: { id: parc.id },
      data: {
        status: "RESCINDIDO",
        observacoes: observacoes || parc.observacoes,
      },
    });

    return { ok: true, rescisaoEntry, totalRemanescente, parcelasAbertas: parcelasAbertas.length };
  });
}

/**
 * Lista parcelamentos da empresa com parcelas embedded.
 */
export async function listParcelamentos({ portalClientId, status }) {
  return prisma.parcelamento.findMany({
    where: { portalClientId, ...(status ? { status } : {}) },
    include: {
      aberturaEntry: { include: { lines: { orderBy: { ordem: "asc" } } } },
      parcelas: {
        orderBy: { numeroParcela: "asc" },
        include: {
          lines: { orderBy: { ordem: "asc" } },
          baixas: { include: { lines: true } },
        },
      },
      guides: { select: { id: true, numeroParcela: true, valor: true, paymentStatus: true } },
      templateOpening: { select: { id: true, name: true } },
      templatePayment: { select: { id: true, name: true } },
      templateRescision: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getParcelamento({ portalClientId, parcelamentoId }) {
  return prisma.parcelamento.findFirst({
    where: { id: parcelamentoId, portalClientId },
    include: {
      aberturaEntry: { include: { lines: true } },
      parcelas: {
        orderBy: { numeroParcela: "asc" },
        include: { lines: true, baixas: { include: { lines: true } } },
      },
      guides: true,
      templateOpening: true,
      templatePayment: true,
      templateRescision: true,
    },
  });
}
