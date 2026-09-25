import { createHash, randomUUID } from "node:crypto";
import { prisma } from "../../infrastructure/db/prisma.js";
import { carregarGrupoIdentidade } from "./InboxWhatsappService.js";

const erro = (code, message, status = 400) => Object.assign(new Error(message), { code, status });
const hash = value => createHash("sha256").update(value).digest("hex");
const VIDA_EVENTO_MS = 2 * 60 * 60 * 1000;
const papelPermitido = user => user?.status === "active" && ["admin", "contador"].includes(user.role)
  && (user.accountType === "FIRM" || user.role === "admin");

export function configuracaoPush(env = process.env) {
  const publicKey = env.ATENDIMENTO_PUSH_VAPID_PUBLIC_KEY || "";
  const privateKey = env.ATENDIMENTO_PUSH_VAPID_PRIVATE_KEY || "";
  const subject = env.ATENDIMENTO_PUSH_VAPID_SUBJECT || "https://altan.company";
  const enabled = ["true", "1"].includes(env.WHATSAPP_ATENDIMENTO_PUSH)
    && /^[\w-]{87}$/.test(publicKey) && /^[\w-]{43}$/.test(privateKey)
    && /^(https:\/\/|mailto:)/.test(subject);
  return { enabled, publicKey: enabled ? publicKey : null, privateKey, subject };
}

export function validarSubscription(subscription) {
  let url;
  try { url = new URL(subscription?.endpoint); } catch { throw erro("PUSH_INSCRICAO_INVALIDA", "Inscrição de notificações inválida."); }
  const host = url.hostname.toLowerCase();
  const permitido = host === "fcm.googleapis.com" || host === "web.push.apple.com"
    || host.endsWith(".push.services.mozilla.com") || host.endsWith(".notify.windows.com");
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash || !permitido
    || url.href.length > 2048) throw erro("PUSH_DESTINO_INVALIDO", "Serviço de notificações não suportado neste aparelho.");
  const { p256dh, auth } = subscription.keys || {};
  const validaChave = (key, size) => typeof key === "string" && /^[\w-]+={0,2}$/.test(key)
    && Buffer.from(key, "base64url").length === size;
  if (!validaChave(p256dh, 65) || !validaChave(auth, 16)
    || Buffer.from(p256dh, "base64url")[0] !== 4) throw erro("PUSH_CHAVE_INVALIDA", "Inscrição de notificações incompleta.");
  return { endpoint: url.href, keys: { p256dh, auth } };
}

export async function registrarInscricaoPush({ userId, subscription, deviceName, preferencias = {} }, { client = prisma, config = configuracaoPush() } = {}) {
  if (!config.enabled) throw erro("PUSH_DESATIVADO", "Notificações ainda não estão disponíveis.", 409);
  const user = await client.user.findUnique({ where: { id: userId } });
  if (!papelPermitido(user)) throw erro("PUSH_SEM_ACESSO", "Sua conta não tem acesso ao atendimento.", 403);
  const limpa = validarSubscription(subscription), endpointHash = hash(limpa.endpoint);
  const anterior = await client.inscricaoPushAtendimento.findUnique({ where: { endpointHash } });
  if (anterior && anterior.userId !== userId) throw erro("PUSH_OUTRA_CONTA", "Desative as notificações anteriores neste aparelho antes de ativar nesta conta.", 409);
  const dados = { subscription: limpa, deviceName: String(deviceName || "Este aparelho").replace(/[\x00-\x1f]/g, "").slice(0, 80),
    minhas: preferencias.minhas !== false, fila: preferencias.fila !== false, ativa: true, revogadaEm: null,
    ativadaEm: anterior?.ativa ? anterior.ativadaEm : new Date(),
    vinculo: anterior?.ativa ? anterior.vinculo : randomUUID() };
  try {
    if (anterior) {
      const atualizada = await client.inscricaoPushAtendimento.updateMany({ where: { id: anterior.id, userId, vinculo: anterior.vinculo }, data: dados });
      if (!atualizada.count) throw erro("PUSH_INSCRICAO_ALTERADA", "A inscrição mudou. Ative novamente neste aparelho.", 409);
      return { ok: true, id: anterior.id, vinculo: dados.vinculo };
    }
    const criada = await client.inscricaoPushAtendimento.create({ data: { userId, endpointHash, ...dados } });
    return { ok: true, id: criada.id, vinculo: criada.vinculo };
  } catch (e) {
    if (e.code === "P2002") throw erro("PUSH_INSCRICAO_ALTERADA", "A inscrição mudou. Ative novamente neste aparelho.", 409);
    throw e;
  }
}

export async function revogarInscricaoPush({ userId, endpoint }, { client = prisma } = {}) {
  if (typeof endpoint !== "string" || endpoint.length > 2048) throw erro("PUSH_INSCRICAO_INVALIDA", "Inscrição inválida.");
  let normalizado;
  try { normalizado = new URL(endpoint).href; } catch { throw erro("PUSH_INSCRICAO_INVALIDA", "Inscrição inválida."); }
  await client.inscricaoPushAtendimento.updateMany({ where: { userId, endpointHash: hash(normalizado) },
    data: { ativa: false, revogadaEm: new Date(), vinculo: randomUUID() } });
  return { ok: true };
}

/** Recebe a mesma transação da mensagem. A flag desligada não cria backlog retroativo. */
export async function registrarEventoPush({ mensagem, conversa, client, config = configuracaoPush(), agora = new Date() }) {
  if (!config.enabled || mensagem?.direcao !== "in" || !conversa?.id) return;
  if (mensagem.ocorridaEmProvedor && agora.getTime() - new Date(mensagem.ocorridaEmProvedor).getTime() > VIDA_EVENTO_MS) return;
  await client.eventoPushAtendimento.create({ data: { id: mensagem.id, conversaId: conversa.id,
    createdAt: agora, expiraEm: new Date(agora.getTime() + VIDA_EVENTO_MS) } });
}

export async function podeNotificarInscricao({ inscricao, evento }, { client = prisma } = {}) {
  if (!inscricao?.ativa || !evento || evento.expiraEm <= new Date()) return false;
  const user = await client.user.findUnique({ where: { id: inscricao.userId } });
  if (!papelPermitido(user)) return false;
  let conversa = await client.conversaWhatsapp.findUnique({ where: { id: evento.conversaId } });
  if (!conversa || conversa.excluidaEm || String(conversa.chaveEscopo).startsWith("legado:")) return false;
  const mensagem = await client.mensagemWhatsapp.findUnique({ where: { id: evento.id }, include: { contexto: true } });
  if (!mensagem || mensagem.direcao !== "in" || mensagem.conversaId !== conversa.id) return false;
  if (mensagem.contexto?.conversaId && mensagem.contexto.conversaId !== conversa.id) {
    // Um recibo neutro pode ganhar contexto em outra empresa da mesma pessoa.
    // A resolução nunca autoriza atravessar uma vigência, canal ou atendimento.
    if (!conversa.vinculoNumeroId || mensagem.contexto.estado !== "RESOLVIDA") return false;
    const efetiva = await client.conversaWhatsapp.findUnique({ where: { id: mensagem.contexto.conversaId } });
    if (!efetiva || efetiva.excluidaEm || String(efetiva.chaveEscopo).startsWith("legado:")
      || efetiva.vinculoNumeroId !== conversa.vinculoNumeroId
      || (efetiva.canalId || "principal") !== (conversa.canalId || "principal")
      || efetiva.telefoneE164 !== conversa.telefoneE164
      || efetiva.portalClientId !== mensagem.contexto.portalClientId
      || efetiva.atendimentoId !== mensagem.contexto.atendimentoId) return false;
    conversa = efetiva;
  }
  if (conversa.lidaAteEm && conversa.lidaAteEm >= mensagem.registradaEm) return false;
  const visiveis = (await client.portalClient.findMany({ select: { id: true } })).map(p => p.id);
  let atendidaPor = conversa.atendidaPor;
  if (conversa.vinculoNumeroId) {
    try {
      const grupo = await carregarGrupoIdentidade({ conversaId: conversa.id, visiveis, client });
      if (grupo.origem.vinculoNumero?.encerrouEm || grupo.origem.canalWhatsapp?.ativo === false) return false;
      atendidaPor = grupo.origem.vinculoNumero?.interlocutor?.atendidaPor || null;
    }
    catch (e) { if (e.status === 404) return false; throw e; }
  } else if (conversa.portalClientId ? !visiveis.includes(conversa.portalClientId)
    : conversa.atendimentoId || !String(conversa.chaveEscopo).startsWith("sem-empresa:")) return false;
  // Usa a atribuição atual, não a que existia quando a notificação entrou na fila.
  return atendidaPor ? inscricao.minhas && atendidaPor === user.id : inscricao.fila;
}

export function payloadPush({ evento, inscricao }) {
  return { title: "Altan Atendimento", body: "Nova mensagem. Abra o atendimento para responder.",
    url: `/whatsapp?app=atendimento&conversa=${encodeURIComponent(evento.conversaId)}`,
    tag: `atendimento:${hash(evento.conversaId).slice(0, 24)}`, vinculo: inscricao.vinculo };
}

/** Só remove registros já encerrados; nunca descarta entrega pendente ou em processamento. */
export async function limparHistoricoPush({ client = prisma, agora = new Date() } = {}) {
  const limite = new Date(agora.getTime() - 30 * 86400000);
  return client.$transaction(async tx => {
    await tx.entregaPushAtendimento.deleteMany({ where: { status: { in: ["ACEITA", "FALHOU", "CANCELADA"] }, updatedAt: { lt: limite } } });
    const antigos = await tx.eventoPushAtendimento.findMany({ where: { processadoEm: { not: null, lt: limite } }, select: { id: true }, take: 500, orderBy: { createdAt: "asc" } });
    if (!antigos.length) return { count: 0 };
    const restantes = await tx.entregaPushAtendimento.findMany({ where: { eventoId: { in: antigos.map(e => e.id) } }, select: { eventoId: true } });
    const protegidos = new Set(restantes.map(e => e.eventoId));
    return tx.eventoPushAtendimento.deleteMany({ where: { id: { in: antigos.filter(e => !protegidos.has(e.id)).map(e => e.id) } } });
  });
}

async function transportarPush(subscription, payload, config) {
  const { default: webpush } = await import("web-push");
  return webpush.sendNotification(subscription, JSON.stringify(payload), {
    vapidDetails: { subject: config.subject, publicKey: config.publicKey, privateKey: config.privateKey },
    TTL: 300, timeout: 8000, urgency: "normal",
  });
}

export async function processarPushAtendimento({ client = prisma, config = configuracaoPush(), transportar = transportarPush,
  autorizar = podeNotificarInscricao, limite = 10, agora = new Date() } = {}) {
  if (!config.enabled) return { desativado: true, eventos: 0, aceitas: 0 };
  const resumo = { eventos: 0, aceitas: 0, canceladas: 0, falhas: 0 };
  const eventos = await client.eventoPushAtendimento.findMany({ where: { processadoEm: null }, orderBy: { createdAt: "asc" }, take: limite });
  for (const evento of eventos) {
    if (evento.expiraEm > agora) {
      const inscricoes = await client.inscricaoPushAtendimento.findMany({ where: { ativa: true, ativadaEm: { lte: evento.createdAt } } });
      const entregas = [];
      for (const inscricao of inscricoes) {
        if (await autorizar({ inscricao, evento }, { client })) entregas.push({ eventoId: evento.id, inscricaoId: inscricao.id, vinculo: inscricao.vinculo });
      }
      if (entregas.length) await client.entregaPushAtendimento.createMany({ data: entregas, skipDuplicates: true });
    }
    await client.eventoPushAtendimento.updateMany({ where: { id: evento.id, processadoEm: null }, data: { processadoEm: agora } });
    resumo.eventos++;
  }
  const filas = await client.entregaPushAtendimento.findMany({ where: { OR: [
    { status: "PENDENTE", proximaTentativaEm: { lte: agora } }, { status: "ENVIANDO", leaseAte: { lte: agora } },
  ] }, orderBy: { createdAt: "asc" }, take: limite });
  for (const item of filas) {
    const token = randomUUID();
    const tomada = await client.entregaPushAtendimento.updateMany({ where: { id: item.id, status: item.status,
      ...(item.status === "ENVIANDO" ? { leaseAte: { lte: agora } } : { proximaTentativaEm: { lte: agora } }) },
    data: { status: "ENVIANDO", reservaToken: token, leaseAte: new Date(Date.now() + 60000), tentativas: { increment: 1 } } });
    if (!tomada.count) continue;
    const terminar = data => client.entregaPushAtendimento.updateMany({ where: { id: item.id, reservaToken: token, status: "ENVIANDO" },
      data: { ...data, reservaToken: null, leaseAte: null } });
    try {
      const [evento, inscricao] = await Promise.all([
        client.eventoPushAtendimento.findUnique({ where: { id: item.eventoId } }),
        client.inscricaoPushAtendimento.findUnique({ where: { id: item.inscricaoId } }),
      ]);
      if (item.tentativas >= 3 || !inscricao || inscricao.vinculo !== item.vinculo
        || !await autorizar({ inscricao, evento }, { client })) {
        await terminar({ status: "CANCELADA", erroCodigo: "DESTINO_OU_EVENTO_INATIVO" }); resumo.canceladas++; continue;
      }
      // Validar novamente mesmo que a inscrição tenha sido gravada por uma versão antiga.
      const atual = await client.inscricaoPushAtendimento.findUnique({ where: { id: item.inscricaoId } });
      if (!atual?.ativa || atual.vinculo !== item.vinculo) {
        await terminar({ status: "CANCELADA", erroCodigo: "INSCRICAO_REVOGADA" }); resumo.canceladas++; continue;
      }
      const subscription = validarSubscription(atual.subscription);
      await transportar(subscription, payloadPush({ evento, inscricao: atual }), config);
      await terminar({ status: "ACEITA", aceitaEm: new Date(), erroCodigo: null });
      resumo.aceitas++;
    } catch (e) {
      const expirou = [404, 410].includes(e.statusCode);
      if (expirou) await client.inscricaoPushAtendimento.updateMany({ where: { id: item.inscricaoId, vinculo: item.vinculo }, data: { ativa: false, revogadaEm: new Date(), vinculo: randomUUID() } });
      const repetir = !expirou && item.tentativas < 2 && (!e.statusCode || e.statusCode === 429 || e.statusCode >= 500) && !e.code?.startsWith("PUSH_");
      await terminar({ status: repetir ? "PENDENTE" : "FALHOU", erroCodigo: expirou ? "INSCRICAO_EXPIRADA" : "PUSH_NAO_CONFIRMADO",
        proximaTentativaEm: new Date(Date.now() + 60000 * (item.tentativas + 1)) });
      resumo.falhas++;
    }
  }
  return resumo;
}
