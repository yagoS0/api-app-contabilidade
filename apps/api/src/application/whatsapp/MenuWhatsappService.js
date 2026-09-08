// Menus determinísticos do WhatsApp. Cliques nunca passam pelo modelo: o id estável decide a ação,
// e toda leitura refaz empresa, contato, pessoa, papel e permissão antes de responder.

import { prisma } from "../../infrastructure/db/prisma.js";
import { WhatsappCloudClient } from "./WhatsappCloudClient.js";
import { enviarMensagemRastreada } from "./SaidaWhatsappService.js";
import { janelaDaConversa } from "./ConversaWhatsappService.js";
import { SITUACOES_JANELA } from "./janela24h.js";
import { resolverVinculoPorTelefone } from "./ContatoWhatsappService.js";
import { SITUACOES } from "./vinculoTelefone.js";
import { sessaoDoContato, fraseSemSessao } from "../assistente/sessaoDoContato.js";
import { definicoes, executarFerramenta } from "../assistente/ferramentas/index.js";
import { expedienteDoEscritorio } from "../assistente/expediente.js";

export const IDS_MENU_WHATSAPP = Object.freeze({
  CLIENTE_GUIAS_MES: "altan.client.guides.current.v1",
  CLIENTE_SITUACAO_FISCAL: "altan.client.fiscal.status.v1",
  CLIENTE_MAIS: "altan.client.more.v1",
  CLIENTE_QUANTO_DEVO: "altan.client.guides.balance.v1",
  CLIENTE_NOTAS: "altan.client.invoices.current.v1",
  CLIENTE_DOCUMENTOS: "altan.client.documents.v1",
  CLIENTE_RECALCULO: "altan.client.guide.recalculate.v1",
  CLIENTE_EMISSAO: "altan.client.nfse.issue.v1",
  CLIENTE_CANCELAMENTO: "altan.client.nfse.cancel.v1",
  CLIENTE_EQUIPE: "altan.client.human.v1",
  LEAD_ANALISAR: "altan.lead.analyze.v1",
  LEAD_CLIENTE: "altan.lead.existing-client.v1",
  LEAD_EQUIPE: "altan.lead.human.v1",
});

const ACAO_POR_ID = Object.freeze({
  [IDS_MENU_WHATSAPP.CLIENTE_GUIAS_MES]: "GUIAS_MES",
  [IDS_MENU_WHATSAPP.CLIENTE_SITUACAO_FISCAL]: "SITUACAO_FISCAL",
  [IDS_MENU_WHATSAPP.CLIENTE_MAIS]: "MAIS",
  [IDS_MENU_WHATSAPP.CLIENTE_QUANTO_DEVO]: "QUANTO_DEVO",
  [IDS_MENU_WHATSAPP.CLIENTE_NOTAS]: "NOTAS",
  [IDS_MENU_WHATSAPP.CLIENTE_DOCUMENTOS]: "DOCUMENTOS",
  [IDS_MENU_WHATSAPP.CLIENTE_RECALCULO]: "RECALCULO",
  [IDS_MENU_WHATSAPP.CLIENTE_EMISSAO]: "EMISSAO",
  [IDS_MENU_WHATSAPP.CLIENTE_CANCELAMENTO]: "CANCELAMENTO",
  [IDS_MENU_WHATSAPP.CLIENTE_EQUIPE]: "EQUIPE",
  [IDS_MENU_WHATSAPP.LEAD_ANALISAR]: "LEAD_ANALISAR",
  [IDS_MENU_WHATSAPP.LEAD_CLIENTE]: "LEAD_CLIENTE",
  [IDS_MENU_WHATSAPP.LEAD_EQUIPE]: "LEAD_EQUIPE",
});

const FERRAMENTA_POR_ACAO = Object.freeze({
  // O mês deste atalho é o do VENCIMENTO. DAS/INSS/FGTS normalmente têm competência anterior;
  // `quanto_devo` traz as liberadas OPEN/OVERDUE e permite filtrar sem confundir os dois campos.
  GUIAS_MES: "quanto_devo",
  SITUACAO_FISCAL: "situacao_fiscal",
  QUANTO_DEVO: "quanto_devo",
  NOTAS: "listar_notas",
  DOCUMENTOS: "listar_documentos",
  RECALCULO: "preparar_recalculo",
  EMISSAO: "preparar_emissao",
  CANCELAMENTO: "preparar_cancelamento",
});

function semAcento(valor) {
  return String(valor || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
}

export function acaoDoTextoLivre(texto, { cliente = false } = {}) {
  const t = semAcento(texto).replace(/[!?.,]+/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return null;
  if (/^(oi|ola|bom dia|boa tarde|boa noite|menu|ajuda|comecar|inicio)$/.test(t)) return "MENU";
  if (cliente) {
    if (/^(guias? do mes|ver guias? do mes)$/.test(t)) return "GUIAS_MES";
    if (/^(situacao fiscal|ver situacao fiscal)$/.test(t)) return "SITUACAO_FISCAL";
    if (/^(mais opcoes|outras opcoes)$/.test(t)) return "MAIS";
    return null;
  }
  if (/\b(analisar|analise)\b.*\b(empresa|cnpj|negocio)\b/.test(t)) return "LEAD_ANALISAR";
  if (/\b(ja sou cliente|sou cliente|cliente altan)\b/.test(t)) return "LEAD_CLIENTE";
  if (/\b(falar|atendente|equipe|pessoa|humano|especialista)\b/.test(t)) return "LEAD_EQUIPE";
  return "LEAD_EQUIPE";
}

function pediuMenuExplicitamente(texto) {
  const t = semAcento(texto).replace(/[!?.,]+/g, " ").replace(/\s+/g, " ").trim();
  return /^(menu|ajuda|comecar|inicio)$/.test(t);
}

function competenciaAtual(agora) {
  const partes = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit",
  }).formatToParts(agora).map(({ type, value }) => [type, value]));
  return `${partes.year}-${partes.month}`;
}

async function carregarSessao(conversa, client) {
  if (!conversa?.portalClientId) return sessaoDoContato({ portalClientId: null });
  const contatos = await client.contatoWhatsapp.findMany({
    where: { portalClientId: conversa.portalClientId, ativo: true, OR: [{ telefoneE164: conversa.telefoneE164 }, { waId: conversa.telefoneE164 }] },
    take: 2,
    select: { id: true, nome: true, userId: true, permissoesAssistente: true },
  });
  const contato = contatos.length === 1 ? contatos[0] : null;
  const vinculoRbac = contato?.userId
    ? await client.companyClientUser.findUnique({
      where: { companyId_userId: { companyId: conversa.portalClientId, userId: contato.userId } },
      select: { role: true, status: true },
    })
    : null;
  return sessaoDoContato({ portalClientId: conversa.portalClientId, contato, vinculoRbac });
}

const ferramentaLiberada = (sessao, nome) => definicoes(sessao).some((f) => f.name === nome);

export function botoesDoCliente(sessao) {
  const botoes = [];
  if (ferramentaLiberada(sessao, "listar_guias")) botoes.push({ id: IDS_MENU_WHATSAPP.CLIENTE_GUIAS_MES, titulo: "Guias do mês" });
  if (ferramentaLiberada(sessao, "situacao_fiscal")) botoes.push({ id: IDS_MENU_WHATSAPP.CLIENTE_SITUACAO_FISCAL, titulo: "Situação fiscal" });
  botoes.push({ id: IDS_MENU_WHATSAPP.CLIENTE_MAIS, titulo: "Mais opções" });
  return botoes.slice(0, 3);
}

export function linhasDoCliente(sessao) {
  const candidatas = [
    ["quanto_devo", IDS_MENU_WHATSAPP.CLIENTE_QUANTO_DEVO, "Quanto devo", "Guias liberadas ainda em aberto"],
    ["listar_notas", IDS_MENU_WHATSAPP.CLIENTE_NOTAS, "Notas do mês", "Consultar NFS-e emitidas"],
    ["listar_documentos", IDS_MENU_WHATSAPP.CLIENTE_DOCUMENTOS, "Documentos", "Contrato, CNPJ, inscrições e alvarás"],
    ["preparar_recalculo", IDS_MENU_WHATSAPP.CLIENTE_RECALCULO, "Recalcular guia", "Pedido com confirmação por código"],
    ["preparar_emissao", IDS_MENU_WHATSAPP.CLIENTE_EMISSAO, "Emitir NFS-e", "Pedido com confirmação por código"],
    ["preparar_cancelamento", IDS_MENU_WHATSAPP.CLIENTE_CANCELAMENTO, "Cancelar NFS-e", "Pedido com confirmação por código"],
  ];
  const linhas = candidatas.filter(([nome]) => ferramentaLiberada(sessao, nome))
    .map(([, id, titulo, descricao]) => ({ id, titulo, descricao }));
  linhas.push({ id: IDS_MENU_WHATSAPP.CLIENTE_EQUIPE, titulo: "Falar com a equipe", descricao: "Encaminhar para atendimento humano" });
  return linhas;
}

function textoGuias(resultado, mesVencimento) {
  if (!resultado?.ok) return resultado?.mensagem || "Não consegui consultar as guias agora.";
  const doMes = (resultado.guias || []).filter((g) => {
    const partes = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(g.vencimento || ""));
    return partes && `${partes[3]}-${partes[2]}` === mesVencimento;
  });
  const rotuloMes = mesVencimento.split("-").reverse().join("/");
  if (!doMes.length) {
    return `Não há guia liberada pelo escritório com vencimento em ${rotuloMes}. Isso não significa que não exista obrigação ainda aguardando liberação.`;
  }
  const linhas = doMes.slice(0, 10).map((g) => `• ${g.tipo} · competência ${g.competencia || "não informada"} · ${g.valorFormatado} · vence ${g.vencimento}`);
  return [`Guias liberadas com vencimento em ${rotuloMes}:`, ...linhas, doMes.length > linhas.length ? `Mais ${doMes.length - linhas.length} guia(s) aparecem no portal.` : null, "Para receber o PDF, escreva o tipo e a competência da guia."].filter(Boolean).join("\n");
}

function textoSituacao(resultado) {
  if (!resultado?.ok) return resultado?.mensagem || "Não consegui consultar a situação fiscal agora.";
  if (!resultado.situacao) return resultado.observacao;
  const data = resultado.relatorioDe || resultado.consultadaEm || "data não informada";
  const orgaos = (resultado.diagnosticos || []).map((d) => `${d.orgao}: ${d.semPendencia ? "sem pendência indicada" : "com apontamentos"}`);
  return [`Última situação fiscal salva: ${resultado.situacao}.`, `Relatório de ${data}.`, ...orgaos, resultado.observacao].filter(Boolean).join("\n");
}

function textoQuantoDevo(resultado) {
  if (!resultado?.ok) return resultado?.mensagem || "Não consegui consultar as guias em aberto agora.";
  return resultado.quantidade
    ? `Há ${resultado.quantidade} guia(s) liberada(s) em aberto, no total de ${resultado.totalFormatado}. ${resultado.vencidas ? `${resultado.vencidas} já vencida(s).` : "Nenhuma está vencida."}`
    : resultado.observacao;
}

function textoNotas(resultado, competencia) {
  if (!resultado?.ok) return resultado?.mensagem || "Não consegui consultar as notas agora.";
  if (!resultado.notas?.length) return `Não encontrei NFS-e emitida em ${competencia}.`;
  return [`NFS-e emitidas em ${competencia}:`, ...resultado.notas.slice(0, 10).map((n) => `• nº ${n.numero || "não informado"} · ${n.valorFormatado} · ${n.outraParte || "tomador não informado"}`)].join("\n");
}

function textoDocumentos(resultado) {
  if (!resultado?.ok) return resultado?.mensagem || "Não consegui consultar os documentos agora.";
  if (!resultado.documentos?.length) return resultado.observacao;
  return ["Documentos disponíveis:", ...resultado.documentos.slice(0, 10).map((d) => `• ${d.tipoDescricao}: ${d.nome}${d.validade ? ` · válido até ${d.validade}` : ""}`), "Escreva o nome do documento que deseja receber."].join("\n");
}

function textoDePreparacao(acao) {
  if (acao === "RECALCULO") return "Diga qual guia vencida deseja recalcular (tipo e competência). Vou conferir e, antes de gerar, mostrarei um código de confirmação.";
  if (acao === "EMISSAO") return "Para emitir uma NFS-e, envie: CPF/CNPJ e nome do tomador, descrição do serviço, valor e competência. Nada será emitido sem a confirmação por código.";
  return "Diga o número da NFS-e, o motivo do cancelamento e uma justificativa de 15 a 255 caracteres. Nada será cancelado sem a confirmação por código.";
}

function mensagemLead(acao, agora) {
  if (acao === "LEAD_ANALISAR") {
    return "Envie o CNPJ e conte, em uma frase, seu objetivo ou dúvida. A equipe fará uma consulta inicial de dados públicos — isso não comprova regularidade fiscal — e continuará o atendimento por aqui.";
  }
  if (acao === "LEAD_CLIENTE") {
    return `Não localizei este número em uma empresa cliente. Envie o CNPJ da empresa para a equipe conferir o cadastro. ${expedienteDoEscritorio(agora).mensagem}`;
  }
  return `Recebi sua mensagem e encaminhei para a equipe. ${expedienteDoEscritorio(agora).mensagem}`;
}

async function marcarHandoff(conversa, agora, client) {
  await client.conversaWhatsapp.updateMany({
    where: { id: conversa.id, atendidaPor: null, atendidaDesde: null },
    data: { atendidaDesde: agora },
  });
}

function vinculoExato(vinculo, portalClientId) {
  return vinculo?.situacao === SITUACOES.VINCULADO
    && vinculo.empresas?.length === 1
    && String(vinculo.empresas[0]?.portalClientId || "") === String(portalClientId || "");
}

function mensagemPosteriorAoCorte(mensagem, corte) {
  if (!corte) return true;
  const recebidaEm = new Date(mensagem?.registradaEm).getTime();
  return Number.isFinite(recebidaEm) && recebidaEm > new Date(corte).getTime();
}

/**
 * @returns `{ tratado }`. `false` deixa texto livre claro seguir para o assistente existente.
 */
export async function responderMenuWhatsapp({ registro, interacao = null, texto = null, agora = new Date(), logger = console, client = prisma, cloud = null, executar = executarFerramenta, conferirJanela = janelaDaConversa, resolverVinculo = resolverVinculoPorTelefone } = {}) {
  const conversa = registro?.conversa;
  const mensagem = registro?.mensagem;
  if (!conversa?.id || !mensagem?.id || mensagem.direcao === "out") return { tratado: false };
  if (conversa.atendidaPor || conversa.atendidaDesde) return { tratado: false, motivo: "ASSUMIDA_POR_HUMANO" };
  if (!mensagemPosteriorAoCorte(mensagem, conversa.automacaoInvalidadaEm)) return { tratado: false, motivo: "AUTOMACAO_INVALIDADA" };
  if (conversa.portalClientId && (conversa.escopoVerificado !== true || !vinculoExato(registro?.vinculo, conversa.portalClientId))) {
    return { tratado: false, motivo: "SEM_ESCOPO_VERIFICADO" };
  }
  // Uma mensagem antiga do segmento não atribuído não recebe menu de lead se o número já passou
  // a identificar uma empresa. O segmento correto será usado na próxima mensagem do contato.
  if (!conversa.portalClientId && registro?.vinculo?.situacao === SITUACOES.VINCULADO) {
    return { tratado: false, motivo: "VINCULO_MUDOU" };
  }

  const turnoId = `menu:${mensagem.id}`;
  const saidaAnterior = await client.mensagemWhatsapp.findFirst({ where: { turnoIaId: turnoId, direcao: "out" } });
  if (saidaAnterior) {
    await client.mensagemWhatsapp.updateMany({ where: { id: mensagem.id, respondidaPelaIaEm: null }, data: { respondidaPelaIaEm: new Date() } });
    return { tratado: true, motivo: "SAIDA_ANTERIOR" };
  }

  const sessao = await carregarSessao(conversa, client);
  const cliente = Boolean(sessao.ok);
  const idRecebido = String(interacao?.id || "").trim();
  const menuExplicito = !idRecebido && pediuMenuExplicitamente(texto);
  let acao = idRecebido ? ACAO_POR_ID[idRecebido] || "ID_DESCONHECIDO" : acaoDoTextoLivre(texto, { cliente });
  if (!acao) return { tratado: false };

  const clienteId = idRecebido.startsWith("altan.client.");
  const leadId = idRecebido.startsWith("altan.lead.");
  if ((clienteId && !cliente) || (leadId && cliente)) acao = "ESCOPO_INVALIDO";

  const whatsapp = cloud || new WhatsappCloudClient({ log: logger });
  const antesDeEnviar = async (ferramenta = null, assinatura = null) => {
    const atual = await client.conversaWhatsapp.findUnique({ where: { id: conversa.id } });
    if (!atual || atual.excluidaEm || atual.atendidaPor || atual.atendidaDesde || atual.portalClientId !== conversa.portalClientId
      || !mensagemPosteriorAoCorte(mensagem, atual.automacaoInvalidadaEm)) {
      throw Object.assign(new Error("A conversa mudou antes da resposta do menu."), { codigo: "AUTOMACAO_INVALIDADA" });
    }
    if (atual.portalClientId) {
      if (atual.escopoVerificado !== true || !vinculoExato(await resolverVinculo(atual.telefoneE164), atual.portalClientId)) {
        throw Object.assign(new Error("O vínculo deste número mudou antes da resposta do menu."), { codigo: "ACESSO_REVOGADO" });
      }
    }
    // A assinatura também protege menus e respostas sem ferramenta: um vínculo criado, removido
    // ou tornado ambíguo enquanto o webhook era processado não pode receber opções calculadas com
    // o acesso antigo. Quando há ferramenta, além da assinatura, ela precisa continuar liberada.
    if (assinatura !== null) {
      const sessaoAtual = await carregarSessao(atual, client);
      const atualAssinada = JSON.stringify({ ok: sessaoAtual.ok, userId: sessaoAtual.userId, papel: sessaoAtual.papel, permissoes: [...(sessaoAtual.permissoesAssistente || [])].sort() });
      if (atualAssinada !== assinatura || (ferramenta && !ferramentaLiberada(sessaoAtual, ferramenta))) {
        throw Object.assign(new Error("O acesso deste número mudou antes da resposta do menu."), { codigo: "ACESSO_REVOGADO" });
      }
    }
    const janela = await conferirJanela(conversa.id, new Date());
    if (janela.situacao !== SITUACOES_JANELA.ABERTA) throw Object.assign(new Error("A janela de atendimento fechou."), { codigo: "FORA_DA_JANELA" });
  };
  const assinatura = JSON.stringify({ ok: sessao.ok, userId: sessao.userId, papel: sessao.papel, permissoes: [...(sessao.permissoesAssistente || [])].sort() });
  const enviar = async ({ tipo = "text", corpo, ferramenta = null, chamada }) => enviarMensagemRastreada({
    conversa, tipo, corpo, autor: "SISTEMA", turnoIaId: turnoId, client,
    antesDeEnviar: () => antesDeEnviar(ferramenta, assinatura), enviar: chamada,
  });

  // O número pertence a uma empresa, mas não identifica uma pessoa com RBAC ativo. Ele não é lead
  // e não deve receber oferta comercial; sem sessão também não pode ver nenhum dado da empresa.
  if (conversa.portalClientId && !cliente) {
    const corpo = `${fraseSemSessao(sessao.motivo)} ${expedienteDoEscritorio(agora).mensagem}`;
    await enviar({ corpo, chamada: () => whatsapp.enviarTexto({ telefone: conversa.telefoneE164, texto: corpo }) });
    await marcarHandoff(conversa, agora, client);
    await client.mensagemWhatsapp.updateMany({ where: { id: mensagem.id, respondidaPelaIaEm: null }, data: { respondidaPelaIaEm: new Date() } });
    return { tratado: true, motivo: "SEM_SESSAO_CLIENTE", acao: "EQUIPE" };
  }

  if (acao === "MENU") {
    const recente = await client.mensagemWhatsapp.findFirst({
      where: { conversaId: conversa.id, direcao: "out", tipo: "interactive", registradaEm: { gte: new Date(agora.getTime() - 24 * 60 * 60 * 1000) } },
      select: { id: true },
    });
    if (recente && !menuExplicito) {
      if (cliente) return { tratado: false, motivo: "MENU_JA_EXIBIDO" };
      const corpo = "O menu continua disponível acima. Toque em uma opção ou escreva o que precisa.";
      await enviar({ corpo, chamada: () => whatsapp.enviarTexto({ telefone: conversa.telefoneE164, texto: corpo }) });
    } else if (cliente) {
      const botoes = botoesDoCliente(sessao);
      const corpo = `Olá${sessao.contatoNome ? `, ${sessao.contatoNome}` : ""}. Como posso ajudar?`;
      await enviar({ tipo: "interactive", corpo, chamada: () => whatsapp.enviarBotoes({ telefone: conversa.telefoneE164, texto: corpo, botoes, rodape: "Você também pode escrever seu pedido." }) });
    } else {
      const botoes = [
        { id: IDS_MENU_WHATSAPP.LEAD_ANALISAR, titulo: "Analisar empresa" },
        { id: IDS_MENU_WHATSAPP.LEAD_CLIENTE, titulo: "Já sou cliente" },
        { id: IDS_MENU_WHATSAPP.LEAD_EQUIPE, titulo: "Falar com a equipe" },
      ];
      const corpo = "Olá! Como a Altan pode ajudar?";
      await enviar({ tipo: "interactive", corpo, chamada: () => whatsapp.enviarBotoes({ telefone: conversa.telefoneE164, texto: corpo, botoes, rodape: "Você também pode escrever seu pedido." }) });
    }
  } else if (!cliente) {
    const final = ["LEAD_ANALISAR", "LEAD_CLIENTE", "LEAD_EQUIPE"].includes(acao) ? acao : "LEAD_EQUIPE";
    const corpo = mensagemLead(final, agora);
    await enviar({ corpo, chamada: () => whatsapp.enviarTexto({ telefone: conversa.telefoneE164, texto: corpo }) });
    if (["LEAD_CLIENTE", "LEAD_EQUIPE"].includes(final)) await marcarHandoff(conversa, agora, client);
  } else if (acao === "MAIS") {
    const linhas = linhasDoCliente(sessao);
    const corpo = "Escolha uma opção autorizada para este número.";
    await enviar({ tipo: "interactive", corpo, chamada: () => whatsapp.enviarLista({ telefone: conversa.telefoneE164, texto: corpo, tituloBotao: "Ver opções", tituloSecao: "Atendimento", linhas }) });
  } else if (acao === "EQUIPE") {
    const corpo = `Encaminhei sua mensagem para a equipe. ${expedienteDoEscritorio(agora).mensagem}`;
    await enviar({ corpo, chamada: () => whatsapp.enviarTexto({ telefone: conversa.telefoneE164, texto: corpo }) });
    await marcarHandoff(conversa, agora, client);
  } else if (["RECALCULO", "EMISSAO", "CANCELAMENTO"].includes(acao)) {
    const ferramenta = FERRAMENTA_POR_ACAO[acao];
    const corpo = ferramentaLiberada(sessao, ferramenta)
      ? textoDePreparacao(acao)
      : "Este número não está autorizado a usar essa função. A equipe pode revisar o acesso no cadastro do contato.";
    await enviar({ corpo, ferramenta: ferramentaLiberada(sessao, ferramenta) ? ferramenta : null, chamada: () => whatsapp.enviarTexto({ telefone: conversa.telefoneE164, texto: corpo }) });
  } else if (["GUIAS_MES", "SITUACAO_FISCAL", "QUANTO_DEVO", "NOTAS", "DOCUMENTOS"].includes(acao)) {
    const ferramenta = FERRAMENTA_POR_ACAO[acao];
    if (!ferramentaLiberada(sessao, ferramenta)) {
      const corpo = "Este número não está autorizado a consultar essa informação. A equipe pode revisar o acesso no cadastro do contato.";
      await enviar({ corpo, chamada: () => whatsapp.enviarTexto({ telefone: conversa.telefoneE164, texto: corpo }) });
    } else {
      const competencia = competenciaAtual(agora);
      const input = acao === "NOTAS" ? { competencia, direcao: "emitidas" } : {};
      // Revalida imediatamente antes da leitura, além da revalidação feita antes da resposta.
      await antesDeEnviar(ferramenta, assinatura);
      const resultado = await executar(ferramenta, input, { sessao, conversa, prisma: client, agora, janela: { aberta: true }, log: logger });
      const corpo = acao === "GUIAS_MES" ? textoGuias(resultado, competencia)
        : acao === "SITUACAO_FISCAL" ? textoSituacao(resultado)
          : acao === "QUANTO_DEVO" ? textoQuantoDevo(resultado)
            : acao === "NOTAS" ? textoNotas(resultado, competencia)
              : textoDocumentos(resultado);
      await enviar({ corpo, ferramenta, chamada: () => whatsapp.enviarTexto({ telefone: conversa.telefoneE164, texto: corpo }) });
    }
  } else {
    const corpo = "Essa opção não é válida ou expirou. Escreva “menu” para ver as opções disponíveis.";
    await enviar({ corpo, chamada: () => whatsapp.enviarTexto({ telefone: conversa.telefoneE164, texto: corpo }) });
  }

  await client.mensagemWhatsapp.updateMany({ where: { id: mensagem.id, respondidaPelaIaEm: null }, data: { respondidaPelaIaEm: new Date() } });
  return { tratado: true, motivo: idRecebido ? "MENU_INTERATIVO" : "MENU_TEXTO", acao };
}
