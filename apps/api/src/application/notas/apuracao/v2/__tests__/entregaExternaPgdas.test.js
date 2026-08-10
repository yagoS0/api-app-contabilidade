// A DECLARAÇÃO ENTREGUE **FORA** DO PORTAL — registrar o que já foi feito, sem virar transmissão.
//
// Contexto (dono, 10/08/2026): *"os meses estão entregues sim, foram entregues à mão"*. As ~190
// competências zeradas já foram declaradas no gov.br e o portal não sabia de nenhuma delas.
// `registrarEntregaExternaPgdas` guarda essa afirmação — e o que estes testes travam é o que ela
// NÃO pode fazer:
//
//   · não escreve em `ApuracaoSnapshot` (nada aqui registra transmissão nossa);
//   · não convive com uma transmissão pelo portal (seriam duas histórias sobre a mesma entrega);
//   · não guarda recibo por conta própria — campo vazio fica NULL, nunca inventado;
//   · desmarcar limpa tudo, porque erro de marcação não pode virar permanente.

jest.mock("../../../../../infrastructure/db/prisma.js", () => ({
  prisma: {
    apuracaoSnapshot: { findUnique: jest.fn(async () => null) },
    entregaObrigacaoArquivo: { upsert: jest.fn(async ({ create, update }) => ({ ...create, ...update })) },
  },
}));

import { prisma } from "../../../../../infrastructure/db/prisma.js";
import { registrarEntregaExternaPgdas, TIPO_ENTREGA_PGDAS } from "../FechamentoService.js";

const BASE = { portalClientId: "p1", competencia: "2026-07", userId: "u1" };

beforeEach(() => {
  jest.clearAllMocks();
  prisma.apuracaoSnapshot.findUnique.mockResolvedValue(null);
  prisma.entregaObrigacaoArquivo.upsert.mockImplementation(async ({ create, update }) => ({ ...create, ...update }));
});

describe("registrarEntregaExternaPgdas", () => {
  test("grava a marca manual no tipo PGDAS_D, com quem afirmou", async () => {
    const r = await registrarEntregaExternaPgdas({ ...BASE, entregue: true, observacao: " recibo 000-X " });
    expect(r.ok).toBe(true);
    expect(r.entregueFora).toBe(true);
    const arg = prisma.entregaObrigacaoArquivo.upsert.mock.calls[0][0];
    expect(arg.where.portalClientId_tipo_competencia.tipo).toBe(TIPO_ENTREGA_PGDAS);
    expect(arg.update.transmitidaEm).toBeInstanceOf(Date);
    expect(arg.update.transmitidaPorId).toBe("u1");
    expect(arg.update.observacao).toBe("recibo 000-X");
  });

  test("recibo em branco vira NULL — nada é inventado nem preenchido por padrão", async () => {
    await registrarEntregaExternaPgdas({ ...BASE, entregue: true, observacao: "   " });
    expect(prisma.entregaObrigacaoArquivo.upsert.mock.calls[0][0].update.observacao).toBeNull();
    await registrarEntregaExternaPgdas({ ...BASE, entregue: true });
    expect(prisma.entregaObrigacaoArquivo.upsert.mock.calls[1][0].update.observacao).toBeNull();
  });

  test("desmarcar limpa data, autor e observação", async () => {
    const r = await registrarEntregaExternaPgdas({ ...BASE, entregue: false });
    expect(r.entregueFora).toBe(false);
    expect(prisma.entregaObrigacaoArquivo.upsert.mock.calls[0][0].update).toEqual({
      transmitidaEm: null, transmitidaPorId: null, observacao: null,
    });
  });

  test("⚠ RECUSA quando a competência já consta transmitida PELO PORTAL", async () => {
    prisma.apuracaoSnapshot.findUnique.mockResolvedValue({ estado: "transmitida", numeroDeclaracao: "999" });
    await expect(registrarEntregaExternaPgdas({ ...BASE, entregue: true }))
      .rejects.toMatchObject({ code: "ENTREGA_EXTERNA_JA_TRANSMITIDA" });
    expect(prisma.entregaObrigacaoArquivo.upsert).not.toHaveBeenCalled();
  });

  test("DESMARCAR continua permitido mesmo com transmissão pelo portal — desfazer é o lado seguro", async () => {
    prisma.apuracaoSnapshot.findUnique.mockResolvedValue({ estado: "transmitida", numeroDeclaracao: "999" });
    await expect(registrarEntregaExternaPgdas({ ...BASE, entregue: false })).resolves.toMatchObject({ ok: true });
  });

  test("competência inválida não grava nada", async () => {
    await expect(registrarEntregaExternaPgdas({ ...BASE, competencia: "2026", entregue: true }))
      .rejects.toMatchObject({ code: "competencia_required" });
    expect(prisma.entregaObrigacaoArquivo.upsert).not.toHaveBeenCalled();
  });

  test("⚠ A FRONTEIRA: nenhum caminho escreve em ApuracaoSnapshot", async () => {
    // O snapshot é onde mora "transmitida" — registrar entrega feita fora nunca pode encostar nele.
    // `update`/`create` sequer existem no mock: se algum dia alguém os chamar, o teste estoura.
    await registrarEntregaExternaPgdas({ ...BASE, entregue: true });
    await registrarEntregaExternaPgdas({ ...BASE, entregue: false });
    expect(Object.keys(prisma.apuracaoSnapshot)).toEqual(["findUnique"]);
  });
});
