// CASOS DOURADOS — a composição por código do comprovante de arrecadação.
//
// As fixtures são o texto REAL de 5 comprovantes da RFB, como o `pdf-parse` os entrega. Só o bloco
// de composição foi recortado: CNPJ e razão social ficam no cabeçalho e simplesmente não estão
// aqui — anonimização por ausência do dado, não por substituição.
//
// ⚠ O QUE ESTES TESTES PROTEGEM é a separação entre DÍVIDA CONSOLIDADA sendo amortizada (códigos
// de tributo) e ENCARGO CORRENTE do mês (códigos TJLP). Ela sai do CÓDIGO, e um item deslocado
// não parece errado — parece um tributo com valor diferente, e vira lançamento em conta errada.

import { parseComposicaoComprovante } from "../parseComposicaoComprovante";
import { parseArrecadacaoComposicao } from "../parseArrecadacao";

const COMPROVANTES = {
  R1: "Composição do Documento de Arrecadação\n2089IRPJ - Lucro presumido163,4032,6614,52210,58\n0380TJLP - IRPJ - Parcelamentos--11,7811,78\n01 - TJLP IRPJ - PARCELAMENTO\n8109PIS - Faturamento23,024,601,4629,08\n0389TJLP - PIS - Parcelamentos--1,621,62\n01 - TJLP PIS - PARCELAMENTO\n2372CSLL - PJ que apuram IRPJ base lucro presumido ou98,0119,608,71126,32\n0391TJLP - CSLL - Parcelamentos--7,067,06\n01 - TJLP CSLL - PARCELAMENTO\n2172COFINS - Contribuição para financiamento da segurid. social108,1521,624,85134,62\n0387TJLP - COFINS - Parcelamentos--7,527,52\n01 - TJLP COFINS - PARCELAMENTO\nTotais\n392,5878,4857,52528,58",
  R2: "Composição do Documento de Arrecadação\n2089IRPJ - Lucro presumido687,21137,4315,95840,59\n0380TJLP - IRPJ - Parcelamentos--36,7536,75\n01 - TJLP IRPJ - PARCELAMENTO\n8109PIS - Faturamento22,974,590,2527,81\n0389TJLP - PIS - Parcelamentos--1,211,21\n01 - TJLP PIS - PARCELAMENTO\n2372CSLL - PJ que apuram IRPJ base lucro presumido ou287,9757,596,80352,36\n0391TJLP - CSLL - Parcelamentos--15,3915,39\n01 - TJLP CSLL - PARCELAMENTO\n2172COFINS - Contribuição para financiamento da segurid. social106,0221,201,16128,38\n0387TJLP - COFINS - Parcelamentos--5,605,60\n01 - TJLP COFINS - PARCELAMENTO\nTotais\n1.104,17220,8183,111.408,09",
  R3: "Composição do Documento de Arrecadação\n2089IRPJ - Lucro presumido27.874,56--27.874,56\n01 - IRPJ - LUCRO PRESUMIDO\n2372CSLL - PJ que apuram IRPJ base lucro presumido ou10.754,85--10.754,85\n01 - CSLL - LUCRO PRESUMIDO OU ARBITRADO - ENTIDADE NÃO\nTotais\n38.629,410,000,0038.629,41",
  R4: "Composição do Documento de Arrecadação\n2172COFINS - Contribuição para financiamento da segurid. social11.597,36--11.597,36\n01 - COFINS - FATURAMENTO/PJ EM GERAL\n8109PIS - Faturamento2.512,76--2.512,76\n02 - PIS - FATURAMENTO - PJ EM GERAL\nTotais\n14.110,120,000,0014.110,12",
  R5: "Composição do Documento de Arrecadação\n8109PIS - Faturamento90,8718,172,42111,46\n3208IRRF - Aluguéis e royalties pagos a PF6,411,280,287,97\n2172COFINS - Contribuição para financiamento da segurid. social419,4783,8811,18514,53\nTotais\n516,75103,3313,88633,96",
};

const porCodigo = (r) => Object.fromEntries(r.itens.map((i) => [i.codigo, i]));

describe("R1 — parcela de parcelamento: 4 tributos + 4 TJLP", () => {
  const r = parseComposicaoComprovante(COMPROVANTES.R1);

  it("lê os 8 itens e fecha com o Totais impresso", () => {
    expect(r.confiavel).toBe(true);
    expect(r.itens).toHaveLength(8);
    expect(r.totais).toEqual({ principal: 392.58, multa: 78.48, juros: 57.52, total: 528.58 });
  });

  it("o código de tributo traz principal, multa e juros da dívida consolidada", () => {
    expect(porCodigo(r)["2089"]).toMatchObject({ principal: 163.4, multa: 32.66, juros: 14.52, total: 210.58 });
  });

  it("⚠ o TJLP traz SÓ juros — é o traço que põe o valor na coluna certa", () => {
    // "0380TJLP - IRPJ - Parcelamentos--11,7811,78": os dois "-" são os tokens de principal e
    // multa. Ignorá-los deslocaria 11,78 para principal — e a linha continuaria somando certo.
    expect(porCodigo(r)["0380"]).toMatchObject({ principal: 0, multa: 0, juros: 11.78, total: 11.78 });
    expect(porCodigo(r)["0387"]).toMatchObject({ principal: 0, multa: 0, juros: 7.52, total: 7.52 });
  });

  it("⚠ O SPLIT QUE DÁ NOME AO TRABALHO: 57,52 = 29,54 amortização + 27,98 encargo do mês", () => {
    // Conferido no comprovante real. Somar os dois como "juros do mês" superestima a despesa e
    // deixa o passivo do parcelamento errado.
    const TJLP = new Set(["0380", "0389", "0391", "0387"]);
    const soma = (f) => Math.round(r.itens.filter(f).reduce((a, i) => a + i.juros, 0) * 100) / 100;
    expect(soma((i) => !TJLP.has(i.codigo))).toBe(29.54);
    expect(soma((i) => TJLP.has(i.codigo))).toBe(27.98);
    expect(r.totais.juros).toBe(57.52);
  });

  it("a denominação sai limpa, sem os valores colados", () => {
    expect(porCodigo(r)["2089"].denominacao).toBe("IRPJ - Lucro presumido");
    expect(porCodigo(r)["0380"].denominacao).toBe("TJLP - IRPJ - Parcelamentos");
  });

  it("a linha de extensão ('01 - TJLP IRPJ - PARCELAMENTO') não vira item", () => {
    // Ela tem 2 dígitos, não 4 — e é só isso que a mantém fora da composição.
    expect(r.itens.map((i) => i.codigo)).toEqual(["2089", "0380", "8109", "0389", "2372", "0391", "2172", "0387"]);
  });
});

describe("R2 — mesmo CNPJ, mesmo PA, mesmo dia, conjunto de códigos IDÊNTICO ao R1", () => {
  const r1 = parseComposicaoComprovante(COMPROVANTES.R1);
  const r2 = parseComposicaoComprovante(COMPROVANTES.R2);

  it("também fecha, com o mesmo split por natureza", () => {
    expect(r2.confiavel).toBe(true);
    expect(r2.totais.juros).toBe(83.11);
    const TJLP = new Set(["0380", "0389", "0391", "0387"]);
    const soma = (f) => Math.round(r2.itens.filter(f).reduce((a, i) => a + i.juros, 0) * 100) / 100;
    expect(soma((i) => !TJLP.has(i.codigo))).toBe(24.16);
    expect(soma((i) => TJLP.has(i.codigo))).toBe(58.95);
  });

  it("⚠ o CONJUNTO DE CÓDIGOS não distingue os dois documentos", () => {
    // É o que obriga a conciliação a usar o número do documento. Aqui os valores diferem e o
    // fallback por soma ainda separaria — mas parcelas repetem valor mês a mês, e no empate o
    // conjunto de códigos não ajuda em nada.
    expect(r2.itens.map((i) => i.codigo)).toEqual(r1.itens.map((i) => i.codigo));
    expect(r2.totais.total).not.toBe(r1.totais.total);
  });
});

describe("R3 e R4 — recolhimento normal do Presumido, sem acréscimo", () => {
  it("R3: IRPJ/CSLL trimestral, multa e juros zerados", () => {
    const r = parseComposicaoComprovante(COMPROVANTES.R3);
    expect(r.confiavel).toBe(true);
    expect(r.itens).toHaveLength(2);
    expect(porCodigo(r)["2089"]).toMatchObject({ principal: 27874.56, multa: 0, juros: 0, total: 27874.56 });
    expect(r.totais).toEqual({ principal: 38629.41, multa: 0, juros: 0, total: 38629.41 });
  });

  it("R4: PIS/COFINS mensal — e a denominação com barra não atrapalha", () => {
    const r = parseComposicaoComprovante(COMPROVANTES.R4);
    expect(r.confiavel).toBe(true);
    expect(porCodigo(r)["2172"].principal).toBe(11597.36);
    expect(porCodigo(r)["8109"].principal).toBe(2512.76);
    expect(r.totais.total).toBe(14110.12);
  });

  it("⚠ no item o vazio vem como '-' e no Totais como '0,00' — mesmo significado", () => {
    const r = parseComposicaoComprovante(COMPROVANTES.R3);
    expect(porCodigo(r)["2089"].multa).toBe(0);
    expect(r.totais.multa).toBe(0);
  });
});

describe("R5 — multa e juros SEM parcelamento", () => {
  const r = parseComposicaoComprovante(COMPROVANTES.R5);

  it("⚠ acréscimo NÃO implica parcelamento: nenhum código TJLP aqui", () => {
    // A prova de que a classificação tem de sair do CÓDIGO, nunca da presença de multa/juros.
    expect(r.confiavel).toBe(true);
    expect(r.totais).toEqual({ principal: 516.75, multa: 103.33, juros: 13.88, total: 633.96 });
    expect(r.itens.every((i) => !/^03(80|87|89|91)$/.test(i.codigo))).toBe(true);
  });

  it("itemiza códigos sem relação entre si no mesmo documento (IRRF junto de PIS/COFINS)", () => {
    // Tratar o documento como bloco único jogaria o IRRF na conta do PIS.
    expect(r.itens.map((i) => i.codigo)).toEqual(["8109", "3208", "2172"]);
    expect(porCodigo(r)["3208"]).toMatchObject({ principal: 6.41, multa: 1.28, juros: 0.28, total: 7.97 });
  });

  it("sem linha de extensão nenhuma, os itens seguem sendo lidos", () => {
    expect(r.itens).toHaveLength(3);
  });
});

describe("recusa — composição meio lida é pior que composição nenhuma", () => {
  it("item que não fecha derruba o documento inteiro", () => {
    // Cada item vira lançamento em conta própria; um item errado não parece errado, parece um
    // tributo com valor diferente.
    const ruim = COMPROVANTES.R5.replace("90,8718,172,42111,46", "90,8718,172,42999,99");
    const r = parseComposicaoComprovante(ruim);
    expect(r.confiavel).toBe(false);
    expect(r.motivo).toBe("item_nao_fecha:8109");
    expect(r.itens).toEqual([]);
  });

  it("⚠ item PERDIDO só é pego pelo confronto com o Totais", () => {
    // O item some, os demais continuam fechando sozinhos — nada denunciaria a falta sem o total.
    const ruim = COMPROVANTES.R5.replace("3208IRRF - Aluguéis e royalties pagos a PF6,411,280,287,97\n", "");
    const r = parseComposicaoComprovante(ruim);
    expect(r.confiavel).toBe(false);
    expect(r.motivo).toBe("soma_nao_confere:principal");
    expect(r.itens).toEqual([]);
  });

  it("texto sem seção de composição não inventa itens", () => {
    expect(parseComposicaoComprovante("Comprovante de Arrecadação\nnada aqui").motivo).toBe("sem_secao_de_composicao");
    expect(parseComposicaoComprovante("").confiavel).toBe(false);
    expect(parseComposicaoComprovante(null).itens).toEqual([]);
  });

  it("composição sem Totais não é lida pela metade", () => {
    const semTotais = COMPROVANTES.R4.replace(/\nTotais\n.*$/, "");
    expect(parseComposicaoComprovante(semTotais).motivo).toBe("sem_linha_de_totais");
  });
});

describe("⚠ REGRESSÃO: por que o parser da GUIA não serve para o COMPROVANTE", () => {
  it("parseArrecadacaoComposicao DESLOCA todos os itens neste layout", () => {
    // Medido contra os 5 comprovantes reais. Ele procura os valores na linha SEGUINTE (layout da
    // guia DCTFWeb); no comprovante vem tudo na mesma linha, e cada item acaba com os valores do
    // item de baixo. O último fica com a linha de Totais. Nada disso levanta suspeita sozinho.
    const antigo = parseArrecadacaoComposicao(COMPROVANTES.R1);
    const item2089 = antigo.itens.find((i) => i.codigo === "2089");
    expect(item2089.principal).toBe(11.78);   // é o TOTAL do 0380, não o principal do IRPJ
    expect(item2089.principal).not.toBe(163.4);

    // E o parser novo acerta o mesmo item.
    expect(porCodigo(parseComposicaoComprovante(COMPROVANTES.R1))["2089"].principal).toBe(163.4);
  });
});
