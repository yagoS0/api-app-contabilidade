import { confirmarEExecutar, DEPS_PADRAO } from "../AcoesPendentesService.js";
import { TIPOS, STATUS } from "../confirmacaoPendente.js";

const agora = new Date("2026-09-09T12:00:00Z");
const log = { error: jest.fn(), warn: jest.fn() };

function ambiente({ tipo = TIPOS.EMITIR_NFSE, desfecho = { texto: "Nota emitida, número 71.", filaHumana: false, resultado: { status: "issued", numero: "71" } } } = {}) {
  const acao = { id: "a1", conversaId: "c1", portalClientId: "p1", userId: "u1", tipo, status: STATUS.PENDENTE, expiraEm: new Date(agora.getTime() + 60000), payload: {} };
  const client = { acaoPendenteWhatsapp: {
    updateMany: jest.fn(async ({ where, data }) => {
      if (acao.status !== where.status || (where.userId && where.userId !== acao.userId)) return { count: 0 };
      Object.assign(acao, data);
      return { count: 1 };
    }),
    findUnique: jest.fn(async () => ({ ...acao })),
    update: jest.fn(async ({ data }) => Object.assign(acao, data)),
  } };
  const executor = jest.fn(async () => desfecho);
  const deps = { ...DEPS_PADRAO, autorizarPermissaoDaAcao: jest.fn(async () => ({ ok: true })), autorizarEmissaoDoCliente: jest.fn(async () => ({ ok: true })) };
  const executar = (extra = {}) => confirmarEExecutar({ acaoId: "a1", conversaId: "c1", portalClientId: "p1", userId: "u1", agora, client, log, deps, executores: { [tipo]: executor }, ...extra });
  return { acao, client, executor, deps, executar };
}

describe("resultado durável da confirmação guiada", () => {
  it("grava o texto e a decisão de encaminhamento junto do resultado fiscal", async () => {
    const a = ambiente();
    await a.executar();
    expect(a.client.acaoPendenteWhatsapp.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: STATUS.EXECUTADA, respostaAoCliente: "Nota emitida, número 71.", encaminharHumano: false, resultado: { status: "issued", numero: "71" } }) }));
  });

  it("guarda também o desfecho indeterminado, sem transformar a exceção em autorização de retry", async () => {
    const a = ambiente();
    a.executor.mockRejectedValueOnce(new Error("persistência após transporte"));
    const r = await a.executar();
    expect(a.acao).toMatchObject({ status: STATUS.EXECUTADA, respostaAoCliente: r.texto, encaminharHumano: true, resultado: { indeterminado: true } });
  });

  it.each(["autorizarPermissaoDaAcao", "autorizarEmissaoDoCliente"])("recusa de %s persiste a resposta sem executar", async (nome) => {
    const a = ambiente();
    a.deps[nome].mockResolvedValueOnce({ ok: false, codigo: "REVOGADO" });
    const r = await a.executar();
    expect(a.executor).not.toHaveBeenCalled();
    expect(a.acao).toMatchObject({ status: STATUS.CANCELADA, respostaAoCliente: r.texto, encaminharHumano: true });
  });

  it("reconfere lease/acesso após os awaits de autorização e antes do executor", async () => {
    const a = ambiente();
    let revogada = false;
    a.deps.autorizarEmissaoDoCliente.mockImplementation(async () => { revogada = true; return { ok: true }; });
    const erro = Object.assign(new Error("conversa assumida"), { codigo: "AUTOMACAO_INVALIDADA" });
    const antesDeExecutar = jest.fn(async () => { if (revogada) throw erro; });
    await expect(a.executar({ antesDeExecutar })).rejects.toBe(erro);
    expect(antesDeExecutar).toHaveBeenCalledTimes(1);
    expect(a.executor).not.toHaveBeenCalled();
    expect(a.acao).toMatchObject({ status: STATUS.CANCELADA, encaminharHumano: true, resultado: { erro: "EXECUCAO_INTERROMPIDA", codigo: "AUTOMACAO_INVALIDADA" } });
    expect(a.acao.respostaAoCliente).toMatch(/não executei/i);
  });

  it("inclui o usuário atual na reserva quando o chamador fornece o escopo", async () => {
    const a = ambiente();
    const r = await a.executar({ userId: "outro" });
    expect(a.client.acaoPendenteWhatsapp.updateMany.mock.calls[0][0].where.userId).toBe("outro");
    expect(a.executor).not.toHaveBeenCalled();
    expect(r.executou).toBe(false);
  });
});
