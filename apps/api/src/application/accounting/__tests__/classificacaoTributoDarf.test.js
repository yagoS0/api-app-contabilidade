// CADA TRIBUTO NA SUA LINHA — e o IRRF não é "outros".
//
// O que o dono viu na tela, em MAIO/2026, e o que o relatório oficial da DCTFWeb dizia:
//
//   na tela                                   |  no relatório oficial
//   OUTROS_TRIBUTOS (cód 3208) → 240 INSS     |  3208-06 IRRF - ALUG E ROYALTIES PAGOS A PF
//   PIS_COFINS (cód 2172)                     |  2172-01 COFINS - FATURAMENTO/PJ EM GERAL
//   PIS_COFINS (cód 8109)                     |  8109-02 PIS - FATURAMENTO - PJ EM GERAL
//
// Três defeitos encadeados: o 3208 não existia no mapa (virou "outros"), o histórico usava o
// SUBTIPO (que agrupa PIS com COFINS de propósito) em vez do tributo, e — o pior — a conta contábil
// é memorizada POR eventType, então o IRRF mal classificado herdou a conta de outro tributo que já
// tinha passado por `DARF_OUTROS`: saiu debitando INSS A PAGAR.

import {
  CODIGO_RECEITA_TO_EVENT, EVENT_TO_SUBTIPO, EVENT_TO_TRIBUTO,
} from "../GuideToProvisionService.js";
import { tributoDaDescricao } from "../../fiscal/serpro/parseDctfwebDeclaracao.js";

describe("código de receita → tributo", () => {
  it("3208 é IRRF, não 'outros' — e vai para a linha IRRF da Circular", () => {
    const evento = CODIGO_RECEITA_TO_EVENT["3208"];
    expect(evento).toBe("DARF_IRRF");
    expect(EVENT_TO_SUBTIPO[evento]).toBe("IRRF");
  });

  it("2172 é COFINS e 8109 é PIS — cada um com o SEU nome", () => {
    expect(EVENT_TO_TRIBUTO[CODIGO_RECEITA_TO_EVENT["2172"]]).toBe("COFINS");
    expect(EVENT_TO_TRIBUTO[CODIGO_RECEITA_TO_EVENT["8109"]]).toBe("PIS");
  });

  it("PIS e COFINS continuam compartilhando a LINHA da Circular", () => {
    // O agrupamento é certo na matriz e errado na descrição: são perguntas diferentes.
    expect(EVENT_TO_SUBTIPO.DARF_PIS).toBe("PIS_COFINS");
    expect(EVENT_TO_SUBTIPO.DARF_COFINS).toBe("PIS_COFINS");
  });

  it("código desconhecido continua em OUTROS_TRIBUTOS — não vira IRRF chutado", () => {
    // Existem outros códigos de IRRF por natureza do rendimento, nenhum confirmado por fonte
    // oficial aqui. O que não está provado fica visível e conferível em vez de inventado.
    expect(CODIGO_RECEITA_TO_EVENT["9999"]).toBeUndefined();
  });
});

describe("tributoDaDescricao — o específico antes do genérico", () => {
  it("IRRF por extenso NÃO é classificado como IRPJ", () => {
    // `IMPOSTO.*RENDA` da linha do IRPJ capturaria esta descrição se viesse primeiro. O valor
    // entraria na linha de um tributo que a empresa pode nem dever, com aparência de certo.
    expect(tributoDaDescricao("IMPOSTO DE RENDA RETIDO NA FONTE")).toBe("IRRF");
    expect(tributoDaDescricao("IRRF - ALUG E ROYALTIES PAGOS A PF")).toBe("IRRF");
  });

  it("IRPJ de verdade continua sendo IRPJ", () => {
    expect(tributoDaDescricao("IRPJ - LUCRO PRESUMIDO")).toBe("IRPJ");
    expect(tributoDaDescricao("IMPOSTO DE RENDA PESSOA JURIDICA")).toBe("IRPJ");
  });

  it("os demais não foram afetados", () => {
    expect(tributoDaDescricao("COFINS - FATURAMENTO/PJ EM GERAL")).toBe("COFINS");
    expect(tributoDaDescricao("PIS - FATURAMENTO - PJ EM GERAL")).toBe("PIS");
    expect(tributoDaDescricao("CSLL - SOBRE O LUCRO LIQUIDO")).toBe("CSLL");
    expect(tributoDaDescricao("QUALQUER OUTRA COISA")).toBeNull();
  });
});
