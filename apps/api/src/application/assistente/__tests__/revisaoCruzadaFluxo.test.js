// Auditoria independente do agrupamento: transportes e atos fiscais são exclusivamente dublês.
jest.mock("../GuardaIaService.js", () => ({
  autorizarChamadaIa: jest.fn(async () => ({ ok: true, contexto: {} })), concluirChamadaIa: jest.fn(),
}));
jest.mock("../../whatsapp/ConversaWhatsappService.js", () => ({
  DIRECAO: { ENTRADA: "in", SAIDA: "out" },
  janelaDaConversa: jest.fn(async () => ({ situacao: "ABERTA" })),
  registrarMensagemEnviada: jest.fn(),
}));
jest.mock("../../whatsapp/SaidaWhatsappService.js", () => ({
  enviarMensagemRastreada: jest.fn(async ({ antesDeEnviar, enviar }) => { await antesDeEnviar(); return enviar(); }),
}));

import { responderMensagem } from "../AssistenteService.js";
import { TODAS_PERMISSOES_ASSISTENTE } from "../../whatsapp/permissoesAssistente.js";

const AGORA = new Date("2026-09-08T12:00:15Z");
const PENDENTE = { id: "ap1", conversaId: "cv1", portalClientId: "pc1", userId: "u1", tipo: "EMITIR_NFSE", codigo: "A7K2", status: "pendente", expiraEm: new Date("2026-09-08T12:10:00Z") };

function casa(m, where = {}) {
  return Object.entries(where).every(([campo, v]) => {
    if (campo === "OR") return v.some((item) => casa(m, item));
    if (campo === "AND") return v.every((item) => casa(m, item));
    if (campo === "conversa") return casa(m.conversa, v.is || v);
    if (campo === "mensagens") return v.some ? m.mensagens.some((item) => casa(item, v.some)) : !m.mensagens.some((item) => casa(item, v.none));
    if (v && typeof v === "object" && !(v instanceof Date)) return Object.entries(v).every(([op, valor]) =>
      op === "gt" ? m[campo] > valor : op === "gte" ? m[campo] >= valor : op === "lt" ? m[campo] < valor : op === "lte" ? m[campo] <= valor : op === "notIn" ? !valor.includes(m[campo]) : false);
    return v === null ? m[campo] == null : m[campo] === v;
  });
}

function ambiente(mensagens, { antesDaReserva } = {}) {
  const conversa = { id: "cv1", portalClientId: "pc1", telefoneE164: "5521999998888", escopoVerificado: true, atendidaPor: null, atendidaDesde: null, portalClient: { id: "pc1", razao: "Empresa de teste", cnpj: "11222333000181" } };
  const acao = { ...PENDENTE };
  const executor = jest.fn(async () => ({ texto: "Ato de teste executado", filaHumana: false, resultado: { fixture: true } }));
  const buscar = ({ where, take } = {}) => mensagens.filter((m) => casa(m, where)).sort((a, b) => a.registradaEm - b.registradaEm || a.id.localeCompare(b.id)).slice(0, take || undefined);
  const client = {
    conversaWhatsapp: { findUnique: jest.fn(async () => conversa), updateMany: jest.fn(async ({ data }) => { Object.assign(conversa, data); return { count: 1 }; }) },
    mensagemWhatsapp: { findUnique: jest.fn(async ({ where }) => mensagens.find((m) => m.id === where.id)), findFirst: jest.fn(async (q) => buscar(q)[0] || null), findMany: jest.fn(async (q) => buscar(q)), updateMany: jest.fn(async () => ({ count: 1 })) },
    contatoWhatsapp: { findMany: jest.fn(async () => [{ id: "c1", nome: "Contato de teste", userId: "u1", permissoesAssistente: [...TODAS_PERMISSOES_ASSISTENTE] }]) },
    companyClientUser: { findUnique: jest.fn(async () => ({ role: "CLIENT_ADMIN", status: "ACTIVE" })) },
    acaoPendenteWhatsapp: {
      findFirst: jest.fn(async ({ where }) => casa(acao, where) ? acao : null),
      findUnique: jest.fn(async () => ({ ...acao })),
      updateMany: jest.fn(async ({ where, data }) => {
        if (data.status === "confirmada") antesDaReserva?.(mensagens);
        if (!casa({ ...acao, conversa: { ...conversa, mensagens } }, where)) return { count: 0 };
        Object.assign(acao, data);
        return { count: 1 };
      }),
      update: jest.fn(async ({ data }) => Object.assign(acao, data)),
    },
  };
  return { client, acao, executor, executores: { EMITIR_NFSE: executor }, acoesDeps: { autorizarPermissaoDaAcao: jest.fn(async () => ({ ok: true })), autorizarEmissaoDoCliente: jest.fn(async () => ({ ok: true })) }, flag: true, piloto: ["pc1"], agora: AGORA, tryLock: async () => true, releaseLock: async () => {}, cloud: { enviarTexto: jest.fn(async () => ({ wamid: "wamid.fixture" })) }, log: { error: jest.fn(), warn: jest.fn(), info: jest.fn() }, assistente: { responder: jest.fn(async () => ({ texto: "Vamos revisar o pedido.", ferramentasChamadas: [], usage: {}, iteracoes: 1, stopReason: "end_turn" })) } };
}

const mensagem = (id, segundo, corpo) => ({ id, conversaId: "cv1", direcao: "in", tipo: "text", corpo, registradaEm: new Date(`2026-09-08T12:00:${String(segundo).padStart(2, "0")}Z`), respondidaPelaIaEm: null });

beforeEach(() => { jest.clearAllMocks(); });

it("não executa confirmação quando duplicata posterior encobre uma correção já recebida", async () => {
  const deps = ambiente([mensagem("m0", 0, "CONFIRMAR A7K2"), mensagem("m9", 9, "CONFIRMAR A7K2"), mensagem("m10", 10, "Espera, o valor está errado")]);
  const r = await responderMensagem({ conversaId: "cv1", mensagemId: "m0", deps });
  expect(r.feito).toBe(true);
  expect(deps.executor).not.toHaveBeenCalled();
  expect(deps.acao.status).toBe("cancelada");
});

it("correção no mesmo instante além das 12 bolhas impede a execução", async () => {
  const deps = ambiente([...Array.from({ length: 12 }, (_, i) => mensagem(`m${String(i).padStart(2, "0")}`, 0, "CONFIRMAR A7K2")), mensagem("z13", 0, "O valor precisa mudar")]);
  const r = await responderMensagem({ conversaId: "cv1", mensagemId: "m00", deps });
  expect(r.feito).toBe(true);
  expect(deps.executor).not.toHaveBeenCalled();
});

it("não executa quando uma fila maior que o limite de contexto contém uma correção", async () => {
  const deps = ambiente([mensagem("m0", 0, "CONFIRMAR A7K2"), ...Array.from({ length: 110 }, (_, i) => mensagem(`n${String(i).padStart(3, "0")}`, 9, "CONFIRMAR A7K2")), mensagem("z", 10, "Espera, preciso corrigir")]);
  const r = await responderMensagem({ conversaId: "cv1", mensagemId: "m0", deps });
  expect(r.feito).toBe(true);
  expect(deps.executor).not.toHaveBeenCalled();
});

it("correção gravada entre a pré-checagem e a reserva atômica impede o ato fiscal", async () => {
  const deps = ambiente([mensagem("m0", 0, "CONFIRMAR A7K2")], { antesDaReserva: (mensagens) => mensagens.push(mensagem("m15", 15, "Espera, está errado")) });
  const r = await responderMensagem({ conversaId: "cv1", mensagemId: "m0", deps });
  expect(r.feito).toBe(true);
  expect(deps.executor).not.toHaveBeenCalled();
  expect(deps.acao.status).toBe("cancelada");
  expect(deps.cloud.enviarTexto.mock.calls[0][0].texto).toMatch(/nova mensagem|confirmação.*mudou/);
});

it("somente duplicatas do mesmo código permitem uma única execução sem modelo", async () => {
  const deps = ambiente([mensagem("m0", 0, "CONFIRMAR A7K2"), mensagem("m9", 9, "confirmar a7k2."), mensagem("m10", 10, " CONFIRMAR A7K2 ")]);
  const r = await responderMensagem({ conversaId: "cv1", mensagemId: "m0", deps });
  expect(r.feito).toBe(true);
  expect(deps.executor).toHaveBeenCalledTimes(1);
  expect(deps.assistente.responder).not.toHaveBeenCalled();
});
