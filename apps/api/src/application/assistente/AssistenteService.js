// Turnos duráveis, lease com posse, escopo verificado e guardas refeitas antes de cada efeito.
import { prisma } from "../../infrastructure/db/prisma.js";
import { IA_HISTORICO_MENSAGENS, INTEGRACAO_WHATSAPP_IA, IA_EMPRESAS_PILOTO, log as logPadrao } from "../../config.js";
import { adquirirLease, renovarLease, liberarLease } from "../whatsapp/WhatsappLeaseService.js";
import { enviarMensagemRastreada } from "../whatsapp/SaidaWhatsappService.js";
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
  const ordenadas = [...(mensagens || [])].filter(m => m.direcao !== DIRECAO.SAIDA || !["enviando", "falhou", "indeterminado"].includes(m.statusEnvio)).sort((a, b) => new Date(a.registradaEm) - new Date(b.registradaEm));
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
  const r = await executarMensagem({ conversaId, mensagemId, deps });
  if (r.feito) {
    await (deps.client || prisma).mensagemWhatsapp.updateMany({
      where: { id: String(mensagemId), conversaId: String(conversaId), direcao: DIRECAO.ENTRADA, respondidaPelaIaEm: null },
      data: { respondidaPelaIaEm: new Date() },
    });
  }
  return r;
}

async function executarMensagem({ conversaId, mensagemId, deps = {} } = {}) {
  const client = deps.client || prisma;
  const log = deps.log || logPadrao;
  const agora = deps.agora || new Date();
  const lockId = `ia:${conversaId}`;
  const turnoIaId = deps.turnoIaId || `mensagem:${mensagemId}`;
  let lock = null;
  let timer = null;
  let leaseValido = true;
  let houveSaida = false;
  try {
    if (!deps.leaseExterno) {
      lock = deps.tryLock ? await deps.tryLock(lockId, LOCK_TTL_MS) : await adquirirLease(lockId, { client, ttlMs: LOCK_TTL_MS });
      if (!lock) return { feito: false, motivo: "FIO_OCUPADO" };
      if (!deps.tryLock) {
        timer = setInterval(() => renovarLease(lock, { client }).then((ok) => { leaseValido = ok; }).catch(() => { leaseValido = false; }), 20000);
        timer.unref?.();
      }
    }

    // 3. O fio, a pessoa, a empresa.
    const conversa = await client.conversaWhatsapp.findUnique({ where: { id: String(conversaId) }, include: { portalClient: { select: { id: true, razao: true, cnpj: true } } } });
    const mensagem = await client.mensagemWhatsapp.findUnique({ where: { id: String(mensagemId) } });
    if (!conversa || !mensagem || mensagem.conversaId !== conversa.id || mensagem.direcao !== DIRECAO.ENTRADA) return { feito: false, motivo: "NAO_ENCONTRADA" };
    if (mensagem.respondidaPelaIaEm) return { feito: false, motivo: "JA_RESPONDIDA" };
    const saidaAnterior = await client.mensagemWhatsapp.findFirst({ where: { turnoIaId, direcao: DIRECAO.SAIDA } });
    if (saidaAnterior) return { feito: false, motivo: "SAIDA_ANTERIOR", indeterminado: true };
    const conferirPortao = async () => {
      await deps.conferirLease?.();
      if (!leaseValido) throw Object.assign(new Error("Reserva do turno expirada."), { codigo: "LEASE_PERDIDA" });
      const atual = await client.conversaWhatsapp.findUnique({ where: { id: conversa.id } });
      const codigo = !atual?.escopoVerificado || atual.portalClientId !== conversa.portalClientId ? "SEM_ESCOPO_VERIFICADO"
        : atual.atendidaPor || atual.atendidaDesde ? "ASSUMIDA_POR_HUMANO"
          : !(deps.flag ?? INTEGRACAO_WHATSAPP_IA) || !(deps.piloto ?? IA_EMPRESAS_PILOTO).includes(conversa.portalClientId) ? "FORA_DO_PILOTO" : null;
      if (codigo) throw Object.assign(new Error("O assistente foi suspenso nesta conversa."), { codigo });
    };
    await conferirPortao();
    const cloud = deps.cloud || new WhatsappCloudClient({ log });
    const dizer = async (texto, { autor = AUTOR.IA, tipo = "text" } = {}) => {
      const r = await enviarMensagemRastreada({ conversa, tipo, corpo: texto, autor, turnoIaId, client,
        antesDeEnviar: async () => {
          await conferirPortao();
          const atual = await janelaDaConversa(conversa.id, new Date());
          if (atual.situacao !== SITUACOES_JANELA.ABERTA) throw Object.assign(new Error("A janela de atendimento fechou."), { codigo: "FORA_DA_JANELA" });
        }, enviar: () => cloud.enviarTexto({ telefone: conversa.telefoneE164, texto }),
      });
      houveSaida = true;
      return r;
    };

    const contatos = conversa.portalClientId
      ? await client.contatoWhatsapp.findMany({ where: { portalClientId: conversa.portalClientId, ativo: true, OR: [{ telefoneE164: conversa.telefoneE164 }, { waId: conversa.telefoneE164 }] }, take: 2, select: { id: true, nome: true, userId: true } })
      : [];
    const contato = contatos.length === 1 ? contatos[0] : null;
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
        await conferirPortao();
        // ⚠ `conversaId` e `portalClientId` vão na reserva: a pendência de um fio nunca é
        // confirmada por outro, nem executada depois de o fio mudar de empresa.
        const r = await confirmarEExecutar({ acaoId: pendente.id, conversaId: conversa.id, portalClientId: conversa.portalClientId, agora, client, log, executores: deps.executores || null, ...(deps.acoesDeps ? { deps: deps.acoesDeps } : {}) });
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

    const guarda = await autorizarChamadaIa({ portalClientId: conversa.portalClientId, conversaId: conversa.id, mensagemId: mensagem.id, finalidade: "assistente_whatsapp", agora, client, log, ...(deps.chaveIa !== undefined ? { chave: deps.chaveIa } : {}) });
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
    const documentosTentados = new Map();
    const ctx = {
      sessao, conversa, prisma: client, servicos: deps.servicos || {}, janela: { aberta: janela.situacao === SITUACOES_JANELA.ABERTA }, agora, log,
      enviarDocumento: async ({ conteudo, nomeArquivo, legenda, guideId, notaId }) => {
        const chaveDocumento = `${guideId || ""}:${notaId || ""}:${nomeArquivo || ""}`;
        if (documentosTentados.has(chaveDocumento)) return documentosTentados.get(chaveDocumento);
        const tentativa = enviarMensagemRastreada({ conversa, tipo: "document", corpo: legenda || nomeArquivo, autor: AUTOR.IA, turnoIaId, client,
          antesDeEnviar: async () => {
            await conferirPortao();
            const janelaAtual = await janelaDaConversa(conversa.id, new Date());
            if (janelaAtual.situacao !== SITUACOES_JANELA.ABERTA) throw Object.assign(new Error("Janela fechada."), { codigo: "FORA_DA_JANELA" });
          }, enviar: () => cloud.enviarDocumento({ telefone: conversa.telefoneE164, conteudo, nomeArquivo, legenda }),
        });
        documentosTentados.set(chaveDocumento, tentativa);
        const r = await tentativa;
        houveSaida = true;
        return r;
      },
      registrarPendencia: (p) => pendenciasDoTurno.push(p),
      registrarChamadaAoEscritorio: (p) => { chamouEscritorio = p; },
    };

    const assistente = deps.assistente || new AssistenteClient({ log });
    let resposta;
    try {
      resposta = await assistente.responder({ system, messages, ferramentas: definicoes(), executar: async (nome, input) => { await conferirPortao(); return executarFerramenta(nome, input, ctx); } });
    } catch (err) {
      await concluirChamadaIa(guarda.contexto, { usage: err?.usage, iteracoes: err?.iteracoes, ferramentas: err?.ferramentasChamadas, erroCodigo: err?.codigo || "IA_ERRO", erroMensagem: err?.message }, { client, log });
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
    return { feito: false, motivo: err?.codigo || "ERRO", erro: err?.message, indeterminado: Boolean(err?.indeterminado || houveSaida) };
  } finally {
    clearInterval(timer);
    if (lock) {
      if (deps.releaseLock) await deps.releaseLock(lockId);
      else await liberarLease(lock, { client });
    }
  }
}

/** Resposta CURTA à pendência ("sim", "não", "cancela", "ok"): o cancelamento já foi dito; não há o que o modelo responder. */
function lerÉSoCancelamento(texto) {
  return /^\s*(sim|ok|nao|não|cancelar|cancela|desist\w*|isso)\s*[.!]?\s*$/i.test(String(texto || ""));
}
