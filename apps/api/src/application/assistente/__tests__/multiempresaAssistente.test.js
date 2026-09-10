// Fronteiras de worker/modelo/reserva com relógio e provedores sintéticos. A implementação real
// do seletor tem sua própria suíte; aqui uma mudança concorrente força a guarda de contexto.
jest.mock("../../../infrastructure/db/prisma.js", () => ({ prisma: {} }));
jest.mock("../../whatsapp/WhatsappLeaseService.js", () => ({ adquirirLease: jest.fn(async () => ({ id: "lease", token: "owner" })), renovarLease: jest.fn(async () => true), liberarLease: jest.fn(async () => {}) }));
jest.mock("../../whatsapp/AtendimentoResponsavelWhatsappService.js", () => ({
  chaveLeaseResponsavel: c => c.atendimentoId ? `responsavel:${c.atendimentoId}` : `ia:${c.id}`,
  filtroEntradasDaConversa: id => ({ OR: [{ conversaId: id }, { contexto: { is: { conversaId: id, estado: "RESOLVIDA" } } }] }),
  filtroAtendimentoAtivo: ({ conversa, contexto, agora }) => ({ id: conversa.atendimentoId, versao: contexto.versao, conversaId: conversa.id, portalClientId: conversa.portalClientId, atendidaPor: null, atendidaDesde: null, aguardandoSelecao: false, expiraEm: { gt: agora } }),
  conferirContextoResponsavel: jest.fn(async ({ conversa, contexto, client }) => {
    if (!conversa?.atendimentoId) return;
    const a = await client.atendimentoResponsavelWhatsapp.findUnique({ where: { id: conversa.atendimentoId } });
    const codigo = a.atendidaPor || a.atendidaDesde ? "ASSUMIDA_POR_HUMANO"
      : !contexto || a.id !== contexto.atendimentoId || a.versao !== contexto.versao || a.portalClientId !== conversa.portalClientId || a.conversaId !== conversa.id ? "CONTEXTO_ALTERADO" : null;
    if (codigo) throw Object.assign(new Error(codigo), { codigo });
  }),
  carregarMensagemResolvida: async ({ conversa, mensagemId, client }) => {
    const original = await client.mensagemWhatsapp.findUnique({ where: { id: mensagemId } });
    const c = original?.contexto;
    return { mensagem: c?.estado === "RESOLVIDA" && c.conversaId === conversa.id ? { ...original, conversaId: conversa.id, corpo: c.texto ?? original.corpo } : original, contexto: c || null };
  },
  encaminharResponsavelParaEquipe: jest.fn(async () => {}),
}));
jest.mock("../../whatsapp/ConversaWhatsappService.js", () => ({ DIRECAO: { ENTRADA: "in", SAIDA: "out" }, janelaDaConversa: jest.fn(async () => ({ situacao: "ABERTA" })), registrarMensagemEnviada: jest.fn() }));
jest.mock("../../whatsapp/SaidaWhatsappService.js", () => ({ enviarMensagemRastreada: jest.fn(async ({ antesDeEnviar, enviar }) => { await antesDeEnviar(); return enviar(); }) }));
jest.mock("../GuardaIaService.js", () => ({ autorizarChamadaIa: jest.fn(async () => ({ ok: true, contexto: {} })), concluirChamadaIa: jest.fn(async () => {}) }));
jest.mock("../ferramentas/index.js", () => ({ definicoes: () => [], executarFerramenta: jest.fn(async (_nome, _input, ctx) => ({ empresa: ctx.sessao.portalClientId })), PERMISSAO_POR_FERRAMENTA: { quanto_devo: "GUIAS" } }));

import { responderMensagem } from "../AssistenteService.js";
import { confirmarEExecutar, criarPendencia } from "../AcoesPendentesService.js";
import { enfileirarTurnoIa, processarTurnosIaUmaVez } from "../TurnoIaWhatsappService.js";
import { adquirirLease } from "../../whatsapp/WhatsappLeaseService.js";
import { executarFerramenta } from "../ferramentas/index.js";
import { TODAS_PERMISSOES_ASSISTENTE } from "../../whatsapp/permissoesAssistente.js";

const AGORA = new Date("2026-09-10T12:00:00Z");
const pin = { atendimentoId: "responsavel", versao: 7, conversaId: "cv1", portalClientId: "klaus" };
const log = { error: jest.fn(), warn: jest.fn(), info: jest.fn() };
const retorno = () => ({ texto: "Resumo da Klaus", ferramentasChamadas: ["quanto_devo"], usage: { input_tokens: 0, output_tokens: 0 }, stopReason: "end_turn" });
const sinal = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

function casa(valor, filtro) {
  if (filtro === null || typeof filtro !== "object" || filtro instanceof Date) return (valor ?? null) === filtro || valor instanceof Date && filtro instanceof Date && +valor === +filtro;
  if (filtro.is) return valor != null && casa(valor, filtro.is);
  if (filtro.some) return (valor || []).some(v => casa(v, filtro.some));
  if (filtro.none) return !(valor || []).some(v => casa(v, filtro.none));
  if (filtro.in) return filtro.in.includes(valor);
  if (filtro.notIn) return !filtro.notIn.includes(valor);
  if (filtro.gt !== undefined) return valor > filtro.gt;
  if (filtro.gte !== undefined) return valor >= filtro.gte && (filtro.lte === undefined || valor <= filtro.lte);
  if (filtro.lt !== undefined) return valor < filtro.lt;
  if (filtro.lte !== undefined) return valor <= filtro.lte;
  return Object.entries(filtro).every(([k, v]) => k === "AND" ? v.every(f => casa(valor, f)) : k === "OR" ? v.some(f => casa(valor, f)) : casa(valor?.[k], v));
}

function banco() {
  const attendance = { id: "responsavel", versao: 7, conversaId: "cv1", portalClientId: "klaus", atendidaPor: null, atendidaDesde: null, aguardandoSelecao: false, expiraEm: new Date("2099-01-01") };
  const conversas = [
    { id: "cv1", portalClientId: "klaus", portalClient: { id: "klaus", razao: "Klaus sintética", cnpj: "11222333000181" } },
    { id: "cv2", portalClientId: "lente" }, { id: "neutra", portalClientId: null },
  ].map(c => ({ ...c, atendimentoId: attendance.id, telefoneE164: "5521999998888", escopoVerificado: true, atendidaPor: null, atendidaDesde: null, excluidaEm: null, automacaoInvalidadaEm: null }));
  const mensagens = [{ id: "m1", conversaId: "neutra", direcao: "in", tipo: "text", corpo: "2", registradaEm: AGORA, respondidaPelaIaEm: null, contexto: { ...pin, estado: "RESOLVIDA", texto: "Quanto devo na Klaus?" } }];
  const acoes = [{ id: "ap", conversaId: "cv1", portalClientId: "klaus", userId: "liz", atendimentoId: "responsavel", contextoVersao: 7, tipo: "RECALCULAR_GUIA", status: "pendente", expiraEm: new Date("2099-01-01"), codigo: "A7K2", payload: {} }];
  const mensagemExpandida = m => ({ ...m, conversa: conversas.find(c => c.id === m.conversaId) });
  const conversaExpandida = c => ({ ...c, mensagens: mensagens.filter(m => m.conversaId === c.id) });
  const atendimentoExpandido = () => ({ ...attendance, conversas: conversas.map(conversaExpandida) });
  const acaoExpandida = a => ({ ...a, conversa: conversaExpandida(conversas.find(c => c.id === a.conversaId)), atendimento: atendimentoExpandido() });
  const client = {
    attendance, conversas, mensagens, acoes,
    atendimentoResponsavelWhatsapp: { findUnique: jest.fn(async () => ({ ...attendance })), updateMany: jest.fn(async ({ where, data }) => { if (!casa(atendimentoExpandido(), where)) return { count: 0 }; Object.assign(attendance, data); return { count: 1 }; }) },
    conversaWhatsapp: { findUnique: jest.fn(async ({ where }) => ({ ...conversas.find(c => c.id === where.id) })), updateMany: jest.fn(async () => ({ count: 1 })) },
    mensagemWhatsapp: {
      findUnique: jest.fn(async ({ where }) => mensagens.find(m => m.id === where.id)),
      findFirst: jest.fn(async ({ where }) => mensagens.find(m => casa(mensagemExpandida(m), where)) || null),
      findMany: jest.fn(async ({ where }) => mensagens.filter(m => casa(mensagemExpandida(m), where))),
      updateMany: jest.fn(async ({ where, data }) => { const rows = mensagens.filter(m => casa(mensagemExpandida(m), where)); rows.forEach(m => Object.assign(m, data)); return { count: rows.length }; }),
    },
    contatoWhatsapp: { findMany: jest.fn(async () => [{ id: "contato", nome: "Liz sintética", userId: "liz", permissoesAssistente: [...TODAS_PERMISSOES_ASSISTENTE] }]) },
    companyClientUser: { findUnique: jest.fn(async () => ({ role: "CLIENT_ADMIN", status: "ACTIVE" })) },
    acaoPendenteWhatsapp: {
      findFirst: jest.fn(async () => null), findUnique: jest.fn(async ({ where }) => ({ ...acoes.find(a => a.id === where.id) })),
      updateMany: jest.fn(async ({ where, data }) => { const rows = acoes.filter(a => casa(acaoExpandida(a), where)); rows.forEach(a => Object.assign(a, data)); return { count: rows.length }; }),
      update: jest.fn(async ({ where, data }) => Object.assign(acoes.find(a => a.id === where.id), data)),
      create: jest.fn(async ({ data }) => { const a = { id: "nova", ...data }; acoes.push(a); return a; }),
    },
  };
  client.$transaction = fn => fn(client);
  return client;
}
function trocar(client, voltar = false) { Object.assign(client.attendance, { portalClientId: voltar ? "klaus" : "lente", conversaId: voltar ? "cv1" : "cv2", versao: client.attendance.versao + 1 }); }
const confirmacao = { mensagemId: "m1", registradaEm: AGORA, mensagensConhecidas: ["m1"] };
function confirmar(client, over = {}) {
  const executor = jest.fn(async ({ acao }) => ({ texto: "feito", resultado: { empresa: acao.portalClientId } }));
  const executar = () => confirmarEExecutar({ acaoId: "ap", conversaId: "cv1", portalClientId: "klaus", userId: "liz", contexto: pin, confirmacao, agora: AGORA, client, log, deps: { autorizarPermissaoDaAcao: async () => ({ ok: true }) }, executores: { RECALCULAR_GUIA: executor }, ...over });
  return { executar, executor };
}

beforeEach(() => jest.clearAllMocks());

it("preserva a entrada neutra, lê o pedido resolvido e exclui histórico da outra empresa", async () => {
  const client = banco(), cloud = { enviarTexto: jest.fn(async () => ({ wamid: "sintetico" })) };
  client.mensagens.push({ id: "antiga", conversaId: "neutra", direcao: "in", tipo: "text", corpo: "1", registradaEm: new Date(+AGORA - 60000), contexto: { ...pin, estado: "RESOLVIDA", texto: "Pedido anterior da Klaus" } });
  client.mensagens.push({ id: "alheia", conversaId: "cv2", direcao: "in", tipo: "text", corpo: "SEGREDO_LENTE", registradaEm: new Date(+AGORA - 60000) });
  const assistente = { responder: jest.fn(async () => retorno()) };
  const r = await responderMensagem({ conversaId: "cv1", mensagemId: "m1", deps: { client, cloud, assistente, contexto: pin, contextoFixadoNoJob: true, flag: true, piloto: ["klaus"], agora: AGORA, log } });
  expect(r.feito).toBe(true);
  expect(adquirirLease).toHaveBeenCalledWith("responsavel:responsavel", expect.anything());
  const history = JSON.stringify(assistente.responder.mock.calls[0][0].messages);
  expect(history).toContain("Quanto devo na Klaus?"); expect(history).toContain("Pedido anterior da Klaus"); expect(history).not.toContain("SEGREDO_LENTE");
  expect(client.mensagens[0].conversaId).toBe("neutra"); expect(client.mensagens[0].corpo).toBe("2"); expect(client.mensagens[0].respondidaPelaIaEm).toBeInstanceOf(Date);
  expect(cloud.enviarTexto.mock.calls[0][0].texto).toMatch(/^Klaus sintética · CNPJ 11222333000181/);
});

it.each(["troca", "volta", "humano"])("mudança de %s enquanto o modelo aguarda impede ferramentas e resposta", async mudanca => {
  const client = banco(), iniciou = sinal(), continuar = sinal(), cloud = { enviarTexto: jest.fn() };
  const assistente = { responder: jest.fn(async ({ executar }) => { iniciou.resolve(); await continuar.promise; await executar("quanto_devo", {}); return retorno(); }) };
  const p = responderMensagem({ conversaId: "cv1", mensagemId: "m1", deps: { client, cloud, assistente, contexto: pin, flag: true, piloto: ["klaus"], agora: AGORA, log } });
  await iniciou.promise;
  if (mudanca === "humano") client.attendance.atendidaPor = "contador";
  else { trocar(client); if (mudanca === "volta") trocar(client, true); }
  continuar.resolve();
  const r = await p;
  expect(r.feito).toBe(false); expect(executarFerramenta).not.toHaveBeenCalled(); expect(cloud.enviarTexto).not.toHaveBeenCalled();
});

it("um job sem pin não adota a seleção atual depois da migração", async () => {
  const client = banco(), assistente = { responder: jest.fn() }, cloud = { enviarTexto: jest.fn() };
  const r = await responderMensagem({ conversaId: "cv1", mensagemId: "m1", deps: { client, assistente, cloud, contextoFixadoNoJob: true, flag: true, piloto: ["klaus"], agora: AGORA, log } });
  expect(r.motivo).toBe("CONTEXTO_ALTERADO"); expect(assistente.responder).not.toHaveBeenCalled();
});

it("o pin antigo do job não é substituído pelo recibo de uma nova seleção", async () => {
  const client = banco(), assistente = { responder: jest.fn() };
  client.mensagens[0].contexto.versao = 9; client.attendance.versao = 9;
  const r = await responderMensagem({ conversaId: "cv1", mensagemId: "m1", deps: { client, assistente, contexto: pin, contextoFixadoNoJob: true, flag: true, piloto: ["klaus"], agora: AGORA, log } });
  expect(r.motivo).toBe("CONTEXTO_ALTERADO"); expect(assistente.responder).not.toHaveBeenCalled();
});

it("uma consulta concluída não libera sua resposta depois da troca", async () => {
  const client = banco(), consultou = sinal(), terminar = sinal(), cloud = { enviarTexto: jest.fn() };
  const assistente = { responder: jest.fn(async ({ executar }) => { await executar("quanto_devo", {}); consultou.resolve(); await terminar.promise; return retorno(); }) };
  const p = responderMensagem({ conversaId: "cv1", mensagemId: "m1", deps: { client, cloud, assistente, contexto: pin, flag: true, piloto: ["klaus"], agora: AGORA, log } });
  await consultou.promise; trocar(client); terminar.resolve();
  const r = await p;
  expect(r.motivo).toBe("CONTEXTO_ALTERADO"); expect(executarFerramenta).toHaveBeenCalledTimes(1); expect(cloud.enviarTexto).not.toHaveBeenCalled();
});

it("criação fixa a versão e recusa resultado de preparação que terminou depois da troca", async () => {
  const client = banco();
  const args = { conversaId: "cv1", portalClientId: "klaus", userId: "liz", tipo: "RECALCULAR_GUIA", payload: {}, corpo: "Guia Klaus", contexto: pin, client, agora: AGORA };
  const criado = await criarPendencia(args);
  expect(criado.acao).toMatchObject({ atendimentoId: "responsavel", contextoVersao: 7, portalClientId: "klaus" });
  trocar(client);
  await expect(criarPendencia(args)).rejects.toMatchObject({ codigo: "CONTEXTO_ALTERADO" });
  expect(client.acaoPendenteWhatsapp.create).toHaveBeenCalledTimes(1);
});

it.each(["troca", "volta", "humano", "entrada neutra", "sem pin"])("reserva atômica recusa %s sem executar", async caso => {
  const client = banco();
  if (caso === "humano") client.attendance.atendidaPor = "contador";
  else if (caso === "entrada neutra") client.mensagens.push({ id: "m2", conversaId: "neutra", direcao: "in", tipo: "text", corpo: "trocar para Lente", registradaEm: new Date(+AGORA + 1) });
  else if (caso !== "sem pin") { trocar(client); if (caso === "volta") trocar(client, true); }
  const f = confirmar(client, caso === "sem pin" ? { contexto: null } : {});
  const r = await f.executar(); expect(r.executou).toBe(false); expect(f.executor).not.toHaveBeenCalled();
});

it("troca durante reconferência posterior à reserva cancela antes do executor", async () => {
  const client = banco(), reservada = sinal(), prosseguir = sinal();
  const f = confirmar(client, { deps: { autorizarPermissaoDaAcao: async () => { reservada.resolve(); await prosseguir.promise; return { ok: true }; } } });
  const p = f.executar(); await reservada.promise; expect(client.acoes[0].status).toBe("confirmada");
  trocar(client); prosseguir.resolve();
  await expect(p).rejects.toMatchObject({ codigo: "CONTEXTO_ALTERADO" });
  expect(f.executor).not.toHaveBeenCalled(); expect(client.acoes[0].status).toBe("cancelada");
});

it("nova entrada neutra durante reconferência bloqueia antes do executor", async () => {
  const client = banco();
  const f = confirmar(client, { deps: { autorizarPermissaoDaAcao: async () => {
    client.mensagens.push({ id: "m2", conversaId: "neutra", direcao: "in", tipo: "text", corpo: "mude para Lente", registradaEm: new Date(+AGORA + 1) });
    return { ok: true };
  } } });
  const r = await f.executar(); expect(r.codigo).toBe("CONFIRMACAO_SUPERADA"); expect(f.executor).not.toHaveBeenCalled();
});

it("permissão revogada durante a preparação final cancela sem efeito fiscal", async () => {
  const client = banco(), autorizar = jest.fn().mockResolvedValueOnce({ ok: true }).mockResolvedValue({ ok: false });
  const f = confirmar(client, { deps: { autorizarPermissaoDaAcao: autorizar } });
  await expect(f.executar()).rejects.toMatchObject({ codigo: "ACESSO_REVOGADO" });
  expect(f.executor).not.toHaveBeenCalled(); expect(client.acoes[0].status).toBe("cancelada");
});

it("segmento desvinculado durante a reserva não cai na autorização legada", async () => {
  const client = banco();
  const f = confirmar(client, { deps: { autorizarPermissaoDaAcao: async () => { client.conversas[0].atendimentoId = null; return { ok: true }; } } });
  await expect(f.executar()).rejects.toMatchObject({ codigo: "CONTEXTO_ALTERADO" });
  expect(f.executor).not.toHaveBeenCalled(); expect(client.acoes[0].status).toBe("cancelada");
});

it("troca depois de iniciar o executor conserva o resultado e não repete na empresa nova", async () => {
  const client = banco(), iniciou = sinal(), concluir = sinal();
  const executor = jest.fn(async ({ acao }) => { iniciou.resolve(); await concluir.promise; return { texto: "Guia Klaus", resultado: { empresa: acao.portalClientId } }; });
  const f = confirmar(client, { executores: { RECALCULAR_GUIA: executor } });
  const p = f.executar(); await iniciou.promise; trocar(client); concluir.resolve();
  expect(await p).toMatchObject({ executou: true, resultado: { empresa: "klaus" } });
  expect(client.acoes[0]).toMatchObject({ status: "executada", portalClientId: "klaus", resultado: { empresa: "klaus" } });
  expect((await f.executar()).executou).toBe(false); expect(executor).toHaveBeenCalledTimes(1);
});

it("worker usa o lease do responsável e entrega o pin durável, sem ler a empresa atual", async () => {
  const client = banco(), job = { id: "job", conversaId: "cv1", portalClientId: "klaus", mensagemId: "m1", atendimentoId: "responsavel", contextoVersao: 7, perfil: "CLIENTE", status: "pendente", reservaToken: null, tentativas: 0 };
  client.turnoIaWhatsapp = { findMany: jest.fn(async () => [{ ...job }]), updateMany: jest.fn(async ({ data }) => { Object.assign(job, data); return { count: 1 }; }) };
  trocar(client);
  const responder = jest.fn(async ({ deps }) => { expect(deps.contexto).toEqual(pin); return { feito: false, motivo: "CONTEXTO_ALTERADO" }; });
  await processarTurnosIaUmaVez({ client, flag: true, piloto: ["klaus"], comercialFlag: false, responder, log, agora: AGORA });
  expect(adquirirLease).toHaveBeenCalledWith("responsavel:responsavel", expect.anything()); expect(job.status).toBe("ignorado");
});

it("enfileiramento conserva o recibo original no retry e rejeita um pin de outra empresa", async () => {
  const original = { id: "job", atendimentoId: "responsavel", contextoVersao: 7 };
  const client = { turnoIaWhatsapp: { create: jest.fn(async () => { throw { code: "P2002" }; }), findUnique: jest.fn(async () => original) } };
  expect(await enfileirarTurnoIa({ conversaId: "cv1", portalClientId: "klaus", mensagemId: "m1", contexto: pin, client })).toBe(original);
  expect(client.turnoIaWhatsapp.create.mock.calls[0][0].data).toMatchObject({ atendimentoId: "responsavel", contextoVersao: 7, portalClientId: "klaus" });
  await expect(enfileirarTurnoIa({ conversaId: "cv1", portalClientId: "lente", mensagemId: "m1", contexto: pin, client })).rejects.toMatchObject({ codigo: "CONTEXTO_ALTERADO" });
});
