import crypto from "node:crypto";
import { prisma } from "../../../infrastructure/db/prisma.js";
import { getResolvedSerproCredentials } from "./SerproRuntimeSettings.js";
import { SerproParcelamentoService } from "./SerproParcelamentoService.js";
import { GuideParserClient } from "../../guides/GuideParserClient.js";
import { estadoEmAberto } from "../../accounting/parcelamento/parcelaStateMachine.js";
import { atualizarGuiaComEvidencia } from "../../guides/atualizarGuiaComEvidencia.js";
import { MODALIDADES_AUTOMATICAS } from "./serproParcelamentoMap.js";
import { reconciliarPedidosFiscais, erroAcompanhamento } from "./ParcelamentoDescobertaService.js";

const digits = v => String(v || "").replace(/\D/g, "");
const json = v => JSON.parse(JSON.stringify(v));
const LEASE_MS = 5 * 60 * 1000;
export const identidadeCapturaParcela = (empresa, tipo, numero, referencia) => `serpro:parcela:${empresa}:${tipo}:${numero}:${referencia}`;
const temPdf = g => Boolean(g?.pdfBytes?.length || g?.storageKey || g?.driveFinalFileId);

/** Obtém uma parcela sem gerar provisão ou baixa. Reserva o PDF antes do vínculo. */
export async function capturarParcelaFiscal({ client = prisma, serpro, args, company, parcelamento, disponivel, parser, assertActive = () => {} }) {
  const anoMesParcela = String(disponivel.anoMesParcela);
  const chave = { parcelamentoId: parcelamento.id, anoMesParcela };
  const owner = crypto.randomUUID();
  const sourceFileId = identidadeCapturaParcela(company.id, parcelamento.tipo, parcelamento.numeroParcelamento, anoMesParcela);
  const reserva = await client.parcelamentoCaptura.upsert({ where: { parcelamentoId_anoMesParcela: chave }, create: { ...chave, portalClientId: company.id, tipo: parcelamento.tipo }, update: {} });
  const obtida = await client.parcelamentoCaptura.updateMany({ where: { id: reserva.id, OR: [{ owner: null }, { reservadoAte: { lt: new Date() } }] }, data: { owner, reservadoAte: new Date(Date.now() + LEASE_MS), estado: "PROCESSANDO", erro: null } });
  if (obtida.count !== 1) return { anoMes: anoMesParcela, status: "em_processamento" };
  let perdeuReserva = false;
  const timer = setInterval(() => { client.parcelamentoCaptura.updateMany({ where: { id: reserva.id, owner }, data: { reservadoAte: new Date(Date.now() + LEASE_MS) } }).then(r => { if (r.count !== 1) perdeuReserva = true; }).catch(() => { perdeuReserva = true; }); }, 30000);
  timer.unref?.();
  try {
    const existentes = await client.guide.findMany({ where: { portalClientId: company.id, OR: [{ parcelamentoId: parcelamento.id, anoMesParcela }, { source: "SERPRO", sourceFileId }, { source: "SERPRO", sourceFileId: `PARC-${parcelamento.numeroParcelamento}-${anoMesParcela}`, parcelamentoId: null, sourcePath: { startsWith: `Parcelamento ${parcelamento.tipo} ` } }] } });
    if (existentes.length > 1) throw erroAcompanhamento("PARCELA_VINCULO_AMBIGUO", "Há mais de uma guia para esta parcela. Confira o vínculo.", 409);
    const existing = existentes[0];
    const prestacoes = await client.parcela.findMany({ where: { parcelamentoId: parcelamento.id, anoMesParcela } });
    if (prestacoes.length > 1) throw erroAcompanhamento("PARCELA_VINCULO_AMBIGUO", "Há mais de uma prestação nesta referência.", 409);
    const prestacao = prestacoes[0];
    if (prestacao?.pagamentoStatus === "CONFIRMADO" || prestacao?.origemBaixa || existing?.paymentStatus === "PAID" || existing?.baixada) return { anoMes: anoMesParcela, status: "paga", guideId: existing?.id || null };
    if (parcelamento.formaPagamento === "DEBITO_AUTOMATICO" && !existing) {
      await client.$transaction(async tx => {
        const owned = await tx.parcelamentoCaptura.updateMany({ where: { id: reserva.id, owner }, data: { estado: "ACOMPANHAR_PAGAMENTO" } });
        if (owned.count !== 1) throw erroAcompanhamento("RESERVA_PERDIDA", "Reserva da parcela indisponível.", 409);
        if (!prestacao) await tx.parcela.create({ data: { portalClientId: company.id, parcelamentoId: parcelamento.id, anoMesParcela, competencia: `${anoMesParcela.slice(0,4)}-${anoMesParcela.slice(4)}`, valorPrevisto: disponivel.valor, origem: "SERPRO" } });
      });
      return { anoMes: anoMesParcela, status: "acompanhar_pagamento" };
    }
    let pdfBuffer = existing?.pdfBytes?.length ? Buffer.from(existing.pdfBytes) : reserva.pdfBytes?.length ? Buffer.from(reserva.pdfBytes) : null;
    let numeroDas = reserva.numeroDocumento || null;
    if (!temPdf(existing) && !pdfBuffer) {
      assertActive();
      const emitida = await serpro.emitirDasParcela({ ...args, tipo: parcelamento.tipo, numeroParcelamento: parcelamento.numeroParcelamento, anoMesParcela });
      pdfBuffer = emitida.pdfBuffer;
      numeroDas = emitida.numeroDas;
      const saved = await client.parcelamentoCaptura.updateMany({ where: { id: reserva.id, owner }, data: { pdfBytes: pdfBuffer, numeroDocumento: numeroDas || null, rawPayload: json(emitida.raw), estado: "PDF_OBTIDO" } });
      if (saved.count !== 1) throw erroAcompanhamento("RESERVA_PERDIDA", "Outra execução assumiu esta parcela.", 409);
    }
    let parsed = null;
    let leituraErro = null;
    if (pdfBuffer && !temPdf(existing)) {
      try { parsed = await (parser || GuideParserClient.create()).parsePdf({ buffer: pdfBuffer, filename: "parcela.pdf" }); }
      catch (err) { leituraErro = err.code || "PDF_LEITURA_PENDENTE"; }
    }
    if (parsed?.cnpj && digits(parsed.cnpj) !== digits(company.cnpj)) throw erroAcompanhamento("PDF_EMPRESA_DIVERGENTE", "O documento retornado pertence a outro CNPJ.", 409);
    const numeroTexto = parsed?.rawTextSample?.match(/N[uú]mero\s+do\s+Parcelamento\s*[:\s]+(\d+)/i)?.[1];
    if (numeroTexto && numeroTexto !== String(parcelamento.numeroParcelamento)) throw erroAcompanhamento("PDF_CONTRATO_DIVERGENTE", "O contrato do documento diverge do selecionado.", 409);
    if (!temPdf(existing) && (!parsed?.cnpj || !numeroTexto || !(parsed?.valor > 0) || !parsed?.vencimento)) leituraErro ||= "PDF_DADOS_INCOMPLETOS";
    const numeroParcela = parsed?.rawTextSample?.match(/Parcela\s*:\s*(\d+)\s*\//i)?.[1];
    const competencia = `${anoMesParcela.slice(0,4)}-${anoMesParcela.slice(4)}`;
    const valor = parsed?.valor != null && parsed.valor > 0 ? parsed.valor : disponivel.valor ?? existing?.valor ?? null;
    const vencimento = parsed?.vencimento ? new Date(parsed.vencimento) : existing?.vencimento || null;
    if (perdeuReserva) throw erroAcompanhamento("RESERVA_PERDIDA", "A reserva da captura expirou.", 409);
    const guide = await client.$transaction(async tx => {
      const owned = await tx.parcelamentoCaptura.updateMany({ where: { id: reserva.id, owner, reservadoAte: { gt: new Date() } }, data: { estado: "VINCULANDO" } });
      if (owned.count !== 1) throw erroAcompanhamento("RESERVA_PERDIDA", "Reserva da parcela indisponível.", 409);
      // Atualização documental não pode perder comprovante/pagamento concorrente.
      const atual = existing ? await tx.guide.findUnique({ where: { id: existing.id } }) : null;
      const evidencia = { ...(parsed || {}), ...(atual?.extracted || {}), numeroDocumento: parsed?.fields?.numeroDocumento || numeroDas || atual?.extracted?.numeroDocumento || null, parcelamentoFiscal: { tipo: parcelamento.tipo, numeroParcelamento: parcelamento.numeroParcelamento, anoMesParcela, leituraErro }, ...(leituraErro ? { conferenciaDocumentoPendente: true } : {}) };
      const documento = { parcelamentoId: parcelamento.id, anoMesParcela, numeroParcela: atual?.numeroParcela ?? prestacao?.numeroParcela ?? (numeroParcela ? Number(numeroParcela) : null), sourceFileId, extracted: evidencia };
      const g = atual ? await atualizarGuiaComEvidencia(tx, atual.id, recente => ({ ...documento, extracted: { ...evidencia, ...(recente.extracted || {}), parcelamentoFiscal: { ...(recente.extracted?.parcelamentoFiscal || {}), ...evidencia.parcelamentoFiscal } }, ...(!temPdf(recente) && pdfBuffer ? { pdfBytes: pdfBuffer, storageProvider: "DATABASE", status: "PROCESSED", ...(recente.valor == null ? { valor } : {}), ...(recente.vencimento == null ? { vencimento } : {}) } : {}) }))
        : await tx.guide.create({ data: { ...documento, portalClientId: company.id, legacyCompanyId: company.companyId || null, cnpj: digits(company.cnpj), competencia, tipo: "SIMPLES", source: "SERPRO", sourcePath: `Parcelamento ${parcelamento.tipo} ${parcelamento.numeroParcelamento} - parcela ${anoMesParcela}`, valor, valorOriginal: valor, vencimento, pdfBytes: pdfBuffer, storageProvider: "DATABASE", hash: pdfBuffer ? crypto.createHash("sha256").update(pdfBuffer).digest("hex") : null, status: "PROCESSED", paymentStatus: "OPEN", emailStatus: "PENDING", parcelaEstado: estadoEmAberto(vencimento), errors: leituraErro ? [leituraErro] : [] } });
      if (prestacao) {
        if (prestacao.guiaId && prestacao.guiaId !== g.id) throw erroAcompanhamento("PARCELA_VINCULO_AMBIGUO", "A prestação possui outra guia.", 409);
        await tx.parcela.update({ where: { id: prestacao.id }, data: { guiaId: g.id, origem: "GUIA" } });
      } else await tx.parcela.create({ data: { portalClientId: company.id, parcelamentoId: parcelamento.id, numeroParcela: g.numeroParcela, competencia, anoMesParcela, vencimento, valorPrevisto: valor, guiaId: g.id, origem: "GUIA" } });
      await tx.parcelamentoCaptura.update({ where: { id: reserva.id }, data: { estado: "CONCLUIDA", guideId: g.id, erro: null, pdfBytes: null } });
      return g;
    });
    return { anoMes: anoMesParcela, status: leituraErro ? "conferir_documento" : temPdf(existing) ? "reutilizada" : "ok", guideId: guide.id };
  } catch (err) {
    await client.parcelamentoCaptura.updateMany({ where: { id: reserva.id, owner }, data: { estado: "ERRO", erro: String(err.code || err.message).slice(0,1000) } });
    throw err;
  } finally { clearInterval(timer); await client.parcelamentoCaptura.updateMany({ where: { id: reserva.id, owner }, data: { owner: null, reservadoAte: null } }); }
}

export async function capturarParcelaGuideForCompany({ portalClientId, parcelamento, log = null, client = prisma, serpro = new SerproParcelamentoService({ log }), parser, assertActive = () => {} }) {
  if (!MODALIDADES_AUTOMATICAS.includes(parcelamento.tipo)) return { ok: false, parcelas: [], reason: "modalidade_nao_suportada" };
  const company = await client.portalClient.findUnique({ where: { id: portalClientId }, select: { id: true, cnpj: true, companyId: true } });
  if (!company) throw erroAcompanhamento("EMPRESA_NAO_ENCONTRADA", "Empresa não encontrada.", 404);
  const runtime = await getResolvedSerproCredentials();
  const args = { contratanteCnpj: runtime.certificate.document, contribuinteCnpj: company.cnpj };
  try {
    // A API atende o acordo ativo da modalidade, por isso a identidade é conferida antes da emissão.
    assertActive();
    const { pedidos, raw } = await serpro.listarPedidos({ ...args, tipo: parcelamento.tipo });
    await reconciliarPedidosFiscais({ portalClientId, tipo: parcelamento.tipo, pedidos, raw, client });
    const ativos = pedidos.filter(p => p.fiscalSituacao === "ATIVO");
    if (ativos.length !== 1 || ativos[0].numeroParcelamento !== String(parcelamento.numeroParcelamento)) throw erroAcompanhamento("CONTRATO_ATIVO_DIVERGENTE", "O contrato selecionado não corresponde ao único acordo ativo informado pela Receita.", 409);
    assertActive();
    const lista = await serpro.listarParcelasGeraveis({ ...args, tipo: parcelamento.tipo });
    const resultados = [];
    for (const disponivel of lista.parcelas) {
      assertActive();
      try { resultados.push(await capturarParcelaFiscal({ client, serpro, args, company, parcelamento, disponivel, parser, assertActive })); }
      catch (err) { resultados.push({ anoMes: disponivel.anoMesParcela, status: "erro", reason: err.code || err.message }); }
    }
    const ok = resultados.every(r => r.status !== "erro");
    await client.parcelamento.update({ where: { id: parcelamento.id }, data: { ultimaConsultaParcelasEm: new Date(), ultimaConsultaParcelasResultado: ok ? resultados.length ? "CONSULTADA" : "SEM_PARCELAS_DISPONIVEIS" : "ERRO_PARCIAL" } });
    return { ok, parcelas: resultados, reason: !ok ? "captura_parcial_com_erros" : !resultados.length ? "sem_parcelas_disponiveis" : null };
  } catch (err) {
    await client.parcelamento.update({ where: { id: parcelamento.id }, data: { ultimaConsultaParcelasEm: new Date(), ultimaConsultaParcelasResultado: `ERRO:${err.code || "CONSULTA_FALHOU"}` } });
    throw err;
  }
}
