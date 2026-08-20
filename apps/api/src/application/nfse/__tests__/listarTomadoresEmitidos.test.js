// A LISTA DA MEMÓRIA DE TOMADORES — a metade que faltava do pedido do dono.
//
// `buscarTomadoresEmitidos` (já usada pela rota do lote) responde *"conheço ESTE documento?"*.
// `listarTomadoresEmitidos` responde *"quem eu já conheço?"*, que é o que o seletor da tela de
// emissão precisa para poder oferecer.
//
// ⚠ NADA AQUI EMITE COISA ALGUMA, e não há Prisma de verdade: o cliente é um dublê e o que se
// observa são as chamadas que ele recebeu.

import { listarTomadoresEmitidos, LIMITE_TOMADORES } from "../tomadorEmitido.js";

function linha(documento, nome, ultimaEmissaoEm) {
  return {
    id: `t-${documento}`,
    companyId: "legacy-1",
    documento,
    nome,
    email: null,
    cMun: "3304557",
    cep: "20000000",
    xLgr: "RUA X",
    nro: "1",
    xCpl: null,
    xBairro: "CENTRO",
    ultimaEmissaoEm: new Date(ultimaEmissaoEm),
  };
}

function prismaDuble({ linhas = [], total = null, aoBuscar = null } = {}) {
  return {
    tomadorEmitido: {
      findMany: jest.fn(async () => {
        if (aoBuscar) throw aoBuscar;
        return linhas;
      }),
      count: jest.fn(async () => {
        if (aoBuscar) throw aoBuscar;
        return total === null ? linhas.length : total;
      }),
    },
  };
}

describe("listarTomadoresEmitidos — escopo, ordem e teto", () => {
  it("⚠ o `where` é SEMPRE escopado pela empresa — sem isso vaza o tomador de outro cliente", async () => {
    const prisma = prismaDuble({ linhas: [linha("11222333000181", "ACME", "2026-08-01")] });
    await listarTomadoresEmitidos({ prisma, companyId: "legacy-1" });

    const args = prisma.tomadorEmitido.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ companyId: "legacy-1" });
    expect(prisma.tomadorEmitido.count.mock.calls[0][0].where).toEqual({ companyId: "legacy-1" });
  });

  it("⚠ ordena por `ultimaEmissaoEm` DESC — 'para quem emiti mais recentemente', não 'quem é mais antigo'", async () => {
    const prisma = prismaDuble({ linhas: [] });
    await listarTomadoresEmitidos({ prisma, companyId: "legacy-1" });

    const args = prisma.tomadorEmitido.findMany.mock.calls[0][0];
    expect(args.orderBy).toEqual({ ultimaEmissaoEm: "desc" });
    // `createdAt` responde outra pergunta ("quem é cliente há mais tempo").
    expect(JSON.stringify(args.orderBy)).not.toMatch(/createdAt/);
  });

  it("o teto vai no `take`, e o padrão é o exportado", async () => {
    const prisma = prismaDuble({ linhas: [] });
    await listarTomadoresEmitidos({ prisma, companyId: "legacy-1" });
    expect(prisma.tomadorEmitido.findMany.mock.calls[0][0].take).toBe(LIMITE_TOMADORES);

    const outro = prismaDuble({ linhas: [] });
    await listarTomadoresEmitidos({ prisma: outro, companyId: "legacy-1", limite: 3 });
    expect(outro.tomadorEmitido.findMany.mock.calls[0][0].take).toBe(3);
  });

  it("⚠ o RECORTE volta nomeado — lista parcial que se apresenta como inteira faz escolher achando que o certo não existe", async () => {
    const prisma = prismaDuble({
      linhas: [linha("1", "A", "2026-08-01"), linha("2", "B", "2026-07-01")],
      total: 40,
    });
    const r = await listarTomadoresEmitidos({ prisma, companyId: "legacy-1", limite: 2 });

    expect(r.tomadores).toHaveLength(2);
    expect(r.total).toBe(40);
    expect(r.recortada).toBe(true);
  });

  it("sem recorte, `recortada` é falso", async () => {
    const prisma = prismaDuble({ linhas: [linha("1", "A", "2026-08-01")] });
    const r = await listarTomadoresEmitidos({ prisma, companyId: "legacy-1" });
    expect(r.recortada).toBe(false);
    expect(r.total).toBe(1);
  });
});

describe("⚠⚠ NUNCA LANÇA — a tela de emissão não pode cair por causa de uma conveniência", () => {
  it("tabela inexistente (P2021, migration não aplicada) devolve lista vazia com motivo", async () => {
    const erro = Object.assign(new Error("The table `tomadores_emitidos` does not exist"), {
      code: "P2021",
    });
    const prisma = prismaDuble({ aoBuscar: erro });
    const log = { warn: jest.fn() };

    const r = await listarTomadoresEmitidos({ prisma, companyId: "legacy-1", log });

    expect(r.tomadores).toEqual([]);
    expect(r.total).toBe(0);
    expect(r.motivo).toMatch(/does not exist/);
    expect(log.warn).toHaveBeenCalled();
  });

  it("não rejeita nunca — nem sem prisma, nem sem companyId", async () => {
    await expect(listarTomadoresEmitidos({ prisma: {}, companyId: "legacy-1" })).resolves.toMatchObject({
      tomadores: [],
      motivo: expect.any(String),
    });
    const prisma = prismaDuble({ linhas: [] });
    await expect(listarTomadoresEmitidos({ prisma, companyId: null })).resolves.toMatchObject({
      tomadores: [],
    });
    // ⚠ E sem `companyId` NADA é consultado: um `findMany` sem escopo devolveria o banco inteiro.
    expect(prisma.tomadorEmitido.findMany).not.toHaveBeenCalled();
  });
});

describe("⚠ ISTO NÃO ESCREVE NADA — é a memória do que a emissão TEVE, não um cadastro", () => {
  it("nenhuma escrita é chamada em nenhum caminho", async () => {
    const prisma = prismaDuble({ linhas: [linha("1", "A", "2026-08-01")] });
    prisma.tomadorEmitido.create = jest.fn();
    prisma.tomadorEmitido.update = jest.fn();
    prisma.tomadorEmitido.upsert = jest.fn();
    prisma.tomadorEmitido.delete = jest.fn();

    await listarTomadoresEmitidos({ prisma, companyId: "legacy-1" });

    expect(prisma.tomadorEmitido.create).not.toHaveBeenCalled();
    expect(prisma.tomadorEmitido.update).not.toHaveBeenCalled();
    expect(prisma.tomadorEmitido.upsert).not.toHaveBeenCalled();
    expect(prisma.tomadorEmitido.delete).not.toHaveBeenCalled();
  });
});
