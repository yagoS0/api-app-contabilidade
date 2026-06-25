// Q22 — Captura automática das parcelas de um parcelamento ATIVO via SERPRO.
//
// Por competência gerável (PARCELASPARAGERAR172): DETPAGTOPARC165 (composição, juros LIDO) +
// GERARDAS16x (PDF) → cria a Guide (PDF anexo, e-mail PENDING) → ingestParcelamentoFromGuide
// (Q23: só vincula a guia + persiste TributoParcela; a provisão já existe da 1ª parcela manual e o
// PAGAMENTO só é lançado quando o contador marca a guia como paga). Idempotente por (parc, anoMesParcela).
//
// Atrás da flag INTEGRACAO_SERPRO_PARCELAMENTO (o chamador — worker — checa antes).

import crypto from "node:crypto";
import { prisma } from "../../../infrastructure/db/prisma.js";
import { getResolvedSerproCredentials } from "./SerproRuntimeSettings.js";
import { SerproParcelamentoService } from "./SerproParcelamentoService.js";
import { createOrUpdateGuideFromProcessing } from "../../guides/GuideService.js";
import { ingestParcelamentoFromGuide } from "../../accounting/parcelamento/ParcelamentoV2Service.js";

function onlyDigits(v) { return String(v || "").replace(/\D+/g, ""); }
function aaaammToCompetencia(aaaamm) {
  const s = String(aaaamm || "").replace(/\D+/g, "");
  return s.length >= 6 ? `${s.slice(0, 4)}-${s.slice(4, 6)}` : null;
}

/**
 * Captura as parcelas geráveis de UM parcelamento ATIVO.
 * @returns {Promise<{ ok, parcelas: Array<{anoMes, status, guideId?, reason?}> }>}
 */
export async function capturarParcelaGuideForCompany({ portalClientId, parcelamento, log = null }) {
  const company = await prisma.portalClient.findUnique({
    where: { id: portalClientId },
    select: { id: true, cnpj: true, companyId: true },
  });
  if (!company) return { ok: false, parcelas: [], reason: "company_not_found" };

  const tipo = parcelamento.tipo || "PARCSN";
  const numeroParcelamento = parcelamento.numeroParcelamento;
  if (!numeroParcelamento) return { ok: false, parcelas: [], reason: "sem_numero_parcelamento" };

  const runtime = await getResolvedSerproCredentials();
  const contratanteCnpj = onlyDigits(runtime.certificate.document);
  const contribuinteCnpj = onlyDigits(company.cnpj);
  const serpro = new SerproParcelamentoService({ log });

  // 1) Competências geráveis (dirige a iteração). Se a modalidade não suporta listagem,
  //    cai pra reference (mês anterior) — sem adivinhar além disso.
  let competenciasAAAAMM = [];
  try {
    const r = await serpro.listarParcelasGeraveis({ contratanteCnpj, contribuinteCnpj, tipo, numeroParcelamento });
    competenciasAAAAMM = r.competencias || [];
  } catch (err) {
    if (err?.code === "MODALIDADE_NAO_SUPORTADA") {
      log?.warn?.({ tipo }, "Listagem de parcelas geráveis não suportada — sem auto-descoberta de competência");
      return { ok: false, parcelas: [], reason: "listagem_nao_suportada" };
    }
    throw err;
  }

  const out = [];
  for (const aaaamm of competenciasAAAAMM) {
    const anoMesParcela = String(aaaamm);
    const competencia = aaaammToCompetencia(anoMesParcela);
    try {
      // 2) Idempotência: já trouxe essa parcela/competência?
      const jaExiste = await prisma.guide.findFirst({
        where: { parcelamentoId: parcelamento.id, anoMesParcela },
        select: { id: true },
      });
      if (jaExiste) { out.push({ anoMes: anoMesParcela, status: "pulada" }); continue; }

      // 3) Composição (juros LIDO) + 4) PDF.
      const { parcela } = await serpro.consultarDetalheParcela({
        contratanteCnpj, contribuinteCnpj, tipo, numeroParcelamento, anoMesParcela,
      });
      let pdfBuffer = null;
      try {
        ({ pdfBuffer } = await serpro.emitirDasParcela({ contratanteCnpj, contribuinteCnpj, tipo, numeroParcelamento, anoMesParcela }));
      } catch (err) {
        if (err?.code === "MODALIDADE_NAO_SUPORTADA") {
          log?.warn?.({ tipo, anoMesParcela }, "Emissão de DAS não suportada nesta modalidade — segue sem PDF");
        } else { throw err; }
      }

      // 5) Cria/atualiza a Guide (PDF anexo + e-mail PENDING).
      const sourceFileId = `PARC-${numeroParcelamento}-${anoMesParcela}`;
      const hash = pdfBuffer ? crypto.createHash("sha256").update(pdfBuffer).digest("hex") : null;
      const guide = await createOrUpdateGuideFromProcessing({
        portalClientId: company.id,
        legacyCompanyId: company.companyId || null,
        parsed: {
          cnpj: company.cnpj, competencia, tipo: "SIMPLES",
          valor: parcela.valorTotal, vencimento: parcela.vencimento || null,
        },
        source: "SERPRO",
        sourceFileId,
        sourcePath: `Parcelamento ${tipo} ${numeroParcelamento} - parcela ${anoMesParcela}`,
        pdfBytes: pdfBuffer || undefined,
        hash: hash || undefined,
        status: "PROCESSED",
        errors: [],
        paymentStatus: "OPEN",
        emailStatusOverride: "PENDING",
      });
      const guideId = guide.guideId || guide.id;

      // 6) Ingestão (Q23): parcelamento já existe (1ª parcela manual), então só vincula a guia +
      //    persiste a composição (TributoParcela). O pagamento sai no "pago" da aba Guias.
      const parcelamentoDTO = {
        tipo, numeroParcelamento,
        valorTotal: parcelamento.totalValue, valorPrincipal: parcelamento.principalTotal,
        valorMulta: parcelamento.valorMulta, valorJuros: parcelamento.jurosTotal,
        quantidadeParcelas: parcelamento.numParcelas, origem: "SERPRO",
      };
      await ingestParcelamentoFromGuide({
        portalClientId: company.id, guideId,
        parcelamentoDTO, parcelaDTO: { ...parcela, anoMesParcela },
      });

      out.push({ anoMes: anoMesParcela, status: pdfBuffer ? "ok" : "ok_sem_pdf", guideId });
    } catch (err) {
      out.push({ anoMes: anoMesParcela, status: "erro", reason: err?.code || err?.message });
      log?.warn?.({ err: err?.message, numeroParcelamento, anoMesParcela }, "Falha ao capturar parcela");
    }
  }
  return { ok: true, parcelas: out };
}
