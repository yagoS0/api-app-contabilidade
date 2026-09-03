// A CONFIRMAÇÃO E A EXECUÇÃO — a reserva atômica, a reconferência do portão e as travas.
//
// ⚠⚠ ESTE ARQUIVO NASCEU DE UM EXPERIMENTO QUE VOLTOU VERDE (03/09/2026, agente "C · custo e
// idempotência"): tirando `status: "pendente"` do `updateMany` de `confirmarEExecutar`, a suíte
// inteira continuava passando — quem barrava a segunda confirmação em SÉRIE era `pendenciaAberta`,
// e a CORRIDA (dois turnos que leram a mesma pendência) não tinha teste nenhum. `confirmarEExecutar`
// nunca era chamada direto.
//
// O que fica travado aqui: (1) a reserva executa UMA vez, mesmo com dois turnos concorrentes;
// (2) pendência de OUTRO fio ou de OUTRA empresa não é confirmada; (3) o portão é RECONFERIDO na
// hora de executar (a rota HTTP reconfere a cada POST — aqui passam até 10 minutos), e a
// reconferência que LANÇA recusa (fechado); (4) o recálculo refaz as 4 travas da rota antes da
// chamada PAGA ao SERPRO; (5) o cancelamento marca a NOSSA `ServiceInvoice`, como a rota faz.
//
// Nenhuma rede, nenhum banco: `client` é um objeto em memória e as funções de fora são dublês.

import { confirmarEExecutar, criarPendencia, DEPS_PADRAO } from "../AcoesPendentesService.js";
import { TIPOS, STATUS } from "../confirmacaoPendente.js";

const AGORA = new Date("2026-09-03T12:00:00.000Z");
const silencio = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

const GUIA = {
  id: "g1", portalClientId: "pc-1", tipo: "SIMPLES", source: "SERPRO", parcelamentoId: null,
  competencia: "2026-07", valor: 1441.25, vencimento: new Date("2026-08-20T00:00:00Z"),
  status: "PROCESSED", paymentStatus: "OVERDUE", liberadaCliente: true,
};

/** Banco em memória: só o que estes caminhos tocam. */
function clienteFalso({ acoes = [], guide = GUIA } = {}) {
  const tabela = new Map(acoes.map((a) => [a.id, { ...a }]));
  const casa = (a, where) => (
    (!where.id || a.id === where.id)
    && (!where.status || a.status === where.status)
    && (!where.conversaId || a.conversaId === where.conversaId)
    && (!where.portalClientId || a.portalClientId === where.portalClientId)
    && (!where.expiraEm?.gt || a.expiraEm > where.expiraEm.gt)
  );
  return {
    _tabela: tabela,
    acaoPendenteWhatsapp: {
      updateMany: jest.fn(async ({ where, data }) => {
        let count = 0;
        for (const a of tabela.values()) if (casa(a, where)) { Object.assign(a, data); count += 1; }
        return { count };
      }),
      findUnique: jest.fn(async ({ where }) => (tabela.has(where.id) ? { ...tabela.get(where.id) } : null)),
      findFirst: jest.fn(async ({ where }) => [...tabela.values()].find((a) => casa(a, where)) || null),
      update: jest.fn(async ({ where, data }) => Object.assign(tabela.get(where.id), data)),
      create: jest.fn(async ({ data }) => { const a = { id: `ap-${tabela.size + 1}`, ...data }; tabela.set(a.id, a); return { ...a }; }),
    },
    guide: {
      findFirst: jest.fn(async ({ where }) => (guide && where.id === guide.id && where.portalClientId === guide.portalClientId && (!where.liberadaCliente || guide.liberadaCliente) ? guide : null)),
      findUnique: jest.fn(async () => ({ ...guide, valor: 1502.9, vencimento: new Date("2026-09-05T00:00:00Z") })),
    },
  };
}

function depsFalsos(over = {}) {
  return {
    ...DEPS_PADRAO,
    NfseService: { issue: jest.fn(async () => ({ status: "issued", nfse: { numeroNfse: "77" } })), sendEvent: jest.fn(async () => ({ status: "accepted" })) },
    NfseRepository: { updateByChaveAcesso: jest.fn(async () => ({ id: "si1" })) },
    resolveLegacyCompanyId: jest.fn(async () => "legacy-1"),
    autorizarEmissaoDoCliente: jest.fn(async () => ({ ok: true, via: "CLIENTE" })),
    comContextoSerpro: jest.fn(async (_ctx, fn) => fn()),
    capturePgdasGuideForCompany: jest.fn(async () => ({ guide: { guideId: "g1" } })),
    reemitirDarfLp: jest.fn(async () => ({ composicao: null })),
    markGuideOpenBySerpro: jest.fn(async () => {}),
    canGuideRecalculate: jest.fn(() => true),
    isGuideOverdue: jest.fn(() => true),
    ...over,
  };
}

function pendencia(over = {}) {
  return {
    id: "ap1", conversaId: "cv1", portalClientId: "pc-1", userId: "u1", tipo: TIPOS.RECALCULAR_GUIA,
    payload: { guideId: "g1" }, codigo: "K9M3", status: STATUS.PENDENTE,
    expiraEm: new Date(AGORA.getTime() + 5 * 60_000), textoDeConfirmacao: "…",
    ...over,
  };
}

describe("a reserva — uma execução, e só uma", () => {
  it("⚠ DOIS turnos concorrentes com a MESMA pendência: o executor roda UMA vez", async () => {
    const client = clienteFalso({ acoes: [pendencia()] });
    const executor = jest.fn(async () => ({ texto: "feito", filaHumana: false, resultado: { ok: true } }));
    const executores = { [TIPOS.RECALCULAR_GUIA]: executor };
    const [a, b] = await Promise.all([
      confirmarEExecutar({ acaoId: "ap1", conversaId: "cv1", portalClientId: "pc-1", agora: AGORA, client, log: silencio, executores }),
      confirmarEExecutar({ acaoId: "ap1", conversaId: "cv1", portalClientId: "pc-1", agora: AGORA, client, log: silencio, executores }),
    ]);
    expect(executor).toHaveBeenCalledTimes(1);
    expect([a.executou, b.executou].filter(Boolean)).toHaveLength(1);
    const recusada = a.executou ? b : a;
    expect(recusada.texto).toMatch(/já foi tratado ou expirou/);
  });

  it("expirada, cancelada e já executada não executam", async () => {
    for (const estado of [{ expiraEm: new Date(AGORA.getTime() - 1000) }, { status: STATUS.CANCELADA }, { status: STATUS.EXECUTADA }]) {
      const client = clienteFalso({ acoes: [pendencia(estado)] });
      const executor = jest.fn();
      const r = await confirmarEExecutar({ acaoId: "ap1", conversaId: "cv1", agora: AGORA, client, log: silencio, executores: { [TIPOS.RECALCULAR_GUIA]: executor } });
      expect(executor).not.toHaveBeenCalled();
      expect(r.executou).toBe(false);
    }
  });

  it("⚠ pendência de OUTRO fio, ou de outra EMPRESA (o fio foi re-vinculado), não é confirmada", async () => {
    const client = clienteFalso({ acoes: [pendencia()] });
    const executor = jest.fn();
    const executores = { [TIPOS.RECALCULAR_GUIA]: executor };
    const outroFio = await confirmarEExecutar({ acaoId: "ap1", conversaId: "cv9", portalClientId: "pc-1", agora: AGORA, client, log: silencio, executores });
    const outraEmpresa = await confirmarEExecutar({ acaoId: "ap1", conversaId: "cv1", portalClientId: "pc-9", agora: AGORA, client, log: silencio, executores });
    expect(executor).not.toHaveBeenCalled();
    expect([outroFio.executou, outraEmpresa.executou]).toEqual([false, false]);
    expect(client._tabela.get("ap1").status).toBe(STATUS.PENDENTE);
  });
});

describe("a reconferência do portão — o que mudou nos 10 minutos", () => {
  it("⚠ autorização REVOGADA entre o pedido e o CONFIRMAR: a nota NÃO é emitida", async () => {
    const client = clienteFalso({ acoes: [pendencia({ tipo: TIPOS.EMITIR_NFSE, payload: { tomador: {} } })] });
    const deps = depsFalsos({ autorizarEmissaoDoCliente: jest.fn(async () => ({ ok: false, codigo: "EMISSAO_NAO_LIBERADA" })) });
    const r = await confirmarEExecutar({ acaoId: "ap1", conversaId: "cv1", portalClientId: "pc-1", agora: AGORA, client, log: silencio, deps });
    expect(deps.NfseService.issue).not.toHaveBeenCalled();
    expect(r.executou).toBe(false);
    expect(r.filaHumana).toBe(true);
    expect(r.texto).toMatch(/autorização para este ato mudou/);
    expect(client._tabela.get("ap1").status).toBe(STATUS.CANCELADA);
  });

  it("⚠ a reconferência que LANÇA recusa — fechado, nunca aberto", async () => {
    const client = clienteFalso({ acoes: [pendencia({ tipo: TIPOS.CANCELAR_NFSE, payload: { chaveAcesso: "5".repeat(50), cMotivo: "2", justificativa: "serviço não prestado ao cliente" } })] });
    const deps = depsFalsos({ autorizarEmissaoDoCliente: jest.fn(async () => { throw new Error("banco fora"); }) });
    const r = await confirmarEExecutar({ acaoId: "ap1", conversaId: "cv1", portalClientId: "pc-1", agora: AGORA, client, log: silencio, deps });
    expect(deps.NfseService.sendEvent).not.toHaveBeenCalled();
    expect(r.executou).toBe(false);
    expect(r.resultado).toEqual({ erro: "RECONFERENCIA", codigo: "RECONFERENCIA_FALHOU" });
  });

  it("autorização mantida: emite, e o recálculo (que não é ato de emissão) nem consulta o portão", async () => {
    const clientE = clienteFalso({ acoes: [pendencia({ tipo: TIPOS.EMITIR_NFSE, payload: { tomador: {} } })] });
    const depsE = depsFalsos();
    const e = await confirmarEExecutar({ acaoId: "ap1", conversaId: "cv1", portalClientId: "pc-1", agora: AGORA, client: clientE, log: silencio, deps: depsE });
    expect(depsE.NfseService.issue).toHaveBeenCalledTimes(1);
    expect(depsE.NfseService.issue.mock.calls[0][0].data.companyId).toBe("legacy-1");
    expect(e.texto).toMatch(/Nota emitida/);
    expect(clientE._tabela.get("ap1").status).toBe(STATUS.EXECUTADA);

    const clientR = clienteFalso({ acoes: [pendencia()] });
    const depsR = depsFalsos();
    await confirmarEExecutar({ acaoId: "ap1", conversaId: "cv1", portalClientId: "pc-1", agora: AGORA, client: clientR, log: silencio, deps: depsR });
    expect(depsR.autorizarEmissaoDoCliente).not.toHaveBeenCalled();
  });
});

describe("o recálculo — as 4 travas da rota, de novo, ANTES da chamada PAGA", () => {
  const casos = [
    ["guia não liberada / de outra empresa", { guide: { ...GUIA, liberadaCliente: false } }, {}, /Não encontrei essa guia/],
    ["ainda processando", { guide: { ...GUIA, status: "PENDING" } }, {}, /sendo processada/],
    ["recálculo indisponível", {}, { canGuideRecalculate: jest.fn(() => false) }, /não pode ser gerada de novo/],
    ["não vencida", {}, { isGuideOverdue: jest.fn(() => false) }, /não consta como vencida/],
  ];
  it.each(casos)("⚠ %s → o SERPRO NÃO é chamado", async (_nome, doBanco, doDeps, frase) => {
    const client = clienteFalso({ acoes: [pendencia()], ...doBanco });
    const deps = depsFalsos(doDeps);
    const r = await confirmarEExecutar({ acaoId: "ap1", conversaId: "cv1", portalClientId: "pc-1", agora: AGORA, client, log: silencio, deps });
    expect(deps.comContextoSerpro).not.toHaveBeenCalled();
    expect(deps.capturePgdasGuideForCompany).not.toHaveBeenCalled();
    expect(r.texto).toMatch(frase);
  });

  it("as 4 travas passando: chama o SERPRO com origem whatsapp:recalcular e forcar FALSE", async () => {
    const client = clienteFalso({ acoes: [pendencia()] });
    const deps = depsFalsos();
    const r = await confirmarEExecutar({ acaoId: "ap1", conversaId: "cv1", portalClientId: "pc-1", agora: AGORA, client, log: silencio, deps });
    expect(deps.comContextoSerpro).toHaveBeenCalledTimes(1);
    expect(deps.comContextoSerpro.mock.calls[0][0]).toEqual({ origem: "whatsapp:recalcular", userId: "u1", forcar: false });
    expect(r.executou).toBe(true);
    expect(r.texto).toMatch(/Guia atualizada/);
  });
});

describe("o cancelamento — o NOSSO registro acompanha", () => {
  it("marca a ServiceInvoice pela chave, como a rota do cliente faz", async () => {
    const chave = "5".repeat(50);
    const client = clienteFalso({ acoes: [pendencia({ tipo: TIPOS.CANCELAR_NFSE, payload: { chaveAcesso: chave, cMotivo: "2", justificativa: "serviço não prestado ao cliente", numero: "12" } })] });
    const deps = depsFalsos();
    const r = await confirmarEExecutar({ acaoId: "ap1", conversaId: "cv1", portalClientId: "pc-1", agora: AGORA, client, log: silencio, deps });
    expect(deps.NfseService.sendEvent.mock.calls[0][0]).toMatchObject({ chaveAcesso: chave, tipoEvento: "e101101", companyId: "legacy-1" });
    expect(deps.NfseRepository.updateByChaveAcesso).toHaveBeenCalledWith(chave, { status: "cancelled" });
    expect(r.executou).toBe(true);
  });
});

describe("criarPendencia — uma por fio", () => {
  it("a anterior é CANCELADA e o código entra no texto", async () => {
    const client = clienteFalso({ acoes: [pendencia()] });
    const { texto, codigo } = await criarPendencia({
      conversaId: "cv1", portalClientId: "pc-1", userId: "u1", tipo: TIPOS.EMITIR_NFSE,
      payload: {}, corpo: "Emitir esta nota?", agora: AGORA, rand: () => 0, client,
    });
    expect(client._tabela.get("ap1").status).toBe(STATUS.CANCELADA);
    expect(texto).toContain(`CONFIRMAR ${codigo}`);
  });
});
