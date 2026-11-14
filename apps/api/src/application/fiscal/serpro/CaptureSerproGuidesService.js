import { persistirDocumentoDasComGuias } from "../../../composition/persistenciaDocumentoDas.js";
import { interpretarRespostaDasComPdf } from "../../../composition/interpretacaoRespostaDas.js";
export { extractDocumentNumber, parsePossibleDate } from "../../../modules/fiscal/public.js";
import { prisma } from "../../../infrastructure/db/prisma.js";
import {
  toGuideResponse,
  PUBLICO,
} from "../../guides/GuideService.js";
import { generateEntriesFromCircular, FONTE_VALOR_GUIA } from "../../accounting/AccountingEntryGeneratorService.js";
import { parseArrecadacaoComposicao } from "./parseArrecadacao.js";
import { gravarAcrescimoCircular } from "../circularAcrescimos.js";
import { normalizeCompetencia, WHERE_GUIA_SEM_PARCELAMENTO } from "../../guides/guideContract.js";
import { getResolvedSerproCredentials } from "./SerproRuntimeSettings.js";
import { reutilizarGuia } from "./reutilizarGuia.js";
import { comContextoSerpro, contextoSerproAtual } from "./serproCallContext.js";
import {
  SerproPgdasdService,
  SERPRO_PGDASD_SERVICE_COBRANCA,
  SERPRO_PGDASD_SERVICE_NORMAL,
} from "./SerproPgdasdService.js";

function getCompetenciaDueDate(competencia) {
  const normalized = normalizeCompetencia(competencia);
  if (!normalized) return null;
  const match = normalized.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  if (!Number.isInteger(year) || !Number.isInteger(monthIndex)) return null;
  return new Date(Date.UTC(year, monthIndex + 1, 20, 23, 59, 59, 999));
}

function resolvePgdasdServiceId({ competencia, serviceId, now = new Date() }) {
  const explicit = String(serviceId || "").trim().toUpperCase();
  if (explicit) return explicit;
  const dueDate = getCompetenciaDueDate(competencia);
  if (dueDate && now.getTime() > dueDate.getTime()) {
    return SERPRO_PGDASD_SERVICE_COBRANCA;
  }
  return SERPRO_PGDASD_SERVICE_NORMAL;
}

function onlyDigits(value) {
  return String(value || "").replace(/\D+/g, "");
}

function buildGuideSourceFileId({ cnpj, competencia, numeroDocumento, serviceId }) {
  const doc = String(numeroDocumento || "sem-documento").replace(/[^a-zA-Z0-9_-]+/g, "");
  const service = String(serviceId || "sem-servico").replace(/[^a-zA-Z0-9_-]+/g, "");
  return `serpro:pgdasd:${service}:${onlyDigits(cnpj)}:${competencia}:${doc}`;
}

function mapGuideLabels(serviceId) {
  if (serviceId === SERPRO_PGDASD_SERVICE_COBRANCA) {
    return {
      sourcePath: "SERPRO PGDAS-D COBRANCA",
      checkResult: "FOUND_COBRANCA",
    };
  }
  return {
    sourcePath: "SERPRO PGDAS-D",
    checkResult: "FOUND_NORMAL",
  };
}

export async function capturePgdasGuideForCompany({
  portalClientId,
  competencia,
  contratanteCnpj,
  existingGuideId = null,
  serviceId = null,
  dataConsolidacao,
  emailStatusOverride, // "PRESERVE" | "PENDING" | undefined (default = comportamento legado)
  atualizar = false,
  somenteDocumentos = false,
}) {
  if ((atualizar || existingGuideId || dataConsolidacao) && !contextoSerproAtual().atualizar) {
    return comContextoSerpro({ ...contextoSerproAtual(), atualizar: true }, () => capturePgdasGuideForCompany({ portalClientId, competencia, contratanteCnpj, existingGuideId, serviceId, dataConsolidacao, emailStatusOverride, atualizar, somenteDocumentos }));
  }
  const normalizedCompanyId = String(portalClientId || "").trim();
  const normalizedCompetencia = normalizeCompetencia(competencia);
  if (!normalizedCompanyId) {
    const err = new Error("portal_company_id_required");
    err.code = "PORTAL_COMPANY_ID_REQUIRED";
    throw err;
  }
  if (!normalizedCompetencia) {
    const err = new Error("competencia_required");
    err.code = "SERPRO_INVALID_COMPETENCIA";
    throw err;
  }

  const portalClient = await prisma.portalClient.findUnique({
    where: { id: normalizedCompanyId },
    select: { id: true, cnpj: true, razao: true, companyId: true },
  });
  if (!portalClient) {
    const err = new Error("portal_company_not_found");
    err.code = "PORTAL_COMPANY_NOT_FOUND";
    throw err;
  }

  if (!contextoSerproAtual().atualizar) {
    const salva = await reutilizarGuia({ portalClientId: normalizedCompanyId, competencia: normalizedCompetencia, tipo: "SIMPLES" });
    if (salva) return { ...salva, company: portalClient };
  }
  const runtime = await getResolvedSerproCredentials();
  const procuradorCnpj = onlyDigits(contratanteCnpj || runtime.certificate.document);
  if (!procuradorCnpj || procuradorCnpj.length !== 14) {
    const err = new Error("serpro_procurador_cnpj_not_configured");
    err.code = "SERPRO_PROCURADOR_CNPJ_NOT_CONFIGURED";
    throw err;
  }

  const service = new SerproPgdasdService();
  const resolvedServiceId = resolvePgdasdServiceId({
    competencia: normalizedCompetencia,
    serviceId,
  });
  const response =
    resolvedServiceId === SERPRO_PGDASD_SERVICE_COBRANCA
      ? await service.emitirDasCobranca({
          contratanteCnpj: procuradorCnpj,
          contribuinteCnpj: portalClient.cnpj,
          periodoApuracao: normalizedCompetencia,
          dataConsolidacao,
        })
      : await service.emitirDasNormal({
          contratanteCnpj: procuradorCnpj,
          contribuinteCnpj: portalClient.cnpj,
          periodoApuracao: normalizedCompetencia,
          dataConsolidacao,
        });

  const mapped = await interpretarRespostaDasComPdf({
    response,
    contribuinteCnpj: portalClient.cnpj,
    competencia: normalizedCompetencia,
  });

  const sourceFileId = buildGuideSourceFileId({
    cnpj: portalClient.cnpj,
    competencia: normalizedCompetencia,
    numeroDocumento: mapped.numeroDocumento,
    serviceId: resolvedServiceId,
  });

  const labels = mapGuideLabels(resolvedServiceId);

  const { guide, now } = await persistirDocumentoDasComGuias({
    existingGuideId,
    portalClient,
    mapped,
    sourceFileId,
    labels,
    normalizedCompetencia,
    emailStatusOverride,
    resolvedServiceId,
    procuradorCnpj,
  });

  const circular = somenteDocumentos
    ? await prisma.companyMonthlyCircular.findUnique({ where: { portalClientId_competencia: { portalClientId: portalClient.id, competencia: normalizedCompetencia } } })
    : await prisma.companyMonthlyCircular.upsert({
    where: {
      portalClientId_competencia: {
        portalClientId: portalClient.id,
        competencia: normalizedCompetencia,
      },
    },
    create: {
      portalClientId: portalClient.id,
      competencia: normalizedCompetencia,
      receitaBruta: mapped.parsed.receitaBruta != null ? mapped.parsed.receitaBruta : null,
      dasTotal: mapped.parsed.valor != null ? mapped.parsed.valor : null,
      inssTotal: mapped.parsed.inssTotal != null ? mapped.parsed.inssTotal : null,
      metadata: {
        integrationSource: "SERPRO_PGDASD",
        sistema: "PGDASD",
        servico: resolvedServiceId,
        numeroDocumento: mapped.numeroDocumento,
        contratanteCnpj: procuradorCnpj,
        contribuinteCnpj: portalClient.cnpj,
        referencia: normalizedCompetencia,
        rawPayload: mapped.rawPayload,
        capturedAt: now.toISOString(),
      },
    },
    update: {
      ...(mapped.parsed.receitaBruta != null ? { receitaBruta: mapped.parsed.receitaBruta } : {}),
      ...(mapped.parsed.valor != null ? { dasTotal: mapped.parsed.valor } : {}),
      ...(mapped.parsed.inssTotal != null ? { inssTotal: mapped.parsed.inssTotal } : {}),
      metadata: {
        integrationSource: "SERPRO_PGDASD",
        sistema: "PGDASD",
        servico: resolvedServiceId,
        numeroDocumento: mapped.numeroDocumento,
        contratanteCnpj: procuradorCnpj,
        contribuinteCnpj: portalClient.cnpj,
        referencia: normalizedCompetencia,
        rawPayload: mapped.rawPayload,
        capturedAt: now.toISOString(),
      },
    },
  });

  // Frente B: grava o split principal/juros/multa do DAS na circular (dado do PDF, antes descartado).
  // Guarda de sanidade: só grava se o total parseado bate com o total do DAS (layout do PDF não
  // validado no offline — se não bater, não grava e a provisão segue no total/dasTotal).
  try {
    if (!somenteDocumentos && mapped.pdfBuffer?.length && mapped.parsed.valor != null) {
      const pdfParse = (await import("pdf-parse")).default;
      const txt = String((await pdfParse(mapped.pdfBuffer))?.text || "");
      const comp = parseArrecadacaoComposicao(txt);
      if (comp?.totais && Math.abs((Number(comp.totais.total) || 0) - Number(mapped.parsed.valor)) < 0.02) {
        await gravarAcrescimoCircular({
          client: prisma,
          portalClientId: portalClient.id,
          competencia: normalizedCompetencia,
          valores: { DAS: { principal: comp.totais.principal, juros: comp.totais.juros, multa: comp.totais.multa } },
        });
      }
    }
  } catch { /* best-effort: nunca derruba a captura do DAS */ }

  let accounting = null;
  try {
    // ⚠ `fonteValor: GUIA` — aqui o `dasTotal` vem do DOCUMENTO DE ARRECADAÇÃO, que depois do
    // vencimento chega recalculado com juros e multa. É exatamente o caso que a guarda de
    // recálculo do `AccountingEntryGeneratorService` existe para proteger: a provisão continua
    // valendo o principal, e o valor novo fica só sinalizado no lançamento e na circular.
    // (É o default do serviço; explícito porque é aqui que a guarda PRECISA morder.)
    accounting = somenteDocumentos ? { skipped: true, somenteDocumentos: true } : await generateEntriesFromCircular({
      portalClientId: portalClient.id,
      competencia: normalizedCompetencia,
      now,
      fonteValor: FONTE_VALOR_GUIA,
    });
  } catch (err) {
    accounting = {
      ok: false,
      error: err?.code || "ACCOUNTING_GENERATION_FAILED",
      reason: err?.message || "Falha ao gerar lançamentos a partir da Circular.",
    };
  }

  // Limpa DAS duplicado da mesma competência — a captura pode rodar de novo (recálculo, retentativa)
  // e a guia nova substitui a anterior.
  //
  // ⚠ `parcelamentoId: null` NÃO É DETALHE — sem ele isto APAGA PARCELA DE PARCELAMENTO.
  // A parcela é gravada com exatamente os três valores filtrados aqui — `tipo:"SIMPLES"`,
  // `source:"SERPRO"`, `status:"PROCESSED"` (`CaptureSerproParcelaService.js:89,92,97`) — porque a
  // parcela do Simples é indistinguível do DAS do mês por tipo; o que as separa é só o vínculo.
  //
  // O estrago não era hipotético nem raro: quem dispara é a captura NORMAL do DAS, que roda toda vez
  // que se busca o extrato da competência. Ela levava junto a parcela daquele mês e, com ela,
  // `lancamentoId`, `baixada`, `dataBaixa` e — por cascade — todo o `TributoParcela`. O parcelamento
  // perdia a parcela e o vínculo com o lançamento contábil já feito, sem uma linha de aviso.
  //
  // É a mesma regra que `guideCompliance` e o rótulo da guia já aplicam: **decide o VÍNCULO, nunca o
  // tipo**. `WHERE_GUIA_SEM_PARCELAMENTO` é a forma compartilhada dessa pergunta — usada aqui para
  // não virar a quarta cópia local dela.
  if (!somenteDocumentos) await prisma.guide.deleteMany({
    where: {
      portalClientId: portalClient.id,
      competencia: normalizedCompetencia,
      tipo: "SIMPLES",
      source: "SERPRO",
      status: "PROCESSED",
      ...WHERE_GUIA_SEM_PARCELAMENTO,
      NOT: { id: guide.id },
    },
  });

  return {
    company: {
      id: portalClient.id,
      razao: portalClient.razao,
      cnpj: portalClient.cnpj,
    },
    // ⚠ Resposta do ESCRITÓRIO — o aviso de recálculo dele nomeia o custo da chamada.
    guide: toGuideResponse(guide, { publico: PUBLICO.ESCRITORIO }),
    circular,
    accounting,
    integration: {
      sistema: "PGDASD",
      servico: resolvedServiceId,
      contratanteCnpj: procuradorCnpj,
      numeroDocumento: mapped.numeroDocumento,
    },
  };
}
