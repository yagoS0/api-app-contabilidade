import { prisma } from "../../../infrastructure/db/prisma.js";
import { GuideStorageService } from "../../guides/GuideStorageService.js";
import { dataDoComprovante } from "../../guides/lib/comprovantePagamento.js";
import { isGuidePaid } from "../../guides/GuidePaymentStatusService.js";
import { registrarConsultaPagamentoGuia } from "../../guides/ConsultaPagamentoGuiaService.js";
import { gerarPagamentoInssFromGuide } from "../../accounting/InssPagamentoService.js";
import { gerarPagamentoParcelaFromGuide, recalcularEstadosParcelasEmAberto } from "../../accounting/parcelamento/ParcelamentoV2Service.js";
import { confirmarPagamento } from "./SerproPagtoWebService.js";
import { classificarDocumentoArrecadado } from "./classificarDocumentoArrecadado.js";
import { consultarDasIndexPorCompetencia } from "./SerproPgdasDeclaracaoService.js";
import { idsComRotinaAtiva } from "./CompanyRotinasService.js";
import { WHERE_GUIA_SEM_PARCELAMENTO } from "../../guides/guideContract.js";
import { INTEGRACAO_SERPRO_PAGTOWEB, INTEGRACAO_SERPRO_PARCELAMENTO } from "../../../config.js";
import { confirmarPagamentoParcela, confirmarPagamentosParcelasEmLote } from "./SerproParcelaPagamentoService.js";

// Q40 Fase A/B: confirmação de pagamento de guias via comprovante oficial (PAGTOWEB).
// O número do documento (DAS/DARF/INSS) fica em guide.extracted.numeroDocumento (não é coluna).

// Exportado para que o probe do PAGAMENTOS71 leia o número pelos MESMOS campos. Uma segunda
// leitura divergiria justamente no caso raro (`numeroDoc`/`numeroDas` das guias antigas), e o
// probe concluiria "a guia não tem número" sobre uma guia que o worker enxerga.
export function getGuideNumeroDocumento(guide) {
  const extracted = guide?.extracted && typeof guide.extracted === "object" ? guide.extracted : {};
  const raw = extracted.numeroDocumento ?? extracted.numeroDoc ?? extracted.numeroDas ?? null;
  const doc = String(raw || "").trim();
  return doc || null;
}

function maskCnpj(cnpj) {
  const d = String(cnpj || "").replace(/\D+/g, "");
  if (d.length !== 14) return "***";
  return `**.***.***/${d.slice(8, 12)}-**`;
}

/**
 * Confirma o pagamento de uma guia consultando o comprovante no SERPRO (PAGTOWEB).
 * - pago → marca PAID + grava o comprovante (PDF) + dispara a baixa contábil (best-effort, idempotente).
 * - não localizado/inconclusivo → registra observação sem reabrir pagamento já confirmado.
 * Idempotente: guia já PAID → skip. Guia sem numeroDocumento → skip.
 */
export async function confirmarPagamentoGuia({ guideId, userId = null, logger = null, assertActive = () => {}, consultasDaRodada = null }) {
  await assertActive();
  const guide = await prisma.guide.findUnique({
    where: { id: String(guideId) },
    include: { portalClient: { select: { id: true, cnpj: true } } },
  });
  if (!guide) return { ok: false, skipped: "guide_not_found" };
  // A declaração do cliente ainda precisa ser conferida na Receita. Baixa e
  // confirmações existentes (inclusive origem legada desconhecida) são preservadas.
  if (guide.baixada || (isGuidePaid(guide) && guide.paymentStatusSource !== "CLIENTE")) {
    return { ok: true, skipped: "already_paid", guideId: guide.id };
  }

  const contribuinteCnpj = guide.portalClient?.cnpj || guide.cnpj;
  if (!contribuinteCnpj) return registrarResultado({ guide, resultadoConsulta: resultadoSemConsulta("CNPJ_AUSENTE"), assertActive });
  if (guide.cnpj && String(guide.cnpj).replace(/\D/g, "") !== String(contribuinteCnpj).replace(/\D/g, "")) {
    return registrarResultado({ guide, resultadoConsulta: resultadoSemConsulta("CNPJ_DIVERGENTE"), assertActive });
  }

  const tipoUpper = String(guide.tipo || "").toUpperCase();

  // Parcela consulta seu próprio contrato/referência, nunca o índice do DAS mensal.
  if (guide.parcelamentoId) {
    const parcela = await prisma.parcela.findFirst({ where: { guiaId: guide.id, portalClientId: guide.portalClientId }, select: { id: true } });
    if (!parcela) return { ok: true, skipped: "identificacao_incompleta", guideId: guide.id };
    return confirmarPagamentoParcela({ parcelaId: parcela.id, portalClientId: guide.portalClientId, logger, assertActive });
  }

  // Q46: DAS (Simples) — sinal de pago AUTORITATIVO vem do `dasPago` (CONSDECLARACAO13), não do PAGTOWEB.
  if (tipoUpper === "SIMPLES") {
    return confirmarPagamentoDas({ guide, contribuinteCnpj, userId, logger, assertActive, consultasDaRodada });
  }

  // Q46: INSS (e demais) — confirma via PAGTOWEB pelo numeroDocumento do DARF (GERARGUIA31).
  const numeroDocumento = getGuideNumeroDocumento(guide);
  if (!numeroDocumento) return registrarResultado({ guide, resultadoConsulta: resultadoSemConsulta("NUMERO_DOCUMENTO_AUSENTE"), assertActive });

  let result;
  await assertActive();
  const consultadoEm = new Date().toISOString();
  try {
    result = await confirmarPagamento({ contribuinteCnpj, numeroDocumento, logger });
  } catch (err) {
    logger?.warn?.(
      { code: err?.code, cnpj: maskCnpj(contribuinteCnpj), guideId: guide.id },
      "PAGTOWEB: falha ao consultar comprovante",
    );
    await registrarResultado({ guide, assertActive, resultadoConsulta: err?.resultadoConsulta || err?.details?.resultadoConsulta || {
      estado: "INDETERMINADO", fonte: "PAGTOWEB", consultadoEm, numeroDocumento,
      motivo: err?.code || "FALHA_CONSULTA", cobertura: "NAO_CONSULTADA", identidadeConferida: false,
    } });
    throw err;
  }

  const resultadoConsulta = result?.resultadoConsulta || { estado: "INDETERMINADO", fonte: "PAGTOWEB",
    consultadoEm, numeroDocumento, motivo: "RESPOSTA_SEM_CLASSIFICACAO", cobertura: "PARCIAL", identidadeConferida: false };
  if (resultadoConsulta.estado !== "CONFIRMADO") return registrarResultado({ guide, resultadoConsulta, assertActive });

  await assertActive();
  const comprovantePdfFileId = await salvarComprovante({ guide, result, logger });
  const registrado = await registrarResultado({ guide, resultadoConsulta, comprovantePdfFileId, comprovante: result?.comprovante, assertActive });
  if (!registrado.pago || !registrado.aplicada) return registrado;
  await assertActive();
  const baixa = await gerarBaixaSePreciso({ guide, comprovante: result?.comprovante, composicao: result?.composicao, userId, logger });
  return { ...registrado, comprovantePdfFileId, baixa };
}

function resultadoSemConsulta(motivo) {
  return { estado: "NAO_APLICAVEL", fonte: "VALIDACAO_LOCAL", consultadoEm: new Date().toISOString(),
    numeroDocumento: null, motivo, cobertura: "NAO_CONSULTADA", identidadeConferida: false };
}

async function registrarResultado({ guide, resultadoConsulta, comprovantePdfFileId = null, comprovante = null, assertActive }) {
  await assertActive();
  const registrado = await registrarConsultaPagamentoGuia({ guide, resultadoConsulta, comprovantePdfFileId, comprovante, assertActive });
  const final = registrado.resultadoConsulta;
  const pago = final.estado === "CONFIRMADO" ? true : final.estado === "NAO_LOCALIZADO" ? false : null;
  return { ok: true, pago, guideId: guide.id, resultadoConsulta: final, aplicada: registrado.aplicada,
    motivoNaoAplicada: registrado.motivoNaoAplicada || null,
    mensagem: pago === true ? "Pagamento confirmado na Receita." : pago === false
      ? "Não consta pagamento registrado na Receita até o momento desta consulta."
      : "Consulta inconclusiva. O pagamento da guia não foi alterado; confira o motivo antes de tentar novamente." };
}

// A circular não é cache de pagamento: uma resposta negativa antiga não pode afirmar
// o resultado da consulta de hoje. A rodada compartilha somente o HTTP recém-executado.
async function confirmarPagamentoDas({ guide, contribuinteCnpj, logger, assertActive = () => {}, consultasDaRodada = null }) {
  if (!guide.competencia) return registrarResultado({ guide, resultadoConsulta: resultadoSemConsulta("COMPETENCIA_AUSENTE"), assertActive });
  const consultadoEm = new Date().toISOString();
  let idx;
  await assertActive();
  try {
    idx = await consultarDasIndexPorCompetencia({ portalClientId: guide.portalClientId, competencia: guide.competencia,
      contribuinteCnpj, numeroDocumento: getGuideNumeroDocumento(guide), consultasDaRodada, assertActive });
  } catch (err) {
    logger?.warn?.({ code: err?.code, guideId: guide.id }, "DAS: falha ao consultar índice (CONSDECLARACAO13)");
    await registrarResultado({ guide, assertActive, resultadoConsulta: err?.resultadoConsulta || { estado: "INDETERMINADO", fonte: "PGDASD_CONSDECLARACAO13",
      consultadoEm, numeroDocumento: getGuideNumeroDocumento(guide), motivo: err?.code || "FALHA_CONSULTA",
      cobertura: "NAO_CONSULTADA", identidadeConferida: false } });
    throw err;
  }
  const resultadoConsulta = idx?.resultadoConsulta || { estado: "INDETERMINADO", fonte: "PGDASD_CONSDECLARACAO13", consultadoEm,
    numeroDocumento: null, motivo: "INDICE_DAS_INDISPONIVEL", cobertura: "PARCIAL", identidadeConferida: false };
  if (resultadoConsulta.estado !== "CONFIRMADO") return registrarResultado({ guide, resultadoConsulta, assertActive });
  const numeroDocumento = idx.numeroDocumento;

  // DAS pago (autoritativo). Busca o comprovante via PAGTOWEB se ligado + número disponível (best-effort).
  let comprovantePdfFileId = null;
  let comprovante = null;
  if (INTEGRACAO_SERPRO_PAGTOWEB && numeroDocumento) {
    try {
      await assertActive();
      const result = await confirmarPagamento({ contribuinteCnpj, numeroDocumento, logger });
      if (result?.resultadoConsulta?.estado === "CONFIRMADO") comprovante = result.comprovante || null;
      if (result?.resultadoConsulta?.estado === "CONFIRMADO" && result.comprovantePdfBuffer?.length) {
        comprovantePdfFileId = await salvarComprovante({ guide, result, logger });
      }
    } catch (err) {
      logger?.warn?.({ code: err?.code, guideId: guide.id }, "PAGTOWEB: comprovante do DAS não obtido (segue como pago)");
    }
  }
  const registrado = await registrarResultado({ guide, resultadoConsulta, comprovantePdfFileId, comprovante, assertActive });
  // DAS não gera baixa contábil automática (o contador dá baixa se quiser); a Circular reflete o pago (Q45).
  return { ...registrado, comprovantePdfFileId };
}

/** Salva o comprovante (PDF) do PAGTOWEB no storage e devolve o fileId (ou null). Best-effort. */
async function salvarComprovante({ guide, result, logger }) {
  if (!result?.comprovantePdfBuffer?.length) return null;
  try {
    const storage = GuideStorageService.create();
    const key = `serpro/comprovante/${guide.portalClientId || "sem-empresa"}/${guide.competencia || "sem-comp"}/${Date.now()}.pdf`;
    const uploaded = await storage.upload({ key, buffer: result.comprovantePdfBuffer, contentType: "application/pdf" });
    return uploaded.key;
  } catch (err) {
    logger?.warn?.({ err: err?.message, guideId: guide.id }, "PAGTOWEB: falha ao salvar comprovante (segue)");
    return null;
  }
}

/**
 * Baixa contábil (best-effort, idempotente): INSS e parcelas geram lançamento de pagamento.
 *
 * ⚠ O RATEIO DO COMPROVANTE ATRAVESSA. Antes esta função chamava a baixa do INSS SEM linhas, e o
 * serviço caía no caminho de lançamento único pelo `guide.valor` — que numa guia em atraso já inclui
 * juros e multa. Isso debitava "INSS a Recolher" pelo total, amortizando o passivo por mais do que
 * foi provisionado e enterrando despesa do mês do pagamento dentro do principal. Não era um
 * problema de apresentação: o saldo da conta ficava errado.
 *
 * O comprovante já traz a quebra validada (`parseComprovanteArrecadacao` só devolve os três
 * componentes quando `principal + juros + multa` fecha com o total). Passando o rateio, a separação
 * que já existe faz o resto.
 *
 * Quando a quebra NÃO é confiável, o serviço se recusa a lançar (`sem_rateio_do_acrescimo`) e a
 * guia fica paga sem lançamento, para o contador dar a baixa pelo modal — que separa. É a regra 5:
 * nunca gravar ato contábil por suposição.
 */
async function gerarBaixaSePreciso({ guide, comprovante, composicao, userId, logger }) {
  const tipoUpper = String(guide.tipo || "").toUpperCase();
  try {
    if (guide.parcelamentoId) {
      const dataPagamento = dataDoComprovante(comprovante);
      if (!dataPagamento || !comprovante?.confiavel || composicao?.confiavel !== true) {
        return { skipped: true, reason: "sem_evidencia_pagamento" };
      }
      // ⚠ A COMPOSIÇÃO POR CÓDIGO É O QUE PERMITE BAIXAR CERTO. Numa parcela, os códigos-tributo
      // são dívida consolidada sendo amortizada (debitam o passivo) e os códigos TJLP são encargo
      // corrente (despesa do mês). Sem ela o pagamento cai no caminho antigo, que debita o passivo
      // só pelo principal e reconhece multa e juros como despesa nova.
      const classificacaoComprovante = composicao ? classificarDocumentoArrecadado(composicao) : null;
      if (!classificacaoComprovante?.classificavel) return { skipped: true, reason: "sem_evidencia_pagamento" };
      const r = await gerarPagamentoParcelaFromGuide({
        portalClientId: guide.portalClientId, guideId: guide.id, userId,
        // ⚠ A data é a da ARRECADAÇÃO, não "hoje". Sem ela a baixa caía na competência em que o
        // worker rodou, que pode ser outro mês — e o mês do pagamento é o da despesa do TJLP.
        dataPagamento,
        classificacaoComprovante,
      });
      // Recusa consciente, e precisa aparecer: guia paga sem lançamento é indistinguível de
      // "esqueci de lançar". Mesmo tratamento do `sem_rateio_do_acrescimo` do INSS.
      if (r?.reason === "comprovante_nao_e_parcela") {
        logger?.warn?.(
          { guideId: guide.id, competencia: guide.competencia, tipoDocumento: r.tipoDocumento },
          "PAGTOWEB: guia vinculada a parcelamento, mas o documento arrecadado NÃO é parcela — nada lançado",
        );
      }
      if (classificacaoComprovante?.alertas?.length) {
        logger?.warn?.(
          { guideId: guide.id, alertas: classificacaoComprovante.alertas },
          "PAGTOWEB: divergência entre código de receita e texto na composição — conferir",
        );
      }
      return r;
    }
    if (tipoUpper === "INSS") {
      const rateio = comprovante?.confiavel
        ? { principal: comprovante.principal, juros: comprovante.juros, multa: comprovante.multa, total: comprovante.total }
        : null;
      const r = await gerarPagamentoInssFromGuide({
        portalClientId: guide.portalClientId, guideId: guide.id, userId,
        dataPagamento: dataDoComprovante(comprovante),
        rateio,
      });
      if (r?.reason === "sem_rateio_do_acrescimo") {
        // Não é falha: é recusa consciente. Precisa aparecer, senão o contador não sabe que sobrou
        // trabalho — e "guia paga sem lançamento" é indistinguível de "esqueci de lançar".
        logger?.warn?.(
          { guideId: guide.id, competencia: guide.competencia, confiavel: comprovante?.confiavel ?? null },
          "PAGTOWEB: baixa do INSS NÃO lançada — guia em atraso sem rateio confiável de juros/multa",
        );
      }
      return r;
    }
    return { skipped: true, reason: "tipo_sem_baixa_automatica" };
  } catch (err) {
    logger?.warn?.({ err: err?.message, guideId: guide.id }, "PAGTOWEB: baixa contábil não gerada (segue)");
    return { skipped: true, reason: "erro", message: err?.message };
  }
}

/**
 * Lista as guias SERPRO ainda em aberto (com numeroDocumento) e confirma o pagamento de cada uma.
 * Usado pelo worker (cron próprio) e pelo disparo manual (run-now / botão por empresa).
 * @param {object} opts
 * @param {string} [opts.portalClientId] limita a uma empresa (botão por empresa)
 * @param {string} [opts.competencia] limita a uma competência
 */
export async function runPaymentConfirmationOnce({ portalClientId = null, competencia = null, userId = null, logger = null, assertActive = () => {}, retomadaPagamento = null } = {}) {
  // Rotina `pagamento`: quando roda em lote (cron ou "confirmar agora"), só as empresas
  // marcadas na página Rotinas. Com `portalClientId` explícito o filtro NÃO se aplica —
  // é o botão por empresa, escolha direta do contador.
  let filtroRotina = null;
  if (!portalClientId) {
    const ids = await idsComRotinaAtiva("pagamento");
    filtroRotina = { portalClientId: { in: [...ids] } };
  }

  // Põe o estado das parcelas em aberto em dia com o calendário antes de varrer. É a única
  // rotina periódica que já passa por parcela, então é aqui que o recálculo pega carona — sem
  // ela, parcela ingerida antes do vencimento ficava `PREVISTA` para sempre.
  // ⚠ Best-effort: é atualização de rótulo, não ato fiscal. Falhar aqui não pode impedir a
  // confirmação de pagamento, que é o trabalho de verdade desta rotina.
  try {
    const rec = await recalcularEstadosParcelasEmAberto({ portalClientId });
    if (rec.atualizadas) logger?.info?.(rec, "parcelas: estado recalculado contra o calendário");
  } catch (err) {
    logger?.warn?.({ err: err?.message }, "parcelas: recálculo de estado falhou (segue com a confirmação)");
  }

  const where = {
    source: "SERPRO",
    status: "PROCESSED",
    AND: [{ OR: [
      { paymentStatus: { in: ["OPEN", "OVERDUE"] } },
      { paymentStatus: "PAID", paymentStatusSource: "CLIENTE", baixada: false },
    ] }],
    // ⚠ PARCELA DE PARCELAMENTO FICA DE FORA DA VARREDURA — a mesma exclusão que `confirmarPagamentoGuia`
    // faz por guia, aqui na QUERY para ela nem entrar na contagem do resumo (senão a mensagem diria
    // "N guias consultadas" incluindo as que ninguém consultou). O motivo está lá: o índice do
    // PGDAS-D responde sobre o DAS de APURAÇÃO da competência, não sobre a prestação, e mandar a
    // parcela ao PAGTOWEB neste laço transformaria a carteira inteira em chamada paga.
    ...WHERE_GUIA_SEM_PARCELAMENTO,
    // SIMPLES/INSS + guia de Lucro Presumido (DCTFWeb, tipo OUTRA) — confirmada via PAGTOWEB pelo nº do DARF.
    OR: [
      { tipo: { in: ["SIMPLES", "INSS"] } },
      { tipo: "OUTRA", sourceFileId: { startsWith: "serpro:dctfweb:lp:" } },
    ],
    ...(portalClientId ? { portalClientId: String(portalClientId) } : {}),
    ...(filtroRotina || {}),
    ...(competencia ? { competencia: String(competencia) } : {}),
    ...(retomadaPagamento ? { id: { in: [...new Set((retomadaPagamento.guideIds || []).map(String))] } } : {}),
  };

  // Chave estável: a consulta muda updatedAt e retirar pagas não pode deslocar páginas.
  const guides = [];
  let cursor;
  while (true) {
    await assertActive();
    const page = await prisma.guide.findMany({ where: { ...where, ...(cursor ? { id: { ...(where.id || {}), gt: cursor } } : {}) },
      select: { id: true, tipo: true, competencia: true, extracted: true, portalClientId: true },
      orderBy: { id: "asc" }, take: 500 });
    guides.push(...page);
    if (page.length < 500) break;
    cursor = page.at(-1).id;
  }

  // Retentar somente falhas da mesma execução agendada. Os demais resultados
  // preservam data/evidência originais, sem gastar outra consulta nem parecer atuais.
  const results = (retomadaPagamento?.concluidos || []).filter(r => r && r.status !== "error");
  const concluidosAnteriores = results.length;
  const consultasDaRodada = new Map();
  let firstError = null; // Q43: 1º código de erro — para o chamador sinalizar falha (não reportar OK falso)
  for (const g of guides) {
    await assertActive();
    // Q46: o DAS (SIMPLES) confirma pelo `dasPago` (índice PGDAS-D) — não depende do numeroDocumento
    // da guia. Só pré-filtramos as NÃO-Simples sem número (INSS precisa do nº do DARF pro PAGTOWEB).
    const tipoUpper = String(g.tipo || "").toUpperCase();
    if (tipoUpper !== "SIMPLES" && !getGuideNumeroDocumento(g)) {
      results.push({ guideId: g.id, status: "sem_numero_documento" });
      continue;
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      const r = await confirmarPagamentoGuia({ guideId: g.id, userId, logger, assertActive, consultasDaRodada });
      const estado = r.resultadoConsulta?.estado;
      results.push({ guideId: g.id, status: r.skipped || (estado === "NAO_APLICAVEL" ? "nao_aplicavel" : estado === "PARCIAL_OU_DIVERGENTE" ? "divergente"
        : r.pago === true ? "paid" : r.pago === false ? "open" : "indeterminado"),
        ...(r.resultadoConsulta ? { resultadoConsulta: r.resultadoConsulta } : {}) });
    } catch (err) {
      const code = err?.code || err?.message || "ERRO";
      if (!firstError) firstError = code;
      results.push({ guideId: g.id, status: "error", error: code,
        ...(err?.resultadoConsulta || err?.details?.resultadoConsulta ? { resultadoConsulta: err.resultadoConsulta || err.details.resultadoConsulta } : {}) });
    }
  }

  const parcelas = INTEGRACAO_SERPRO_PARCELAMENTO
    ? await confirmarPagamentosParcelasEmLote({ portalClientIds: portalClientId ? [portalClientId] : filtroRotina?.portalClientId.in,
      ...(retomadaPagamento ? { parcelaIds: retomadaPagamento.parcelaIds || [] } : {}), logger, assertActive })
    : { total: 0, results: [], skipped: "integracao_parcelamento_desabilitada" };
  // Parcelas possuem parser próprio; o resumo adota o vocabulário comum sem misturar
  // identificadores nem usar o índice do DAS mensal para confirmar uma prestação.
  results.push(...parcelas.results.map(r => ({ ...r, status: ({ CONFIRMADO: "paid", NAO_LOCALIZADO: "open",
    INDETERMINADO: "indeterminado", DIVERGENTE: "divergente", PARCIAL_OU_DIVERGENTE: "divergente", NAO_APLICAVEL: "nao_aplicavel" })[r.status] || r.status })));
  firstError ||= parcelas.results.find(r => r.status === "error")?.error || null;
  const retomados = retomadaPagamento ? guides.length + parcelas.total : 0;
  const total = guides.length + parcelas.total + concluidosAnteriores;
  const paid = results.filter((r) => r.status === "paid").length;
  const naoLocalizado = results.filter((r) => r.status === "open").length; // consultou, mas não achou comprovante
  const semDoc = results.filter((r) => r.status === "sem_numero_documento").length;
  const jaPago = results.filter((r) => r.status === "already_paid").length;
  const errors = results.filter((r) => r.status === "error").length;
  const indeterminados = results.filter((r) => r.status === "indeterminado").length;
  const divergentes = results.filter((r) => r.status === "divergente").length;
  const naoAplicavel = results.filter((r) => r.status === "nao_aplicavel").length;
  const cobertura = errors + indeterminados + divergentes + naoAplicavel + semDoc > 0
    || results.some(r => r.aplicadaGuia === false || !["paid", "open", "already_paid"].includes(r.status)) ? "PARCIAL" : "COMPLETA";
  const pagtowebDisabled = results.some(r => r.error === "SERPRO_PAGTOWEB_DISABLED");

  // Q45: resultado auto-descritivo — em vez de "ok" genérico, diz o que aconteceu.
  let mensagem;
  if (total === 0) {
    mensagem = `Nenhuma guia SERPRO em aberto para confirmar${competencia ? ` (competência ${competencia})` : ""}.`;
  } else {
    const partes = [`${paid} paga(s)`];
    if (naoLocalizado) partes.push(`${naoLocalizado} não localizada(s)`);
    if (jaPago) partes.push(`${jaPago} já constava(m) paga(s)`);
    if (semDoc) partes.push(`${semDoc} sem nº do documento`);
    if (indeterminados) partes.push(`${indeterminados} inconclusiva(s)`);
    if (divergentes) partes.push(`${divergentes} com informação parcial ou divergente`);
    if (naoAplicavel) partes.push(`${naoAplicavel} sem identificação para consulta`);
    if (errors) partes.push(`${errors} com erro${firstError ? ` (${firstError})` : ""}`);
    mensagem = `${total} guia(s) verificada(s): ${partes.join(", ")}.`;
    if (concluidosAnteriores) mensagem += ` ${concluidosAnteriores} resultado(s) anterior(es) preservado(s); ${retomados} item(ns) reavaliado(s) nesta retomada.`;
    if (pagtowebDisabled) mensagem += " PAGTOWEB desabilitado para as guias que dependem desse serviço.";
  }

  return {
    total, paid, open: naoLocalizado, naoLocalizado, semDoc, jaPago, errors, indeterminados, divergentes, naoAplicavel, cobertura,
    pagtowebDisabled, firstError, mensagem, results, parcelas, concluidosAnteriores, retomados,
  };
}
