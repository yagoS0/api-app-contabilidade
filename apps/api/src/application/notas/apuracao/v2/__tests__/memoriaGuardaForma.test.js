// A MEMÓRIA GUARDA A **FORMA**, NUNCA O VALOR — e o MERCADO tem de sobreviver.
//
// `ApuracaoConfigMemory` tem chave `portalClientId` e NENHUMA competência: um registro por empresa,
// reaberto em todo mês seguinte. Enquanto ela guardava `valorInterno`/`valorExterno`, o valor de um
// mês era carregado para dentro de outro. Medido em produção (12 memórias, 95 pares
// empresa×competência de 02/2026 a 07/2026): 72 pré-preenchimentos vieram da memória, 48 dos 85 com
// faturamento real DIVERGIAM da própria competência, e 10 de 10 competências SEM faturamento nenhum
// abriram com valor > 0 na tela. O faturamento de 07/2026 da ARAUJO (R$ 20.301,21) aparecia em
// fevereiro, março, abril, maio e junho.
//
// ⚠ E isso derrotava o GATE POR SOMA em produção: com `somaAtividades > 0` a declaração não é lida
// como zerada, a caixa "Declarar SEM MOVIMENTO" não renderiza e o Calcular fica habilitado —
// chamada PAGA ao SERPRO declarando receita que não existe naquele mês.
//
// ⚠ O PORTÃO DESTA MUDANÇA É O MERCADO. `NotaItem.flagExportacao` é `false` em 16.153/16.153 itens
// (o único escritor é o parser de NF-e, CFOP 7xxx; a criação do item da NFS-e nunca o toca), então o
// faturamento chega ao fechamento SEMPRE como "interno" — inclusive o da CDA MARKETING, que presta
// serviço ao exterior e cujas duas declarações (65227792202606001, 65227792202607001) saíram com
// receita EXTERNA por causa do `mercado` gravado nesta memória. Perder o mercado na limpeza faria a
// empresa nascer interna na competência seguinte, e o erro chegaria à declaração.

jest.mock("../../../../../infrastructure/db/prisma.js", () => ({
  prisma: {
    apuracaoConfigMemory: {
      findUnique: jest.fn(async () => null),
      update: jest.fn(async (args) => args),
      create: jest.fn(async (args) => args),
    },
    atividadePgdasd: { findMany: jest.fn(async () => []) },
  },
}));

import { prisma } from "../../../../../infrastructure/db/prisma.js";
import {
  normalizarFormaAtividades, salvarConfigMemory, lerConfigMemory, somaDaLista, CAMPOS_DA_FORMA,
} from "../ApuracaoConfigMemoryService.js";
import { aplicarFaturamentoNaForma } from "../FechamentoService.js";
import { buildDeclaracaoPayload } from "../../../../fiscal/serpro/PgdasSimulacaoService.js";

// A memória REAL da CDA MARKETING, na forma medida em produção: atividade 30, mercado EXTERNO — com
// o valor que não deveria estar ali.
const MEMORIA_CDA = [{
  idAtividade: 30, descricao: "Prestação de serviços ao exterior", anexoImplicito: "III",
  mercado: "EXTERNO", sujeitoFatorR: true, tipoReceita: "SERVICO_FATOR_R",
  valorInterno: 0, valorExterno: 8400,
}];

beforeEach(() => { jest.clearAllMocks(); });

describe("normalizarFormaAtividades — o valor sai, a forma fica", () => {
  it("⚠ O MERCADO SOBREVIVE — é o campo que só existe aqui", () => {
    const [forma] = normalizarFormaAtividades(MEMORIA_CDA);
    expect(forma.mercado).toBe("EXTERNO");
    expect(forma.idAtividade).toBe(30);
    expect(forma.anexoImplicito).toBe("III");
    expect(forma.sujeitoFatorR).toBe(true);
    expect(forma.tipoReceita).toBe("SERVICO_FATOR_R");
  });

  it("os campos de VALOR somem — inclusive como chave, não só como zero", () => {
    const [forma] = normalizarFormaAtividades(MEMORIA_CDA);
    expect("valorInterno" in forma).toBe(false);
    expect("valorExterno" in forma).toBe(false);
    expect(somaDaLista([forma])).toBe(0);
  });

  it("⚠ campo ausente continua ausente — mercado NÃO ganha um 'INTERNO' de brinde", () => {
    // Supor o mercado é exatamente o erro que a declaração da CDA revelaria. Sem dado, sem campo.
    const [forma] = normalizarFormaAtividades([{ idAtividade: 30, valorInterno: 100 }]);
    expect("mercado" in forma).toBe(false);
  });

  it("linha sem idAtividade é descartada (é o mesmo filtro que o modal aplica ao carregar)", () => {
    expect(normalizarFormaAtividades([{ valorInterno: 500 }, null, undefined])).toEqual([]);
    expect(normalizarFormaAtividades("nada")).toEqual([]);
  });

  it("nenhum campo fora de CAMPOS_DA_FORMA passa", () => {
    const [forma] = normalizarFormaAtividades([{ ...MEMORIA_CDA[0], qualquerCoisa: 1, valorTotal: 9 }]);
    expect(Object.keys(forma).every((k) => CAMPOS_DA_FORMA.includes(k))).toBe(true);
  });
});

describe("salvarConfigMemory / lerConfigMemory", () => {
  it("⚠ a ESCRITA nunca leva valor — mesmo recebendo a lista do modal, com valores", async () => {
    await salvarConfigMemory({ portalClientId: "p1", atividadesEscolhidas: MEMORIA_CDA });
    const gravado = prisma.apuracaoConfigMemory.create.mock.calls[0][0].data.atividadesEscolhidas;
    expect(somaDaLista(gravado)).toBe(0);
    expect(gravado[0].mercado).toBe("EXTERNO");
  });

  it("a FOLHA continua com valor — ela é carimbada por `pa`, a atividade não", async () => {
    // A série de folha é `[{ pa, valor }]` de 12 meses ANTERIORES e o modal só reusa a célula do
    // `pa` que bate: não há como um valor de julho aparecer como sendo de março. A atividade, que
    // não tem competência nenhuma, tem.
    const folha = [{ pa: "2026-06", valor: 5000 }];
    await salvarConfigMemory({ portalClientId: "p1", atividadesEscolhidas: [], folhaMensal12: folha });
    expect(prisma.apuracaoConfigMemory.create.mock.calls[0][0].data.folhaMensal12).toEqual(folha);
  });

  it("⚠ a LEITURA também normaliza — as 12 memórias de produção ainda têm valor gravado", async () => {
    // O script de limpeza é rodado pelo dono; quem lê não pode depender disso ter acontecido.
    prisma.apuracaoConfigMemory.findUnique.mockResolvedValueOnce({
      portalClientId: "p1", atividadesEscolhidas: MEMORIA_CDA, folhaMensal12: null,
    });
    const mem = await lerConfigMemory({ portalClientId: "p1" });
    expect(somaDaLista(mem.atividadesEscolhidas)).toBe(0);
    expect(mem.atividadesEscolhidas[0].mercado).toBe("EXTERNO");
  });
});

describe("aplicarFaturamentoNaForma — o valor vem da PRÓPRIA competência", () => {
  const forma = normalizarFormaAtividades(MEMORIA_CDA);

  it("⚠ O MERCADO LEMBRADO MANDA NO DESTINO DO VALOR — o total vai para EXTERNO", () => {
    // A NFS-e da CDA chega como "interna" (`flagExportacao` nunca é escrita para NFS-e). Jogar o
    // total em `valorInterno` faria a declaração dela nascer interna, contrariando as duas que já
    // saíram corretas.
    const { atividades, prefill } = aplicarFaturamentoNaForma({
      forma, faturamentoInterno: 12000, faturamentoExterno: 0,
    });
    expect(atividades[0].valorExterno).toBe(12000);
    expect(atividades[0].valorInterno).toBe(0);
    expect(prefill.mercadoAplicado).toBe("EXTERNO");
    expect(prefill.indefinido).toBe(false);
  });

  it("atividade de mercado interno recebe o total em `valorInterno`", () => {
    const interna = [{ idAtividade: 1, mercado: "INTERNO" }];
    const { atividades } = aplicarFaturamentoNaForma({ forma: interna, faturamentoInterno: 3200.55 });
    expect(atividades[0]).toMatchObject({ valorInterno: 3200.55, valorExterno: 0 });
  });

  it("⚠ SEM FATURAMENTO NA COMPETÊNCIA, O VALOR É ZERO — nada do mês anterior atravessa", () => {
    // Era este o caso das 10 de 10 competências zeradas que abriam com valor > 0.
    const { atividades } = aplicarFaturamentoNaForma({ forma, faturamentoInterno: 0, faturamentoExterno: 0 });
    expect(somaDaLista(atividades)).toBe(0);
  });

  it("⚠ 2+ ATIVIDADES → VALOR VAZIO (null), com o motivo — não se inventa rateio", () => {
    const duas = [{ idAtividade: 1, mercado: "INTERNO" }, { idAtividade: 11, mercado: "INTERNO" }];
    const { atividades, prefill } = aplicarFaturamentoNaForma({ forma: duas, faturamentoInterno: 9000 });
    expect(atividades.map((a) => a.valorInterno)).toEqual([null, null]);
    expect(atividades.map((a) => a.valorExterno)).toEqual([null, null]);
    expect(prefill.indefinido).toBe(true);
    expect(prefill.motivo).toMatch(/rateio/i);
    expect(prefill.total).toBe(9000);
  });

  it("⚠ vazio é `null`, NUNCA 0 — 0 é uma afirmação, ausência não é", () => {
    // Com 0 no lugar de null, "não sei quanto" fica indistinguível de "conferi e é zero mesmo".
    const duas = [{ idAtividade: 1, mercado: "INTERNO" }, { idAtividade: 11, mercado: "INTERNO" }];
    const { atividades } = aplicarFaturamentoNaForma({ forma: duas, faturamentoInterno: 9000 });
    expect(atividades[0].valorInterno).toBeNull();
    expect(atividades[0].valorInterno).not.toBe(0);
  });

  it("receita interna E externa com uma atividade só também fica vazia", () => {
    // A atividade do PGDAS-D é mercado-específica (o mercado está no `idAtividade`): não há linha
    // onde pôr a outra metade. Escolher uma e esconder a outra seria decidir a declaração.
    const { atividades, prefill } = aplicarFaturamentoNaForma({
      forma, faturamentoInterno: 1000, faturamentoExterno: 500,
    });
    expect(atividades[0].valorInterno).toBeNull();
    expect(prefill.indefinido).toBe(true);
    expect(prefill.motivo).toMatch(/interna|externa/i);
  });

  it("forma vazia devolve lista vazia, sem inventar linha", () => {
    expect(aplicarFaturamentoNaForma({ forma: [], faturamentoInterno: 100 }).atividades).toEqual([]);
  });
});

// ─── O QUE NÃO PODE TER QUEBRADO ──────────────────────────────────────────────────────────────
describe("⚠ o valor vazio não desarma o que subiu junto", () => {
  it("7b341aad — o GATE POR SOMA continua lendo zero com valor `null`", () => {
    // `Number(null || 0)` é 0, então a soma segue 0 e a caixa "Declarar SEM MOVIMENTO" renderiza.
    // Esta é a mesma expressão do backend (`somaAtividades`) e do front (`FechamentoModal`).
    const atividades = [{ idAtividade: 1, valorInterno: null, valorExterno: null }];
    const soma = atividades.reduce((s, a) => s + Number(a?.valorInterno || 0) + Number(a?.valorExterno || 0), 0);
    expect(soma).toBe(0);
  });

  it("e0d13e3b — atividade COM valor NÃO vira 'sem valor': a chave `atividades` continua no payload", () => {
    const payload = buildDeclaracaoPayload({
      contribuinteCnpj: "10.111.222/0001-58", competencia: "2026-07", indicadorTransmissao: false,
      atividades: [{ idAtividade: 30, valorInterno: null, valorExterno: 12000 }],
    });
    const est = payload.declaracao.estabelecimentos[0];
    expect(est.atividades).toEqual([expect.objectContaining({ idAtividade: 30, valorAtividade: 12000 })]);
    expect(payload.declaracao.receitaPaCompetenciaExterno).toBe(12000);
  });

  it("e0d13e3b — com TODOS os valores `null` a chave some, como na declaração zerada", () => {
    const payload = buildDeclaracaoPayload({
      contribuinteCnpj: "10.111.222/0001-58", competencia: "2026-07", indicadorTransmissao: false,
      atividades: [{ idAtividade: 1, valorInterno: null, valorExterno: null }],
    });
    expect("atividades" in payload.declaracao.estabelecimentos[0]).toBe(false);
  });
});
