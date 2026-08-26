// ⚠⚠ O ESCOPO GLOBAL — a diferença entre O(1) e O(n) em hora humana.
//
// Até 26/08/2026 `AprendizadoService` só gravava escopo EMPRESA. O mesmo código de serviço era
// decidido UMA VEZ POR CLIENTE: com mil empresas, mil pendências idênticas e mil regras idênticas
// para uma pergunta que tem uma resposta só — **o código de serviço não muda de significado
// conforme o cliente**. Estes testes prendem as duas metades do conserto (a regra que vale para a
// carteira, e as pendências irmãs que deixam de ser pedidas) e, principalmente, as guardas que
// impedem o alcance maior de virar estrago maior.

jest.mock("../../../../../infrastructure/db/prisma.js", () => {
  const db = { regras: [], pendencias: [], produtos: [] };
  const prisma = {
    __db: db,
    filaPendencia: {
      findUnique: jest.fn(async ({ where }) => db.pendencias.find((p) => p.id === where.id) || null),
      findMany: jest.fn(async ({ where }) => db.pendencias.filter((p) => (
        p.tipo === where.tipo
        && p.resolvida === where.resolvida
        && (!where.id?.not || p.id !== where.id.not)
        && (!where.detalhes || p.detalhes?.codigo === where.detalhes.equals)
      ))),
      update: jest.fn(async ({ where, data }) => {
        const p = db.pendencias.find((x) => x.id === where.id);
        Object.assign(p, data);
        return p;
      }),
      updateMany: jest.fn(async ({ where, data }) => {
        const alvo = db.pendencias.filter((p) => where.id.in.includes(p.id));
        alvo.forEach((p) => Object.assign(p, data));
        return { count: alvo.length };
      }),
    },
    regraClassificacao: {
      findFirst: jest.fn(async ({ where }) => db.regras.find((r) => (
        r.escopo === where.escopo
        && (r.portalClientId ?? null) === (where.portalClientId ?? null)
        && r.tipoCodigo === where.tipoCodigo && r.codigo === where.codigo
        && (r.vigenciaFim ?? null) === null
      )) || null),
      create: jest.fn(async ({ data }) => {
        const r = { id: `r${db.regras.length + 1}`, ...data };
        db.regras.push(r);
        return r;
      }),
      update: jest.fn(async ({ where, data }) => {
        const r = db.regras.find((x) => x.id === where.id);
        Object.assign(r, data);
        return r;
      }),
    },
    produtoServico: { create: jest.fn(async ({ data }) => ({ id: "p1", ...data })) },
  };
  return { prisma };
});

jest.mock("../ClassificadorService.js", () => ({
  classificarItensV2: jest.fn(async ({ portalClientId }) => ({ portalClientId, classificados: 1 })),
}));

import { prisma } from "../../../../../infrastructure/db/prisma.js";
import { classificarItensV2 } from "../ClassificadorService.js";
import {
  resolverPendenciaItemSemRegra,
  PRIORIDADE_GLOBAL_APRENDIZADO,
  ACAO_RESOLVIDA_POR_REGRA_GLOBAL,
} from "../AprendizadoService.js";

const db = prisma.__db;

function pendencia(id, portalClientId, codigo = "171201") {
  return {
    id,
    portalClientId,
    tipo: "ITEM_SEM_REGRA",
    resolvida: false,
    detalhes: { codigo, tipoCodigo: "LC116" },
  };
}

function regraSeed(tipoReceita = "SERVICO_FATOR_R") {
  return {
    id: "seed1",
    escopo: "GLOBAL",
    portalClientId: null,
    tipoCodigo: "LC116",
    codigo: "171201",
    tipoReceita,
    fonte: "SEED_APP",
    prioridade: 10,
    vigenciaFim: null,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  db.regras.length = 0;
  db.pendencias.length = 0;
  db.produtos.length = 0;
  // O caso real medido: TRÊS empresas paradas no MESMO código (17.12, "Administração em geral").
  db.pendencias.push(
    pendencia("pend-A", "emp-A"),
    pendencia("pend-B", "emp-B"),
    pendencia("pend-C", "emp-C"),
  );
});

describe("⚠ O DEFAULT CONTINUA EMPRESA — alcance não muda em silêncio", () => {
  it("sem `escopo`, a regra nasce EMPRESA, com o portalClientId da pendência", async () => {
    const r = await resolverPendenciaItemSemRegra({
      pendenciaId: "pend-A", tipoReceita: "SERVICO_ANEXO_IV", userId: "u1",
    });
    expect(r.escopo).toBe("EMPRESA");
    expect(db.regras[0]).toMatchObject({ escopo: "EMPRESA", portalClientId: "emp-A", prioridade: 100 });
  });

  it("⚠⚠ e ela NÃO fecha a pendência de mais ninguém", async () => {
    // É o comportamento de antes, e ele tem de sobreviver: resolver para uma empresa não pode
    // decidir pelas outras. Só o pedido explícito de GLOBAL faz isso.
    await resolverPendenciaItemSemRegra({
      pendenciaId: "pend-A", tipoReceita: "SERVICO_ANEXO_IV", userId: "u1",
    });
    expect(db.pendencias.find((p) => p.id === "pend-B").resolvida).toBe(false);
    expect(db.pendencias.find((p) => p.id === "pend-C").resolvida).toBe(false);
  });

  it("⚠ escopo desconhecido RECUSA — nunca cai em EMPRESA por precaução", async () => {
    // Um typo viraria alcance MENOR que o pedido, e o contador acharia ter decidido para a
    // carteira quando decidiu para uma empresa. Falha barulhenta.
    for (const escopo of ["global", "GLOBAIS", "", null, "TODOS"]) {
      await expect(resolverPendenciaItemSemRegra({
        pendenciaId: "pend-A", tipoReceita: "SERVICO_ANEXO_IV", escopo, userId: "u1",
      })).rejects.toThrow(/escopo inválido/);
    }
    expect(db.regras).toHaveLength(0);
  });
});

describe("⚠⚠ GLOBAL: uma decisão, a carteira inteira", () => {
  const resolverGlobal = () => resolverPendenciaItemSemRegra({
    pendenciaId: "pend-A", tipoReceita: "SERVICO_ANEXO_IV", escopo: "GLOBAL", userId: "u1",
  });

  it("a regra nasce SEM portalClientId — é isso que a faz valer para cliente que ainda não existe", async () => {
    await resolverGlobal();
    expect(db.regras[0]).toMatchObject({ escopo: "GLOBAL", portalClientId: null });
  });

  it("⚠ com prioridade ACIMA do seed (10) e ABAIXO de EMPRESA (100)", async () => {
    // Acima do seed porque a decisão do contador corrige o de-para embarcado; abaixo de EMPRESA
    // porque quem já tinha exceção própria não pode perdê-la quando alguém resolve globalmente.
    await resolverGlobal();
    expect(db.regras[0].prioridade).toBe(PRIORIDADE_GLOBAL_APRENDIZADO);
    expect(PRIORIDADE_GLOBAL_APRENDIZADO).toBeGreaterThan(10);
    expect(PRIORIDADE_GLOBAL_APRENDIZADO).toBeLessThan(100);
  });

  it("⚠⚠ as pendências IRMÃS são fechadas — é aqui que a hora humana é economizada", async () => {
    const r = await resolverGlobal();
    expect(r.irmas.fechadas).toBe(2);
    expect(r.irmas.empresas.sort()).toEqual(["emp-B", "emp-C"]);
    expect(db.pendencias.every((p) => p.resolvida)).toBe(true);
  });

  it("⚠⚠ e elas levam MARCA PRÓPRIA — ninguém as revisou uma a uma", async () => {
    // Colapsá-las em CRIOU_REGRA faria pendência fechada por tabela parecer conferida por uma
    // pessoa, e é essa diferença que alguém vai querer auditar quando a classificação for
    // contestada.
    await resolverGlobal();
    const irma = db.pendencias.find((p) => p.id === "pend-B");
    expect(irma.acaoResolucao).toBe(ACAO_RESOLVIDA_POR_REGRA_GLOBAL);
    expect(irma.acaoResolucao).not.toBe("CRIOU_REGRA");
    // A que foi de fato decidida guarda a ação normal.
    expect(db.pendencias.find((p) => p.id === "pend-A").acaoResolucao).toBe("CRIOU_REGRA");
  });

  it("⚠ só as empresas AFETADAS são reclassificadas, nunca a carteira toda", async () => {
    await resolverGlobal();
    const alvos = classificarItensV2.mock.calls.map((c) => c[0].portalClientId).sort();
    expect(alvos).toEqual(["emp-A", "emp-B", "emp-C"]);
  });

  it("pendência de OUTRO código não é tocada", async () => {
    db.pendencias.push(pendencia("pend-D", "emp-D", "042301"));
    const r = await resolverGlobal();
    expect(r.irmas.fechadas).toBe(2);
    expect(db.pendencias.find((p) => p.id === "pend-D").resolvida).toBe(false);
  });
});

describe("⚠⚠ SOBRESCREVER O SEED É LEGÍTIMO — MAS NUNCA SILENCIOSO", () => {
  it("a descrição registra o valor anterior e a fonte de onde ele veio", async () => {
    // Sem isso, quem depois vir o banco discordar do `RegraClassificacaoSeeds.js` não tem como
    // saber se foi decisão do contador ou defeito.
    db.regras.push(regraSeed("SERVICO_FATOR_R"));
    await resolverPendenciaItemSemRegra({
      pendenciaId: "pend-A", tipoReceita: "SERVICO_ANEXO_IV", escopo: "GLOBAL", userId: "u1",
    });
    const r = db.regras.find((x) => x.id === "seed1");
    expect(r.tipoReceita).toBe("SERVICO_ANEXO_IV");
    expect(r.descricao).toMatch(/SERVICO_FATOR_R/);
    expect(r.descricao).toMatch(/SEED_APP/);
    expect(r.fonte).toBe("APRENDIZADO");
  });

  it("⚠ e a PRIORIDADE sobe — valor certo com peso errado perderia para outra regra de 50", async () => {
    db.regras.push(regraSeed("SERVICO_FATOR_R"));
    await resolverPendenciaItemSemRegra({
      pendenciaId: "pend-A", tipoReceita: "SERVICO_ANEXO_IV", escopo: "GLOBAL", userId: "u1",
    });
    expect(db.regras.find((x) => x.id === "seed1").prioridade).toBe(PRIORIDADE_GLOBAL_APRENDIZADO);
  });

  it("reconfirmar o MESMO tipo não finge que houve mudança", async () => {
    db.regras.push(regraSeed("SERVICO_ANEXO_IV"));
    await resolverPendenciaItemSemRegra({
      pendenciaId: "pend-A", tipoReceita: "SERVICO_ANEXO_IV", escopo: "GLOBAL", userId: "u1",
    });
    expect(db.regras.find((x) => x.id === "seed1").descricao).toMatch(/Reconfirmado/);
  });

  it("⚠⚠ a regra de EMPRESA de outra empresa NÃO é tocada pelo GLOBAL", async () => {
    // A precedência (100 > 50) já garante que ela vença; o que este teste prende é que o GLOBAL
    // não a REESCREVE — perder a exceção de um cliente ao resolver um código é o estrago que o
    // alcance maior poderia causar.
    db.regras.push({
      id: "emp1",
      escopo: "EMPRESA",
      portalClientId: "emp-B",
      tipoCodigo: "LC116",
      codigo: "171201",
      tipoReceita: "SERVICO_FATOR_R",
      fonte: "APRENDIZADO",
      prioridade: 100,
      vigenciaFim: null,
    });
    await resolverPendenciaItemSemRegra({
      pendenciaId: "pend-A", tipoReceita: "SERVICO_ANEXO_IV", escopo: "GLOBAL", userId: "u1",
    });
    expect(db.regras.find((x) => x.id === "emp1")).toMatchObject({
      tipoReceita: "SERVICO_FATOR_R", prioridade: 100, portalClientId: "emp-B",
    });
  });
});
