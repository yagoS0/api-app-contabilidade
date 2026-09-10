import { prisma } from "../../infrastructure/db/prisma.js";
import { Prisma } from "@prisma/client";
import { INTEGRACAO_WHATSAPP_MENU, IA_EMPRESAS_PILOTO, WHATSAPP_MENU_TELEFONES_PILOTO } from "../../config.js";
import { resolverVinculoPorTelefone } from "./ContatoWhatsappService.js";
import { garantirConversa, janelaDaConversa } from "./ConversaWhatsappService.js";
import { adquirirLease, renovarLease, liberarLease } from "./WhatsappLeaseService.js";
import { enviarMensagemRastreada } from "./SaidaWhatsappService.js";
import { WhatsappCloudClient } from "./WhatsappCloudClient.js";
import { empresasAutorizadas, decidirSelecaoEmpresa, opcoesSelecaoEmpresa, textoSelecaoEmpresa } from "./selecaoEmpresaWhatsapp.js";

export const TTL_CONTEXTO_MS = 30 * 60 * 1000;
const json = v => JSON.parse(JSON.stringify(v));
const falha = (codigo, texto = "O atendimento mudou. Confira a empresa antes de continuar.") => Object.assign(new Error(texto), { codigo });
const dataMs = v => v ? new Date(v).getTime() : 0;
const pedeEquipe = (texto, interacao) => ["altan.client.human.v1", "altan.lead.human.v1"].includes(interacao?.id)
  || /^(?:(?:quero|preciso|gostaria de)\s+)?(?:(?:falar|conversar)\s+com\s+)?(?:(?:o|a|um|uma)\s+)?(?:contador|contadora|atendente|equipe|humano|atendimento humano|escrit[oó]rio)[.!?]?$/i.test(String(texto || "").trim());
export const chaveLeaseResponsavel = conversa => conversa?.atendimentoId ? `responsavel:${conversa.atendimentoId}` : `ia:${conversa?.id}`;
export const filtroEntradasDaConversa = conversaId => ({ OR: [{ conversaId }, { contexto: { is: { conversaId, estado: "RESOLVIDA" } } }] });

export async function comLeaseDoAtendimento({ conversa, client = prisma }, trabalho) {
  const lease = await adquirirLease(chaveLeaseResponsavel(conversa), { client });
  if (!lease) throw falha("FIO_OCUPADO", "Este atendimento está concluindo uma resposta. Tente novamente em instantes.");
  let valido = true;
  const conferirLease = async () => { if (!valido || !await renovarLease(lease, { client })) throw falha("LEASE_PERDIDA"); };
  const timer = setInterval(() => renovarLease(lease, { client }).then(ok => { valido = ok; }).catch(() => { valido = false; }), 20000);
  timer.unref?.();
  try { return await trabalho(conferirLease); } finally { clearInterval(timer); await liberarLease(lease, { client }); }
}

export function filtroAtendimentoAtivo({ conversa, contexto = conversa?.contexto, mensagem, agora = new Date(), permitirHandoffEm = null }) {
  return {
    id: conversa.atendimentoId, versao: contexto?.versao ?? -1,
    portalClientId: conversa.portalClientId, conversaId: conversa.id,
    aguardandoSelecao: false, expiraEm: { gt: agora }, atendidaPor: null,
    atendidaDesde: permitirHandoffEm || null,
    OR: [{ automacaoInvalidadaEm: null }, { automacaoInvalidadaEm: { lt: mensagem?.registradaEm || new Date(0) } }],
  };
}

/** A resolução é o recibo autorizado, nunca uma licença para mover a mensagem original. */
export async function carregarMensagemResolvida({ conversa, mensagemId, client = prisma }) {
  const original = await client.mensagemWhatsapp.findUnique({ where: { id: String(mensagemId) } });
  if (!original) return { mensagem: null, contexto: null };
  if (!conversa?.atendimentoId) return { mensagem: original, contexto: null };
  const contexto = await client.resolucaoContextoWhatsapp.findUnique({ where: { mensagemId: original.id } });
  if (!contexto || contexto.estado !== "RESOLVIDA" || contexto.conversaId !== conversa.id || contexto.portalClientId !== conversa.portalClientId
    || contexto.atendimentoId !== conversa.atendimentoId) throw falha("CONTEXTO_INVALIDO");
  return { mensagem: { ...original, conversaId: conversa.id, tipo: contexto.tipo || original.tipo, corpo: contexto.texto ?? original.corpo }, contexto };
}

export async function conferirContextoResponsavel({ conversa, mensagem, contexto = conversa?.contexto, client = prisma, permitirHandoffEm = null, agora = new Date(), resolverVinculo = resolverVinculoPorTelefone }) {
  if (!conversa?.atendimentoId) return;
  contexto ||= await client.resolucaoContextoWhatsapp.findUnique({ where: { mensagemId: mensagem?.id || "" } });
  if (!mensagem && contexto?.mensagemId) mensagem = await client.mensagemWhatsapp.findUnique({ where: { id: contexto.mensagemId } });
  if (!mensagem) throw falha("CONTEXTO_INVALIDO");
  if (!contexto || contexto.atendimentoId !== conversa.atendimentoId || contexto.conversaId !== conversa.id || contexto.portalClientId !== conversa.portalClientId) throw falha("CONTEXTO_INVALIDO");
  const recibo = await client.resolucaoContextoWhatsapp.findUnique({ where: { mensagemId: mensagem.id } });
  if (!recibo || recibo.estado !== "RESOLVIDA" || ["atendimentoId", "conversaId", "portalClientId", "versao"].some(campo => recibo[campo] !== contexto[campo])) throw falha("CONTEXTO_INVALIDO");
  const atual = await client.atendimentoResponsavelWhatsapp.findFirst({ where: filtroAtendimentoAtivo({ conversa, contexto, mensagem, agora, permitirHandoffEm }) });
  if (!atual) throw falha("CONTEXTO_ALTERADO");
  const acesso = empresasAutorizadas(await resolverVinculo(conversa.telefoneE164, { client }));
  if (acesso.bloqueado || acesso.userId !== atual.userId || !acesso.empresas.some(e => e.portalClientId === conversa.portalClientId)) throw falha("ACESSO_REVOGADO");
}

async function pausarRascunho(tx, conversaId) {
  if (!conversaId) return;
  await tx.acaoPendenteWhatsapp.updateMany({ where: { conversaId, status: "pendente" }, data: { status: "cancelada" } });
  const r = await tx.rascunhoEmissaoWhatsapp.findUnique({ where: { conversaId } });
  if (r && !["CONCLUIDO", "CANCELADO", "EQUIPE"].includes(r.estado?.status)) {
    const estado = { ...r.estado, status: "PAUSADO" };
    delete estado.codigo;
    await tx.rascunhoEmissaoWhatsapp.updateMany({ where: { id: r.id, versao: r.versao }, data: { estado: json(estado), versao: { increment: 1 } } });
  }
}

/** Chamado também antes do seletor: o escritório pode ver o atendimento na carteira correta. */
export async function garantirAtendimentoResponsavel({ conversa, empresas = [], userId = null, client = prisma }) {
  const humanos = await client.conversaWhatsapp.findFirst({ where: { telefoneE164: conversa.telefoneE164, OR: [{ atendidaPor: { not: null } }, { atendidaDesde: { not: null } }] }, orderBy: { atendidaDesde: "desc" } });
  const atendimento = await client.atendimentoResponsavelWhatsapp.upsert({
    where: { canal_telefoneE164: { canal: "principal", telefoneE164: conversa.telefoneE164 } },
    create: { telefoneE164: conversa.telefoneE164, userId, atendidaPor: humanos?.atendidaPor || null, atendidaDesde: humanos?.atendidaDesde || null }, update: {},
  });
  for (const empresa of empresas) await garantirConversa({ telefone: conversa.telefoneE164, portalClientId: empresa.portalClientId, client });
  await client.conversaWhatsapp.updateMany({ where: { telefoneE164: conversa.telefoneE164, atendimentoId: null }, data: { atendimentoId: atendimento.id } });
  return atendimento;
}

/** O atendimento humano é do interlocutor inteiro. Histórico e carteira continuam por empresa. */
export async function alterarAtendimentoHumano({ conversa, atendidaPor = null, atendidaDesde = null, client = prisma }) {
  const atendimento = conversa.atendimentoId
    ? await client.atendimentoResponsavelWhatsapp.findUnique({ where: { id: conversa.atendimentoId } })
    : await garantirAtendimentoResponsavel({ conversa, client });
  return client.$transaction(async tx => {
    const quando = new Date();
    const atual = await tx.atendimentoResponsavelWhatsapp.update({ where: { id: atendimento.id }, data: {
      atendidaPor, atendidaDesde, automacaoInvalidadaEm: quando, versao: { increment: 1 },
      ...(!atendidaPor && !atendidaDesde ? { aguardandoSelecao: true, expiraEm: null } : {}),
      pedidoPendente: null, coletaPendenteConversaId: null, interacaoPendente: Prisma.DbNull,
    } });
    await tx.conversaWhatsapp.updateMany({ where: { atendimentoId: atendimento.id }, data: { atendidaPor, atendidaDesde, automacaoInvalidadaEm: quando } });
    await tx.acaoPendenteWhatsapp.updateMany({ where: { conversa: { is: { atendimentoId: atendimento.id } }, status: "pendente" }, data: { status: "cancelada" } });
    await tx.turnoIaWhatsapp.updateMany({ where: { atendimentoId: atendimento.id, status: { in: ["pendente", "falhou", "processando"] } }, data: { status: "ignorado", motivo: "ASSUMIDA_POR_HUMANO", reservaToken: null, leaseAte: null, concluidoEm: quando } });
    const segmentos = await tx.conversaWhatsapp.findMany({ where: { atendimentoId: atendimento.id }, select: { id: true } });
    for (const segmento of segmentos) await pausarRascunho(tx, segmento.id);
    return { atendimento: atual, conversa: await tx.conversaWhatsapp.findUnique({ where: { id: conversa.id } }) };
  });
}

/** Handoff do próprio turno permite somente a sua mensagem final, sem reautorizar outros jobs. */
export async function encaminharResponsavelParaEquipe({ conversa, mensagem, contexto = conversa?.contexto, client = prisma, quando = new Date() }) {
  if (!conversa.atendimentoId) return client.conversaWhatsapp.updateMany({ where: { id: conversa.id, atendidaPor: null, atendidaDesde: null, excluidaEm: null }, data: { atendidaDesde: quando } });
  return client.$transaction(async tx => {
    const mudou = await tx.atendimentoResponsavelWhatsapp.updateMany({ where: filtroAtendimentoAtivo({ conversa, contexto, mensagem }), data: { atendidaDesde: quando } });
    if (!mudou.count) throw falha("CONTEXTO_ALTERADO");
    await tx.conversaWhatsapp.updateMany({ where: { atendimentoId: conversa.atendimentoId, atendidaPor: null }, data: { atendidaDesde: quando } });
    await tx.acaoPendenteWhatsapp.updateMany({ where: { atendimentoId: conversa.atendimentoId, status: "pendente" }, data: { status: "cancelada" } });
    return mudou;
  });
}

export async function selecionarEmpresaDoEscritorio({ conversa, portalClientId, client = prisma, resolverVinculo = resolverVinculoPorTelefone }) {
  const acesso = empresasAutorizadas(await resolverVinculo(conversa.telefoneE164, { client }));
  if (acesso.bloqueado || !acesso.empresas.some(e => e.portalClientId === portalClientId)) throw falha("EMPRESA_NAO_E_CANDIDATA");
  const atendimento = await garantirAtendimentoResponsavel({ conversa, empresas: acesso.empresas, userId: acesso.userId, client });
  const destino = await garantirConversa({ telefone: conversa.telefoneE164, portalClientId, client });
  return client.$transaction(async tx => {
    const atual = await tx.atendimentoResponsavelWhatsapp.update({ where: { id: atendimento.id }, data: { portalClientId, conversaId: destino.id, versao: { increment: 1 }, userId: acesso.userId,
      aguardandoSelecao: false, pedidoPendente: null, coletaPendenteConversaId: null, interacaoPendente: Prisma.DbNull, expiraEm: new Date(Date.now() + TTL_CONTEXTO_MS) } });
    await pausarRascunho(tx, atendimento.conversaId);
    return { conversa: { ...destino, atendimentoId: atual.id }, atendimento: atual };
  });
}

async function empresaDaReferencia({ mensagem, atendimento, empresas, client }) {
  if (!mensagem.respostaAProviderMessageId) return null;
  const citada = await client.mensagemWhatsapp.findUnique({ where: { providerMessageId: mensagem.respostaAProviderMessageId }, include: { conversa: true } });
  return citada?.direcao === "out" && citada.conversa?.telefoneE164 === atendimento.telefoneE164
    && citada.conversa?.atendimentoId === atendimento.id && (citada.envioGuiaId || citada.tipo === "document")
    && empresas.some(e => e.portalClientId === citada.conversa.portalClientId) ? citada.conversa.portalClientId : null;
}

async function hidratar(registro, recibo, client) {
  if (recibo.estado !== "RESOLVIDA") return { registro, recibo };
  const conversa = await client.conversaWhatsapp.findUnique({ where: { id: recibo.conversaId }, include: { portalClient: { select: { id: true, razao: true, cnpj: true } } } });
  const candidata = registro.vinculo.empresas.find(e => e.portalClientId === recibo.portalClientId);
  return { recibo, registro: { ...registro, contexto: recibo, conversa: { ...conversa, contexto: recibo },
    mensagem: { ...registro.mensagem, conversaId: conversa.id, tipo: recibo.tipo || registro.mensagem.tipo, corpo: recibo.texto ?? registro.mensagem.corpo },
    vinculo: { ...registro.vinculo, situacao: "VINCULADO", empresas: candidata ? [candidata] : [] } } };
}

/** Resolvido sob lease do responsável; decisão e recibo têm um único commit. */
export async function resolverContextoDaMensagem({ registro, atendimento, texto = "", interacao = null, agora = new Date(), client = prisma, resolverVinculo = resolverVinculoPorTelefone }) {
  const existente = await client.resolucaoContextoWhatsapp.findUnique({ where: { mensagemId: registro.mensagem.id } });
  if (existente) return hidratar(registro, existente, client);
  const vinculo = await resolverVinculo(registro.conversa.telefoneE164, { client });
  const acesso = empresasAutorizadas(vinculo);
  const atual = await client.atendimentoResponsavelWhatsapp.findUnique({ where: { id: atendimento.id } });
  const mensagem = registro.mensagem;
  if (registro.conversa.excluidaEm || dataMs(mensagem.registradaEm) <= dataMs(registro.conversa.automacaoInvalidadaEm)) return { registro, suspenso: true, motivo: "AUTOMACAO_INVALIDADA" };
  if (!atual || atual.atendidaPor || atual.atendidaDesde || dataMs(mensagem.registradaEm) <= dataMs(atual.automacaoInvalidadaEm)) return { registro, suspenso: true, motivo: "ASSUMIDA_POR_HUMANO" };
  const anteriorMensagem = atual.ultimaMensagemId ? await client.mensagemWhatsapp.findUnique({ where: { id: atual.ultimaMensagemId } }) : null;
  if (dataMs(mensagem.registradaEm) < dataMs(atual.ultimaInteracaoEm)
    || (dataMs(mensagem.registradaEm) === dataMs(atual.ultimaInteracaoEm) && atual.ultimaMensagemId && mensagem.id.localeCompare(atual.ultimaMensagemId) < 0)
    || (mensagem.ocorridaEmProvedor && anteriorMensagem?.ocorridaEmProvedor && dataMs(mensagem.ocorridaEmProvedor) < dataMs(anteriorMensagem.ocorridaEmProvedor))) return { registro, suspenso: true, motivo: "CONTEXTO_FORA_DE_ORDEM" };
  const rascunho = atual.conversaId ? await client.rascunhoEmissaoWhatsapp.findUnique({ where: { conversaId: atual.conversaId } }) : null;
  const pendencia = atual.conversaId ? await client.acaoPendenteWhatsapp.findFirst({ where: { conversaId: atual.conversaId, status: "pendente" }, select: { id: true } }) : null;
  const coletaAtiva = Boolean(pendencia || (rascunho && dataMs(rascunho.expiraEm) > agora.getTime() && ["COLETANDO", "PRONTO", "REVISAO"].includes(rascunho.estado?.status)));
  const empresaCitadaId = await empresaDaReferencia({ mensagem, atendimento: atual, empresas: acesso.empresas, client });
  const decisao = pedeEquipe(texto, interacao) ? { acao: "EQUIPE" }
    : acesso.bloqueado || !acesso.empresas.length || (atual.userId && atual.userId !== acesso.userId)
    ? { acao: "BLOQUEAR", motivo: "CADASTRO_RESPONSAVEL_AMBIGUO" }
    : decidirSelecaoEmpresa({ empresas: acesso.empresas, contexto: atual, texto, interacao, agora, empresaCitadaId, coletaAtiva });
  const selecionada = ["SELECIONAR", "CONTINUAR"].includes(decisao.acao) ? acesso.empresas.find(e => e.portalClientId === (decisao.portalClientId || atual.portalClientId)) : null;
  const segmento = selecionada ? await garantirConversa({ telefone: atual.telefoneE164, portalClientId: selecionada.portalClientId, client }) : null;
  const alterou = !selecionada || selecionada.portalClientId !== atual.portalClientId || atual.aguardandoSelecao || dataMs(atual.expiraEm) <= agora.getTime();
  const versao = atual.versao + (alterou ? 1 : 0);
  const handoff = ["BLOQUEAR", "EQUIPE"].includes(decisao.acao);
  const pedir = !selecionada && !handoff && decisao.acao !== "TODAS";
  const pedido = Object.hasOwn(decisao, "pedido") ? decisao.pedido : (atual.aguardandoSelecao ? atual.pedidoPendente : texto);
  const contexto = { ...atual, versao, aguardandoSelecao: pedir, empresaIdsOferecidos: acesso.empresas.map(e => e.portalClientId) };
  const coletaPendenteConversaId = pedir && coletaAtiva && ["CONTEXTO_EXPIRADO", "CONFIRMACAO_EXIGE_CONTEXTO"].includes(decisao.motivo) ? atual.conversaId
    : pedir && atual.aguardandoSelecao ? atual.coletaPendenteConversaId : null;
  const retomarColeta = Boolean(selecionada && atual.coletaPendenteConversaId === segmento?.id);
  const resultado = selecionada ? (retomarColeta ? { retomarColeta: true, textoRetomada: atual.pedidoPendente || null } : null) : handoff
    ? { texto: decisao.acao === "EQUIPE" ? "Encaminhei sua mensagem para a equipe. Um contador vai continuar este atendimento por aqui."
      : "Este número precisa de uma conferência de acesso no cadastro. Encaminhei para a equipe verificar as empresas e o responsável antes de continuar.", opcoes: [], bloqueado: true }
    : decisao.acao === "TODAS" ? { empresas: acesso.empresas.map(e => e.portalClientId) }
    : { texto: textoSelecaoEmpresa({ empresas: acesso.empresas, contexto }), opcoes: opcoesSelecaoEmpresa({ empresas: acesso.empresas, contexto }), motivo: decisao.motivo };
  const efetivo = selecionada ? (retomarColeta ? "retomar emissão" : atual.coletaPendenteConversaId ? "menu" : decisao.acao === "CONTINUAR" ? texto : decisao.textoOperacao || decisao.pedido || "menu") : null;
  const interacaoEfetiva = selecionada ? (atual.aguardandoSelecao ? atual.interacaoPendente : interacao) : null;
  const interacaoPendente = pedir && atual.aguardandoSelecao && pedido === atual.pedidoPendente ? atual.interacaoPendente
    : pedir && !interacao?.id?.startsWith("altan.company.") ? interacao : null;
  const recibo = await client.$transaction(async tx => {
    const mudou = await tx.atendimentoResponsavelWhatsapp.updateMany({ where: { id: atual.id, versao: atual.versao, ultimaMensagemId: atual.ultimaMensagemId, atendidaPor: null, atendidaDesde: null }, data: {
      userId: acesso.userId || atual.userId, versao, portalClientId: selecionada?.portalClientId || null, conversaId: segmento?.id || null,
      aguardandoSelecao: pedir, pedidoPendente: pedir ? pedido || null : null,
      coletaPendenteConversaId: coletaPendenteConversaId || null,
      interacaoPendente: interacaoPendente ? json(interacaoPendente) : Prisma.DbNull,
      empresaIdsOferecidos: contexto.empresaIdsOferecidos, ultimaInteracaoEm: mensagem.registradaEm, ultimaMensagemId: mensagem.id,
      expiraEm: new Date(agora.getTime() + TTL_CONTEXTO_MS),
      ...(handoff ? { atendidaDesde: agora } : {}),
    } });
    if (!mudou.count) throw falha("CONTEXTO_CONCORRENTE");
    if (alterou) {
      await pausarRascunho(tx, atual.conversaId);
      if (segmento && segmento.id !== atual.conversaId) await pausarRascunho(tx, segmento.id);
    }
    if (handoff) await tx.conversaWhatsapp.updateMany({ where: { atendimentoId: atual.id }, data: { atendidaDesde: agora } });
    return tx.resolucaoContextoWhatsapp.create({ data: {
      mensagemId: mensagem.id, atendimentoId: atual.id, conversaId: segmento?.id || null, portalClientId: selecionada?.portalClientId || null,
      versao, estado: selecionada ? "RESOLVIDA" : decisao.acao === "TODAS" ? "TODAS" : "SELECAO", texto: efetivo,
      tipo: selecionada ? (interacaoEfetiva ? "interactive" : ["text", "interactive", "button"].includes(mensagem.tipo) ? "text" : mensagem.tipo) : null,
      ...(interacaoEfetiva ? { interacao: json(interacaoEfetiva) } : {}), ...(resultado ? { resultado: json(resultado) } : {}),
    } });
  });
  return hidratar({ ...registro, vinculo }, recibo, client);
}

/** Segura a mesma reserva usada pelo worker até terminar menu/coleta ou fixar o job. */
export async function atenderContextoResponsavel({ registro, item, processar, agora = new Date(), client = prisma, cloud = null,
  flag = INTEGRACAO_WHATSAPP_MENU, piloto = IA_EMPRESAS_PILOTO, telefonesPiloto = WHATSAPP_MENU_TELEFONES_PILOTO,
  resolverVinculo = resolverVinculoPorTelefone, conferirJanela = janelaDaConversa, log = console }) {
  if (!flag) return processar(registro, item, {});
  const conhecido = registro.conversa.atendimentoId ? await client.atendimentoResponsavelWhatsapp.findUnique({ where: { id: registro.conversa.atendimentoId } }) : null;
  if (!registro.vinculo?.empresas?.length && !conhecido?.userId) return processar(registro, item, {});
  const noPiloto = telefonesPiloto.includes(registro.conversa.telefoneE164) || (registro.vinculo.empresas || []).some(e => piloto.includes(e.portalClientId)) || (conhecido?.portalClientId && piloto.includes(conhecido.portalClientId));
  if (!noPiloto) return conhecido?.userId ? { tratadoContexto: true, motivo: "FORA_DO_PILOTO" } : processar(registro, item, {});
  const acesso = empresasAutorizadas(registro.vinculo);
  const atendimento = await garantirAtendimentoResponsavel({ conversa: registro.conversa, empresas: acesso.empresas, userId: acesso.userId, client });
  const conversa = { ...registro.conversa, atendimentoId: atendimento.id };
  const lease = await adquirirLease(chaveLeaseResponsavel(conversa), { client });
  if (!lease) throw falha("FIO_OCUPADO");
  let valida = true;
  const conferirLease = async () => { if (!valida || !await renovarLease(lease, { client })) throw falha("LEASE_PERDIDA"); };
  const timer = setInterval(() => renovarLease(lease, { client }).then(ok => { valida = ok; }).catch(() => { valida = false; }), 20000);
  timer.unref?.();
  try {
    const resolvida = await resolverContextoDaMensagem({ registro: { ...registro, conversa }, atendimento, texto: item.corpo || "", interacao: item.interacao, agora, client, resolverVinculo });
    if (resolvida.suspenso) return { tratadoContexto: true, motivo: resolvida.motivo };
    const { recibo } = resolvida;
    if (recibo.estado === "TODAS") {
      const { consultarGuiasDoResponsavel } = await import("./GuiasResponsavelWhatsappService.js");
      return await consultarGuiasDoResponsavel({ registro: { ...registro, conversa }, recibo, conferirLease, client, cloud, agora, piloto, telefonesPiloto, resolverVinculo, conferirJanela, log });
    }
    if (recibo.estado !== "RESOLVIDA") {
      const r = recibo.resultado;
      const antesDeEnviar = async () => {
        await conferirLease();
        const segmentoAtual = await client.conversaWhatsapp.findUnique({ where: { id: conversa.id } });
        if (!segmentoAtual || segmentoAtual.excluidaEm || dataMs(registro.mensagem.registradaEm) <= dataMs(segmentoAtual.automacaoInvalidadaEm)) throw falha("AUTOMACAO_INVALIDADA");
        const atual = await client.atendimentoResponsavelWhatsapp.findUnique({ where: { id: atendimento.id } });
        if (!atual || atual.versao !== recibo.versao || atual.atendidaPor || (atual.atendidaDesde && !r.bloqueado)) throw falha("CONTEXTO_ALTERADO");
        const atualAcesso = empresasAutorizadas(await resolverVinculo(conversa.telefoneE164, { client }));
        if (!r.bloqueado && (atualAcesso.bloqueado || atualAcesso.userId !== acesso.userId || JSON.stringify(atualAcesso.empresas.map(e => e.portalClientId).sort()) !== JSON.stringify(acesso.empresas.map(e => e.portalClientId).sort()))) throw falha("ACESSO_REVOGADO");
        if ((await conferirJanela(conversa.id, new Date())).situacao !== "ABERTA") throw falha("FORA_DA_JANELA");
      };
      const turnoIaId = `empresa:${registro.mensagem.id}`;
      const anterior = await client.mensagemWhatsapp.findFirst({ where: { turnoIaId, direcao: "out" } });
      if (!anterior) {
        const whatsapp = cloud || new WhatsappCloudClient({ log });
        const opcoes = (r.opcoes || []).slice(0, 10);
        await enviarMensagemRastreada({ conversa, corpo: r.texto, autor: "SISTEMA", tipo: opcoes.length ? "interactive" : "text", turnoIaId, client, antesDeEnviar,
          enviar: () => opcoes.length ? whatsapp.enviarLista({ telefone: conversa.telefoneE164, texto: r.texto.slice(0, 1024), tituloBotao: "Escolher empresa", tituloSecao: "Empresas", linhas: opcoes.map(o => ({ id: o.id, titulo: o.titulo.slice(0, 24), descricao: o.descricao })) })
            : whatsapp.enviarTexto({ telefone: conversa.telefoneE164, texto: r.texto }) });
      }
      await client.mensagemWhatsapp.updateMany({ where: { id: registro.mensagem.id, respondidaPelaIaEm: null }, data: { respondidaPelaIaEm: new Date() } });
      return { tratadoContexto: true, motivo: "SELECAO_EMPRESA" };
    }
    await conferirContextoResponsavel({ conversa: resolvida.registro.conversa, mensagem: resolvida.registro.mensagem, contexto: recibo, client, resolverVinculo });
    if (!telefonesPiloto.includes(conversa.telefoneE164) && !piloto.includes(recibo.portalClientId)) {
      const destino = resolvida.registro.conversa;
      const texto = `Empresa: ${destino.portalClient?.razao || "selecionada"}. A equipe vai continuar este atendimento por aqui; o atendimento automático ainda não está habilitado para esta empresa.`;
      await encaminharResponsavelParaEquipe({ conversa: destino, mensagem: resolvida.registro.mensagem, contexto: recibo, client, quando: agora });
      const whatsapp = cloud || new WhatsappCloudClient({ log });
      await enviarMensagemRastreada({ conversa: destino, corpo: texto, autor: "SISTEMA", turnoIaId: `empresa:${registro.mensagem.id}`, client,
        antesDeEnviar: async () => { await conferirLease(); await conferirContextoResponsavel({ conversa: destino, mensagem: resolvida.registro.mensagem, contexto: recibo, client, resolverVinculo, permitirHandoffEm: agora }); },
        enviar: () => whatsapp.enviarTexto({ telefone: destino.telefoneE164, texto }) });
      await client.mensagemWhatsapp.updateMany({ where: { id: registro.mensagem.id, respondidaPelaIaEm: null }, data: { respondidaPelaIaEm: new Date() } });
      return { tratadoContexto: true, motivo: "EMPRESA_ATENDIMENTO_HUMANO" };
    }
    return await processar(resolvida.registro, { ...item, tipo: recibo.tipo || item.tipo, corpo: recibo.texto ?? item.corpo, interacao: recibo.interacao || null }, { leaseExterno: true, conferirLease });
  } finally { clearInterval(timer); await liberarLease(lease, { client }); }
}
