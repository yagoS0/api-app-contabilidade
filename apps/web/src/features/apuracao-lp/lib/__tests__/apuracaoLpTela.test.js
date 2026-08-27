// A LEITURA DA APURAÇÃO DO LUCRO PRESUMIDO.
//
// A CONTA é do backend e não é remedida aqui. O que este arquivo prende é o que só a leitura pode
// errar: 3,65% se passando pela carga do Presumido, célula vazia, e "sem declaração" com cara de
// "confere".

import {
  PERIODO, AUSENCIA, CONFERENCIA, fraseDaAusencia,
  linhasDaMemoriaDeCalculo, leituraDaCargaEfetiva, linhasDaConferencia, resumoDaConferencia,
  avisoDaQuota, avisoDosServicos16, dinheiro, pct,
} from "../apuracaoLpTela";

/** Um fechamento de trimestre, com os números do caso dourado do backend. */
const FECHA = {
  competencia: "2026-06",
  receita: { servicos: 100_000, mercadorias: 0, total: 100_000 },
  pis: 650,
  cofins: 3_000,
  irpj: { base: 96_000, presuncaoAplicadaServicos: 0.32, normal: 14_400, adicional: 3_600, total: 18_000 },
  csll: { base: 96_000, presuncaoAplicadaServicos: 0.32, total: 8_640 },
  trimestre: { meses: ["2026-04", "2026-05", "2026-06"], receitaServicos: 300_000, receitaMercadorias: 0, receita: 300_000, pis: 1_950, cofins: 9_000, total: 37_590 },
  cargaEfetiva: { valor: 0.1253, total: 37_590, receita: 300_000, base: "TRIMESTRE", completa: true, motivo: null },
};

/** Um mês que não fecha trimestre. */
const NAO_FECHA = {
  competencia: "2026-05",
  receita: { servicos: 100_000, mercadorias: 0, total: 100_000 },
  pis: 650,
  cofins: 3_000,
  irpj: null,
  csll: null,
  trimestre: null,
  cargaEfetiva: {
    valor: 0.0365, total: 3_650, receita: 100_000, base: "MES", completa: false,
    motivo: "Só PIS e COFINS entram: IRPJ e CSLL fecham no último mês do trimestre. A carga completa do Presumido só se lê no fechamento trimestral.",
  },
};

describe("⚠⚠ A MEMÓRIA DE CÁLCULO — cada linha diz DE ONDE saiu a base", () => {
  it("no fechamento, as cinco linhas saem com base, alíquota e valor", () => {
    const l = linhasDaMemoriaDeCalculo(FECHA);
    expect(l.map((x) => x.chave)).toEqual(["pis", "cofins", "irpj", "irpjAdicional", "csll"]);
    expect(l.find((x) => x.chave === "pis")).toMatchObject({ base: 100_000, aliquota: 0.0065, valor: 650, periodo: PERIODO.MES });
    expect(l.find((x) => x.chave === "irpj")).toMatchObject({ base: 96_000, aliquota: 0.15, valor: 14_400, periodo: PERIODO.TRIMESTRE });
    expect(l.find((x) => x.chave === "csll")).toMatchObject({ base: 96_000, aliquota: 0.09, valor: 8_640 });
  });

  it("⚠⚠ O ADICIONAL É LINHA PRÓPRIA, com base e alíquota PRÓPRIAS", () => {
    // Somado ao IRPJ, "18.000 sobre base 96.000" daria uma alíquota aparente de 18,75%, que não
    // existe em norma nenhuma e não confere com nada.
    const ad = linhasDaMemoriaDeCalculo(FECHA).find((x) => x.chave === "irpjAdicional");
    expect(ad).toMatchObject({ base: 36_000, aliquota: 0.10, valor: 3_600 });
    expect(ad.baseDescricao).toMatch(/excede R\$ 60\.000,00 de base no trimestre/);
  });

  it("⚠ a descrição da base do IRPJ nomeia a PRESUNÇÃO aplicada", () => {
    const irpj = linhasDaMemoriaDeCalculo(FECHA).find((x) => x.chave === "irpj");
    expect(irpj.baseDescricao).toMatch(/32,00% da receita de serviços do trimestre/);
  });

  it("⚠⚠ com serviços E mercadorias, ela NÃO afirma um percentual só", () => {
    // As duas presumem percentuais diferentes: dizer "32% da receita" ali daria um número que o
    // contador não consegue refazer contra a DARF.
    const misto = {
      ...FECHA,
      trimestre: { ...FECHA.trimestre, receitaServicos: 200_000, receitaMercadorias: 100_000 },
    };
    const irpj = linhasDaMemoriaDeCalculo(misto).find((x) => x.chave === "irpj");
    expect(irpj.baseDescricao).toMatch(/percentuais diferentes para serviços e para mercadorias/);
    expect(irpj.baseDescricao).not.toMatch(/32,00%/);
  });

  it("⚠ com a presunção de 16% confirmada, é 16% que aparece na memória", () => {
    const dezesseis = {
      ...FECHA,
      irpj: { ...FECHA.irpj, presuncaoAplicadaServicos: 0.16 },
    };
    const l = linhasDaMemoriaDeCalculo(dezesseis);
    expect(l.find((x) => x.chave === "irpj").baseDescricao).toMatch(/16,00%/);
    // ⚠ E a CSLL continua dizendo 32% — a redução do § 4º não a alcança.
    expect(l.find((x) => x.chave === "csll").baseDescricao).toMatch(/32,00%/);
  });
});

describe("⚠⚠ CÉLULA VAZIA É PROIBIDA — o mês que não fecha", () => {
  it("IRPJ, adicional e CSLL continuam na tabela, com a ausência NOMEADA", () => {
    const l = linhasDaMemoriaDeCalculo(NAO_FECHA);
    expect(l.map((x) => x.chave)).toEqual(["pis", "cofins", "irpj", "irpjAdicional", "csll"]);
    for (const chave of ["irpj", "irpjAdicional", "csll"]) {
      const linha = l.find((x) => x.chave === chave);
      expect(linha.ausencia).toBe(AUSENCIA.FECHA_NO_TRIMESTRE);
      expect(fraseDaAusencia(linha.ausencia)).toBe("não apurado neste mês");
    }
  });

  it("⚠⚠ e o valor é `null`, NUNCA `0` — zero diria que a empresa não deve o tributo", () => {
    const l = linhasDaMemoriaDeCalculo(NAO_FECHA);
    for (const chave of ["irpj", "irpjAdicional", "csll"]) {
      const linha = l.find((x) => x.chave === chave);
      expect(linha.valor).toBeNull();
      expect(linha.valor).not.toBe(0);
      expect(linha.base).toBeNull();
      expect(linha.aliquota).toBeNull();
    }
  });

  it("⚠ PIS e COFINS continuam com número — eles SÃO apurados no mês", () => {
    const l = linhasDaMemoriaDeCalculo(NAO_FECHA);
    expect(l.find((x) => x.chave === "pis").valor).toBe(650);
    expect(l.find((x) => x.chave === "pis").ausencia).toBeUndefined();
  });

  it("apuração ausente devolve lista vazia, sem quebrar", () => {
    expect(linhasDaMemoriaDeCalculo(null)).toEqual([]);
    expect(linhasDaMemoriaDeCalculo(undefined)).toEqual([]);
  });
});

describe("⚠⚠ A ALÍQUOTA EFETIVA — a parcialidade sai em PALAVRAS", () => {
  it("no fechamento: completa, com o rótulo do TRIMESTRE e sem ressalva", () => {
    const c = leituraDaCargaEfetiva(FECHA.cargaEfetiva);
    expect(c.texto).toBe("12,53%");
    expect(c.completa).toBe(true);
    expect(c.rotulo).toMatch(/do trimestre/i);
    expect(c.ressalva).toBeNull();
  });

  it("⚠⚠ no mês que não fecha: 3,65% SAI COM A RESSALVA, e o rótulo diz MÊS", () => {
    // Sem isso, "o Presumido custa 3,65%" — e o mesmo contador vê 12,5% três meses depois.
    const c = leituraDaCargaEfetiva(NAO_FECHA.cargaEfetiva);
    expect(c.texto).toBe("3,65%");
    expect(c.completa).toBe(false);
    expect(c.rotulo).toMatch(/do mês/i);
    expect(c.ressalva).toMatch(/IRPJ e CSLL fecham no último mês do trimestre/i);
  });

  it("⚠⚠ receita zero vira TRAÇO, nunca 0% — e o motivo aparece", () => {
    const c = leituraDaCargaEfetiva({
      valor: null, total: 0, receita: 0, base: "MES", completa: false,
      motivo: "Sem receita na competência: não há alíquota efetiva a calcular (zero afirmaria carga zero).",
    });
    expect(c.texto).toBe("—");
    expect(c.texto).not.toBe("0,00%");
    expect(c.ressalva).toMatch(/zero afirmaria carga zero/i);
  });

  it("⚠⚠ COM RECEITA ZERO o título NÃO diz 'parcial' — não há alíquota a ser parcial", () => {
    // Achado NO NAVEGADOR (27/08/2026): o título estava escrito no componente como
    // `completa ? … : "Esta alíquota é PARCIAL"`, e a caixa dizia isso sobre um TRAÇO.
    expect(leituraDaCargaEfetiva({ valor: null, base: "MES", completa: false }).tituloDaRessalva)
      .toBe("Não há alíquota efetiva a calcular");
  });

  it("⚠ e os outros dois títulos continuam distintos entre si", () => {
    expect(leituraDaCargaEfetiva(NAO_FECHA.cargaEfetiva).tituloDaRessalva).toMatch(/PARCIAL/);
    expect(leituraDaCargaEfetiva(FECHA.cargaEfetiva).tituloDaRessalva).toBe("Sobre este número");
  });

  it("⚠⚠ o tom NUNCA é `ok` — apuração calculada não é apuração paga", () => {
    // Verde, nesta casa, quer dizer CONCLUÍDO.
    for (const carga of [FECHA.cargaEfetiva, NAO_FECHA.cargaEfetiva, { valor: null, base: "MES" }]) {
      expect(leituraDaCargaEfetiva(carga).tom).not.toBe("ok");
    }
    expect(leituraDaCargaEfetiva(FECHA.cargaEfetiva).tom).toBe("neutro");
    expect(leituraDaCargaEfetiva(NAO_FECHA.cargaEfetiva).tom).toBe("atencao");
  });
});

describe("⚠⚠ A CONFERÊNCIA — `sem_dctfweb` NÃO é `ok`", () => {
  const REC = {
    PIS: { calculado: 650, dctfweb: 650, diferenca: 0, status: "ok" },
    COFINS: { calculado: 3000, dctfweb: 3500, diferenca: 500, status: "divergente" },
    IRPJ: { calculado: 18000, dctfweb: null, status: "sem_dctfweb" },
  };

  it("cada linha traz calculado, declarado e o rótulo do estado", () => {
    const l = linhasDaConferencia(REC);
    expect(l.find((x) => x.tributo === "PIS")).toMatchObject({ calculado: 650, declarado: 650, tom: "ok" });
    expect(l.find((x) => x.tributo === "COFINS")).toMatchObject({ diferenca: 500, tom: "atencao" });
  });

  it("⚠⚠ `sem_dctfweb` diz que NÃO HÁ COM O QUE COMPARAR — e o tom não é verde", () => {
    const irpj = linhasDaConferencia(REC).find((x) => x.tributo === "IRPJ");
    expect(irpj.rotulo).toMatch(/sem declaração capturada/i);
    expect(irpj.tom).toBe("neutro");
    expect(irpj.declarado).toBeNull();
  });

  it("⚠⚠ com DARF capturada, a LINHA também muda de frase — e é o mesmo defeito, um nível abaixo", () => {
    // "sem declaração capturada" ao lado de um bloco que anuncia a DARF é a mesma contradição que o
    // resumo já resolvia; a linha ficava dizendo o contrário do cabeçalho dela.
    const l = linhasDaConferencia(REC, { temDeclaracao: true });
    expect(l.find((x) => x.tributo === "IRPJ").rotulo).toBe("a declaração desta competência não traz este tributo");
    // ⚠ E os OUTROS estados não mudam de frase por causa disso.
    expect(l.find((x) => x.tributo === "PIS").rotulo).toMatch(/confere com a declaração/);
  });

  it("⚠ status desconhecido cai em SEM DECLARAÇÃO, nunca em `ok`", () => {
    // Falhar para o lado seguro: um estado novo do backend não pode se pintar de conferido.
    const l = linhasDaConferencia({ X: { calculado: 1, status: "coisa_nova" } });
    expect(l[0].rotulo).toMatch(/sem declaração capturada/i);
  });

  it("⚠ a conferência é ALERTA, nunca bloqueio — nenhum tom é `danger`", () => {
    // Vermelho, nesta casa, BLOQUEIA o fechamento; isto não bloqueia nada.
    for (const l of linhasDaConferencia(REC)) expect(l.tom).not.toBe("danger");
  });
});

describe("⚠⚠ O RESUMO — 'nada a comparar' NÃO é 'tudo confere'", () => {
  it("sem nenhum tributo comparado, ele diz isso, e diz o que ISSO significa", () => {
    const r = resumoDaConferencia({
      PIS: { calculado: 650, dctfweb: null, status: "sem_dctfweb" },
      COFINS: { calculado: 3000, dctfweb: null, status: "sem_dctfweb" },
    });
    expect(r.comparadas).toBe(0);
    expect(r.tom).toBe("neutro");
    expect(r.frase).toMatch(/não há declaração da DCTFWeb capturada/i);
    expect(r.frase).toMatch(/não quer dizer que o cálculo está certo/i);
  });

  it("⚠⚠ COM DARF capturada mas NENHUM tributo comparável, ele NÃO diz 'não há declaração'", () => {
    // Achado NO NAVEGADOR (27/08/2026), não no teste: num mês que não fecha trimestre com DARF de
    // IRPJ/CSLL, a tela mostrava "HÁ DARF DE IRPJ/CSLL NESTA COMPETÊNCIA" e, logo abaixo, "não há
    // declaração da DCTFWeb capturada". As duas eram exatas e se liam como contradição.
    const r = resumoDaConferencia(
      {
        PIS: { calculado: 260, dctfweb: null, status: "sem_dctfweb" },
        COFINS: { calculado: 1200, dctfweb: null, status: "sem_dctfweb" },
      },
      { tributosDeclarados: ["IRPJ", "CSLL"] },
    );
    expect(r.comparadas).toBe(0);
    expect(r.frase).not.toMatch(/não há declaração/i);
    expect(r.frase).toMatch(/IRPJ e CSLL/);
    expect(r.frase).toMatch(/ausência de sobreposição/i);
  });

  it("⚠ e SEM DARF nenhuma continua dizendo que não há declaração — as duas frases não se fundem", () => {
    const r = resumoDaConferencia(
      { PIS: { calculado: 260, dctfweb: null, status: "sem_dctfweb" } },
      { tributosDeclarados: [] },
    );
    expect(r.frase).toMatch(/não há declaração da DCTFWeb capturada/i);
  });

  it("com divergência, ele conta e diz que é alerta", () => {
    const r = resumoDaConferencia({
      PIS: { calculado: 650, dctfweb: 650, status: "ok" },
      COFINS: { calculado: 3000, dctfweb: 3500, status: "divergente" },
    });
    expect(r).toMatchObject({ comparadas: 2, divergentes: 1, tom: "atencao" });
    expect(r.frase).toMatch(/não um bloqueio/i);
  });

  it("tudo conferido e batendo é `ok` — aqui verde É o certo", () => {
    // Isto é uma conferência CONCLUÍDA, não uma ação a fazer.
    const r = resumoDaConferencia({ PIS: { calculado: 650, dctfweb: 650, status: "ok" } });
    expect(r.tom).toBe("ok");
    expect(r.frase).toMatch(/tolerância de 2%/);
  });

  it("reconciliação ausente não quebra", () => {
    expect(linhasDaConferencia(null)).toEqual([]);
    expect(resumoDaConferencia(null).comparadas).toBe(0);
  });
});

describe("⚠⚠ O AVISO DA QUOTA — e a TELA NÃO ESCREVE A FRASE", () => {
  it("o texto vem PRONTO do backend", () => {
    // Duas frases sobre a mesma DARF divergiriam na primeira correção, e esta é sobre dado fiscal.
    const q = avisoDaQuota({
      total: 8_880,
      tributos: [{ tributo: "IRPJ", valor: 6_000 }, { tributo: "CSLL", valor: 2_880 }],
      leitura: "Este mês não fecha trimestre, então o cálculo não apura IRPJ nem CSLL — mas há DARF de IRPJ e CSLL nesta competência.",
    });
    expect(q.texto).toMatch(/não fecha trimestre/);
    expect(q.total).toBe(8_880);
    expect(q.tributos).toHaveLength(2);
    expect(q.tom).toBe("atencao");
  });

  it("⚠ e ele tem TÍTULO próprio — aviso sem título vira uma faixa âmbar indistinguível", () => {
    expect(avisoDaQuota({ leitura: "x" }).titulo).toBeTruthy();
  });

  it("sem quota, não há bloco — nada a dizer é dizer nada", () => {
    expect(avisoDaQuota(null)).toBeNull();
    expect(avisoDaQuota(undefined)).toBeNull();
  });
});

describe("⚠ O AVISO DOS R$ 120.000 — os quatro estados falam", () => {
  it("`nao_perguntado` é âmbar: há decisão pendente", () => {
    const a = avisoDosServicos16({ estado: "nao_perguntado", presuncao: 0.32, motivo: "…", excecoes: ["a", "b"] });
    expect(a.tom).toBe("atencao");
    expect(a.excecoes).toHaveLength(2);
  });

  it("⚠ `confirmado` e `recusado` são NEUTROS — a decisão foi tomada", () => {
    // Âmbar permanente treina o olho a ignorar a cor que significa "falta fazer".
    for (const estado of ["confirmado", "recusado"]) {
      expect(avisoDosServicos16({ estado }).tom).toBe("neutro");
    }
  });

  it("⚠⚠ `impossivel_pela_receita` é âmbar — a confirmação foi REBAIXADA e isso precisa aparecer", () => {
    expect(avisoDosServicos16({ estado: "impossivel_pela_receita" }).tom).toBe("atencao");
  });

  it("num mês que não fecha trimestre não há aviso — a presunção não foi aplicada a nada", () => {
    expect(avisoDosServicos16(null)).toBeNull();
  });
});

describe("⚠⚠ A FORMATAÇÃO — `null` é TRAÇO, nunca zero", () => {
  it("dinheiro", () => {
    expect(dinheiro(null)).toBe("—");
    expect(dinheiro(undefined)).toBe("—");
    expect(dinheiro("1234")).toBe("—"); // ⚠ string não é número: `Number("")` é 0, e 0 afirma
    expect(dinheiro(0)).toMatch(/0,00/);  // ⚠ zero DECLARADO continua sendo um valor
    expect(dinheiro(1234.5)).toMatch(/1\.234,50/);
  });

  it("percentual", () => {
    expect(pct(null)).toBe("—");
    expect(pct(null)).not.toBe("0,00%");
    expect(pct(0)).toBe("0,00%");
    expect(pct(0.1253)).toBe("12,53%");
    expect(pct(0.0065)).toBe("0,65%");
  });
});
