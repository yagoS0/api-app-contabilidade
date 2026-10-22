import { travarGuiaArrecadatoria } from './lib/documentoNaoArrecadatorio.js';
import { bloqueioEnvioParcela, conferirFormaIndicacaoParaEnvio } from './GuiaParcelaEnvioGuard.js';
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
      const chaveTemplate = fase === 'ANTES' ? 'guia_pagamento_antes_v1' : fase === 'NO_VENCIMENTO' ? 'guia_pagamento_no_vencimento_v1' : acoes.length ? 'guia_pagamento_depois_atualizacao_v2' : 'guia_pagamento_depois_v1';
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
    const vinculosDaGuia = { parcela: { include: { parcelamento: true } }, parcelamento: true };
    const informada = parcelaId ? await db.parcela.findUnique({ where: { id: parcelaId }, include: { guia: { include: vinculosDaGuia }, parcelamento: true } }) : null;
    if (parcelaId && !informada) throw erro('DOCUMENTO_NAO_ENCONTRADO', 'Parcela não encontrada.');
    const g = informada?.guia || (!parcelaId && guideId ? await db.guide.findUnique({ where: { id: guideId }, include: vinculosDaGuia }) : null);
    const p = informada || g?.parcela || null;
    if ((guideId && g && g.id !== guideId) || (p && g && (p.portalClientId !== g.portalClientId || (p.guiaId && p.guiaId !== g.id))))
      throw erro('DOCUMENTO_ESCOPO_DIVERGENTE', 'O vínculo entre guia e parcela precisa de conferência.');
    const contrato = p?.parcelamento || g?.parcelamento;
    if ((p?.parcelamentoId && g?.parcelamentoId && p.parcelamentoId !== g.parcelamentoId)
      || (p?.parcelamentoId && p?.parcelamento && p.parcelamentoId !== p.parcelamento.id)
      || (g?.parcelamentoId && g?.parcelamento && g.parcelamentoId !== g.parcelamento.id))
      throw erro('DOCUMENTO_ESCOPO_DIVERGENTE', 'Guia e parcela estão vinculadas a contratos diferentes. Confira o vínculo antes do aviso.');
    if (contrato?.portalClientId && contrato.portalClientId !== (g?.portalClientId || p?.portalClientId)) throw erro('DOCUMENTO_ESCOPO_DIVERGENTE', 'O contrato não pertence à empresa da guia.');
    if ((g?.parcelamentoId || p?.parcelamentoId) && !contrato) throw erro('PARCELA_VINCULO_INCOMPLETO', 'O contrato desta parcela precisa de conferência.');
    if (p?.pagamentoErro || ['DIVERGENTE', 'ERRO'].includes(p?.pagamentoStatus)) throw erro('CONSULTA_NAO_CONCLUIDA', 'Pagamento precisa de conferência pelo contador.');
    if (g) await conferirFormaIndicacaoParaEnvio(g, db);
    const bloqueio = bloqueioEnvioParcela({ ...g, parcelamentoId: g?.parcelamentoId || p?.parcelamentoId, parcela: p, parcelamento: contrato });
    if (bloqueio) throw erro(bloqueio.code, bloqueio.message);
    if (!p && !g) throw erro("DOCUMENTO_NAO_ENCONTRADO", "Documento não encontrado.");
    if (p?.origemBaixa || p?.baixadaEm || p?.pagamentoStatus === "CONFIRMADO" || g?.baixada || g?.paymentStatus === "PAID" || g?.clienteConfirmouEm || g?.paymentConfirmedAt) throw erro("PAGAMENTO_JA_CONFIRMADO", "Pagamento já confirmado; aviso cancelado.");

    if (!g?.liberadaCliente) throw erro("GUIA_NAO_LIBERADA", "Obtenha e libere a guia no portal antes de avisar o cliente.");
    if (g.status !== 'PROCESSED') throw erro('GUIA_NAO_PROCESSADA', 'A guia precisa de revisão antes de avisar o cliente.');
    const companyId = p?.portalClientId || g.portalClientId;
    const company = await db.portalClient.findUnique({ where: { id: companyId }, select: { razao: true, municipio: true } });
    if (!calendarioAvisosGuia(g.vencimento, feriados, company?.municipio)) throw erro('VENCIMENTO_INVALIDO', 'Confira o vencimento da guia antes de avisar o cliente.');
    const fase = faseAvisoGuia(g.vencimento, agora, feriados, company?.municipio);
    if (!fase) throw erro('FORA_DO_DIA_DO_AVISO', 'Hoje não é o dia útil anterior, o vencimento ajustado ou o dia útil posterior.');
    return { p: p ? { ...p, parcelamento: contrato } : null, g, companyId, company, fase };
  };
  let doc;
  try { await assertActive(); doc = await carregar(); }
  catch (e) {
    if (!["VENCIMENTO_INVALIDO", "PAGAMENTO_JA_CONFIRMADO", "FORA_DO_DIA_DO_AVISO", "GUIA_NAO_LIBERADA", "GUIA_NAO_PROCESSADA", "CONSULTA_NAO_CONCLUIDA", "PARCELA_PAGA", "PARCELA_DEBITO_AUTOMATICO", "PARCELAMENTO_EXCLUIDO", "PARCELA_DOCUMENTO_PENDENTE", "PARCELA_DOCUMENTO_INCOMPLETO", "PARCELA_VINCULO_INCOMPLETO", "DOCUMENTO_ESCOPO_DIVERGENTE"].includes(e.code)) throw e;
    return { status: ["PAGAMENTO_JA_CONFIRMADO", "FORA_DO_DIA_DO_AVISO", "PARCELA_PAGA", "PARCELA_DEBITO_AUTOMATICO", "PARCELAMENTO_EXCLUIDO"].includes(e.code) ? "IGNORADO" : "PENDENTE", motivo: e.code, mensagem: e.message };
  }
  const { p, g, companyId, company, fase } = doc;
  const referencia = p?.anoMesParcela || g?.competencia || p?.competencia;
  if (!companyId || !referencia) return { status: "PENDENTE", motivo: "IDENTIFICACAO_INCOMPLETA" };
  const acoes = fase === 'DEPOIS' ? [{ acao: 'recalcular', label: 'Atualizar guia' }] : [];
  // O vínculo posterior pode mudar parcela/contrato; a guia e sua competência preservam a identidade.
  const base = createHash("sha256").update(JSON.stringify([companyId, g.id, g.competencia || referencia, fase, new Date(g.vencimento).toISOString().slice(0, 10)])).digest("hex");
  const revisao = versaoPagamentoGuia(g);
  const transporte = deps.transporte || await transportePadrao();
  const destinos = await transporte.destinatarios(companyId);
  const targets = destinos.telefones.map(contato => ({ canal: "WHATSAPP", destino: contato.telefoneE164, contato }));
  if (!targets.length) return { status: "PENDENTE", motivo: "SEM_DESTINATARIO_WHATSAPP", mensagem: "Cadastre um destinatário WhatsApp com autorização de envio para confirmar o pagamento.", companyId, guideId: g.id, parcelaId: p?.id || null };
  const tipo = p ? `parcela${p.numeroParcela ? ` ${p.numeroParcela}` : ""} do parcelamento${p.parcelamento?.numeroParcelamento ? ` ${p.parcelamento.numeroParcelamento}` : ""}` : g.tipo;
  const vencimento = calendarioAvisosGuia(g.vencimento, feriados, company?.municipio).vencimento.split('-').reverse().join('/');
  const variaveis = [company?.razao || 'Empresa', tipo, referencia, vencimento].map(String);
  const texto = fase === 'NO_VENCIMENTO'
    ? `${variaveis[0]}\nA guia de ${tipo}, referência ${referencia}, vence hoje (${vencimento}). Se você já pagou, toque em Confirmar pagamento abaixo. Não é necessário pagar novamente.`
    : `${variaveis[0]}\nPode confirmar se a guia de ${tipo}, referência ${referencia}, com vencimento em ${vencimento}, já foi paga?\nSe você já pagou, toque em Confirmar pagamento abaixo. Não é necessário pagar novamente.${fase === 'DEPOIS' ? `\nSe ainda não pagou, ${acoes.length ? 'toque em Atualizar guia. Quando possível, faremos a atualização automática, com os acréscimos aplicáveis; nos demais casos, o contador receberá o pedido' : 'solicite a atualização desta guia ao contador'}.` : ''}`;
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
    // Revisão diferente ou legado não autorizam repetir uma saída de resultado incerto.
    const key = `aviso_pagamento:${base}:${createHash("sha256").update(`${target.canal}:${target.destino}`).digest("hex")}`;
    const value = { status: "RESERVADO", companyId, guideId: g?.id || null, parcelaId: p?.id || null, referencia, fase, revisao, scheduledAt, canal: target.canal, criadoEm: new Date().toISOString() };
    try { await db.$transaction(async tx => {
      if (g) await travarGuiaArrecadatoria(tx, g.id, companyId);
      await tx.appSetting.create({ data: { key, value } });
    }); }
    catch (e) {
      if (e.code !== "P2002") throw e;
      const anterior = await db.appSetting.findUnique({ where: { key } });
      if (anterior?.value?.revisao !== revisao) {
        resultados.push({ status: 'PENDENTE', motivo: 'AVISO_REVISAO_A_CONFERIR', mensagem: 'Existe um aviso anterior sem revisão compatível. Confira o histórico antes de reenviar.', canal: target.canal });
        continue;
      }
      resultados.push({ status: anterior?.value?.status === "ENVIADO" ? "JA_ENVIADO" : "PENDENTE", motivo: anterior?.value?.motivo || "AVISO_JA_RESERVADO", mensagem: anterior?.value?.mensagem || "Confira o histórico do aviso antes de reenviar.", canal: target.canal }); continue;
    }
    let iniciou = false;
    const conferir = async () => {
      await assertActive(); const atual = await carregar();
      if ((atual.p?.id || null) !== (p?.id || null) || versaoPagamentoGuia(atual.g) !== versaoPagamentoGuia(g) || (atual.g.hash || null) !== (g.hash || null) || String(atual.g.valor) !== String(g.valor)
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
      const status = ["PAGAMENTO_JA_CONFIRMADO", "PARCELA_PAGA", "PARCELA_DEBITO_AUTOMATICO", "PARCELAMENTO_EXCLUIDO"].includes(motivo) ? "CANCELADO" : iniciou && !["VENCIMENTO_INVALIDO", "WHATSAPP_JANELA_FECHADA", "WHATSAPP_TEMPLATE_PENDENTE", "DESTINATARIO_ALTERADO", "GUIA_ALTERADA", "GUIA_WHATSAPP_NAO_ENTREGUE", "GUIA_NAO_PROCESSADA", "CONSULTA_NAO_CONCLUIDA", "PARCELA_DOCUMENTO_PENDENTE", "PARCELA_DOCUMENTO_INCOMPLETO", "PARCELA_VINCULO_INCOMPLETO", "DOCUMENTO_ESCOPO_DIVERGENTE", "GUIA_NAO_LIBERADA", "FORA_DO_DIA_DO_AVISO"].includes(motivo) ? "INDETERMINADO" : "PENDENTE";
      const mensagem = e.code || e.codigo ? e.message : "Não foi possível confirmar o envio. Confira o histórico antes de reenviar.";
      await db.appSetting.update({ where: { key }, data: { value: { ...value, status, motivo, mensagem, concluidoEm: new Date().toISOString() } } });
      resultados.push({ status, motivo, mensagem, canal: target.canal });
    }
  }
  return { status: resultados.every(r => r.status === "JA_ENVIADO") ? "JA_ENVIADO" : resultados.every(r => ["ENVIADO", "JA_ENVIADO"].includes(r.status)) ? "ENVIADO" : "PENDENTE", companyId, razao: company?.razao, competencia: g.competencia, tipo: g.tipo, mensagem: resultados.filter(r => r.status === 'PENDENTE').map(r => r.mensagem).filter(Boolean).join(' ') || undefined, guideId: g?.id || null, parcelaId: p?.id || null, resultados };
}
