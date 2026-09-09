import { processarConfirmacaoGuiada } from "../ConfirmacaoGuiadaWhatsappService.js";

const agora = new Date("2026-09-09T12:01:00Z");
const entrada = (id = "m1", texto = "CONFIRMAR A7K2", ms = 0) => ({ id, conversaId: "c1", direcao: "in", tipo: "text", corpo: texto, registradaEm: new Date(agora.getTime() + ms) });
const acaoBase = () => ({ id: "a1", conversaId: "c1", portalClientId: "p1", userId: "u1", tipo: "EMITIR_NFSE", status: "pendente", codigo: "A7K2", createdAt: new Date(agora.getTime() - 30000), expiraEm: new Date(agora.getTime() + 60000), respostaAoCliente: null, encaminharHumano: false });

function casa(obj, where) {
  return Object.entries(where || {}).every(([k, v]) => {
    if (k === "OR") return v.some(q => casa(obj, q));
    if (k === "conversa") return casa(obj.conversa, v.is);
    if (k === "mensagens") return v.none ? !obj.mensagens.some(m => casa(m, v.none)) : obj.mensagens.some(m => casa(m, v.some));
    if (v && typeof v === "object" && !(v instanceof Date)) return Object.entries(v).every(([op, valor]) => {
      if (op === "in") return valor.includes(obj[k]);
      if (op === "notIn") return !valor.includes(obj[k]);
      if (op === "gte") return obj[k] >= valor;
      if (op === "gt") return obj[k] > valor;
      if (op === "lt") return obj[k] < valor;
      throw new Error(`Operador não simulado: ${op}`);
    });
    return v === null ? obj[k] == null : obj[k] === v;
  });
}

function ambiente({ acao = {}, mensagens = [entrada()], antesDaReserva } = {}) {
  const atual = acao === null ? null : { ...acaoBase(), ...acao };
  const conversa = { id: "c1", portalClientId: "p1", escopoVerificado: true, excluidaEm: null, atendidaPor: null, atendidaDesde: null, automacaoInvalidadaEm: null };
  const sessao = { ok: true, userId: "u1", portalClientId: "p1" };
  const client = {
    acaoPendenteWhatsapp: {
      findFirst: jest.fn(async ({ where }) => atual && casa(atual, where) ? { ...atual } : null),
      findUnique: jest.fn(async () => atual && { ...atual }),
      updateMany: jest.fn(async ({ where, data }) => {
        if (data.status === "confirmada") antesDaReserva?.({ atual, mensagens, conversa });
        if (!atual || !casa({ ...atual, conversa: { ...conversa, mensagens } }, where)) return { count: 0 };
        Object.assign(atual, data);
        return { count: 1 };
      }),
      update: jest.fn(async ({ data }) => Object.assign(atual, data)),
    },
    mensagemWhatsapp: {
      findMany: jest.fn(async ({ where, take }) => mensagens.filter(m => casa(m, where)).sort((a, b) => a.registradaEm - b.registradaEm || a.id.localeCompare(b.id)).slice(0, take)),
      findFirst: jest.fn(async ({ where }) => mensagens.find(m => casa(m, where)) || null),
    },
  };
  const executor = jest.fn(async () => ({ texto: "Nota emitida, número 71.", filaHumana: false, resultado: { status: "issued", numero: "71" } }));
  const conferirAcesso = jest.fn(async () => {});
  const acoesDeps = { autorizarPermissaoDaAcao: jest.fn(async () => ({ ok: true })), autorizarEmissaoDoCliente: jest.fn(async () => ({ ok: true })) };
  const processar = (texto = mensagens[0].corpo, extra = {}) => processarConfirmacaoGuiada({ conversa, mensagem: mensagens[0], sessao, texto, agora, client, conferirAcesso, executores: { EMITIR_NFSE: executor }, acoesDeps, log: { warn: jest.fn(), error: jest.fn() }, ...extra });
  return { atual, conversa, sessao, client, mensagens, executor, conferirAcesso, acoesDeps, processar };
}

it("confirma pelo código exato, com todas as dimensões de escopo na reserva", async () => {
  const a = ambiente();
  expect(await a.processar()).toMatchObject({ tratado: true, codigo: "EXECUTADA", finalizada: true, filaHumana: false });
  expect(a.executor).toHaveBeenCalledTimes(1);
  expect(a.atual).toMatchObject({ status: "executada", mensagemConfirmacaoId: "m1", respostaAoCliente: "Nota emitida, número 71." });
  expect(a.client.acaoPendenteWhatsapp.updateMany.mock.calls[0][0].where).toMatchObject({ conversaId: "c1", portalClientId: "p1", userId: "u1", conversa: { is: { mensagens: { none: { id: { notIn: ["m1"] } } } } } });
});

it.each([
  ["sim", "LEMBRAR_CONFIRMACAO", false, "pendente"],
  ["pode seguir", "LEMBRAR_CONFIRMACAO", false, "pendente"],
  ["CONFIRMAR B8K3", "CODIGO_ERRADO", false, "pendente"],
  ["CANCELAR PEDIDO", "CANCELADA", true, "cancelada"],
  ["não quero mais", "CANCELADA", true, "cancelada"],
])("%s preserva o protocolo determinístico", async (texto, codigo, finalizada, status) => {
  const a = ambiente();
  expect(await a.processar(texto)).toMatchObject({ tratado: true, codigo, finalizada });
  expect(a.atual.status).toBe(status);
  expect(a.executor).not.toHaveBeenCalled();
});

it("devolve correção livre ao coletor, sem apagar a pendência antes de ele salvar a revisão", async () => {
  const a = ambiente();
  expect(await a.processar("Troca para 1050,50")).toEqual({ tratado: false, acaoId: "a1" });
  expect(a.atual.status).toBe("pendente");
  expect(a.executor).not.toHaveBeenCalled();
});

it("expira o pedido sem executar", async () => {
  const a = ambiente({ acao: { expiraEm: new Date(agora.getTime() - 1) } });
  expect(await a.processar()).toMatchObject({ codigo: "EXPIRADA", finalizada: true });
  expect(a.atual.status).toBe("expirada");
  expect(a.executor).not.toHaveBeenCalled();
});

it("recusa confirmação anterior à criação do resumo mesmo que o código coincida", async () => {
  const a = ambiente({ acao: { createdAt: new Date(agora.getTime() + 1) } });
  expect(await a.processar()).toMatchObject({ codigo: "CONFIRMACAO_ANTERIOR_RESUMO", finalizada: false });
  expect(a.atual.status).toBe("pendente");
  expect(a.executor).not.toHaveBeenCalled();
});

it.each([{ conversaId: "outra" }, { portalClientId: "outra" }, { userId: "outro" }])("não revela nem executa pendência de outro escopo: %j", async (acao) => {
  const a = ambiente({ acao });
  expect(await a.processar()).toMatchObject({ codigo: "SEM_PENDENCIA", acaoId: null });
  expect(a.executor).not.toHaveBeenCalled();
  for (const [q] of a.client.acaoPendenteWhatsapp.findFirst.mock.calls) expect(q.where).toMatchObject({ conversaId: "c1", portalClientId: "p1", userId: "u1" });
});

it("conferência de acesso é obrigatória e ocorre antes de qualquer leitura", async () => {
  const a = ambiente();
  a.conferirAcesso.mockRejectedValueOnce(new Error("acesso revogado"));
  await expect(a.processar()).rejects.toThrow("acesso revogado");
  await expect(a.processar(undefined, { conferirAcesso: null })).rejects.toMatchObject({ codigo: "ACESSO_REVOGADO" });
  expect(a.client.acaoPendenteWhatsapp.findFirst).not.toHaveBeenCalled();
});

it("recusa mensagem de outro fio antes de ler pendências", async () => {
  const a = ambiente();
  await expect(a.processar(undefined, { mensagem: { ...entrada(), conversaId: "outra" } })).rejects.toMatchObject({ codigo: "ACESSO_REVOGADO" });
  expect(a.client.acaoPendenteWhatsapp.findFirst).not.toHaveBeenCalled();
});

it("duplicata posterior não esconde correção, inclusive mensagem já respondida", async () => {
  const a = ambiente({ mensagens: [entrada(), entrada("m2", "CONFIRMAR A7K2", 9000), { ...entrada("m3", "Espera, o valor está errado", 10000), respondidaPelaIaEm: agora }] });
  expect(await a.processar()).toMatchObject({ codigo: "CONFIRMACAO_SUPERADA", finalizada: true });
  expect(a.executor).not.toHaveBeenCalled();
});

it("correção no mesmo instante também bloqueia", async () => {
  const a = ambiente({ mensagens: [entrada(), entrada("a0", "Era outro tomador")] });
  expect(await a.processar()).toMatchObject({ codigo: "CONFIRMACAO_SUPERADA" });
  expect(a.executor).not.toHaveBeenCalled();
});

it("não autoriza com uma caixa truncada em mais de cem entradas", async () => {
  const a = ambiente({ mensagens: [entrada(), ...Array.from({ length: 101 }, (_, i) => entrada(`n${i}`, "CONFIRMAR A7K2", i + 1))] });
  expect(await a.processar()).toMatchObject({ codigo: "CONFIRMACAO_SUPERADA" });
  expect(a.executor).not.toHaveBeenCalled();
});

it("somente duplicatas conhecidas permitem uma execução", async () => {
  const a = ambiente({ mensagens: [entrada(), entrada("m2", " confirmar a7k2. ", 1)] });
  await a.processar();
  await a.processar(undefined, { mensagem: a.mensagens[1], texto: a.mensagens[1].corpo });
  expect(a.executor).toHaveBeenCalledTimes(1);
});

it("nova entrada entre leitura e UPDATE é barrada na própria reserva", async () => {
  const a = ambiente({ antesDaReserva: ({ mensagens }) => mensagens.push(entrada("nova", "Correção", 1)) });
  expect(await a.processar()).toMatchObject({ codigo: "CONFIRMACAO_SUPERADA" });
  expect(a.executor).not.toHaveBeenCalled();
  expect(a.atual.status).toBe("cancelada");
});

it("nova entrada durante a autorização, depois da reserva, ainda impede o executor", async () => {
  const a = ambiente();
  a.acoesDeps.autorizarEmissaoDoCliente.mockImplementation(async () => { a.mensagens.push(entrada("nova", "Correção", 1)); return { ok: true }; });
  expect(await a.processar()).toMatchObject({ codigo: "CONFIRMACAO_SUPERADA", filaHumana: false });
  expect(a.executor).not.toHaveBeenCalled();
  expect(a.atual).toMatchObject({ status: "cancelada", encaminharHumano: false });
});

it.each(["atendidaPor", "automacaoInvalidadaEm"])("%s alterado antes da reserva bloqueia o ato", async (campo) => {
  const a = ambiente({ antesDaReserva: ({ conversa }) => { conversa[campo] = campo === "atendidaPor" ? "contador" : agora; } });
  await a.processar();
  expect(a.executor).not.toHaveBeenCalled();
});

it("humano assume durante a reconferência; interrompe sem executar nem retornar texto para enviar", async () => {
  const a = ambiente();
  const erro = Object.assign(new Error("humano assumiu"), { codigo: "AUTOMACAO_INVALIDADA" });
  a.acoesDeps.autorizarEmissaoDoCliente.mockImplementation(async () => { a.conferirAcesso.mockRejectedValue(erro); return { ok: true }; });
  await expect(a.processar()).rejects.toBe(erro);
  expect(a.executor).not.toHaveBeenCalled();
  expect(a.atual.status).toBe("cancelada");
});

it.each([false, true])("recupera resposta persistida depois de crash sem repetir executor (handoff=%s)", async (encaminharHumano) => {
  const a = ambiente({ acao: { status: "executada", mensagemConfirmacaoId: "m1", respostaAoCliente: "Resultado exato salvo.", encaminharHumano } });
  expect(await a.processar()).toMatchObject({ codigo: "RESULTADO_RECUPERADO", texto: "Resultado exato salvo.", filaHumana: encaminharHumano, finalizada: true });
  expect(a.executor).not.toHaveBeenCalled();
});

it("nova mensagem com o código já executado recupera resultado e não pede reemissão", async () => {
  const a = ambiente({ acao: { status: "executada", mensagemConfirmacaoId: "anterior", respostaAoCliente: "Nota emitida 71." } });
  expect(await a.processar()).toMatchObject({ codigo: "RESULTADO_RECUPERADO", texto: "Nota emitida 71." });
  expect(a.executor).not.toHaveBeenCalled();
});

it.each([
  { status: "confirmada", mensagemConfirmacaoId: "m1" },
  { status: "confirmada", mensagemConfirmacaoId: "outra" },
  { status: "executada", mensagemConfirmacaoId: "m1", respostaAoCliente: null },
])("resultado incerto/legado vai à equipe sem executor: %j", async (acao) => {
  const a = ambiente({ acao });
  expect(await a.processar()).toMatchObject({ codigo: "RESULTADO_INDETERMINADO", filaHumana: true, finalizada: true });
  expect(a.executor).not.toHaveBeenCalled();
});

it("falha ao persistir depois do executor deixa reserva incerta e bloqueia novo ato no retry", async () => {
  const a = ambiente();
  a.client.acaoPendenteWhatsapp.update.mockRejectedValueOnce(new Error("banco indisponível após emissão"));
  await expect(a.processar()).rejects.toThrow("banco indisponível após emissão");
  expect(a.atual.status).toBe("confirmada");
  expect(await a.processar()).toMatchObject({ codigo: "RESULTADO_INDETERMINADO", filaHumana: true });
  expect(a.executor).toHaveBeenCalledTimes(1);
});
