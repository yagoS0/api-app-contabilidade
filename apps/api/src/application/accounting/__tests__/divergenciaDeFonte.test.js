// O DETECTOR — `lançamento ≠ circular`.
//
// ⚠ Este teste existe porque o projeto tem histórico de GUARDA QUE NÃO MORDE: a conferência do ADN
// nunca gravou nada, o `alcancouFim` nunca foi consultado, e `hasAccountingDivergence` é escrito em
// toda sincronia e lido por NINGUÉM (varredura de 12/08/2026 nos dois apps). Aqui a metade que
// importa é a que exige que o detector CALE quando não há divergência — um detector que acende
// sempre é tão inútil quanto um que nunca acende, e é o mais fácil de escrever sem perceber.

// O módulo é PURO, mas importa o gerador (de propósito — ver `divergenciaDeFonte.js`), e o gerador
// abre o cliente do Prisma no topo. O mock é só para o import não tocar no banco.
jest.mock("../../../infrastructure/db/prisma.js", () => ({
  prisma: { $transaction: jest.fn() },
}));

import {
  divergenciasDeFonte,
  SELECT_CIRCULAR_PARA_DIVERGENCIA,
  EVENTOS_DERIVADOS_DA_CIRCULAR,
} from "../divergenciaDeFonte.js";

const linhas = (valor) => [
  { tipo: "D", valor },
  { tipo: "C", valor },
];

const lancamentoDas = (valor, extra = {}) => ({
  id: "e-das",
  eventType: "DAS_SIMPLES",
  origem: "SERPRO",
  historico: "VR REF DAS SIMPLES NACIONAL - 07/2026",
  lines: linhas(valor),
  ...extra,
});

describe("divergenciasDeFonte", () => {
  it("acusa o DAS congelado: a circular foi retificada, as linhas ficaram no valor anterior", () => {
    // O caso da LENTE 2026-07, com os números medidos em produção.
    const r = divergenciasDeFonte({ dasTotal: 19539.95 }, [lancamentoDas(18347.28)]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      eventType: "DAS_SIMPLES",
      esperado: 19539.95,
      lancado: 18347.28,
      diferenca: 1192.67,
      entryId: "e-das",
    });
  });

  it("CALA quando o lançamento acompanha a circular", () => {
    expect(divergenciasDeFonte({ dasTotal: 19539.95 }, [lancamentoDas(19539.95)])).toEqual([]);
  });

  it("⚠ o valor do lançamento é a soma dos DÉBITOS, nunca das duas pernas", () => {
    // Se ele somasse D+C, um lançamento balanceado e CORRETO acusaria o dobro — que é exatamente o
    // defeito que produziu `recalculatedFromValor = 2 × ΣD` em 55 de 89 provisões de DAS.
    const r = divergenciasDeFonte({ dasTotal: 1531.93 }, [lancamentoDas(1531.93)]);
    expect(r).toEqual([]);
  });

  it("⚠ guia vencida com juros NÃO é divergência — a provisão vale o PRINCIPAL", () => {
    // `acrescimos.DAS.principal` é a mesma leitura que o gerador faz (`resolveAmount`). Comparar
    // contra o `dasTotal` cru acusaria o caso legítimo do documento recalculado após o vencimento,
    // e um aviso que acende no caso normal é um aviso que ninguém lê.
    const circular = { dasTotal: 1180.5, acrescimos: { DAS: { principal: 1000, juros: 150.5, multa: 30 } } };
    expect(divergenciasDeFonte(circular, [lancamentoDas(1000)])).toEqual([]);
    // E continua acusando quando o principal em si divergiu.
    expect(divergenciasDeFonte(circular, [lancamentoDas(900)])).toHaveLength(1);
  });

  it("⚠ circular SEM o número não acusa nada — ausência não é resposta", () => {
    // Senão "ninguém buscou o extrato" viraria "o razão está errado".
    expect(divergenciasDeFonte({ dasTotal: null }, [lancamentoDas(18347.28)])).toEqual([]);
    expect(divergenciasDeFonte({}, [lancamentoDas(18347.28)])).toEqual([]);
  });

  it("⚠ sem lançamento não acusa — 'falta gerar' é outra pergunta", () => {
    expect(divergenciasDeFonte({ dasTotal: 19539.95 }, [])).toEqual([]);
  });

  it("⚠ lançamento MANUAL do contador não é cobrado — ele não deriva da circular", () => {
    const manual = lancamentoDas(18347.28, { origem: "MANUAL" });
    expect(divergenciasDeFonte({ dasTotal: 19539.95 }, [manual])).toEqual([]);
  });

  it("circular sem nada devolve lista vazia (não explode)", () => {
    expect(divergenciasDeFonte(null, [lancamentoDas(1)])).toEqual([]);
    expect(divergenciasDeFonte({ dasTotal: 10 }, null)).toEqual([]);
  });

  it("mede a RECEITA junto do imposto — o dono disse 'como todos os outros impostos'", () => {
    const circular = { dasTotal: 1000, receitaServicos: 9000, receitaVendasSemST: 500 };
    const r = divergenciasDeFonte(circular, [
      lancamentoDas(1000),
      { id: "e-rec", eventType: "RECEITA_SERVICO", origem: "SERPRO", lines: linhas(7000) },
      { id: "e-vsst", eventType: "RECEITA_VENDA_SEM_ST", origem: "SERPRO", lines: linhas(500) },
    ]);
    expect(r.map((d) => d.eventType)).toEqual(["RECEITA_SERVICO"]);
    expect(r[0]).toMatchObject({ esperado: 9000, lancado: 7000, campo: "receitaServicos" });
  });

  it("tolerância de um centavo — arredondamento não vira alarme", () => {
    expect(divergenciasDeFonte({ dasTotal: 1000.004 }, [lancamentoDas(1000)])).toEqual([]);
    expect(divergenciasDeFonte({ dasTotal: 1000.02 }, [lancamentoDas(1000)])).toHaveLength(1);
  });

  it("⚠ a lista de eventos vem do GERADOR, não de uma cópia", () => {
    // Uma segunda lista divergiria no primeiro tributo novo, e o detector mediria MENOS do que o
    // gerador escreve, em silêncio — a própria classe de defeito que ele existe para pegar.
    expect(EVENTOS_DERIVADOS_DA_CIRCULAR).toEqual(
      expect.arrayContaining(["DAS_SIMPLES", "RECEITA_SERVICO", "RECEITA_VENDA_SEM_ST", "RECEITA_VENDA_COM_ST"]),
    );
    // O `select` da rota tem de trazer TODO campo que `resolveAmount` pode ler — inclusive
    // `acrescimos`, senão o desvio para o principal some e o detector acusa juros como divergência.
    expect(SELECT_CIRCULAR_PARA_DIVERGENCIA).toMatchObject({
      dasTotal: true, receitaServicos: true, receitaVendasSemST: true, receitaVendasComST: true, acrescimos: true,
    });
  });
});
