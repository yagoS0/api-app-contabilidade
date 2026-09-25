jest.mock("../../../infrastructure/db/prisma.js", () => ({ prisma: {} }));
jest.mock("../InboxWhatsappService.js", () => ({ carregarGrupoIdentidade: jest.fn() }));
import { carregarGrupoIdentidade } from "../InboxWhatsappService.js";
import { configuracaoPush, validarSubscription, registrarInscricaoPush, revogarInscricaoPush, registrarEventoPush,
  podeNotificarInscricao, payloadPush, processarPushAtendimento } from "../AtendimentoPushService.js";

const config = { enabled: true, publicKey: "publica", privateKey: "privada", subject: "https://altan.company" };
const subscription = { endpoint: "https://fcm.googleapis.com/fcm/send/dispositivo-ficticio", keys: {
  p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString("base64url"), auth: Buffer.alloc(16, 2).toString("base64url"),
} };
const user = { id: "user1", role: "contador", accountType: "FIRM", status: "active" };
const now = () => new Date();
function estado() {
  const evento = { id: "m1", conversaId: "conv1", expiraEm: new Date(Date.now() + 3600000), createdAt: now() };
  const inscricao = { id: "sub1", userId: "user1", ativa: true, vinculo: "nonce1", minhas: true, fila: true, subscription, createdAt: new Date(Date.now() - 1000) };
  const conversa = { id: "conv1", portalClientId: "emp1", chaveEscopo: "empresa:emp1", atendidaPor: null };
  const mensagem = { id: "m1", conversaId: "conv1", direcao: "in", registradaEm: now() };
  const item = { id: "d1", eventoId: "m1", inscricaoId: "sub1", vinculo: "nonce1", status: "PENDENTE", proximaTentativaEm: new Date(0), tentativas: 0 };
  const client = {
    user: { findUnique: jest.fn(async () => user) },
    portalClient: { findMany: jest.fn(async () => [{ id: "emp1" }]) },
    conversaWhatsapp: { findUnique: jest.fn(async () => conversa) },
    mensagemWhatsapp: { findUnique: jest.fn(async () => mensagem) },
    inscricaoPushAtendimento: {
      findUnique: jest.fn(async () => ({ ...inscricao })), findMany: jest.fn(async () => [{ ...inscricao }]),
      create: jest.fn(async ({ data }) => ({ id: "nova", ...data })),
      updateMany: jest.fn(async ({ where, data }) => { if (where.vinculo && where.vinculo !== inscricao.vinculo) return { count: 0 }; Object.assign(inscricao, data); return { count: 1 }; }),
    },
    eventoPushAtendimento: { create: jest.fn(), findMany: jest.fn(async () => []), findUnique: jest.fn(async () => evento), updateMany: jest.fn(async () => ({ count: 1 })) },
    entregaPushAtendimento: { createMany: jest.fn(), findMany: jest.fn(async () => [{ ...item }]), updateMany: jest.fn(async ({ where, data }) => {
      if (where.status && item.status !== where.status) return { count: 0 };
      if (where.reservaToken && item.reservaToken !== where.reservaToken) return { count: 0 };
      Object.assign(item, data, { tentativas: data.tentativas ? item.tentativas + data.tentativas.increment : item.tentativas });
      return { count: 1 };
    }) },
  };
  const transportar = jest.fn(async () => ({}));
  return { client, evento, inscricao, conversa, mensagem, item, transportar, config };
}
let fetchAnterior;
beforeEach(() => { jest.clearAllMocks(); carregarGrupoIdentidade.mockResolvedValue({ origem: {}, segmentos: [] }); fetchAnterior = globalThis.fetch; globalThis.fetch = jest.fn(() => { throw Error("Rede proibida"); }); });
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); globalThis.fetch = fetchAnterior; });

test("configuração desativada esconde chave pública e não consulta fila", async () => {
  expect(configuracaoPush({})).toMatchObject({ enabled: false, publicKey: null });
  expect(configuracaoPush({ WHATSAPP_ATENDIMENTO_PUSH: "1", ATENDIMENTO_PUSH_VAPID_PUBLIC_KEY: "x".repeat(87), ATENDIMENTO_PUSH_VAPID_PRIVATE_KEY: "y".repeat(43) })).toMatchObject({ enabled: true });
  const s = estado(); expect(await processarPushAtendimento({ ...s, config: { enabled: false } })).toMatchObject({ desativado: true });
  expect(s.client.eventoPushAtendimento.findMany).not.toHaveBeenCalled();
  await expect(registrarInscricaoPush({ userId: user.id, subscription }, { client: s.client, config: { enabled: false } })).rejects.toMatchObject({ code: "PUSH_DESATIVADO" });
});

test.each(["http://fcm.googleapis.com/send", "https://127.0.0.1/push", "https://169.254.169.254/latest", "https://fcm.googleapis.com.evil.test/push",
  "https://user:pass@fcm.googleapis.com/push", "https://fcm.googleapis.com:8080/push", "https://fcm.googleapis.com/push#secret", "file:///C:/secret", "https://evilnotify.windows.com/push"])("SSRF recusa %s", endpoint => {
  expect(() => validarSubscription({ ...subscription, endpoint })).toThrow();
});
test.each(["https://web.push.apple.com/abc", "https://updates.push.services.mozilla.com/wpush/v2/abc", "https://wns2.notify.windows.com/w/?token=abc"])("permite provedor conhecido %s", endpoint => {
  expect(validarSubscription({ ...subscription, endpoint }).endpoint).toBe(endpoint);
});
test.each([{ p256dh: "abc", auth: subscription.keys.auth }, { p256dh: subscription.keys.p256dh, auth: "abc" }, { p256dh: Buffer.alloc(65).toString("base64url"), auth: subscription.keys.auth }])("recusa chaves inválidas", keys => {
  expect(() => validarSubscription({ ...subscription, keys })).toThrow();
});

test.each([{ ...user, role: "cliente" }, { ...user, accountType: "CLIENT" }, { ...user, status: "inactive" }])("somente conta ativa de atendimento inscreve", async proibido => {
  const s = estado(); s.client.user.findUnique.mockResolvedValue(proibido);
  await expect(registrarInscricaoPush({ userId: user.id, subscription }, s)).rejects.toMatchObject({ status: 403 });
  expect(s.client.inscricaoPushAtendimento.create).not.toHaveBeenCalled();
});
test("endpoint de outra conta não pode ser tomado e inscrição nova não aceita userId externo", async () => {
  const s = estado(); s.inscricao.userId = "outra";
  await expect(registrarInscricaoPush({ userId: user.id, subscription }, s)).rejects.toMatchObject({ code: "PUSH_OUTRA_CONTA" });
  expect(s.client.inscricaoPushAtendimento.updateMany).not.toHaveBeenCalled();
});
test("revogação condiciona dono, troca nonce e reativação não revive eventos antigos", async () => {
  const s = estado(), anterior = s.inscricao.vinculo;
  await revogarInscricaoPush({ userId: user.id, endpoint: subscription.endpoint }, s);
  expect(s.client.inscricaoPushAtendimento.updateMany.mock.calls[0][0].where.userId).toBe(user.id);
  expect(s.inscricao).toMatchObject({ ativa: false }); expect(s.inscricao.vinculo).not.toBe(anterior);
  const depoisRevogar = s.inscricao.vinculo;
  const r = await registrarInscricaoPush({ userId: user.id, subscription }, s);
  expect(r.vinculo).not.toBe(depoisRevogar);
  await processarPushAtendimento(s);
  expect(s.item.status).toBe("CANCELADA"); expect(s.transportar).not.toHaveBeenCalled();
});
test("unicidade concorrente da inscrição retorna conflito controlado", async () => {
  const s = estado(); s.client.inscricaoPushAtendimento.findUnique.mockResolvedValue(null);
  s.client.inscricaoPushAtendimento.create.mockRejectedValue({ code: "P2002" });
  await expect(registrarInscricaoPush({ userId: user.id, subscription }, s)).rejects.toMatchObject({ code: "PUSH_INSCRICAO_ALTERADA", status: 409 });
});

test("flag off, saída e webhook antigo não geram backlog", async () => {
  const s = estado();
  await registrarEventoPush({ mensagem: s.mensagem, conversa: s.conversa, client: s.client, config: { enabled: false } });
  await registrarEventoPush({ mensagem: { ...s.mensagem, direcao: "out" }, conversa: s.conversa, client: s.client, config });
  await registrarEventoPush({ mensagem: { ...s.mensagem, ocorridaEmProvedor: new Date(Date.now() - 3 * 3600000) }, conversa: s.conversa, client: s.client, config });
  expect(s.client.eventoPushAtendimento.create).not.toHaveBeenCalled();
  await registrarEventoPush({ mensagem: s.mensagem, conversa: s.conversa, client: s.client, config });
  expect(s.client.eventoPushAtendimento.create).toHaveBeenCalledTimes(1);
});

test.each(["expirada", "revogada", "lida", "excluida", "legado", "outraEmpresa", "outroResponsavel", "semFila", "outraResolucao"])("evento %s não notifica", async caso => {
  const s = estado();
  if (caso === "expirada") s.evento.expiraEm = new Date(0);
  if (caso === "revogada") s.inscricao.ativa = false;
  if (caso === "lida") s.conversa.lidaAteEm = new Date(Date.now() + 1);
  if (caso === "excluida") s.conversa.excluidaEm = now();
  if (caso === "legado") s.conversa.chaveEscopo = "legado:empresa:emp1";
  if (caso === "outraEmpresa") s.conversa.portalClientId = "emp2";
  if (caso === "outroResponsavel") s.conversa.atendidaPor = "outro";
  if (caso === "semFila") s.inscricao.fila = false;
  if (caso === "outraResolucao") s.mensagem.contexto = { conversaId: "outra" };
  expect(await podeNotificarInscricao(s, s)).toBe(false);
});
test("atribuição V2 no interlocutor prevalece sobre segmento antigo ainda na fila", async () => {
  const s = estado(); s.conversa.vinculoNumeroId = "v1";
  carregarGrupoIdentidade.mockResolvedValue({ origem: { ...s.conversa, vinculoNumero: { interlocutor: { atendidaPor: "outro" } } }, segmentos: [s.conversa] });
  expect(await podeNotificarInscricao(s, s)).toBe(false);
});
test.each(["vinculoEncerrado", "canalDesativado"])("identidade atual recusa %s", async caso => {
  const s = estado(); s.conversa.vinculoNumeroId = "v1";
  carregarGrupoIdentidade.mockResolvedValue({ origem: { ...s.conversa,
    vinculoNumero: { encerrouEm: caso === "vinculoEncerrado" ? now() : null, interlocutor: { atendidaPor: null } },
    canalWhatsapp: { ativo: caso !== "canalDesativado" } }, segmentos: [s.conversa] });
  expect(await podeNotificarInscricao(s, s)).toBe(false);
});
test("nova atribuição do próprio operador e fila autorizada notificam", async () => {
  const s = estado(); expect(await podeNotificarInscricao(s, s)).toBe(true);
  s.conversa.atendidaPor = "user1"; s.inscricao.fila = false;
  expect(await podeNotificarInscricao(s, s)).toBe(true);
});
test("payload é genérico, sem texto, empresa, telefone ou nome do cliente", () => {
  const s = estado(); const p = payloadPush(s);
  expect(Object.keys(p).sort()).toEqual(["body", "tag", "title", "url", "vinculo"]);
  expect(p.body).toBe("Nova mensagem. Abra o atendimento para responder.");
  expect(p.url).toBe("/whatsapp?app=atendimento&conversa=conv1");
  expect(p.vinculo).toBe("nonce1");
});

test("duas instâncias disputando mesma entrega chamam transporte uma vez", async () => {
  const s = estado(); s.client.entregaPushAtendimento.findMany.mockResolvedValue([{ ...s.item }]);
  await Promise.all([processarPushAtendimento(s), processarPushAtendimento(s)]);
  expect(s.transportar).toHaveBeenCalledTimes(1); expect(s.item.status).toBe("ACEITA");
});
test.each([404, 410])("provedor %s revoga inscrição e não repete", async statusCode => {
  const s = estado(); s.transportar.mockRejectedValue({ statusCode });
  await processarPushAtendimento(s);
  expect(s.inscricao.ativa).toBe(false); expect(s.inscricao.vinculo).not.toBe("nonce1");
  expect(s.item).toMatchObject({ status: "FALHOU", erroCodigo: "INSCRICAO_EXPIRADA" });
});
test.each([429, 500, null])("falha temporária %s tem no máximo três transportes", async statusCode => {
  const s = estado(); s.transportar.mockRejectedValue(statusCode ? { statusCode } : new Error("timeout"));
  for (let i = 0; i < 3; i++) {
    s.item.proximaTentativaEm = new Date(0);
    await processarPushAtendimento(s);
  }
  expect(s.transportar).toHaveBeenCalledTimes(3); expect(s.item.status).toBe("FALHOU"); expect(s.item.tentativas).toBe(3);
});
test("revogação durante autorização impede transporte com inscrição antiga", async () => {
  const s = estado();
  const autorizar = jest.fn(async () => { s.inscricao.ativa = false; s.inscricao.vinculo = "revogado"; return true; });
  await processarPushAtendimento({ ...s, autorizar });
  expect(s.transportar).not.toHaveBeenCalled(); expect(s.item.status).toBe("CANCELADA");
});
