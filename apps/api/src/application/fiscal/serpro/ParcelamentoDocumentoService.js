import crypto from "node:crypto";
import { prisma } from "../../../infrastructure/db/prisma.js";
import { atualizarGuiaComEvidencia } from "../../guides/atualizarGuiaComEvidencia.js";
import { erroAcompanhamento } from "./ParcelamentoDescobertaService.js";

const digits = v => String(v ?? "").replace(/\D/g, "");
const hashPdf = buffer => crypto.createHash("sha256").update(buffer).digest("hex");
async function carregarPdf(guia) { const { getGuidePdfBuffer } = await import("../../guides/GuideService.js"); return getGuidePdfBuffer(guia); }

async function contexto({ portalClientId, parcelaId, client, lerPdf }) {
  const p = await client.parcela.findFirst({ where: { id: parcelaId, portalClientId }, include: { guia: true, parcelamento: true } });
  if (!p?.guia || p.parcelamento?.portalClientId !== portalClientId || p.guia.portalClientId !== portalClientId) throw erroAcompanhamento("DOCUMENTO_NAO_ENCONTRADO", "Documento desta parcela não encontrado na empresa.", 404);
  const company = await client.portalClient.findUnique({ where: { id: portalClientId }, select: { cnpj: true } });
  const buffer = await lerPdf(p.guia);
  if (!buffer?.length || Buffer.from(buffer).subarray(0,4).toString() !== "%PDF") throw erroAcompanhamento("DOCUMENTO_PDF_INDISPONIVEL", "O PDF está indisponível. Obtenha ou importe a guia novamente.", 409);
  return { p, company, hash: hashPdf(buffer) };
}

export async function obterDocumentoParcela({ portalClientId, parcelaId, client = prisma, lerPdf = carregarPdf }) {
  const { p, company, hash } = await contexto({ portalClientId, parcelaId, client, lerPdf });
  return { documento: { guideId: p.guia.id, cnpj: company.cnpj, numeroParcelamento: p.parcelamento.numeroParcelamento, anoMesParcela: p.anoMesParcela,
    valor: p.guia.valor == null ? null : Number(p.guia.valor), vencimento: p.guia.vencimento ? new Date(p.guia.vencimento).toISOString().slice(0,10) : null,
    hash, pdfUrl: `/firm/companies/${portalClientId}/guides/${p.guia.id}/file` } };
}

export async function conferirDocumentoParcela({ portalClientId, parcelaId, usuarioId, dados, client = prisma, lerPdf = carregarPdf }) {
  const { p, company, hash } = await contexto({ portalClientId, parcelaId, client, lerPdf });
  if (dados?.confirmado !== true) throw erroAcompanhamento("CONFERENCIA_OBRIGATORIA", "Confirme que conferiu os dados no PDF.");
  if (dados.hash !== hash) throw erroAcompanhamento("DOCUMENTO_ALTERADO", "O PDF mudou. Abra o documento novamente antes de confirmar.", 409);
  if (digits(dados.cnpj) !== digits(company.cnpj) || String(dados.numeroParcelamento).trim() !== String(p.parcelamento.numeroParcelamento) || digits(dados.anoMesParcela) !== p.anoMesParcela) throw erroAcompanhamento("IDENTIFICACAO_DIVERGENTE", "CNPJ, contrato e referência devem corresponder à parcela selecionada.");
  const valor = Number(dados.valor);
  const dia = String(dados.vencimento || "");
  const vencimento = /^\d{4}-\d{2}-\d{2}$/.test(dia) ? new Date(`${dia}T12:00:00Z`) : null;
  if (!(valor > 0) || !Number.isFinite(valor) || !vencimento || !Number.isFinite(vencimento.getTime()) || vencimento.toISOString().slice(0,10) !== dia) throw erroAcompanhamento("DADOS_DOCUMENTO_INVALIDOS", "Informe valor positivo e vencimento válido conforme o PDF.");
  const evidencia = { usuarioId: usuarioId || null, conferidoEm: new Date().toISOString(), hash, cnpj: digits(company.cnpj), numeroParcelamento: p.parcelamento.numeroParcelamento, anoMesParcela: p.anoMesParcela, valor, vencimento: dia };
  const guia = await atualizarGuiaComEvidencia(client, p.guia.id, atual => {
    if (atual.parcelamentoId !== p.parcelamentoId || atual.anoMesParcela !== p.anoMesParcela || atual.portalClientId !== portalClientId) throw erroAcompanhamento("DOCUMENTO_ALTERADO", "O vínculo da guia mudou. Reabra a conferência.", 409);
    if (atual.pdfBytes?.length ? hashPdf(atual.pdfBytes) !== hash : atual.storageKey !== p.guia.storageKey) throw erroAcompanhamento("DOCUMENTO_ALTERADO", "O PDF mudou durante a conferência.", 409);
    const anterior = atual.extracted?.parcelamentoFiscal || {};
    return { ...(atual.baixada || atual.paymentStatus === "PAID" ? {} : { valor: Math.round(valor * 100) / 100, vencimento }),
      extracted: { ...(atual.extracted || {}), conferenciaDocumentoPendente: false, parcelamentoFiscal: { ...anterior, leituraErro: null, conferenciaDocumental: evidencia, historicoConferencias: [...(anterior.historicoConferencias || []), evidencia] } } };
  });
  return { guideId: guia.id, conferido: true };
}
