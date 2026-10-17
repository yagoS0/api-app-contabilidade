import { versaoPagamentoGuia } from './ConfirmacaoPagamentoClienteService.js';
import { createHash, randomUUID } from "node:crypto";
import { prisma } from "../../infrastructure/db/prisma.js";
import { faseAvisoGuia, calendarioAvisosGuia } from './calendarioAvisosGuia.js';
import { templateOperacional } from '../whatsapp/TemplateOperacionalWhatsapp.js';
import { conferirEntregaGuiaWhatsapp } from './EntregaGuiaWhatsappService.js';

const erro = (code, message) => Object.assign(new Error(message), { code });

export async function transportePadrao() {
  const contatos = await import("../whatsapp/ContatoWhatsappService.js");
  return {
    destinatarios: contatos.destinatariosDeEnvio,
    async whatsapp({ companyId, contato, texto, acoes, botaoId, key, conferir, fase, variaveis }) {
      const { INTEGRACAO_WHATSAPP } = await import("../../config.js");
      if (!INTEGRACAO_WHATSAPP) throw erro("WHATSAPP_DESLIGADO", "WhatsApp desativado; aviso pendente para o contador.");
      const { garantirConversa, janelaDaConversa } = await import("../whatsapp/ConversaWhatsappService.js");
      const { whatsappPorCanal } = await import("../whatsapp/CanalWhatsappService.js");
      const { enviarMensagemRastreada } = await import("../whatsapp/SaidaWhatsappService.js");
      const conversa = await garantirConversa({ telefone: contato.telefoneE164, portalClientId: companyId });
      const aberta = (await janelaDaConversa(conversa.id)).situacao === 'ABERTA';
      const chaveTemplate = fase === 'ANTES' ? 'guia_pagamento_antes_v1' : acoes.length ? 'guia_pagamento_depois_atualizacao_v2' : 'guia_pagamento_depois_v1';
      const template = aberta ? null : await templateOperacional(chaveTemplate, prisma);
      const checar = async () => {
        await conferir();
        if (aberta && (await janelaDaConversa(conversa.id)).situacao !== 'ABERTA') throw erro('WHATSAPP_JANELA_FECHADA', 'A janela fechou antes do envio.');
        if (!aberta) await templateOperacional(chaveTemplate, prisma);
      };
      await checar();
      const cloud = await whatsappPorCanal(conversa);
      const botoes = [{ id: botaoId, titulo: 'Confirmar pagamento' }, ...acoes.map(a => ({ id: a.id, titulo: a.label }))];
      return enviarMensagemRastreada({ conversa, corpo: texto, tipo: aberta ? 'interactive' : 'template', autor: 'SISTEMA', turnoIaId: key,
        antesDeEnviar: checar, enviar: () => aberta ? cloud.enviarBotoes({ telefone: contato.telefoneE164, texto, botoes })
          : cloud.enviarTemplate({ telefone: contato.telefoneE164, template: template.nomeMeta, idioma: template.idioma, variaveis, botoesResposta: botoes.map(b => b.id) }) });
    },
  };
}

/** Retorno negativo concluído é aviso de ausência de confirmação, nunca ordem para pagar novamente. */
export async function avisarPagamentoNaoConfirmado({ guideId = null, parcelaId = null, scheduledAt, assertActive = () => {}, agora = new Date() }, deps = {}) {
  if (!scheduledAt) return { status: "IGNORADO", motivo: "CONSULTA_MANUAL" };
  const db = deps.db || prisma;
  const feriados = deps.feriados ?? await db.feriado.findMany({});
  const carregar = async () => {
    const p = parcelaId ? await db.parcela.findUnique({ where: { id: parcelaId }, include: { guia: true, parcelamento: true } }) : null;
    const g = p?.guia || (guideId ? await db.guide.findUnique({ where: { id: guideId } }) : null);
    if (!p && !g) throw erro("DOCUMENTO_NAO_ENCONTRADO", "Documento não encontrado.");
    if (p?.origemBaixa || p?.baixadaEm || p?.pagamentoStatus === "CONFIRMADO" || g?.baixada || g?.paymentStatus === "PAID" || g?.clienteConfirmouEm || g?.paymentConfirmedAt) throw erro("PAGAMENTO_JA_CONFIRMADO", "Pagamento já confirmado; aviso cancelado.");
    if (p?.pagamentoErro || p?.pagamentoStatus === "DIVERGENTE") throw erro("CONSULTA_NAO_CONCLUIDA", "Pagamento precisa de conferência pelo contador.");
    if (!g?.liberadaCliente) throw erro("GUIA_NAO_LIBERADA", "Obtenha e libere a guia no portal antes de avisar o cliente.");
    if (g.status !== 'PROCESSED') throw erro('GUIA_NAO_PROCESSADA', 'A guia precisa de revisão antes de avisar o cliente.');
    const companyId = p?.portalClientId || g.portalClientId;
    const company = await db.portalClient.findUnique({ where: { id: companyId }, select: { razao: true, municipio: true } });
    const fase = faseAvisoGuia(g.vencimento, agora, feriados, company?.municipio);
    if (!fase) throw erro('FORA_DO_DIA_DO_AVISO', 'Hoje não é o dia útil anterior ou posterior ao vencimento.');
    return { p, g, companyId, company, fase };
  };
  let doc;
  try { await assertActive(); doc = await carregar(); }
  catch (e) {
    if (!["PAGAMENTO_JA_CONFIRMADO", "FORA_DO_DIA_DO_AVISO", "GUIA_NAO_LIBERADA", "GUIA_NAO_PROCESSADA", "CONSULTA_NAO_CONCLUIDA"].includes(e.code)) throw e;
    return { status: ["PAGAMENTO_JA_CONFIRMADO", "FORA_DO_DIA_DO_AVISO"].includes(e.code) ? "IGNORADO" : "PENDENTE", motivo: e.code, mensagem: e.message };
  }
  const { p, g, companyId, company, fase } = doc;
  const referencia = p?.anoMesParcela || g?.competencia || p?.competencia;
  if (!companyId || !referencia) return { status: "PENDENTE", motivo: "IDENTIFICACAO_INCOMPLETA" };
  const acoes = fase === 'DEPOIS' ? [{ acao: 'recalcular', label: 'Atualizar guia' }] : [];
  // O vínculo posterior pode mudar parcela/contrato; a guia e sua competência preservam a identidade.
  const base = createHash("sha256").update(JSON.stringify([companyId, g.id, g.competencia || referencia, fase, new Date(g.vencimento).toISOString().slice(0, 10)])).digest("hex");
  const transporte = deps.transporte || await transportePadrao();
  const destinos = await transporte.destinatarios(companyId);
  const targets = destinos.telefones.map(contato => ({ canal: "WHATSAPP", destino: contato.telefoneE164, contato }));
  if (!targets.length) return { status: "PENDENTE", motivo: "SEM_DESTINATARIO_WHATSAPP", mensagem: "Cadastre um destinatário WhatsApp com autorização de envio para confirmar o pagamento.", companyId, guideId: g.id, parcelaId: p?.id || null };
  const tipo = p ? `parcela${p.numeroParcela ? ` ${p.numeroParcela}` : ""} do parcelamento${p.parcelamento?.numeroParcelamento ? ` ${p.parcelamento.numeroParcelamento}` : ""}` : g.tipo;
  const vencimento = calendarioAvisosGuia(g.vencimento, feriados, company?.municipio).vencimento.split('-').reverse().join('/');
  const variaveis = [company?.razao || 'Empresa', tipo, referencia, vencimento].map(String);
  const texto = `${variaveis[0]}\nPode confirmar se a guia de ${tipo}, referência ${referencia}, com vencimento em ${vencimento}, já foi paga?\nSe você já pagou, toque em Confirmar pagamento abaixo. Não é necessário pagar novamente.${fase === 'DEPOIS' ? `\nSe ainda não pagou, ${acoes.length ? 'toque em Atualizar guia. Quando possível, faremos a atualização automática, com os acréscimos aplicáveis; nos demais casos, o contador receberá o pedido' : 'solicite a atualização desta guia ao contador'}.` : ''}`;
  const resultados = [];
  for (const target of targets) {
    // Verificar antes da reserva permite nova avaliação após o escritório entregar
    // a guia. O resultado da rotina preserva a pendência, sem consumir o aviso.
    try { await conferirEntregaGuiaWhatsapp(db, g, target.destino, target.contato.vinculoNumeroId); }
    catch (e) {
      if (e.code !== 'GUIA_WHATSAPP_NAO_ENTREGUE') throw e;
      resultados.push({ status: 'PENDENTE', motivo: e.code, mensagem: e.message, canal: target.canal });
      continue;
    }
    const key = `aviso_pagamento:${base}:${createHash("sha256").update(`${target.canal}:${target.destino}`).digest("hex")}`;
    const value = { status: "RESERVADO", companyId, guideId: g?.id || null, parcelaId: p?.id || null, referencia, fase, scheduledAt, canal: target.canal, criadoEm: new Date().toISOString() };
    try { await db.appSetting.create({ data: { key, value } }); }
    catch (e) {
      if (e.code !== "P2002") throw e;
      const anterior = await db.appSetting.findUnique({ where: { key } });
      resultados.push({ status: anterior?.value?.status === "ENVIADO" ? "JA_ENVIADO" : "PENDENTE", motivo: anterior?.value?.motivo || "AVISO_JA_RESERVADO", mensagem: anterior?.value?.mensagem || "Confira o histórico do aviso antes de reenviar.", canal: target.canal }); continue;
    }
    let iniciou = false;
    const conferir = async () => {
      await assertActive(); const atual = await carregar();
      if (versaoPagamentoGuia(atual.g) !== versaoPagamentoGuia(g) || (atual.g.hash || null) !== (g.hash || null) || String(atual.g.valor) !== String(g.valor)
        || String(atual.g.vencimento) !== String(g.vencimento) || atual.fase !== fase) throw erro('GUIA_ALTERADA', 'A guia mudou durante a preparação do aviso.');
      const cadastro = await transporte.destinatarios(companyId);
      const contatoAtual = cadastro.telefones.find(c => c.id === target.contato.id && c.telefoneE164 === target.destino);
      if (!contatoAtual || (contatoAtual.vinculoNumeroId || null) !== (target.contato.vinculoNumeroId || null)) throw erro("DESTINATARIO_ALTERADO", "Configuração de envio mudou; aviso pendente.");
      await conferirEntregaGuiaWhatsapp(db, atual.g, target.destino, contatoAtual.vinculoNumeroId);
    };
    try {
      await conferir();
      // Transporte repete as guardas imediatamente antes da rede; a reserva nunca é reenviada após timeout.
      const checarTransporte = async () => { await conferir(); iniciou = true; };
      const botaoId = 'altan.payment.confirm.' + randomUUID();
      const token = { versaoPagamento: versaoPagamentoGuia(g), companyId, guideId: g.id, competencia: g.competencia || null, hash: g.hash || null, contatoId: target.contato.id, telefone: target.destino, expiraEm: new Date(agora.getTime()+7*86400000).toISOString() };
      await db.appSetting.create({ data: { key: botaoId, value: token } });
      const botoesAcoes = [];
      for (const acao of acoes) {
        const id = 'altan.payment.recalculate.' + randomUUID();
        await db.appSetting.create({ data: { key: id, value: token } });
        botoesAcoes.push({ ...acao, id });
      }
      await transporte.whatsapp({ companyId, contato: target.contato, texto, acoes: botoesAcoes, botaoId, key, fase, variaveis, conferir: checarTransporte });
      await db.appSetting.update({ where: { key }, data: { value: { ...value, status: "ENVIADO", concluidoEm: new Date().toISOString() } } });
      resultados.push({ status: "ENVIADO", canal: target.canal });
    } catch (e) {
      const motivo = e.code || e.codigo || "AVISO_ENVIO_NAO_CONFIRMADO";
      const status = motivo === "PAGAMENTO_JA_CONFIRMADO" ? "CANCELADO" : iniciou && !["WHATSAPP_JANELA_FECHADA", "WHATSAPP_TEMPLATE_PENDENTE", "DESTINATARIO_ALTERADO", "GUIA_ALTERADA", "GUIA_WHATSAPP_NAO_ENTREGUE", "GUIA_NAO_PROCESSADA"].includes(motivo) ? "INDETERMINADO" : "PENDENTE";
      const mensagem = e.code || e.codigo ? e.message : "Não foi possível confirmar o envio. Confira o histórico antes de reenviar.";
      await db.appSetting.update({ where: { key }, data: { value: { ...value, status, motivo, mensagem, concluidoEm: new Date().toISOString() } } });
      resultados.push({ status, motivo, mensagem, canal: target.canal });
    }
  }
  return { status: resultados.every(r => r.status === "JA_ENVIADO") ? "JA_ENVIADO" : resultados.every(r => ["ENVIADO", "JA_ENVIADO"].includes(r.status)) ? "ENVIADO" : "PENDENTE", companyId, razao: company?.razao, competencia: g.competencia, tipo: g.tipo, mensagem: resultados.filter(r => r.status === 'PENDENTE').map(r => r.mensagem).filter(Boolean).join(' ') || undefined, guideId: g?.id || null, parcelaId: p?.id || null, resultados };
}
