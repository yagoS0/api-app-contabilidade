import { createHash } from "node:crypto";
import { prisma } from "../../infrastructure/db/prisma.js";
import { canGuideRecalculate } from "./lib/recalculoDaGuia.js";
import { elegibilidadeVencimentoAutomatico } from "../fiscal/serpro/ConsultaPagamentoAutomaticaService.js";

const esc = value => String(value ?? "").replace(/[&<>\"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const erro = (code, message) => Object.assign(new Error(message), { code });

async function transportePadrao() {
  const contatos = await import("../whatsapp/ContatoWhatsappService.js");
  return {
    canais: contatos.canaisParaEnvio,
    destinatarios: contatos.destinatariosDeEnvio,
    async email({ to, texto, acoes, conferir }) {
      const { EmailService } = await import("../../infrastructure/mail/EmailService.js");
      await conferir();
      const botoes = acoes.map(a => `<a href="${esc(a.url)}" style="display:inline-block;padding:12px 18px;margin:8px 8px 0 0;background:#1b4167;color:#fff;text-decoration:none;border-radius:6px">${esc(a.label)}</a>`).join("");
      return new EmailService().send({ to, subject: "Confirmação de pagamento da guia", html: `<p>${esc(texto).replaceAll("\n", "<br>")}</p>${botoes}`, attachments: [] });
    },
    async whatsapp({ companyId, contato, texto, acoes, key, conferir }) {
      const { INTEGRACAO_WHATSAPP } = await import("../../config.js");
      if (!INTEGRACAO_WHATSAPP) throw erro("WHATSAPP_DESLIGADO", "WhatsApp desativado; aviso pendente para o contador.");
      const { garantirConversa, janelaDaConversa } = await import("../whatsapp/ConversaWhatsappService.js");
      const { whatsappPorCanal } = await import("../whatsapp/CanalWhatsappService.js");
      const { enviarMensagemRastreada } = await import("../whatsapp/SaidaWhatsappService.js");
      const conversa = await garantirConversa({ telefone: contato.telefoneE164, portalClientId: companyId });
      const checar = async () => {
        await conferir();
        if ((await janelaDaConversa(conversa.id)).situacao !== "ABERTA") throw erro("WHATSAPP_JANELA_FECHADA", "Janela do WhatsApp fechada e sem modelo aprovado para este aviso; contador deve contatar o cliente.");
      };
      await checar();
      const cloud = await whatsappPorCanal(conversa);
      const corpo = `${texto}\n\n${acoes.map(a => `${a.label}: ${a.url}`).join("\n")}`;
      return enviarMensagemRastreada({ conversa, corpo, autor: "SISTEMA", turnoIaId: key,
        antesDeEnviar: checar, enviar: () => cloud.enviarTexto({ telefone: contato.telefoneE164, texto: corpo }) });
    },
  };
}

/** Retorno negativo concluído é aviso de ausência de confirmação, nunca ordem para pagar novamente. */
export async function avisarPagamentoNaoConfirmado({ guideId = null, parcelaId = null, scheduledAt, assertActive = () => {} }, deps = {}) {
  if (!scheduledAt) return { status: "IGNORADO", motivo: "CONSULTA_MANUAL" };
  const db = deps.db || prisma;
  const carregar = async () => {
    const p = parcelaId ? await db.parcela.findUnique({ where: { id: parcelaId }, include: { guia: true, parcelamento: true } }) : null;
    const g = p?.guia || (guideId ? await db.guide.findUnique({ where: { id: guideId } }) : null);
    if (!p && !g) throw erro("DOCUMENTO_NAO_ENCONTRADO", "Documento não encontrado.");
    if (p?.origemBaixa || p?.baixadaEm || p?.pagamentoStatus === "CONFIRMADO" || g?.baixada || g?.paymentStatus === "PAID" || g?.clienteConfirmouEm) throw erro("PAGAMENTO_JA_CONFIRMADO", "Pagamento já confirmado; aviso cancelado.");
    if (p?.pagamentoErro || p?.pagamentoStatus === "DIVERGENTE") throw erro("CONSULTA_NAO_CONCLUIDA", "Pagamento precisa de conferência pelo contador.");
    if (!g?.liberadaCliente) throw erro("GUIA_NAO_LIBERADA", "Obtenha e libere a guia no portal antes de avisar o cliente.");
    if (elegibilidadeVencimentoAutomatico(g.vencimento)) throw erro("GUIA_NAO_VENCIDA", "Guia sem vencimento anterior a hoje; não avisar cobrança.");
    return { p, g, companyId: p?.portalClientId || g.portalClientId };
  };
  let doc;
  try { await assertActive(); doc = await carregar(); }
  catch (e) {
    if (!["PAGAMENTO_JA_CONFIRMADO", "GUIA_NAO_VENCIDA", "GUIA_NAO_LIBERADA", "CONSULTA_NAO_CONCLUIDA"].includes(e.code)) throw e;
    return { status: ["PAGAMENTO_JA_CONFIRMADO", "GUIA_NAO_VENCIDA"].includes(e.code) ? "IGNORADO" : "PENDENTE", motivo: e.code, mensagem: e.message };
  }
  const { p, g, companyId } = doc;
  const referencia = p?.anoMesParcela || g?.competencia || p?.competencia;
  if (!companyId || !referencia) return { status: "PENDENTE", motivo: "IDENTIFICACAO_INCOMPLETA" };
  const portalUrl = deps.portalUrl ?? (await import("../../config.js")).PORTAL_CLIENTE_WEB_URL;
  let baseUrl;
  try { baseUrl = new URL(portalUrl); if (!["https:", "http:"].includes(baseUrl.protocol)) throw Error(); }
  catch { return { status: "PENDENTE", motivo: "PORTAL_NAO_CONFIGURADO", mensagem: "Configure o endereço do portal para enviar as ações ao cliente." }; }
  const acoes = [{ acao: "confirmar", label: "Confirmar pagamento" }, ...(canGuideRecalculate(g) ? [{ acao: "recalcular", label: "Recalcular guia" }] : [])].map(a => {
    const link = new URL(baseUrl.href); link.hash = "/guias"; link.search = new URLSearchParams({ empresa: companyId, guia: g.id, competencia: g.competencia || p?.competencia || "", acao: a.acao }).toString();
    return { ...a, url: link.href };
  });
  // O vínculo posterior pode mudar parcela/contrato; a guia e sua competência preservam a identidade.
  const base = createHash("sha256").update(JSON.stringify([companyId, g.id, g.competencia || referencia])).digest("hex");
  const transporte = deps.transporte || await transportePadrao();
  const company = await db.portalClient.findUnique({ where: { id: companyId }, select: { razao: true } });
  const { escolha } = await transporte.canais(companyId);
  const destinos = await transporte.destinatarios(companyId);
  const targets = escolha === "EMAIL" ? destinos.emails.map(email => ({ canal: "EMAIL", destino: email }))
    : escolha === "WHATSAPP" ? destinos.telefones.map(contato => ({ canal: "WHATSAPP", destino: contato.telefoneE164, contato })) : [];
  if (!targets.length) return { status: "PENDENTE", motivo: !escolha || escolha === "PERGUNTAR" ? "CANAL_REQUER_ESCOLHA" : "SEM_DESTINATARIO_CADASTRADO", mensagem: !escolha || escolha === "PERGUNTAR" ? "Escolha o canal para avisar este cliente." : "Cadastre um destinatário de guias para avisar este cliente.", companyId, guideId: g?.id || null, parcelaId: p?.id || null };
  const tipo = p ? `parcela${p.numeroParcela ? ` ${p.numeroParcela}` : ""} do parcelamento${p.parcelamento?.numeroParcelamento ? ` ${p.parcelamento.numeroParcelamento}` : ""}` : g.tipo;
  const texto = `${company?.razao || "Empresa"}\nA Receita ainda não confirmou o pagamento de ${tipo}, referência ${referencia}. Isso pode ocorrer enquanto o pagamento é processado.\nSe você já pagou, confirme no portal do cliente, informando a data do pagamento. Não é necessário pagar novamente.\nSe ainda não pagou, ${canGuideRecalculate(g) ? "use Recalcular guia para conferir a atualização antes de solicitar a emissão" : "solicite a atualização desta guia ao contador"}.`;
  const resultados = [];
  for (const target of targets) {
    const key = `aviso_pagamento:${base}:${createHash("sha256").update(`${target.canal}:${target.destino}`).digest("hex")}`;
    const value = { status: "RESERVADO", companyId, guideId: g?.id || null, parcelaId: p?.id || null, referencia, scheduledAt, canal: target.canal, criadoEm: new Date().toISOString() };
    try { await db.appSetting.create({ data: { key, value } }); }
    catch (e) {
      if (e.code !== "P2002") throw e;
      const anterior = await db.appSetting.findUnique({ where: { key } });
      resultados.push({ status: anterior?.value?.status === "ENVIADO" ? "JA_ENVIADO" : "PENDENTE", motivo: anterior?.value?.motivo || "AVISO_JA_RESERVADO", mensagem: anterior?.value?.mensagem || "Confira o histórico do aviso antes de reenviar.", canal: target.canal }); continue;
    }
    let iniciou = false;
    const conferir = async () => {
      await assertActive(); await carregar();
      const atual = await transporte.canais(companyId), cadastro = await transporte.destinatarios(companyId);
      if (atual.escolha !== target.canal || (target.canal === "EMAIL" ? !cadastro.emails.includes(target.destino) : !cadastro.telefones.some(c => c.id === target.contato.id && c.telefoneE164 === target.destino))) throw erro("DESTINATARIO_ALTERADO", "Configuração de envio mudou; aviso pendente.");
    };
    try {
      await conferir();
      // Transporte repete as guardas imediatamente antes da rede; a reserva nunca é reenviada após timeout.
      const checarTransporte = async () => { await conferir(); iniciou = true; };
      if (target.canal === "EMAIL") await transporte.email({ to: target.destino, texto, acoes, conferir: checarTransporte });
      else await transporte.whatsapp({ companyId, contato: target.contato, texto, acoes, key, conferir: checarTransporte });
      await db.appSetting.update({ where: { key }, data: { value: { ...value, status: "ENVIADO", concluidoEm: new Date().toISOString() } } });
      resultados.push({ status: "ENVIADO", canal: target.canal });
    } catch (e) {
      const motivo = e.code || e.codigo || "AVISO_ENVIO_NAO_CONFIRMADO";
      const status = motivo === "PAGAMENTO_JA_CONFIRMADO" ? "CANCELADO" : iniciou && !["WHATSAPP_JANELA_FECHADA", "DESTINATARIO_ALTERADO"].includes(motivo) ? "INDETERMINADO" : "PENDENTE";
      const mensagem = e.code || e.codigo ? e.message : "Não foi possível confirmar o envio. Confira o histórico antes de reenviar.";
      await db.appSetting.update({ where: { key }, data: { value: { ...value, status, motivo, mensagem, concluidoEm: new Date().toISOString() } } });
      resultados.push({ status, motivo, mensagem, canal: target.canal });
    }
  }
  return { status: resultados.every(r => r.status === "JA_ENVIADO") ? "JA_ENVIADO" : resultados.every(r => ["ENVIADO", "JA_ENVIADO"].includes(r.status)) ? "ENVIADO" : "PENDENTE", companyId, guideId: g?.id || null, parcelaId: p?.id || null, resultados };
}
