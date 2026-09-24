import { prisma } from "../../../infrastructure/db/prisma.js";
import { getResolvedSerproCredentials } from "./SerproRuntimeSettings.js";
import { SerproParcelamentoService } from "./SerproParcelamentoService.js";
import { interpretarPagamentoParcela } from "./parcelaPagamento.js";
import { parcelaPagamentoConfirmado } from "../../accounting/parcelamento/pendenciasParcelamento.js";
import { capturarRevisaoConsulta, registrarConsultaPagamentoGuia } from "../../guides/ConsultaPagamentoGuiaService.js";
import { lerComposicaoDoDocumento } from "../../accounting/parcelamento/composicaoDocumentoParcela.js";

const digits = value => String(value ?? "").replace(/\D/g, "");
const includeParcela = { guia: { include: { tributosParcela: true } }, parcelamento: true };
function revisaoParcela(p) {
  return JSON.stringify({
    id: p.id, portalClientId: p.portalClientId, parcelamentoId: p.parcelamentoId,
    guiaId: p.guiaId, anoMesParcela: p.anoMesParcela, numeroParcela: p.numeroParcela,
    valorPrevisto: p.valorPrevisto == null ? null : String(p.valorPrevisto),
    contrato: [p.parcelamento?.id, p.parcelamento?.portalClientId, p.parcelamento?.tipo, p.parcelamento?.numeroParcelamento, p.parcelamento?.status],
    guia: p.guia ? capturarRevisaoConsulta(p.guia) : null,
    tributos: (p.guia?.tributosParcela || []).map(t => [t.codigoTributo, String(t.principal), String(t.juros), String(t.multa), String(t.total)]).sort(),
  });
}

function observacaoParcela(p, r, agora, cnpj, extra = {}) {
  const estado = r.status === "CONFIRMADO" ? "CONFIRMADO" : r.status === "NAO_LOCALIZADO" ? "NAO_LOCALIZADO" : r.status === "INDETERMINADO" ? "INDETERMINADO" : "PARCIAL_OU_DIVERGENTE";
  const identidadeConferida = !["IDENTIFICACAO_DIVERGENTE", "PARCELA_DIVERGENTE", "DOCUMENTO_DIVERGENTE",
    "CNPJ_ESPERADO_INVALIDO", "CNPJ_AUSENTE", "CNPJ_DIVERGENTE"].includes(r.motivo);
  return {
    estado, fonte: `PARCELAMENTO_${p.parcelamento.tipo}`, consultadoEm: agora.toISOString(), cnpj: digits(cnpj),
    numeroDocumento: r.numeroDocumento ?? p.guia?.extracted?.numeroDocumento ?? p.guia?.extracted?.numeroDas ?? null,
    cobertura: ["CONFIRMADO", "NAO_LOCALIZADO"].includes(estado) ? "COMPLETA" : "PARCIAL",
    identidadeConferida, motivo: r.motivo || null,
    identidadeObrigacao: { tipo: "PARCELA", parcelamentoId: p.parcelamentoId, numeroParcelamento: String(p.parcelamento.numeroParcelamento), anoMesParcela: String(p.anoMesParcela), numeroParcela: p.numeroParcela ?? null },
    evidencia: { numeroParcelamento: p.parcelamento.numeroParcelamento, anoMesParcela: p.anoMesParcela, numeroParcela: p.numeroParcela },
    ...extra,
  };
}

export async function confirmarPagamentoParcela({ portalClientId, parcelaId, force = false, logger = null, assertActive = () => {} }) {
  await assertActive();
  const p = await prisma.parcela.findFirst({ where: { id: parcelaId, portalClientId }, include: includeParcela });
  if (!p) return { ok: false, skipped: "parcela_nao_encontrada" };
  if (p.parcelamento.status === "EXCLUIDO") return { ok: true, skipped: "contrato_excluido" };
  if (parcelaPagamentoConfirmado(p, { aceitarDeclaracaoCliente: false })) return { ok: true, pago: true, skipped: "already_paid" };
  if (!["PARCSN", "PARCMEI"].includes(p.parcelamento.tipo)) return { ok: true, skipped: "modalidade_manual" };
  if (!/^\d+$/.test(String(p.parcelamento.numeroParcelamento || "")) || !/^\d{4}(0[1-9]|1[0-2])$/.test(String(p.anoMesParcela || ""))) return { ok: true, skipped: "identificacao_incompleta" };
  const agora = new Date();
  const revisao = revisaoParcela(p);
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
    if ((p.guia?.cnpj && digits(p.guia.cnpj) !== digits(company.cnpj))
      || (p.guia?.portalClientId && p.guia.portalClientId !== portalClientId)
      || (p.guia?.parcelamentoId && p.guia.parcelamentoId !== p.parcelamentoId)
      || (p.guia?.numeroParcela != null && p.numeroParcela != null && Number(p.guia.numeroParcela) !== Number(p.numeroParcela))
      || (p.guia?.anoMesParcela && p.guia.anoMesParcela !== p.anoMesParcela)
      || (p.parcelamento?.portalClientId && p.parcelamento.portalClientId !== portalClientId)) {
      throw Object.assign(new Error("A identificação da parcela diverge da empresa."), { code: "PARCELA_EMPRESA_DIVERGENTE" });
    }
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
    const minimo = extracted.principal ?? extracted.valorPrincipal ?? principalDocumental ?? principalPdf
      ?? (p.valorPrevisto == null ? null : String(p.valorPrevisto)) ?? (p.guia?.valor == null ? null : String(p.guia.valor));
    const r = interpretarPagamentoParcela(raw, { contribuinteCnpj: company.cnpj, numeroParcelamento: p.parcelamento.numeroParcelamento,
      anoMesParcela: p.anoMesParcela, numeroParcela: p.numeroParcela,
      numeroDocumento: extracted.numeroDocumento ?? extracted.numeroDas, valorMinimo: minimo,
      principalEsperado: extracted.principal ?? extracted.valorPrincipal ?? principalDocumental ?? principalPdf });
    await assertActive();
    const resultadoConsulta = observacaoParcela(p, r, agora, company.cnpj);
    return await prisma.$transaction(async tx => {
      await assertActive();
      // Os nomes físicos vêm do schema. Locks curtos após HTTP congelam referência,
      // documento e cadastro até a gravação; nunca manter transação durante consulta paga.
      await tx.$queryRaw`SELECT "id" FROM "PortalClient" WHERE "id" = ${portalClientId} FOR SHARE`;
      await tx.$queryRaw`SELECT "id" FROM "parcelamentos" WHERE "id" = ${p.parcelamentoId || p.parcelamento.id} FOR SHARE`;
      // Baixa manual também reserva Guide antes de Parcela; respeitar a mesma ordem.
      if (p.guiaId) await tx.$queryRaw`SELECT "id" FROM "Guide" WHERE "id" = ${p.guiaId} FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "parcelas" WHERE "id" = ${p.id} FOR UPDATE`;
      const atual = await tx.parcela.findFirst({ where: { id: p.id, portalClientId }, include: includeParcela });
      const empresaAtual = await tx.portalClient.findUnique({ where: { id: portalClientId }, select: { cnpj: true } });
      await assertActive();
      let recusada = !atual || revisaoParcela(atual) !== revisao ? "REFERENCIA_ALTERADA" : null;
      if (!recusada && digits(empresaAtual?.cnpj) !== digits(company.cnpj)) recusada = "EMPRESA_ALTERADA";
      if (!recusada && parcelaPagamentoConfirmado(atual, { aceitarDeclaracaoCliente: false })) recusada = "PAGAMENTO_JA_REGISTRADO";
      if (recusada) return { ok: true, pago: null, status: "INDETERMINADO", aplicada: false, motivo: recusada, parcelaId: p.id,
        resultadoConsulta: { ...resultadoConsulta, estado: "INDETERMINADO", motivo: recusada, cobertura: "PARCIAL", identidadeConferida: false } };
      // Reavalia também a reserva: uma tentativa superada não escreve sobre outra.
      const whereReserva = { id: p.id, portalClientId, origemBaixa: null,
        baixadaEm: null, pagamentoConsultadoEm: agora, OR: [{ pagamentoStatus: null }, { pagamentoStatus: { not: "CONFIRMADO" } }] };
      const gravada = await tx.parcela.updateMany({ where: whereReserva, data: { pagamentoConsultadoEm: agora } });
      if (!gravada.count) return { ok: true, pago: null, status: "INDETERMINADO", aplicada: false, motivo: "CONSULTA_SUPERADA", parcelaId: p.id,
        resultadoConsulta: { ...resultadoConsulta, estado: "INDETERMINADO", motivo: "CONSULTA_SUPERADA", cobertura: "PARCIAL" } };
      let registroGuia = null;
      if (p.guiaId && p.guia) {
        registroGuia = await registrarConsultaPagamentoGuia({ guide: { ...p.guia, portalClient: { cnpj: company.cnpj } }, resultadoConsulta,
          comprovante: r.status === "CONFIRMADO" ? r.comprovante : null, assertActive,
          client: { $transaction: fn => fn(tx) } });
      }
      await assertActive();
      if (registroGuia && (!registroGuia.aplicada || registroGuia.resultadoConsulta.estado !== resultadoConsulta.estado)) {
        // A mesma prova não pode quitar a parcela quando foi recusada para sua guia.
        // Conserva a observação recusada (sem rollback) e o estado anterior da parcela.
        // pagamentoConsultadoEm continua sendo a tentativa real, que consumiu consulta:
        // apagá-lo permitiria nova chamada paga imediata. Não é data de confirmação.
        const motivo = registroGuia.motivoNaoAplicada || registroGuia.resultadoConsulta.motivo || "EVIDENCIA_NAO_APLICADA";
        return { ok: true, pago: null, status: "INDETERMINADO", aplicada: false, motivo, parcelaId: p.id,
          resultadoConsulta: { ...resultadoConsulta, estado: "INDETERMINADO", motivo, cobertura: "PARCIAL" },
          aplicadaGuia: registroGuia.aplicada, resultadoConsultaGuia: registroGuia.resultadoConsulta };
      }
      const aplicada = await tx.parcela.updateMany({ where: whereReserva,
        data: { pagamentoStatus: r.status, pagamentoEvidencia: { raw, comprovante: r.comprovante || null, valorPago: r.valorPago ?? null, resultado: r.status, consultadoEm: agora.toISOString(), resultadoConsulta }, pagamentoErro: r.motivo || null,
          ...(r.status === "CONFIRMADO" ? { pagamentoEm: r.pagoEm, valorPago: r.valorPago } : {}) } });
      // Após os locks e a reserva conferida, uma falha aqui aborta a aplicação positiva
      // inteira. O caminho de recusa acima já retornou e preservou sua auditoria.
      if (aplicada.count !== 1) throw Object.assign(new Error("A reserva da consulta foi alterada."), { code: "CONSULTA_SUPERADA" });
      return { ok: true, pago: r.status === "CONFIRMADO" ? true : r.status === "NAO_LOCALIZADO" ? false : null,
        status: r.status, motivo: r.motivo || null, parcelaId: p.id, aplicada: true, resultadoConsulta,
        ...(registroGuia ? { aplicadaGuia: registroGuia.aplicada, resultadoConsultaGuia: registroGuia.resultadoConsulta } : {}) };
    });
  } catch (err) {
    await assertActive();
    const resultadoConsulta = observacaoParcela(p, { status: "INDETERMINADO", motivo: err.code || "CONSULTA_FALHOU" }, agora, p.guia?.cnpj,
      { estado: "INDETERMINADO", cobertura: "NAO_CONSULTADA", identidadeConferida: false });
    err.resultadoConsulta = resultadoConsulta;
    await prisma.parcela.updateMany({ where: { id: p.id, portalClientId, origemBaixa: null, baixadaEm: null,
      pagamentoConsultadoEm: agora, OR: [{ pagamentoStatus: null }, { pagamentoStatus: { not: "CONFIRMADO" } }] }, data: { pagamentoErro: err.code || "CONSULTA_FALHOU" } });
    throw err;
  }
}

export async function confirmarPagamentosParcelasEmLote({ portalClientIds, parcelaIds, logger = null, limite = 500, assertActive = () => {} } = {}) {
  if (parcelaIds !== undefined && !Array.isArray(parcelaIds)) {
    throw Object.assign(new Error("A seleção de parcelas deve ser uma lista."), { code: "PARCELA_IDS_INVALIDOS" });
  }
  const selecionadas = parcelaIds === undefined ? null : [...new Set(parcelaIds.filter(id => typeof id === "string" && id.trim()).map(id => id.trim()))];
  // Snapshot vazio é uma execução sem parcelas. Nunca ampliar uma retomada para a carteira.
  if (selecionadas?.length === 0) return { results: [], total: 0 };
  const ids = [...new Set((portalClientIds || []).filter(Boolean))];
  const semConsulta = (parcelaId, motivo = "FORA_DO_ESCOPO_OU_INTERVALO_MINIMO") => ({
    parcelaId, status: "nao_consultado", motivo,
    resultadoConsulta: { estado: "INDETERMINADO", fonte: "VALIDACAO_LOCAL", consultadoEm: null,
      cobertura: "NAO_CONSULTADA", identidadeConferida: false, motivo },
  });
  if (!ids.length) {
    const results = (selecionadas || []).map(id => semConsulta(id));
    return { results, total: results.length };
  }
  const results = [];
  const partes = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" }).formatToParts(new Date());
  const mesAtual = partes.find(p => p.type === "year").value + partes.find(p => p.type === "month").value;
  const vistos = [];
  while (results.length < limite) {
    await assertActive();
    const rows = await prisma.parcela.findMany({ where: { portalClientId: { in: ids }, origemBaixa: null, baixadaEm: null,
      anoMesParcela: { not: null, lte: mesAtual }, guia: { isNot: { OR: [
        { paymentStatus: "PAID", OR: [{ paymentStatusSource: { not: "CLIENTE" } }, { paymentStatusSource: null }] },
        { baixada: true },
      ] } },
      parcelamento: { status: { not: "EXCLUIDO" }, tipo: { in: ["PARCSN", "PARCMEI"] }, numeroParcelamento: { not: null } },
      AND: [{ OR: [{ pagamentoStatus: null }, { pagamentoStatus: { not: "CONFIRMADO" } }] },
        { OR: [{ pagamentoConsultadoEm: null }, { pagamentoConsultadoEm: { lte: new Date(Date.now() - 86_400_000) } }] },
        ...(selecionadas ? [{ id: { in: selecionadas } }] : [])],
      ...(vistos.length ? { id: { notIn: vistos } } : {}) }, orderBy: [{ pagamentoConsultadoEm: { sort: "asc", nulls: "first" } }, { id: "asc" }], take: Math.min(100, limite - results.length),
      select: { id: true, portalClientId: true } });
    if (!rows.length) break;
    for (const p of rows) {
      await assertActive();
      try {
        const r = await confirmarPagamentoParcela({ portalClientId: p.portalClientId, parcelaId: p.id, logger, assertActive });
        const estado = r.resultadoConsulta?.estado;
        results.push({ parcelaId: p.id, status: r.skipped || (estado === "PARCIAL_OU_DIVERGENTE" ? "divergente" : estado === "NAO_APLICAVEL" ? "nao_aplicavel"
          : r.pago === true ? "paid" : r.pago === false ? "open" : "indeterminado"),
          ...(r.resultadoConsulta ? { resultadoConsulta: metadadosConsulta(r.resultadoConsulta), aplicada: r.aplicada } : {}),
          ...(r.resultadoConsultaGuia ? { aplicadaGuia: r.aplicadaGuia, resultadoConsultaGuia: metadadosConsulta(r.resultadoConsultaGuia) } : {}) });
      } catch (err) {
        results.push({ parcelaId: p.id, status: "error", error: err.code || "CONSULTA_FALHOU",
          ...(err.resultadoConsulta ? { resultadoConsulta: metadadosConsulta(err.resultadoConsulta) } : {}) });
      }
    }
    vistos.push(...rows.map(p => p.id));
  }
  // O intervalo continua valendo na retomada. Itens do snapshot que não puderam ser
  // consultados permanecem visíveis, sem carimbo novo nem cobertura completa fictícia.
  for (const id of selecionadas || []) if (!vistos.includes(id)) results.push(semConsulta(id,
    results.length >= limite ? "LIMITE_DO_LOTE" : "FORA_DO_ESCOPO_OU_INTERVALO_MINIMO"));
  return { total: results.length, results };
}

function metadadosConsulta(resultado) {
  return Object.fromEntries(["estado", "fonte", "consultadoEm", "numeroDocumento", "cnpj", "cobertura",
    "identidadeConferida", "motivo", "identidadeObrigacao", "observacaoId", "evidencia"]
    .filter(key => resultado[key] !== undefined).map(key => [key, resultado[key]]));
}
