import { prisma } from "../../../infrastructure/db/prisma.js";
import { getResolvedSerproCredentials } from "./SerproRuntimeSettings.js";
import { SerproParcelamentoService } from "./SerproParcelamentoService.js";
import { interpretarPagamentoParcela } from "./parcelaPagamento.js";
import { parcelaPagamentoConfirmado } from "../../accounting/parcelamento/pendenciasParcelamento.js";
import { atualizarGuiaComEvidencia } from "../../guides/atualizarGuiaComEvidencia.js";
import { comprovanteParaRegistro } from "../../guides/lib/comprovantePagamento.js";
import { lerComposicaoDoDocumento } from "../../accounting/parcelamento/composicaoDocumentoParcela.js";
import { avisarPagamentoNaoConfirmado } from "../../guides/AvisoPagamentoService.js";
import { consultaAutomaticaEncerrada, registrarNegativaAutomatica, elegibilidadeVencimentoAutomatico } from "./ConsultaPagamentoAutomaticaService.js";

export async function confirmarPagamentoParcela({ portalClientId, parcelaId, force = false, logger = null, assertActive = () => {}, scheduledAt = null }) {
  await assertActive();
  const p = await prisma.parcela.findFirst({ where: { id: parcelaId, portalClientId }, include: { guia: { include: { tributosParcela: true } }, parcelamento: true } });
  if (!p) return { ok: false, skipped: "parcela_nao_encontrada" };
  if (p.parcelamento.status === "EXCLUIDO") return { ok: true, skipped: "contrato_excluido" };
  const conferirDeclaracaoCliente = !scheduledAt && p.guia?.paymentStatusSource === "CLIENTE" && !p.guia?.baixada && !p.origemBaixa && !p.baixadaEm && p.pagamentoStatus !== "CONFIRMADO";
  if (!conferirDeclaracaoCliente && (parcelaPagamentoConfirmado(p) || p.guia?.clienteConfirmouEm)) return { ok: true, pago: true, skipped: "already_paid" };
  const vencimentoReal = p.guia?.vencimento || (p.origem !== "CONTRATO" ? p.vencimento : null);
  const vencimentoRecusa = scheduledAt ? elegibilidadeVencimentoAutomatico(vencimentoReal) : null;
  if (vencimentoRecusa) return { ok: true, skipped: vencimentoRecusa, parcelaId: p.id };
  if (await consultaAutomaticaEncerrada({ parcelaId: p.id, guideId: p.guiaId, scheduledAt })) return { ok: true, skipped: "conferencia_manual", status: "NAO_LOCALIZADO", parcelaId: p.id };
  if (!["PARCSN", "PARCMEI"].includes(p.parcelamento.tipo)) return { ok: true, skipped: "modalidade_manual" };
  if (!/^\d+$/.test(String(p.parcelamento.numeroParcelamento || "")) || !/^\d{4}(0[1-9]|1[0-2])$/.test(String(p.anoMesParcela || ""))) return { ok: true, skipped: "identificacao_incompleta" };
  const agora = new Date();
  const intervalo = force ? 15 * 60_000 : 24 * 60 * 60_000;
  if (p.pagamentoConsultadoEm && agora - new Date(p.pagamentoConsultadoEm) < intervalo) return { ok: true, skipped: "intervalo_minimo", proximaConsultaEm: new Date(+new Date(p.pagamentoConsultadoEm) + intervalo) };
  // Reserva persistente antes da chamada: concorrência/reinício não multiplicam chamadas pagas.
  const reserva = await prisma.parcela.updateMany({ where: { id: p.id, portalClientId, pagamentoConsultadoEm: p.pagamentoConsultadoEm || null,
    origemBaixa: null, OR: [{ pagamentoStatus: null }, { pagamentoStatus: { not: "CONFIRMADO" } }] },
    data: { pagamentoConsultadoEm: agora, pagamentoErro: null } });
  if (reserva.count !== 1) return { ok: true, skipped: "consulta_em_andamento" };
  try {
    const [company, credentials] = await Promise.all([
      prisma.portalClient.findUnique({ where: { id: portalClientId }, select: { cnpj: true } }), getResolvedSerproCredentials(),
    ]);
    if (!company?.cnpj) throw Object.assign(new Error("Empresa sem CNPJ."), { code: "SEM_CNPJ" });
    await assertActive();
    const { raw } = await new SerproParcelamentoService({ log: logger }).consultarPagamentoParcela({
      contratanteCnpj: credentials.certificate.document, contribuinteCnpj: company.cnpj, tipo: p.parcelamento.tipo,
      numeroParcelamento: Number(p.parcelamento.numeroParcelamento), anoMesParcela: Number(p.anoMesParcela),
    });
    const extracted = p.guia?.extracted || {};
    // Principal conhecido evita comparar pagamento pontual com multa/juros de uma recaptura posterior.
    const principalDocumental = p.guia?.tributosParcela?.length
      ? p.guia.tributosParcela.reduce((total, t) => total + Number(t.principal || 0), 0) : null;
    const leituraPdf = lerComposicaoDoDocumento(p.guia);
    const principalPdf = leituraPdf?.tributos && !leituraPdf.recusa ? leituraPdf.tributos.reduce((s, t) => s + t.principal, 0) : null;
    const minimo = extracted.principal ?? extracted.valorPrincipal ?? principalDocumental ?? principalPdf ?? p.valorPrevisto ?? p.guia?.valor;
    const r = interpretarPagamentoParcela(raw, { numeroParcelamento: p.parcelamento.numeroParcelamento,
      anoMesParcela: p.anoMesParcela, numeroParcela: p.numeroParcela,
      numeroDocumento: extracted.numeroDocumento ?? extracted.numeroDas, valorMinimo: minimo,
      principalEsperado: extracted.principal ?? extracted.valorPrincipal ?? principalDocumental ?? principalPdf });
    await prisma.$transaction(async tx => {
      // Trava a prestação e reavalia baixa manual registrada durante a consulta.
      const gravada = await tx.parcela.updateMany({ where: { id: p.id, portalClientId, origemBaixa: null,
        pagamentoConsultadoEm: agora, OR: [{ pagamentoStatus: null }, { pagamentoStatus: { not: "CONFIRMADO" } }] },
        data: { pagamentoStatus: r.status, pagamentoEvidencia: { raw, comprovante: r.comprovante || null, valorPago: r.valorPago ?? null, resultado: r.status, consultadoEm: agora.toISOString() }, pagamentoErro: r.motivo || null,
          ...(r.status === "CONFIRMADO" ? { pagamentoEm: r.pagoEm, valorPago: r.valorPago } : {}) } });
      if (!gravada.count || !p.guiaId || r.status !== "CONFIRMADO") return;
      await atualizarGuiaComEvidencia(tx, p.guiaId, atual => {
        if (atual.baixada || (atual.paymentStatus === "PAID" && atual.paymentStatusSource !== "CLIENTE")) return {};
        return { paymentStatus: "PAID", paymentStatusSource: "SERPRO", paymentConfirmedAt: r.pagoEm,
          paymentConfirmedByUserId: null, serproLastCheckedAt: agora, serproLastCheckResult: "PARCELA_PAGAMENTO_CONFIRMADO",
          extracted: { ...(atual.extracted || {}), comprovante: comprovanteParaRegistro(r.comprovante) } };
      });
    });
    if (r.status === "NAO_LOCALIZADO") await registrarNegativaAutomatica({ parcelaId: p.id, guideId: p.guiaId, scheduledAt });
    return { ok: true, pago: r.status === "CONFIRMADO", status: r.status, motivo: r.motivo || null, parcelaId: p.id };
  } catch (err) {
    await prisma.parcela.updateMany({ where: { id: p.id, portalClientId, pagamentoConsultadoEm: agora }, data: { pagamentoErro: err.code || "CONSULTA_FALHOU" } });
    throw err;
  }
}

export async function confirmarPagamentosParcelasEmLote({ portalClientIds, logger = null, limite = 500, assertActive = () => {}, scheduledAt = null } = {}) {
  const ids = [...new Set((portalClientIds || []).filter(Boolean))];
  if (!ids.length) return { results: [], total: 0 };
  const results = [];
  let consultas = 0;
  const partes = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" }).formatToParts(new Date());
  const mesAtual = partes.find(p => p.type === "year").value + partes.find(p => p.type === "month").value;
  const vistos = [];
  while (consultas < limite) {
    await assertActive();
    const rows = await prisma.parcela.findMany({ where: { portalClientId: { in: ids }, origemBaixa: null, baixadaEm: null,
      anoMesParcela: { not: null, lte: mesAtual }, guia: { isNot: scheduledAt ? { OR: [{ paymentStatus: "PAID" }, { baixada: true }] } : { baixada: true } },
      parcelamento: { status: { not: "EXCLUIDO" }, tipo: { in: ["PARCSN", "PARCMEI"] }, numeroParcelamento: { not: null } },
      AND: [{ OR: [{ pagamentoStatus: null }, { pagamentoStatus: { not: "CONFIRMADO" } }] },
        { OR: [{ pagamentoConsultadoEm: null }, { pagamentoConsultadoEm: { lte: new Date(Date.now() - 86_400_000) } }] }],
      ...(vistos.length ? { id: { notIn: vistos } } : {}) }, orderBy: [{ pagamentoConsultadoEm: { sort: "asc", nulls: "first" } }, { id: "asc" }], take: 100,
      select: { id: true, portalClientId: true } });
    if (!rows.length) break;
    for (const p of rows) {
      if (consultas >= limite) break;
      await assertActive();
      try {
        const r = await confirmarPagamentoParcela({ portalClientId: p.portalClientId, parcelaId: p.id, logger, assertActive, scheduledAt });
        if (!r.skipped) consultas++;
        const aviso = scheduledAt && r.status === "NAO_LOCALIZADO" && (!r.skipped || r.skipped === "conferencia_manual")
          ? await avisarPagamentoNaoConfirmado({ parcelaId: p.id, scheduledAt, assertActive }) : null;
        results.push({ parcelaId: p.id, status: r.skipped || (r.pago ? "paid" : r.status || "open"), ...(aviso ? { aviso } : {}) });
      }
      catch (err) { consultas++; results.push({ parcelaId: p.id, status: "error", error: err.code || "CONSULTA_FALHOU" }); }
    }
    vistos.push(...rows.map(p => p.id));
  }
  return { total: results.length, consultas, results };
}
