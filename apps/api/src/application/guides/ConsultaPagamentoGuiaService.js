import crypto from "node:crypto";
import { prisma } from "../../infrastructure/db/prisma.js";
import { dataDoComprovante, comprovanteParaRegistro } from "./lib/comprovantePagamento.js";

export const ESTADOS_CONSULTA_PAGAMENTO = Object.freeze({
  CONFIRMADO: "CONFIRMADO", NAO_LOCALIZADO: "NAO_LOCALIZADO",
  INDETERMINADO: "INDETERMINADO", PARCIAL_OU_DIVERGENTE: "PARCIAL_OU_DIVERGENTE",
  NAO_APLICAVEL: "NAO_APLICAVEL",
});
const estados = new Set(Object.values(ESTADOS_CONSULTA_PAGAMENTO));
const texto = v => v == null ? null : String(v);
const dataIso = v => v && Number.isFinite(new Date(v).getTime()) ? new Date(v).toISOString() : null;
const numero = v => v == null ? null : String(v).replace(/\D/g, "") || null;

function identidadeParcela(input) {
  if (input?.tipo !== "PARCELA") return null;
  return { tipo: "PARCELA", parcelamentoId: texto(input.parcelamentoId),
    numeroParcelamento: numero(input.numeroParcelamento), anoMesParcela: numero(input.anoMesParcela),
    numeroParcela: Number.isInteger(input.numeroParcela) && input.numeroParcela > 0 ? input.numeroParcela : null };
}

function parcelaCorresponde(guide, identidade) {
  if (!identidade || !guide.parcelamentoId || identidade.parcelamentoId !== guide.parcelamentoId
      || !identidade.numeroParcelamento || !/^\d{4}(0[1-9]|1[0-2])$/.test(identidade.anoMesParcela || "")) return false;
  const mes = numero(guide.anoMesParcela);
  const parcela = guide.numeroParcela;
  if (mes && mes !== identidade.anoMesParcela) return false;
  if (parcela != null && parcela !== identidade.numeroParcela) return false;
  return Boolean(mes || parcela != null);
}

/** Mudanças de envio/leitura não invalidam a consulta. Mudanças da obrigação/PDF invalidam. */
export function capturarRevisaoConsulta(guide) {
  const e = guide?.extracted || {};
  const documento = {
    id: guide?.id, portalClientId: guide?.portalClientId, cnpj: numero(guide?.cnpj),
    tipo: guide?.tipo, competencia: guide?.competencia, parcelamentoId: guide?.parcelamentoId,
    anoMesParcela: guide?.anoMesParcela, numeroParcela: guide?.numeroParcela,
    source: guide?.source, sourceFileId: guide?.sourceFileId,
    numeroDocumento: numero(e.numeroDocumento ?? e.numeroDoc ?? e.numeroDas ?? e.numeroGuia),
    numeroDas: numero(e.numeroDas), status: guide?.status,
    valor: texto(guide?.valor), vencimento: dataIso(guide?.vencimento),
    hash: guide?.hash, storageKey: guide?.storageKey,
    pdfHash: guide?.pdfBytes?.length ? crypto.createHash("sha256").update(guide.pdfBytes).digest("hex") : null,
  };
  return crypto.createHash("sha256").update(JSON.stringify(documento)).digest("hex");
}

export function normalizarResultadoConsultaPagamento(input = {}) {
  const consultadoEm = dataIso(input.consultadoEm);
  if (!consultadoEm) throw Object.assign(new Error("A consulta precisa do instante real da tentativa."), { code: "CONSULTA_SEM_DATA" });
  const r = {
    consultaId: texto(input.consultaId) || crypto.randomUUID(),
    estado: estados.has(input.estado) ? input.estado : "INDETERMINADO",
    fonte: texto(input.fonte) || "DESCONHECIDA", consultadoEm,
    numeroDocumento: numero(input.numeroDocumento),
    cnpj: numero(input.cnpj ?? input.evidencia?.cnpj),
    ...(identidadeParcela(input.identidadeObrigacao) ? { identidadeObrigacao: identidadeParcela(input.identidadeObrigacao) } : {}),
    cobertura: ["COMPLETA", "PARCIAL", "NAO_CONSULTADA"].includes(input.cobertura) ? input.cobertura : "NAO_CONSULTADA",
    identidadeConferida: input.identidadeConferida === true,
    motivo: texto(input.motivo) || null,
    ...(input.evidencia ? { evidencia: JSON.parse(JSON.stringify(input.evidencia)) } : {}),
    ...(input.reutilizadoDeConsultaId ? { reutilizadoDeConsultaId: String(input.reutilizadoDeConsultaId) } : {}),
  };
  if (["CONFIRMADO", "NAO_LOCALIZADO"].includes(r.estado) && (r.cobertura !== "COMPLETA" || !r.identidadeConferida)) {
    r.estado = "INDETERMINADO";
    r.motivo = r.motivo || "EVIDENCIA_INSUFICIENTE";
  }
  return r;
}

function naoAplicado(resultado, motivo) {
  return { ...resultado, estado: "INDETERMINADO", motivo, evidencia: { ...(resultado.evidencia || {}), estadoObservado: resultado.estado } };
}

/**
 * Registro append-only e projeção atômica. O lock é curto e só ocorre depois do HTTP.
 * A resposta que chegou tarde fica no histórico, sem desfazer confirmação/data/baixa.
 */
export async function registrarConsultaPagamentoGuia({
  guide, resultadoConsulta, comprovantePdfFileId = null, comprovante = null,
  assertActive = () => {}, client = prisma,
}) {
  if (!guide?.id) throw Object.assign(new Error("Guia ausente na consulta."), { code: "guide_not_found" });
  const observado = normalizarResultadoConsultaPagamento(resultadoConsulta);
  const revisao = capturarRevisaoConsulta(guide);
  await assertActive();
  return client.$transaction(async tx => {
    // Guide não possui @@map: nome SQL preservado. Identificador é parâmetro, nunca SQL montado.
    await tx.$queryRaw`SELECT "id" FROM "Guide" WHERE "id" = ${String(guide.id)} FOR UPDATE`;
    const atual = await tx.guide.findUnique({ where: { id: String(guide.id) } });
    const repetida = await tx.guidePaymentObservation.findUnique({
      where: { guideReferenceId_consultaId: { guideReferenceId: String(guide.id), consultaId: observado.consultaId } },
    });
    await assertActive();
    let motivoNaoAplicada = null;
    if (!atual) motivoNaoAplicada = "GUIA_REMOVIDA";
    else if (capturarRevisaoConsulta(atual) !== revisao) motivoNaoAplicada = "DOCUMENTO_ALTERADO";
    if (!motivoNaoAplicada && repetida && repetida.documentRevision !== revisao) motivoNaoAplicada = "DOCUMENTO_ALTERADO";
    const numeroEsperado = numero(guide.extracted?.numeroDocumento ?? guide.extracted?.numeroDoc ?? guide.extracted?.numeroDas ?? guide.extracted?.numeroGuia);
    const cnpjEsperado = numero(guide.portalClient?.cnpj || guide.cnpj);
    if (!motivoNaoAplicada && ((numeroEsperado && observado.numeroDocumento && numeroEsperado !== observado.numeroDocumento)
      || (cnpjEsperado && observado.cnpj && cnpjEsperado !== observado.cnpj))) motivoNaoAplicada = "IDENTIDADE_RESULTADO_DIVERGENTE";
    const parcelaIdentificada = parcelaCorresponde(guide, observado.identidadeObrigacao)
      && Boolean(cnpjEsperado && observado.cnpj === cnpjEsperado);
    if (!motivoNaoAplicada && observado.identidadeObrigacao && !parcelaIdentificada) motivoNaoAplicada = "IDENTIDADE_RESULTADO_DIVERGENTE";
    if (!motivoNaoAplicada && ["CONFIRMADO", "NAO_LOCALIZADO"].includes(observado.estado) && !observado.numeroDocumento && !parcelaIdentificada) {
      motivoNaoAplicada = "DOCUMENTO_RESULTADO_AUSENTE";
    }
    const anterior = atual?.extracted?.consultaPagamento;
    if (!motivoNaoAplicada && anterior?.consultadoEm && anterior.observacaoId !== repetida?.id
        && new Date(anterior.consultadoEm) >= new Date(observado.consultadoEm)) {
      motivoNaoAplicada = "OBSERVACAO_SUPERADA";
    }
    // A identificação da empresa também pode mudar sem edição da guia.
    if (!motivoNaoAplicada && guide.portalClient?.cnpj && atual.portalClientId) {
      await tx.$queryRaw`SELECT "id" FROM "PortalClient" WHERE "id" = ${atual.portalClientId} FOR SHARE`;
      const empresa = await tx.portalClient.findUnique({ where: { id: atual.portalClientId }, select: { cnpj: true } });
      if (numero(empresa?.cnpj) !== numero(guide.portalClient.cnpj)) motivoNaoAplicada = "EMPRESA_ALTERADA";
    }
    if (repetida) {
      const motivo = motivoNaoAplicada || repetida.ignoredReason;
      return { guia: atual, resultadoConsulta: { ...(motivo ? naoAplicado(repetida.result, motivo) : repetida.result), observacaoId: repetida.id },
        aplicada: !motivo && repetida.applied, motivoNaoAplicada: motivo || null, repetida: true };
    }
    const resultado = motivoNaoAplicada ? naoAplicado(observado, motivoNaoAplicada) : observado;
    const aplicada = !motivoNaoAplicada;
    const registro = await tx.guidePaymentObservation.create({ data: {
      consultaId: observado.consultaId, guideId: atual?.id || null, guideReferenceId: String(guide.id),
      portalClientId: guide.portalClientId || null, documentRevision: revisao,
      source: observado.fonte, state: observado.estado, checkedAt: new Date(observado.consultadoEm),
      applied: aplicada, ignoredReason: motivoNaoAplicada, result: resultado,
    } });
    if (!aplicada) return { guia: atual, resultadoConsulta: { ...resultado, observacaoId: registro.id }, aplicada, motivoNaoAplicada };
    const checkedAt = new Date(observado.consultadoEm);
    const resultadoSalvo = { ...resultado, observacaoId: registro.id };
    const data = {
      serproLastCheckedAt: checkedAt,
      serproLastCheckResult: observado.estado === "CONFIRMADO"
        ? (observado.fonte.startsWith("PGDAS") ? "PGDAS_PAGAMENTO_CONFIRMADO"
          : observado.fonte.startsWith("PARCELAMENTO_") ? "PARCELA_PAGAMENTO_CONFIRMADO" : "COMPROVANTE_FOUND")
        : observado.estado,
      extracted: { ...(atual.extracted || {}), consultaPagamento: resultadoSalvo },
    };
    if (observado.cobertura === "COMPLETA" && observado.identidadeConferida) data.serproLastSeenAt = checkedAt;
    if (observado.estado === "CONFIRMADO") {
      data.paymentStatus = "PAID";
      // Confirmação manual/baixa existente conserva autoria, data e procedência financeira.
      if (!atual.baixada && atual.paymentStatusSource !== "MANUAL") {
        if (atual.paymentStatusSource === "CLIENTE") {
          data.extracted.pagamentoDeclaradoCliente = {
            declaradoEm: dataIso(atual.clienteConfirmouEm),
            porUserId: atual.clienteConfirmouPorUserId || atual.paymentConfirmedByUserId || null,
            pagoEmInformado: dataIso(atual.paymentConfirmedAt),
          };
        }
        data.paymentStatusSource = "SERPRO";
        // Uma consulta de situação não apaga a data já lida de comprovante oficial.
        data.paymentConfirmedAt = dataDoComprovante(comprovante)
          || (atual.paymentStatusSource === "SERPRO" ? atual.paymentConfirmedAt : null);
        data.paymentConfirmedByUserId = null;
      }
      if (comprovantePdfFileId) data.comprovantePdfFileId = comprovantePdfFileId;
      if (comprovante && !atual.baixada && atual.paymentStatusSource !== "MANUAL"
          && (comprovante.confiavel || !atual.extracted?.comprovante?.confiavel)) {
        data.extracted.comprovante = comprovanteParaRegistro(comprovante);
      }
    }
    // NAO_LOCALIZADO é observação, não prova para reabrir PAID ou forçar OVERDUE.
    // INDETERMINADO também não altera status fiscal nem comprovante anterior.
    const guia = await tx.guide.update({ where: { id: atual.id }, data });
    return { guia, resultadoConsulta: resultadoSalvo, aplicada, motivoNaoAplicada: null };
  });
}
