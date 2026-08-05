// O PARSER DA DECLARAÇÃO COMPLETA — é ele que decide em que linha cada imposto cai.
//
// A CONSDECCOMPLETA33 só devolve PDF: os débitos saem de regex sobre o texto extraído. Não há campo
// estruturado para conferir, então um erro aqui é silencioso e vira lançamento contábil errado —
// foi assim que o IRRF do código 3208 acabou dentro de "outros tributos" e debitando INSS.
//
// O texto abaixo reproduz a estrutura confirmada no spike (cada célula numa linha) com os três
// débitos reais que o dono mostrou na tela oficial da DCTFWeb, em MAIO/2026.

import { parseDctfwebDeclaracao } from "../parseDctfwebDeclaracao.js";

const TEXTO = `
Relatório da Declaração Completa - DCTFWeb
CNPJ
55.387.580/0001-03
Período apuração
05/2026
Número do Recibo
1234567890
Forma de tributação
LUCRO PRESUMIDO
Regime PIS/COFINS
CUMULATIVO
Código da Receita
3208-06
Descrição
IRRF - ALUG E ROYALTIES PAGOS A PF
Débito Apurado
526,78
Saldo a Pagar
526,78
Código da Receita
2172-01
Descrição
COFINS - FATURAMENTO/PJ EM GERAL
Débito Apurado
16.759,22
Saldo a Pagar
16.759,22
Código da Receita
8109-02
Descrição
PIS - FATURAMENTO - PJ EM GERAL
Débito Apurado
3.631,16
Saldo a Pagar
3.631,16
`;

describe("parseDctfwebDeclaracao", () => {
  const r = parseDctfwebDeclaracao(TEXTO);

  it("lê o cabeçalho", () => {
    expect(r.cabecalho.cnpj).toBe("55387580000103");
    expect(r.cabecalho.competencia).toBe("05/2026");
    expect(r.cabecalho.formaTributacao).toBe("LUCRO PRESUMIDO");
  });

  it("encontra os três débitos", () => {
    expect(r.debitos).toHaveLength(3);
  });

  it("o 3208 é IRRF — nunca mais 'outros tributos'", () => {
    const irrf = r.debitos.find((d) => d.codigoReceita.startsWith("3208"));
    expect(irrf.tributo).toBe("IRRF");
    expect(irrf.debitoApurado).toBe(526.78);
  });

  it("COFINS e PIS são identificados SEPARADAMENTE", () => {
    expect(r.debitos.find((d) => d.codigoReceita.startsWith("2172")).tributo).toBe("COFINS");
    expect(r.debitos.find((d) => d.codigoReceita.startsWith("8109")).tributo).toBe("PIS");
  });

  it("nenhum débito fica sem tributo identificado", () => {
    // Débito sem tributo cai em OUTROS_TRIBUTOS e herda a conta memorizada daquele balde — que foi
    // exatamente o caminho pelo qual o IRRF saiu debitando INSS A PAGAR.
    expect(r.debitos.filter((d) => !d.tributo)).toHaveLength(0);
  });

  it("os totais batem com o relatório oficial (R$ 20.917,16)", () => {
    expect(r.totais.debitoApurado).toBe(20917.16);
    expect(r.totais.porTributo).toEqual({ IRRF: 526.78, COFINS: 16759.22, PIS: 3631.16 });
  });

  it("texto vazio não quebra — devolve estrutura vazia", () => {
    const vazio = parseDctfwebDeclaracao("");
    expect(vazio.debitos).toEqual([]);
    expect(vazio.totais.debitoApurado).toBe(0);
  });
});
