// GERARGUIA31 NÃO DEVOLVE SEMPRE UM DARF DE INSS — e o sistema afirmava que sim.
//
// `syncSerproInssForCompany` chama "DCTFWeb / GERAL_MENSAL", o MESMO serviço que
// `emitirDarfDctfweb` usa na captura do Lucro Presumido. Na empresa com folha vem o DARF
// previdenciário; na empresa de Lucro Presumido vem o DARF de PIS/COFINS/IRPJ/CSLL. A função
// gravava `tipo:"INSS"` nos dois casos — sem olhar a composição que ela mesma já tinha parseado.
//
// O que o dono viu: SINCROSAT TELEMETRIA, 2026-07, R$ 1.435,49 rotulado INSS, ao lado de uma guia
// `tipo:"OUTRA"` de MESMO valor e MESMO vencimento — a MESMA dívida, gravada duas vezes.
//
// ⚠ A REGRA É SOBRE O DOCUMENTO, NUNCA SOBRE O CADASTRO. Os casos ALBATROZ e ELITES abaixo são
// reais e existem neste arquivo de propósito: quem "simplificar" isto para um teste de
// `regimeTributario`/`hasProlabore` apaga guia previdenciária legítima, e estes dois quebram.
//
// Todos os textos abaixo reproduzem o layout medido nos PDFs guardados em produção (21/08/2026,
// 70 guias `tipo:"INSS"` reparseadas com `scripts/diag-inss-composicao-pdf.mjs`).

import { parseArrecadacaoComposicao, tributosSeNaoForPrevidenciario } from "../parseArrecadacao.js";

const composicaoDe = (texto) => parseArrecadacaoComposicao(texto).itens;

// SINCROSAT TELEMETRIA LTDA — 2026-07 — o documento que virou "guia de INSS" na tela do dono.
const DARF_LP_PIS_COFINS = `
Composição do Documento de Arrecadação
2172COFINS - CONTRIB P/ FIN. SEG. SOCIAL
1.179,850,000,001.179,85
8109PIS - FATURAMENTO
255,640,000,00255,64
Totais
1.435,490,000,001.435,49
`;

// EDUCACAO E DIREITO TREINAMENTO LTDA — 2026-03 — LP com os quatro tributos.
const DARF_LP_QUATRO_TRIBUTOS = `
Composição do Documento de Arrecadação
2172COFINS - CONTRIB P/ FIN. SEG. SOCIAL
148,980,000,00148,98
8109PIS - FATURAMENTO
32,260,000,0032,26
2089IRPJ - LUCRO PRESUMIDO
349,780,000,00349,78
2372CSLL - DEMAIS
209,870,000,00209,87
`;

// O caso comum e legítimo: pró-labore de sócio (59 das 70 guias medidas).
const DARF_PREVIDENCIARIO_CONTRIB_INDIVIDUAL = `
Composição do Documento de Arrecadação
1099CP DESCONTADA SEGURADO - CONTRIB INDIVIDUAL
178,310,000,00178,31
`;

// ALBATROZ TECNOLOGIA S.A. — 2026-07 — LUCRO_PRESUMIDO, hasProlabore=false, e MESMO ASSIM
// previdenciário de verdade. É este caso que proíbe filtrar por regime/cadastro.
const DARF_PREVIDENCIARIO_EM_LUCRO_PRESUMIDO = `
Composição do Documento de Arrecadação
1099CP DESCONTADA SEGURADO - CONTRIB INDIVIDUAL
178,310,000,00178,31
1138CONTRIB PREVIDENCIÁRIA EMPRESA/EMPREGADOR
324,200,000,00324,20
`;

// ELITES CONSTRUCOES E REFORMAS LTDA — 2026-01 — folha completa, hasProlabore=false no cadastro.
const DARF_PREVIDENCIARIO_FOLHA_COMPLETA = `
Composição do Documento de Arrecadação
1082CONTR PREV DESCONTA SEGURADO-EMPREGADO/AVULSO
597,580,000,00597,58
1138CONTRIB PREVIDENCIÁRIA EMPRESA/EMPREGADOR
1.709,290,000,001.709,29
1646CONTRIB PREV RISCO AMBIENTAL/APOSENT ESPECIAL
261,030,000,00261,03
2985CONT PREV SOBRE REC BRUTA-ART 7º L12.546/2011
684,230,000,00684,23
`;

describe("tributosSeNaoForPrevidenciario — o documento diz o que ele é", () => {
  it("RECUSA o DARF de PIS/COFINS que o dono viu rotulado como INSS (SINCROSAT 2026-07)", () => {
    const itens = composicaoDe(DARF_LP_PIS_COFINS);
    // Antes: este documento virava `tipo:"INSS"`, R$ 1.435,49, ao lado da mesma dívida em "OUTRA".
    expect(tributosSeNaoForPrevidenciario(itens)).toEqual(["COFINS", "PIS"]);
    expect(itens.reduce((s, i) => s + i.total, 0)).toBeCloseTo(1435.49, 2);
  });

  it("RECUSA o DARF de Lucro Presumido com os quatro tributos", () => {
    expect(tributosSeNaoForPrevidenciario(composicaoDe(DARF_LP_QUATRO_TRIBUTOS)))
      .toEqual(["COFINS", "PIS", "IRPJ", "CSLL"]);
  });

  it("ACEITA o DARF de contribuição individual — o caso comum do pró-labore", () => {
    expect(tributosSeNaoForPrevidenciario(composicaoDe(DARF_PREVIDENCIARIO_CONTRIB_INDIVIDUAL))).toBeNull();
  });

  it("ACEITA previdenciário em empresa de LUCRO_PRESUMIDO sem pró-labore no cadastro (ALBATROZ)", () => {
    // ⚠ Se a recusa olhasse o CADASTRO em vez do DOCUMENTO, esta guia real sumiria.
    expect(tributosSeNaoForPrevidenciario(composicaoDe(DARF_PREVIDENCIARIO_EM_LUCRO_PRESUMIDO))).toBeNull();
  });

  it("ACEITA a folha completa, inclusive o código 2985 (CPRB)", () => {
    expect(tributosSeNaoForPrevidenciario(composicaoDe(DARF_PREVIDENCIARIO_FOLHA_COMPLETA))).toBeNull();
  });

  it("NÃO afirma nada quando a composição veio vazia — ausência de prova não é prova", () => {
    // PDF que não parseou não pode virar recusa: perderíamos a guia de INSS de quem a tem.
    expect(tributosSeNaoForPrevidenciario([])).toBeNull();
    expect(tributosSeNaoForPrevidenciario(null)).toBeNull();
    expect(tributosSeNaoForPrevidenciario(composicaoDe("PDF sem seção de composição"))).toBeNull();
  });

  it("NÃO afirma nada com código desconhecido — o catálogo da Receita cresce", () => {
    expect(tributosSeNaoForPrevidenciario([{ codigo: "9999" }])).toBeNull();
    // Basta UMA linha previdenciária para o documento deixar de ser recusável.
    expect(tributosSeNaoForPrevidenciario([{ codigo: "2172" }, { codigo: "1099" }])).toBeNull();
  });
});
