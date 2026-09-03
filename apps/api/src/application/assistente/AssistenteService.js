// O TURNO DO ASSISTENTE — de uma mensagem recebida a uma resposta enviada. NUNCA lança.
//
// A ordem, e por que cada passo existe:
//   1. RESERVA a mensagem (`respondidaPelaIaEm`, `updateMany` lendo `count`): duas entregas do
//      mesmo webhook não geram duas respostas.
//   2. LOCK por conversa (`tryAcquireGuideLock("ia:<conversaId>")`): um turno por fio de cada vez.
//   3. Carrega o fio, o contato, a pessoa (sessão) e a empresa. Sem sessão ⇒ frase fixa.
//   4. Se há PENDÊNCIA aberta, a resposta é lida pela REGEX (`decidirResposta`) ANTES de qualquer
//      modelo: CONFIRMAR <código> executa (`confirmarEExecutar`); o resto cancela — e segue.
//   5. Mídia (não-texto) ⇒ frase fixa. Texto ⇒ guarda de custo (falha fechado) ⇒ modelo ⇒ texto.
//   6. ENVIA a resposta (`enviarTexto`, e documentos pelas ferramentas), REGISTRA os balões
//      (`autor: IA`) e FECHA a chamada em `chamadas_ia`.
//
// ⚠ Quem decide se este serviço é chamado é o gancho em `ProcessarEventoWhatsappService`
// (flag + piloto + VINCULADO + não assumido). Aqui se assume que a decisão de chamar já foi tomada,
// mas as guardas de sessão e de custo são refeitas — dupla checagem é barata.

import { prisma } from "../../infrastructure/db/prisma.js";
import { IA_HISTORICO_MENSAGENS, log as logPadrao } from "../../config.js";
import { tryAcquireGuideLock, releaseGuideLock } from "../guides/GuideLockService.js";
import { WhatsappCloudClient } from "../whatsapp/WhatsappCloudClient.js";
import { registrarMensagemEnviada, janelaDaConversa, DIRECAO } from "../whatsapp/ConversaWhatsappService.js";
import { SITUACOES_JANELA } from "../whatsapp/janela24h.js";
import { AssistenteClient } from "./AssistenteClient.js";
import { autorizarChamadaIa, concluirChamadaIa } from "./GuardaIaService.js";
import { montarSystem, MENSAGENS_FIXAS } from "./promptDoAssistente.js";
import { sessaoDoContato, fraseSemSessao } from "./sessaoDoContato.js";
import { decidirResposta, FRASES } from "./confirmacaoPendente.js";
import { pendenciaAberta, confirmarEExecutar, cancelarPendencia, marcarExpirada } from "./AcoesPendentesService.js";
import { definicoes, executarFerramenta } from "./ferramentas/index.js";

export const AUTOR = Object.freeze({ IA: "IA", HUMANO: "HUMANO", SISTEMA: "SISTEMA" });
const LOCK_TTL_MS = 90_000;

/** A mensagem `in` → um turno da API. Mídia vira uma frase entre colchetes (o modelo não a lê). */
function paraTurno(m) {
  if (m.direcao === DIRECAO.ENTRADA) {
    const texto = m.tipo === "text" ? String(m.corpo || "") : `[${m.tipo || "mídia"} recebida — sem texto]`;
    return { role: "user", content: texto || "[mensagem vazia]" };
  }
  const texto = String(m.corpo || "").trim();
  return { role: "assistant", content: texto || `[${m.tipo || "mensagem"} enviada]` };
}

/** Turnos consecutivos do mesmo papel são fundidos (a API exige alternância), e o primeiro é `user`. */
export function montarHistorico(mensagens) {
  const ordenadas = [...(mensagens || [])].sort((a, b) => new Date(a.registradaEm) - new Date(b.registradaEm));
  const turnos = [];
  for (const m of ordenadas) {
    const t = paraTurno(m);
    const ultimo = turnos[turnos.length - 1];
    if (ultimo && ultimo.role === t.role) ultimo.content = `${ultimo.content}\n${t.content}`;
    else turnos.push(t);
  }
  while (turnos.length && turnos[0].role !== "user") turnos.shift();
  return turnos;
}

/**
 * @param {object} p
 * @param {string} p.conversaId
 * @param {string} p.mensagemId  a mensagem `in` que disparou o turno
 * @param {object} [p.deps]  injeção para teste: `{ client (prisma), cloud (WhatsappCloudClient), assistente (AssistenteClient), servicos, agora, log, rand }`
 * @returns {Promise<{feito:boolean, motivo?:string, texto?:string}>}
 */
export async function responderMensagem({ conversaId, mensagemId, deps = {} } = {}) {
  const client = deps.client || prisma;
  const log = deps.log || logPadrao;
  const agora = deps.agora || new Date();
  const lockId = `ia:${conversaId}`;
  let lock = false;
  try {
    // 1. A reserva.
    const reserva = await client.mensagemWhatsapp.updateMany({
      where: { id: String(mensagemId), conversaId: String(conversaId), direcao: DIRECAO.ENTRADA, respondidaPelaIaEm: null },
      data: { respondidaPelaIaEm: agora },
    });
    if (!reserva.count) return { feito: false, motivo: "JA_RESPONDIDA" };

    // 2. O lock por fio.
    lock = await (deps.tryLock || tryAcquireGuideLock)(lockId, LOCK_TTL_MS);
    if (!lock) {
      // Outro turno está correndo neste fio; a mensagem será lida no histórico dele.
      await client.mensagemWhatsapp.updateMany({ where: { id: String(mensagemId) }, data: { respondidaPelaIaEm: null } });
      return { feito: false, motivo: "FIO_OCUPADO" };
    }

    // 3. O fio, a pessoa, a empresa.
    const conversa = await client.conversaWhatsapp.findUnique({ where: { id: String(conversaId) }, include: { portalClient: { select: { id: true, razao: true, cnpj: true } } } });
    const mensagem = await client.mensagemWhatsapp.findUnique({ where: { id: String(mensagemId) } });
    if (!conversa || !mensagem) return { feito: false, motivo: "NAO_ENCONTRADA" };
    const cloud = deps.cloud || new WhatsappCloudClient({ log });
    const dizer = async (texto, { autor = AUTOR.IA, tipo = "text" } = {}) => {
      const r = await cloud.enviarTexto({ telefone: conversa.telefoneE164, texto });
      await registrarMensagemEnviada({ telefone: conversa.telefoneE164, portalClientId: conversa.portalClientId, tipo, corpo: texto, providerMessageId: r?.wamid || null, autor }).catch((e) => log?.warn?.({ err: e?.message }, "assistente: falha ao registrar balão"));
      return r;
    };

    const contato = conversa.portalClientId
      ? await client.contatoWhatsapp.findFirst({ where: { portalClientId: conversa.portalClientId, telefoneE164: conversa.telefoneE164, ativo: true }, select: { id: true, nome: true, userId: true } })
      : null;
    const vinculoRbac = contato?.userId && conversa.portalClientId
      ? await client.companyClientUser.findUnique({ where: { companyId_userId: { companyId: conversa.portalClientId, userId: contato.userId } }, select: { role: true, status: true } })
      : null;
    const sessao = sessaoDoContato({ portalClientId: conversa.portalClientId, contato, vinculoRbac });
    if (!sessao.ok) {
      await dizer(fraseSemSessao(sessao.motivo), { autor: AUTOR.SISTEMA });
      return { feito: true, motivo: sessao.motivo };
    }

    // 4. A pendência — lida pela regex, ANTES do modelo.
    const pendente = await pendenciaAberta(conversa.id, { client });
    const ehTexto = mensagem.tipo === "text";
    if (pendente) {
      const d = decidirResposta({ texto: ehTexto ? mensagem.corpo : "", pendente, agora });
      if (d.decisao === "EXPIRADA") {
        await marcarExpirada(pendente.id, { client });
        await dizer(FRASES.EXPIRADA, { autor: AUTOR.SISTEMA });
        return { feito: true, motivo: "EXPIRADA" };
      }
      if (d.decisao === "EXECUTAR") {
        const r = await confirmarEExecutar({ acaoId: pendente.id, agora, client, log, executores: deps.executores || null });
        if (r.filaHumana) await client.conversaWhatsapp.update({ where: { id: conversa.id }, data: { atendidaDesde: agora } }).catch(() => {});
        await dizer(r.texto, { autor: AUTOR.SISTEMA });
        return { feito: true, motivo: "EXECUTADA", texto: r.texto };
      }
      if (d.decisao === "CODIGO_ERRADO") {
        await dizer(FRASES.CODIGO_ERRADO(pendente.codigo), { autor: AUTOR.SISTEMA });
        return { feito: true, motivo: "CODIGO_ERRADO" };
      }
      // CANCELAR: a pendência morre e a mensagem segue como conversa normal.
      await cancelarPendencia(pendente.id, { client });
      await dizer(FRASES.CANCELADA, { autor: AUTOR.SISTEMA });
      if (!ehTexto || lerÉSoCancelamento(mensagem.corpo)) return { feito: true, motivo: "CANCELADA" };
    }

    // 5. Mídia ⇒ frase fixa. Texto ⇒ modelo.
    if (!ehTexto) {
      await dizer(MENSAGENS_FIXAS.SO_TEXTO, { autor: AUTOR.SISTEMA });
      return { feito: true, motivo: "SO_TEXTO" };
    }

    const guarda = await autorizarChamadaIa({ portalClientId: conversa.portalClientId, conversaId: conversa.id, mensagemId: mensagem.id, agora, client, log, ...(deps.chaveIa !== undefined ? { chave: deps.chaveIa } : {}) });
    if (!guarda.ok) {
      await dizer(guarda.mensagem, { autor: AUTOR.SISTEMA });
      return { feito: true, motivo: guarda.motivo };
    }

    const janela = await janelaDaConversa(conversa.id, agora);
    const historico = await client.mensagemWhatsapp.findMany({ where: { conversaId: conversa.id }, orderBy: { registradaEm: "desc" }, take: IA_HISTORICO_MENSAGENS });
    const messages = montarHistorico(historico);
    const system = montarSystem({ empresa: conversa.portalClient, sessao, pendencia: null, janela: { aberta: janela.situacao === SITUACOES_JANELA.ABERTA }, hoje: agora });

    const pendenciasDoTurno = [];
    let chamouEscritorio = null;
    const ctx = {
      sessao, conversa, prisma: client, servicos: deps.servicos || {}, janela: { aberta: janela.situacao === SITUACOES_JANELA.ABERTA }, agora, log,
      enviarDocumento: async ({ conteudo, nomeArquivo, legenda, guideId, notaId }) => {
        const r = await cloud.enviarDocumento({ telefone: conversa.telefoneE164, conteudo, nomeArquivo, legenda });
        await registrarMensagemEnviada({ telefone: conversa.telefoneE164, portalClientId: conversa.portalClientId, tipo: "document", corpo: `${legenda || nomeArquivo}${guideId ? ` [guia ${guideId}]` : notaId ? ` [nota ${notaId}]` : ""}`, providerMessageId: r?.wamid || null, autor: AUTOR.IA }).catch(() => {});
        return r;
      },
      registrarPendencia: (p) => pendenciasDoTurno.push(p),
      registrarChamadaAoEscritorio: (p) => { chamouEscritorio = p; },
    };

    const assistente = deps.assistente || new AssistenteClient({ log });
    let resposta;
    try {
      resposta = await assistente.responder({ system, messages, ferramentas: definicoes(), executar: (nome, input) => executarFerramenta(nome, input, ctx) });
    } catch (err) {
      await concluirChamadaIa(guarda.contexto, { erroCodigo: err?.codigo || "IA_ERRO", erroMensagem: err?.message }, { client, log });
      log?.error?.({ conversaId: conversa.id, codigo: err?.codigo, err: err?.message }, "assistente: o modelo não respondeu");
      await dizer(MENSAGENS_FIXAS.ERRO_MODELO, { autor: AUTOR.SISTEMA });
      return { feito: true, motivo: err?.codigo || "IA_ERRO" };
    }
    await concluirChamadaIa(guarda.contexto, { usage: resposta.usage, iteracoes: resposta.iteracoes, ferramentas: resposta.ferramentasChamadas, stopReason: resposta.stopReason }, { client, log });

    // 6. A resposta — e, se houve pendência, o texto de confirmação EXATO como segunda mensagem.
    const texto = resposta.recusou ? MENSAGENS_FIXAS.RECUSA_MODELO : (resposta.texto || "").trim();
    if (texto) await dizer(texto, { autor: AUTOR.IA });
    for (const p of pendenciasDoTurno) await dizer(p.texto, { autor: AUTOR.SISTEMA });
    if (chamouEscritorio) {
      await client.conversaWhatsapp.update({ where: { id: conversa.id }, data: { atendidaDesde: agora } }).catch(() => {});
      await registrarMensagemEnviada({ telefone: conversa.telefoneE164, portalClientId: conversa.portalClientId, tipo: "text", corpo: `[pedido de atendimento humano] ${chamouEscritorio.motivo}`, autor: AUTOR.SISTEMA }).catch(() => {});
    }
    return { feito: true, motivo: "RESPONDIDA", texto };
  } catch (err) {
    log?.error?.({ conversaId, mensagemId, err: err?.message }, "assistente: TURNO FALHOU");
    return { feito: false, motivo: "ERRO", erro: err?.message };
  } finally {
    if (lock) await (deps.releaseLock || releaseGuideLock)(lockId);
  }
}

/** Resposta CURTA à pendência ("sim", "não", "cancela", "ok"): o cancelamento já foi dito; não há o que o modelo responder. */
function lerÉSoCancelamento(texto) {
  return /^\s*(sim|ok|nao|não|cancelar|cancela|desist\w*|isso)\s*[.!]?\s*$/i.test(String(texto || ""));
}
