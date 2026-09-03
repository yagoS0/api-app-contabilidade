// AS AÇÕES PENDENTES — a ligação com o banco e a EXECUÇÃO do que o cliente confirmou.
//
// ⚠⚠ A IA NUNCA EXECUTA. Ela chama `criarPendencia` (via ferramenta); quem executa é
// `confirmarEExecutar`, chamado pelo serviço DEPOIS de a regex reconhecer "CONFIRMAR <código>" —
// fora do modelo. A execução chama AS MESMAS funções das rotas do cliente:
//   EMITIR_NFSE     → `NfseService.issue`            (a mesma de `POST /client/.../nfse`)
//   CANCELAR_NFSE   → `NfseService.sendEvent`        (a mesma de `POST /client/.../cancelar`)
//   RECALCULAR_GUIA → `capturePgdasGuideForCompany` / `reemitirDarfLp`, dentro de
//                     `comContextoSerpro({ origem: "whatsapp:recalcular", forcar: false })`
//
// ⚠⚠ A RESERVA É ATÔMICA: `updateMany({ where: { id, status: "pendente", expiraEm: { gt: now } } })`
// lendo o `count`. Dupla confirmação (reentrega do webhook, dois toques) executa UMA vez.
//
// ⚠ Desfecho `TRANSPORTE` (502, desconhecido): a pendência fica `executada` com
// `resultado.indeterminado = true`, o cliente lê que não se sabe se saiu, e o fio vai para a fila
// humana. NUNCA se retenta sozinho — reemitir é E0014 numa nota que talvez exista.

// ⚠⚠ A CONFIRMAÇÃO RECONFERE (03/09/2026, achado do agente "A · guardas"). Entre o pedido e o
// CONFIRMAR passam até 10 minutos, e a rota HTTP reconfere o portão a CADA POST: o escritório pode
// ter revogado `emissaoClienteLiberada`, o papel da pessoa pode ter caído, a guia pode ter sido
// paga. Por isso, antes de executar: EMITIR/CANCELAR passam de novo por `autorizarEmissaoDoCliente`
// e RECALCULAR refaz as 4 travas da rota. Reconferência que FALHA (erro interno) recusa — fechado.
// E a reserva leva o `conversaId`: a pendência de um fio nunca é confirmada por outro.

import { prisma } from "../../infrastructure/db/prisma.js";
import { log as logPadrao } from "../../config.js";
import { TIPOS, STATUS, TTL_MS, gerarCodigo, rodapeDeConfirmacao } from "./confirmacaoPendente.js";
import { NfseService } from "../nfse/NfseService.js";
import { NfseRepository } from "../../infrastructure/db/NfseRepository.js";
import { resolveLegacyCompanyId } from "../../routes/middlewares/portalAccess.js";
import { autorizarEmissaoDoCliente } from "../nfse/autorizacaoEmissaoDoCliente.js";
import { classificarFalha, CAMADA } from "../nfse/desfechoEmissao.js";
import { comContextoSerpro } from "../fiscal/serpro/serproCallContext.js";
import { capturePgdasGuideForCompany } from "../fiscal/serpro/CaptureSerproGuidesService.js";
import { reemitirDarfLp } from "../fiscal/lp/LucroPresumidoProvisaoService.js";
import { SERPRO_PGDASD_SERVICE_COBRANCA } from "../fiscal/serpro/SerproPgdasdService.js";
import { markGuideOpenBySerpro } from "../guides/GuidePaymentStatusService.js";
import { ESPECIE_RECALCULO, especieDoRecalculo, leituraDosAcrescimos, traduzirRecusaParaCliente, canGuideRecalculate, isGuideOverdue } from "../guides/lib/recalculoDaGuia.js";
import { fmtBRL } from "@contabilidade/shared/declaracao-nfse";

export const ORIGENS = Object.freeze({
  EMITIR: "whatsapp:emitir",
  CANCELAR: "whatsapp:cancelar",
  RECALCULAR: "whatsapp:recalcular",
});

/** As funções de fora, INJETÁVEIS — o teste passa dublês e mede a recusa por NÃO-CHAMADA. */
export const DEPS_PADRAO = Object.freeze({
  NfseService, NfseRepository, resolveLegacyCompanyId, autorizarEmissaoDoCliente,
  comContextoSerpro, capturePgdasGuideForCompany, reemitirDarfLp, markGuideOpenBySerpro,
  canGuideRecalculate, isGuideOverdue,
});

const TEXTO_RECONFERENCIA = "Desde o seu pedido a autorização para este ato mudou, então NÃO executei. O escritório vai conferir e responder por aqui.";

/** A pendência ABERTA do fio (a mais recente, `pendente`), ou null. Expiração é conferida por quem lê. */
export async function pendenciaAberta(conversaId, { client = prisma } = {}) {
  return client.acaoPendenteWhatsapp.findFirst({
    where: { conversaId: String(conversaId), status: STATUS.PENDENTE },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * CRIA a pendência. Uma por fio: a anterior `pendente` é CANCELADA (o texto prometeu que qualquer
 * outra resposta cancela, e um pedido novo é outra resposta).
 * @returns {{acao, texto}} `texto` = o corpo que o cliente LÊ + o rodapé com o código
 */
export async function criarPendencia({ conversaId, portalClientId, userId, tipo, payload, corpo, agora = new Date(), rand = Math.random, client = prisma } = {}) {
  if (!Object.values(TIPOS).includes(tipo)) throw new Error(`tipo de pendência desconhecido: ${tipo}`);
  const codigo = gerarCodigo(rand);
  const texto = `${String(corpo || "").trim()}\n\n${rodapeDeConfirmacao(codigo)}`;
  await client.acaoPendenteWhatsapp.updateMany({
    where: { conversaId: String(conversaId), status: STATUS.PENDENTE },
    data: { status: STATUS.CANCELADA },
  });
  const acao = await client.acaoPendenteWhatsapp.create({
    data: {
      conversaId: String(conversaId),
      portalClientId: String(portalClientId),
      userId: userId ? String(userId) : null,
      tipo,
      payload,
      textoDeConfirmacao: texto,
      codigo,
      expiraEm: new Date(agora.getTime() + TTL_MS),
      status: STATUS.PENDENTE,
    },
  });
  return { acao, texto, codigo };
}

export async function cancelarPendencia(acaoId, { client = prisma } = {}) {
  await client.acaoPendenteWhatsapp.updateMany({ where: { id: String(acaoId), status: STATUS.PENDENTE }, data: { status: STATUS.CANCELADA } });
}

export async function marcarExpirada(acaoId, { client = prisma } = {}) {
  await client.acaoPendenteWhatsapp.updateMany({ where: { id: String(acaoId), status: STATUS.PENDENTE }, data: { status: STATUS.EXPIRADA } });
}

/**
 * CONFIRMA (reserva atômica) E EXECUTA. Devolve o que dizer ao cliente e se o fio vai à fila humana.
 * @returns {Promise<{executou:boolean, texto:string, filaHumana:boolean, resultado:object|null}>}
 */
export async function confirmarEExecutar({ acaoId, conversaId = null, portalClientId = null, agora = new Date(), client = prisma, log = logPadrao, executores = null, deps = DEPS_PADRAO } = {}) {
  const reserva = await client.acaoPendenteWhatsapp.updateMany({
    where: {
      id: String(acaoId), status: STATUS.PENDENTE, expiraEm: { gt: agora },
      ...(conversaId ? { conversaId: String(conversaId) } : {}),
      // ⚠ A EMPRESA TAMBÉM ENTRA: o escritório pode ter RE-VINCULADO o fio a outra empresa nos 10
      // minutos da pendência, e aí o ato sairia no CNPJ em que ela nasceu, não no do fio de agora.
      ...(portalClientId ? { portalClientId: String(portalClientId) } : {}),
    },
    data: { status: STATUS.CONFIRMADA, confirmadaEm: agora },
  });
  if (!reserva.count) {
    // Já confirmada por outra entrega, cancelada, expirou entre a leitura e a reserva — ou é de outro fio.
    return { executou: false, texto: "Esse pedido já foi tratado ou expirou. Se ainda quiser, peça de novo.", filaHumana: false, resultado: null };
  }
  const acao = await client.acaoPendenteWhatsapp.findUnique({ where: { id: String(acaoId) } });

  // ⚠ A RECONFERÊNCIA DO PORTÃO, fechada: recusa E erro interno terminam sem executar.
  if (acao.tipo === TIPOS.EMITIR_NFSE || acao.tipo === TIPOS.CANCELAR_NFSE) {
    let autorizacao;
    try {
      autorizacao = await deps.autorizarEmissaoDoCliente({ portalClientId: acao.portalClientId, userId: acao.userId, client });
    } catch (err) {
      log?.error?.({ err: err?.message, acaoId: acao.id }, "assistente: reconferência da autorização lançou — recusando");
      autorizacao = { ok: false, codigo: "RECONFERENCIA_FALHOU" };
    }
    if (!autorizacao?.ok) {
      await client.acaoPendenteWhatsapp.update({ where: { id: acao.id }, data: { status: STATUS.CANCELADA, resultado: { erro: "RECONFERENCIA", codigo: autorizacao?.codigo || null } } });
      log?.warn?.({ acaoId: acao.id, tipo: acao.tipo, codigo: autorizacao?.codigo }, "assistente: autorização mudou entre o pedido e a confirmação");
      return { executou: false, texto: TEXTO_RECONFERENCIA, filaHumana: true, resultado: { erro: "RECONFERENCIA", codigo: autorizacao?.codigo || null } };
    }
  }

  const exec = executores || EXECUTORES;
  const executor = exec[acao.tipo];
  let desfecho;
  try {
    desfecho = await executor({ acao, log, client, deps, agora });
  } catch (err) {
    log?.error?.({ err: err?.message, acaoId: acao.id, tipo: acao.tipo }, "assistente: execução da ação pendente lançou");
    desfecho = { texto: "Não consegui concluir o pedido — o escritório vai conferir e responder por aqui.", filaHumana: true, resultado: { erro: String(err?.code || err?.message || "erro"), indeterminado: true } };
  }
  await client.acaoPendenteWhatsapp.update({
    where: { id: acao.id },
    data: { status: STATUS.EXECUTADA, executadaEm: new Date(), resultado: desfecho.resultado ?? null },
  });
  return { executou: true, texto: desfecho.texto, filaHumana: Boolean(desfecho.filaHumana), resultado: desfecho.resultado ?? null };
}

// ── OS EXECUTORES — um por tipo, chamando a MESMA função da rota ─────────────────────────────────

async function executarEmissao({ acao, log, deps = DEPS_PADRAO }) {
  const legacyCompanyId = await deps.resolveLegacyCompanyId(acao.portalClientId);
  if (!legacyCompanyId) return { texto: "Não encontrei o cadastro fiscal da empresa. O escritório vai conferir.", filaHumana: true, resultado: { erro: "company_not_found" } };
  let result;
  try {
    result = await deps.NfseService.issue({ data: { ...(acao.payload || {}), companyId: legacyCompanyId }, log });
  } catch (err) {
    const codigo = String(err?.code || "");
    if (codigo === "COMPANY_MISSING_FIELDS") {
      return { texto: `A empresa está com o cadastro de emissão incompleto (${(err.missing || []).join(", ")}). O escritório precisa completar antes de emitir.`, filaHumana: true, resultado: { erro: codigo, missing: err.missing || [] } };
    }
    return { texto: "A emissão foi recusada antes de sair. O escritório vai conferir o motivo e responder por aqui.", filaHumana: true, resultado: { erro: codigo || String(err?.message || "erro") } };
  }
  if (result?.status === "issued") {
    const numero = result?.nfse?.numeroNfse || result?.nfse?.numero || result?.numeroNfse || null;
    return {
      texto: `Nota emitida${numero ? ` — número ${numero}` : ""}. Ela aparece no portal e posso mandar o DANFSe por aqui se quiser.`,
      filaHumana: false,
      resultado: { status: "issued", numero, nfseId: result?.nfse?.id || result?.invoiceId || null },
    };
  }
  if (result?.status === "rejected") {
    return {
      texto: `A prefeitura/sistema nacional RECUSOU a nota: ${result.message || result.codigo || "motivo não informado"}. Nada foi emitido. ${result.correcao || "O escritório pode corrigir e emitir de novo."}`,
      filaHumana: true,
      resultado: { status: "rejected", codigo: result.codigo || null, camada: result.camada || CAMADA.RECEITA },
    };
  }
  if (result?.camada === CAMADA.TRANSPORTE) {
    return {
      texto: "Não consegui confirmar se a nota saiu: a comunicação com o sistema nacional falhou no meio. NÃO peça de novo — o escritório vai conferir antes de qualquer nova tentativa.",
      filaHumana: true,
      resultado: { status: result?.status || "falha_envio", camada: CAMADA.TRANSPORTE, indeterminado: true, codigo: result?.codigo || null },
    };
  }
  return {
    texto: `A emissão não saiu: ${result?.message || result?.codigo || "motivo não informado"}. O escritório vai conferir.`,
    filaHumana: true,
    resultado: { status: result?.status || "falha_envio", camada: result?.camada || CAMADA.NOSSA, codigo: result?.codigo || null },
  };
}

async function executarCancelamento({ acao, log, deps = DEPS_PADRAO }) {
  const legacyCompanyId = await deps.resolveLegacyCompanyId(acao.portalClientId);
  if (!legacyCompanyId) return { texto: "Não encontrei o cadastro fiscal da empresa. O escritório vai conferir.", filaHumana: true, resultado: { erro: "company_not_found" } };
  const p = acao.payload || {};
  try {
    const r = await deps.NfseService.sendEvent({
      chaveAcesso: p.chaveAcesso,
      tipoEvento: "e101101",
      cMotivo: p.cMotivo,
      justificativa: p.justificativa,
      companyId: legacyCompanyId,
      log,
    });
    // ⚠ O NOSSO registro da emissão acompanha — a mesma linha da rota `POST /client/.../cancelar`.
    // É `ServiceInvoice` (nossa tabela), NUNCA `PortalInvoice` (projeção do ADN, que a captura
    // atualiza). `updateByChaveAcesso` devolve null quando a nota não é nossa — não é erro.
    await deps.NfseRepository.updateByChaveAcesso(p.chaveAcesso, { status: "cancelled" });
    return { texto: `Pedido de cancelamento da nota ${p.numero || ""} enviado e aceito. A nota passa a constar como cancelada assim que o sistema nacional processar.`, filaHumana: false, resultado: { status: r?.status || "accepted" } };
  } catch (err) {
    const camada = err?.camada || null;
    if (camada === CAMADA.TRANSPORTE) {
      return { texto: "Não consegui confirmar se o cancelamento foi registrado: a comunicação falhou no meio. NÃO peça de novo — o escritório vai conferir antes.", filaHumana: true, resultado: { camada, indeterminado: true, codigo: err?.codigo || err?.code || null } };
    }
    if (camada === CAMADA.RECEITA) {
      return { texto: `O sistema nacional RECUSOU o cancelamento: ${err?.message || err?.codigo || "motivo não informado"}. A nota continua válida.`, filaHumana: true, resultado: { camada, codigo: err?.codigo || null } };
    }
    return { texto: `O cancelamento não saiu: ${err?.message || err?.code || "motivo não informado"}. Nada foi cancelado. O escritório vai conferir.`, filaHumana: true, resultado: { camada: camada || CAMADA.NOSSA, codigo: err?.code || err?.codigo || null } };
  }
}

async function executarRecalculo({ acao, log, client, deps = DEPS_PADRAO, agora = new Date() }) {
  const p = acao.payload || {};
  // ⚠ AS 4 TRAVAS DA ROTA, DE NOVO, NA HORA DE EXECUTAR — a guia pode ter sido paga ou revogada
  // nos 10 minutos entre o pedido e o CONFIRMAR, e a chamada ao SERPRO é PAGA.
  const guide = await client.guide.findFirst({ where: { id: String(p.guideId), portalClientId: acao.portalClientId, liberadaCliente: true } });
  if (!guide) return { texto: "Não encontrei essa guia liberada para a empresa.", filaHumana: false, resultado: { erro: "not_found" } };
  if (guide.status !== "PROCESSED") return { texto: "Esta guia ainda está sendo processada; não dá para gerar a atualizada agora.", filaHumana: false, resultado: { erro: "guia_nao_processada" } };
  if (!deps.canGuideRecalculate(guide)) return { texto: "Esta guia não pode ser gerada de novo por aqui. Fale com o escritório.", filaHumana: true, resultado: { erro: "recalculo_indisponivel" } };
  if (!deps.isGuideOverdue(guide, agora)) return { texto: "Esta guia não consta como vencida agora — use a que você já tem.", filaHumana: false, resultado: { erro: "guia_nao_vencida" } };
  const contexto = { origem: ORIGENS.RECALCULAR, userId: acao.userId || null, forcar: false };
  try {
    const especie = especieDoRecalculo(guide);
    let atualizada;
    let acrescimos = null;
    if (especie === ESPECIE_RECALCULO.DARF_PRESUMIDO) {
      const darf = await deps.comContextoSerpro(contexto, () => deps.reemitirDarfLp({ portalClientId: acao.portalClientId, competencia: guide.competencia, guideId: guide.id }));
      await deps.markGuideOpenBySerpro({ guideId: guide.id });
      atualizada = await client.guide.findUnique({ where: { id: guide.id } });
      acrescimos = leituraDosAcrescimos(darf?.composicao, { ehCliente: true });
    } else {
      const result = await deps.comContextoSerpro(contexto, () => deps.capturePgdasGuideForCompany({
        portalClientId: acao.portalClientId, competencia: guide.competencia, existingGuideId: guide.id, serviceId: SERPRO_PGDASD_SERVICE_COBRANCA,
      }));
      await deps.markGuideOpenBySerpro({ guideId: result.guide.guideId });
      atualizada = await client.guide.findUnique({ where: { id: result.guide.guideId } });
    }
    const venc = atualizada?.vencimento ? new Date(atualizada.vencimento).toLocaleDateString("pt-BR", { timeZone: "UTC" }) : "não informado";
    return {
      texto: `Guia atualizada: ${fmtBRL(atualizada?.valor)}, vencimento ${venc}.${acrescimos?.texto ? ` ${acrescimos.texto}` : ""} Posso mandar o PDF por aqui.`,
      filaHumana: false,
      resultado: { guideId: atualizada?.id || guide.id, valor: atualizada?.valor != null ? Number(atualizada.valor) : null, vencimento: atualizada?.vencimento || null },
    };
  } catch (err) {
    // ⚠ A recusa da guarda do SERPRO chega TRADUZIDA: o orçamento do escritório nunca vai ao cliente.
    const traduzida = traduzirRecusaParaCliente(err);
    return { texto: traduzida?.mensagem || "Não consegui gerar a guia atualizada agora. O escritório vai conferir.", filaHumana: true, resultado: { erro: traduzida?.codigo || err?.code || String(err?.message || "erro") } };
  }
}

export const EXECUTORES = Object.freeze({
  [TIPOS.EMITIR_NFSE]: executarEmissao,
  [TIPOS.CANCELAR_NFSE]: executarCancelamento,
  [TIPOS.RECALCULAR_GUIA]: executarRecalculo,
});

// Reexportado para quem monta o texto da pendência de emissão sem depender do serviço inteiro.
export { classificarFalha };
