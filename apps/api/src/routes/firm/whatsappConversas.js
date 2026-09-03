// AS CONVERSAS DE WHATSAPP — as rotas do escritório para a tela mínima (F5, 02/09/2026). Mount: `/firm`.
//
// O que a tela precisa e o serviço já tinha (`ConversaWhatsappService`): a fila de não vinculados
// (`conversasNaoVinculadas`), o fio (`listarMensagens`, escopado), a janela (`janelaDaConversa`) e a
// atribuição (`atribuirConversa`). O que faltava era a PORTA — e três verbos novos: ASSUMIR (a IA
// pausa), DEVOLVER (a IA volta) e RESPONDER (texto livre, só dentro da janela de 24h).
//
// ── ⚠ MULTI-TENANCY ────────────────────────────────────────────────────────────────────────────
// Toda conversa VINCULADA só é alcançável se `portalClientId` estiver em `empresasVisiveis(req)` —
// o mesmo critério do calendário, das obrigações e do lote de guias. As NÃO vinculadas
// (`portalClientId` nulo) são a fila do escritório: quem enxerga é `admin|contador`, porque não há
// empresa a que restringir.
//
// ── ⚠ RESPONDER É MENSAGEM DE SERVIÇO ──────────────────────────────────────────────────────────
// Fora da janela de 24h a Meta recusa texto livre (131047). A rota recusa ANTES, com 409 e o
// motivo, e diz o caminho: o template `reabrir_conversa` — que hoje está `DECLARADO` (não
// aprovado), então a resposta nomeia isso em vez de fingir que existe um botão.

import { Router } from "express";
import { prisma } from "../../infrastructure/db/prisma.js";
import { empresasVisiveis } from "./empresasVisiveis.js";
import {
  ConversaWhatsappError,
  conversasNaoVinculadas,
  listarMensagens,
  janelaDaConversa,
  atribuirConversa,
  registrarMensagemEnviada,
} from "../../application/whatsapp/ConversaWhatsappService.js";
import { salvarContato, ContatoWhatsappError } from "../../application/whatsapp/ContatoWhatsappService.js";
import { resolverVinculoPorTelefone } from "../../application/whatsapp/ContatoWhatsappService.js";
import { SITUACOES_JANELA } from "../../application/whatsapp/janela24h.js";
import { WhatsappCloudClient, WhatsappError, mascararTelefone } from "../../application/whatsapp/WhatsappCloudClient.js";
import { pendenciaAberta } from "../../application/assistente/AcoesPendentesService.js";
import { consumoIaDoMes } from "../../application/assistente/GuardaIaService.js";

export const AUTOR_HUMANO = "HUMANO";

function somenteAdminOuContador(req, res) {
  const appRole = String(req.auth?.user?.role || "").toLowerCase();
  if (["admin", "contador"].includes(appRole)) return true;
  res.status(403).json({ ok: false, error: "forbidden_admin_or_contador_only" });
  return false;
}

/** A conversa, DENTRO do escopo do usuário — ou null (404, nunca 403: a existência do fio de outra carteira não é informação). */
async function conversaNoEscopo(req, conversaId, { client = prisma } = {}) {
  const conversa = await client.conversaWhatsapp.findUnique({
    where: { id: String(conversaId) },
    include: { portalClient: { select: { id: true, razao: true, cnpj: true } }, atendente: { select: { id: true, name: true, email: true } } },
  });
  if (!conversa) return null;
  if (!conversa.portalClientId) return conversa; // a fila: só admin|contador chega aqui (conferido pela rota)
  const visiveis = await empresasVisiveis(req);
  return visiveis.includes(conversa.portalClientId) ? conversa : null;
}

function resumoDaConversa(c, { ultima = null, janela = null, pendencia = null, naoLidas = 0 } = {}) {
  return {
    id: c.id,
    telefoneE164: c.telefoneE164,
    telefoneMascarado: mascararTelefone(c.telefoneE164),
    nomePerfilProvedor: c.nomePerfilProvedor || null,
    portalClientId: c.portalClientId || null,
    empresa: c.portalClient ? { id: c.portalClient.id, razao: c.portalClient.razao, cnpj: c.portalClient.cnpj } : null,
    atendidaPor: c.atendidaPor || null,
    atendente: c.atendente ? { id: c.atendente.id, nome: c.atendente.name || null, email: c.atendente.email || null } : null,
    atendidaDesde: c.atendidaDesde || null,
    /** `atendidaDesde` sem `atendidaPor` = o assistente chamou o escritório (a fila humana). */
    naFilaDoEscritorio: Boolean(c.atendidaDesde && !c.atendidaPor),
    lidaAteEm: c.lidaAteEm || null,
    updatedAt: c.updatedAt,
    ultimaMensagem: ultima ? { direcao: ultima.direcao, tipo: ultima.tipo, corpo: ultima.corpo, registradaEm: ultima.registradaEm, autor: ultima.autor || null } : null,
    naoLidas,
    janela: janela ? { situacao: janela.situacao, permite: janela.permite, expiraEm: janela.expiraEm, avisos: janela.avisos } : null,
    pendencia: pendencia ? { id: pendencia.id, tipo: pendencia.tipo, codigo: pendencia.codigo, expiraEm: pendencia.expiraEm } : null,
  };
}

export function createWhatsappConversasRouter({ log, client = prisma, cloud = null } = {}) {
  const router = Router({ mergeParams: true });

  function falhar(res, err, contexto) {
    if (err instanceof ConversaWhatsappError || err instanceof ContatoWhatsappError) {
      return res.status(400).json({ ok: false, error: err.code, message: err.message });
    }
    if (err instanceof WhatsappError) {
      return res.status(422).json({ ok: false, error: err.codigo, message: err.mensagemUsuario, podeTentarDeNovo: err.podeTentarDeNovo });
    }
    log?.error?.({ err: err?.message || err, ...contexto }, "Falha nas conversas de WhatsApp");
    return res.status(500).json({ ok: false, error: "erro_interno", message: "Erro interno." });
  }

  /**
   * A LISTA. `?filtro=nao-vinculadas | atendidas-por-mim | todas` (default: todas as da carteira +
   * a fila). Cada fio vem com a última mensagem, as não lidas (derivadas de `lidaAteEm`), a janela e
   * a pendência aberta — o que a tela precisa para decidir o que oferecer ANTES do clique.
   */
  router.get("/whatsapp/conversas", async (req, res) => {
    if (!somenteAdminOuContador(req, res)) return undefined;
    const filtro = String(req.query?.filtro || "todas");
    try {
      const visiveis = await empresasVisiveis(req);
      const where = filtro === "nao-vinculadas"
        ? { portalClientId: null }
        : filtro === "atendidas-por-mim"
          ? { portalClientId: { in: visiveis }, atendidaPor: String(req.auth.user.id) }
          : { OR: [{ portalClientId: { in: visiveis } }, { portalClientId: null }] };
      const conversas = await client.conversaWhatsapp.findMany({
        where,
        include: { portalClient: { select: { id: true, razao: true, cnpj: true } }, atendente: { select: { id: true, name: true, email: true } } },
        orderBy: { updatedAt: "desc" },
        take: 200,
      });
      const itens = await Promise.all(conversas.map(async (c) => {
        const [ultima, naoLidas, janela, pendencia] = await Promise.all([
          client.mensagemWhatsapp.findFirst({ where: { conversaId: c.id }, orderBy: { registradaEm: "desc" } }),
          client.mensagemWhatsapp.count({ where: { conversaId: c.id, direcao: "in", ...(c.lidaAteEm ? { registradaEm: { gt: c.lidaAteEm } } : {}) } }),
          janelaDaConversa(c.id),
          pendenciaAberta(c.id, { client }),
        ]);
        return resumoDaConversa(c, { ultima, naoLidas, janela, pendencia });
      }));
      // O motivo de cada não vinculada (DESCONHECIDO/AMBIGUO + candidatas) vem do vínculo, na leitura.
      const fila = filtro === "atendidas-por-mim" ? [] : await conversasNaoVinculadas({ limite: 50 });
      const motivoPorId = new Map(fila.map((f) => [f.conversa.id, { motivo: f.motivo, empresasCandidatas: f.empresasCandidatas, divergemPeloNonoDigito: f.divergemPeloNonoDigito }]));
      return res.json({
        ok: true,
        filtro,
        conversas: itens.map((i) => ({ ...i, vinculo: motivoPorId.get(i.id) || null })),
        consumoIa: await consumoIaDoMes(),
      });
    } catch (err) {
      return falhar(res, err, { filtro });
    }
  });

  /** O FIO. As mensagens (escopadas) + a janela + a pendência. Marca `lidaAteEm` = agora. */
  router.get("/whatsapp/conversas/:conversaId/mensagens", async (req, res) => {
    if (!somenteAdminOuContador(req, res)) return undefined;
    const { conversaId } = req.params || {};
    try {
      const conversa = await conversaNoEscopo(req, conversaId, { client });
      if (!conversa) return res.status(404).json({ ok: false, error: "conversa_nao_encontrada" });
      // ⚠ Fio NÃO vinculado não passa por `listarMensagens` (que exige escopo de empresa): ele é a
      // fila do escritório, e o escritório inteiro o lê — só admin|contador chegam aqui.
      const mensagens = conversa.portalClientId
        ? await listarMensagens({ portalClientId: conversa.portalClientId, conversaId: conversa.id, limite: 200 })
        : await client.mensagemWhatsapp.findMany({ where: { conversaId: conversa.id }, orderBy: { registradaEm: "desc" }, take: 200 });
      const [janela, pendencia] = await Promise.all([janelaDaConversa(conversa.id), pendenciaAberta(conversa.id, { client })]);
      await client.conversaWhatsapp.update({ where: { id: conversa.id }, data: { lidaAteEm: new Date() } }).catch(() => {});
      return res.json({
        ok: true,
        conversa: resumoDaConversa(conversa, { janela, pendencia }),
        mensagens: [...mensagens].reverse().map((m) => ({
          id: m.id, direcao: m.direcao, tipo: m.tipo, corpo: m.corpo, autor: m.autor || null,
          providerMessageId: m.providerMessageId || null, envioGuiaId: m.envioGuiaId || null,
          ocorridaEmProvedor: m.ocorridaEmProvedor || null, registradaEm: m.registradaEm,
        })),
      });
    } catch (err) {
      return falhar(res, err, { conversaId });
    }
  });

  /** ASSUMIR: a pessoa passa a responder; a IA cala (`atendidaPor` preenchido). */
  router.post("/whatsapp/conversas/:conversaId/assumir", async (req, res) => {
    if (!somenteAdminOuContador(req, res)) return undefined;
    const { conversaId } = req.params || {};
    try {
      const conversa = await conversaNoEscopo(req, conversaId, { client });
      if (!conversa) return res.status(404).json({ ok: false, error: "conversa_nao_encontrada" });
      const atualizada = await client.conversaWhatsapp.update({
        where: { id: conversa.id },
        data: { atendidaPor: String(req.auth.user.id), atendidaDesde: new Date() },
        include: { portalClient: { select: { id: true, razao: true, cnpj: true } }, atendente: { select: { id: true, name: true, email: true } } },
      });
      return res.json({ ok: true, conversa: resumoDaConversa(atualizada) });
    } catch (err) {
      return falhar(res, err, { conversaId });
    }
  });

  /** DEVOLVER À IA: limpa `atendidaPor` E `atendidaDesde` (a fila do escritório também esvazia). */
  router.post("/whatsapp/conversas/:conversaId/devolver", async (req, res) => {
    if (!somenteAdminOuContador(req, res)) return undefined;
    const { conversaId } = req.params || {};
    try {
      const conversa = await conversaNoEscopo(req, conversaId, { client });
      if (!conversa) return res.status(404).json({ ok: false, error: "conversa_nao_encontrada" });
      const atualizada = await client.conversaWhatsapp.update({
        where: { id: conversa.id },
        data: { atendidaPor: null, atendidaDesde: null },
        include: { portalClient: { select: { id: true, razao: true, cnpj: true } }, atendente: { select: { id: true, name: true, email: true } } },
      });
      return res.json({ ok: true, conversa: resumoDaConversa(atualizada) });
    } catch (err) {
      return falhar(res, err, { conversaId });
    }
  });

  /**
   * RESPONDER À MÃO. Texto livre — SÓ dentro da janela de 24h. Fora dela: 409 `FORA_DA_JANELA`
   * com a situação e o que existe (o template `reabrir_conversa`, quando aprovado).
   * ⚠ Não assume o fio sozinho: responder não é assumir. Quem quer calar a IA clica em Assumir.
   */
  router.post("/whatsapp/conversas/:conversaId/responder", async (req, res) => {
    if (!somenteAdminOuContador(req, res)) return undefined;
    const { conversaId } = req.params || {};
    const texto = String(req.body?.texto || "").trim();
    if (!texto) return res.status(400).json({ ok: false, error: "texto_obrigatorio", message: "Escreva a mensagem." });
    try {
      const conversa = await conversaNoEscopo(req, conversaId, { client });
      if (!conversa) return res.status(404).json({ ok: false, error: "conversa_nao_encontrada" });
      const janela = await janelaDaConversa(conversa.id);
      if (janela.situacao !== SITUACOES_JANELA.ABERTA) {
        const template = await client.templateWhatsapp.findUnique({ where: { chave: "reabrir_conversa" } }).catch(() => null);
        return res.status(409).json({
          ok: false,
          error: "FORA_DA_JANELA",
          situacao: janela.situacao,
          message: janela.situacao === SITUACOES_JANELA.NUNCA_ABERTA
            ? "Este cliente nunca escreveu por aqui: a Meta só aceita texto livre nas 24h seguintes a uma mensagem DELE. Para iniciar, é preciso um modelo aprovado."
            : "A janela de 24h desde a última mensagem do cliente fechou: a Meta só aceita modelo aprovado agora.",
          reabrirConversa: {
            chave: "reabrir_conversa",
            statusAprovacao: template?.statusAprovacao || null,
            disponivel: String(template?.statusAprovacao || "").toUpperCase() === "APROVADO" && Boolean(template?.nomeMeta),
          },
          avisos: janela.avisos,
        });
      }
      const cliente = cloud || new WhatsappCloudClient({ log });
      const r = await cliente.enviarTexto({ telefone: conversa.telefoneE164, texto });
      const { mensagem } = await registrarMensagemEnviada({
        telefone: conversa.telefoneE164, portalClientId: conversa.portalClientId, tipo: "text", corpo: texto,
        providerMessageId: r?.wamid || null, autor: AUTOR_HUMANO,
      });
      return res.json({ ok: true, mensagem: { id: mensagem?.id || null, providerMessageId: r?.wamid || null, autor: AUTOR_HUMANO, corpo: texto } });
    } catch (err) {
      return falhar(res, err, { conversaId });
    }
  });

  /**
   * VINCULAR: cadastra o contato na empresa E atribui o fio. É por aqui que a fila esvazia.
   * Body: `{ portalClientId, contato: { nome, papel?, optIn?, optInOrigem?, userId? } }`.
   * ⚠ A empresa tem de estar na carteira do usuário; o número do fio é o telefone do contato (o
   * cadastro é a autoridade — dígito a dígito).
   */
  router.post("/whatsapp/conversas/:conversaId/vincular", async (req, res) => {
    if (!somenteAdminOuContador(req, res)) return undefined;
    const { conversaId } = req.params || {};
    const portalClientId = String(req.body?.portalClientId || "").trim();
    const contato = req.body?.contato || {};
    if (!portalClientId) return res.status(400).json({ ok: false, error: "empresa_obrigatoria", message: "Escolha a empresa." });
    try {
      const visiveis = await empresasVisiveis(req);
      if (!visiveis.includes(portalClientId)) return res.status(404).json({ ok: false, error: "empresa_nao_encontrada" });
      const conversa = await client.conversaWhatsapp.findUnique({ where: { id: String(conversaId) } });
      if (!conversa) return res.status(404).json({ ok: false, error: "conversa_nao_encontrada" });
      // 1) o contato — o telefone vem do FIO, nunca do corpo (o corpo não escolhe o número).
      const salvo = await salvarContato({ ...contato, portalClientId, telefone: `+${conversa.telefoneE164}` });
      // 2) a atribuição — agora o vínculo responde VINCULADO para esta empresa, e `atribuirConversa` aceita.
      const atualizada = await atribuirConversa({ conversaId: conversa.id, portalClientId });
      const vinculo = await resolverVinculoPorTelefone(conversa.telefoneE164);
      return res.json({ ok: true, contato: salvo, conversa: resumoDaConversa({ ...atualizada, portalClient: null }), vinculo: { situacao: vinculo.situacao } });
    } catch (err) {
      return falhar(res, err, { conversaId, portalClientId });
    }
  });

  return router;
}
