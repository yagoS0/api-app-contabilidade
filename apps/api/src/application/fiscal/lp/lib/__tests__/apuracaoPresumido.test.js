// A APURAÇÃO DO LUCRO PRESUMIDO — a regra pura.
//
// `LucroPresumidoCalculoService` existia desde 14/07/2026 e **não tinha um único teste**: ele
// carrega o Prisma no topo, então nunca houve como medi-lo sem banco. A regra saiu de lá para cá e
// é isto que este arquivo prende — inclusive as quatro coisas que ela ganhou nesta rodada.

import fs from "node:fs";
import path from "node:path";
import {
  PRESUNCAO, ALIQ, SERVICOS_16, EXCECOES_SERVICOS_16, TRIBUTOS_NAO_CALCULADOS,
  PRESUNCAO_IRPJ_SERVICOS_16, LIMITE_SERVICOS_16_PCT_ANUAL,
  presuncaoIrpjDeServicos, cargaEfetiva, quotaDeTrimestreAnterior,
  mesesDoTrimestre, isFimDeTrimestre, apurarPresumido,
} from "../apuracaoPresumido.js";

/** Um trimestre de serviços, com o mesmo valor nos três meses. */
const trimestreDeServicos = (porMes) => [0, 1, 2].map(() => ({ servicos: porMes, mercadorias: 0 }));

describe("o trimestre e o mês que o fecha", () => {
  it("mar/jun/set/dez fecham; os outros não", () => {
    for (const c of ["2026-03", "2026-06", "2026-09", "2026-12"]) expect(isFimDeTrimestre(c)).toBe(true);
    for (const c of ["2026-01", "2026-02", "2026-04", "2026-05", "2026-07", "2026-11"]) {
      expect(isFimDeTrimestre(c)).toBe(false);
    }
  });

  it("os meses do trimestre saem completos, do primeiro ao último", () => {
    expect(mesesDoTrimestre("2026-05")).toEqual(["2026-04", "2026-05", "2026-06"]);
    expect(mesesDoTrimestre("2026-01")).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(mesesDoTrimestre("2026-12")).toEqual(["2026-10", "2026-11", "2026-12"]);
  });
});

describe("⚠ CASO DOURADO — calculado à mão, trimestre de serviços de R$ 300.000", () => {
  // base IRPJ 300.000 × 32% = 96.000 · normal 14.400 · adicional (96.000 − 60.000) × 10% = 3.600
  // base CSLL 300.000 × 32% = 96.000 · CSLL 8.640
  // PIS 1.950 · COFINS 9.000 · total 37.590 · carga 12,53%
  const r = apurarPresumido({
    competencia: "2026-06",
    receita: { servicos: 100_000, mercadorias: 0 },
    receitasDoTrimestre: trimestreDeServicos(100_000),
  });

  it("IRPJ: base, normal, adicional e total", () => {
    expect(r.irpj).toMatchObject({ base: 96_000, normal: 14_400, adicional: 3_600, total: 18_000 });
  });

  it("CSLL: base e total", () => {
    expect(r.csll).toMatchObject({ base: 96_000, total: 8_640 });
  });

  it("PIS e COFINS do TRIMESTRE, e os do MÊS separados", () => {
    expect(r.trimestre).toMatchObject({ pis: 1_950, cofins: 9_000, receita: 300_000 });
    expect(r.pis).toBe(650);
    expect(r.cofins).toBe(3_000);
  });

  it("o total e a alíquota efetiva do trimestre", () => {
    expect(r.trimestre.total).toBe(37_590);
    expect(r.cargaEfetiva.valor).toBeCloseTo(0.1253, 10);
  });

  it("⚠ o adicional só incide sobre o EXCEDENTE de R$ 60.000 no trimestre, nunca sobre a base toda", () => {
    // Base de 96.000: o adicional cheio daria 9.600. Só o excedente dá 3.600.
    expect(r.irpj.adicional).toBe(3_600);
    expect(r.irpj.adicional).not.toBe(9_600);
  });

  it("⚠ base pequena não gera adicional NEGATIVO", () => {
    const p = apurarPresumido({
      competencia: "2026-06",
      receita: { servicos: 10_000, mercadorias: 0 },
      receitasDoTrimestre: trimestreDeServicos(10_000),
    });
    expect(p.irpj.base).toBe(9_600);
    expect(p.irpj.adicional).toBe(0);
  });
});

describe("⚠⚠ A REGRA DOS R$ 120.000 — e ela reduz SÓ o IRPJ", () => {
  const trimestreQueCabe = { competencia: "2026-06", receita: { servicos: 30_000, mercadorias: 0 }, receitasDoTrimestre: trimestreDeServicos(30_000) };

  it("`null` (não perguntado) mantém 32% — o comportamento de hoje, intacto", () => {
    const r = apurarPresumido({ ...trimestreQueCabe, servicos16: null });
    expect(r.servicos16.estado).toBe(SERVICOS_16.NAO_PERGUNTADO);
    expect(r.irpj.base).toBe(28_800); // 90.000 × 32%
    expect(r.irpj.total).toBe(4_320);
  });

  it("⚠ omitir o parâmetro é o MESMO que `null` — nada muda para quem não passa nada", () => {
    const semParametro = apurarPresumido(trimestreQueCabe);
    const comNull = apurarPresumido({ ...trimestreQueCabe, servicos16: null });
    expect(semParametro.irpj).toEqual(comNull.irpj);
    expect(semParametro.servicos16.estado).toBe(SERVICOS_16.NAO_PERGUNTADO);
  });

  it("`true` (confirmado) aplica 16% — e o IRPJ cai pela METADE", () => {
    const r = apurarPresumido({ ...trimestreQueCabe, servicos16: true });
    expect(r.servicos16.estado).toBe(SERVICOS_16.CONFIRMADO);
    expect(r.irpj.base).toBe(14_400); // 90.000 × 16%
    expect(r.irpj.total).toBe(2_160);
  });

  it("⚠⚠ e a CSLL NÃO cai junto — ela segue em 32% nos três estados", () => {
    // O art. 20 remete ao inciso III do § 1º do art. 15, e o § 4º não o alcança.
    for (const v of [null, true, false]) {
      const r = apurarPresumido({ ...trimestreQueCabe, servicos16: v });
      expect(r.csll.base).toBe(28_800); // 90.000 × 32%, sempre
      expect(r.csll.total).toBe(2_592);
      expect(r.csll.presuncaoAplicadaServicos).toBe(0.32);
    }
  });

  it("⚠⚠ `false` também dá 32% — mas com estado e motivo DIFERENTES de `null`", () => {
    // "Não perguntamos" e "conferimos e não cabe" produzem o mesmo imposto e NÃO são a mesma
    // afirmação. Colapsá-los faria a tela dizer que o contador respondeu algo que ele não respondeu.
    const naoPerguntado = apurarPresumido({ ...trimestreQueCabe, servicos16: null });
    const recusado = apurarPresumido({ ...trimestreQueCabe, servicos16: false });
    expect(recusado.irpj.total).toBe(naoPerguntado.irpj.total);
    expect(recusado.servicos16.estado).toBe(SERVICOS_16.RECUSADO);
    expect(recusado.servicos16.motivo).not.toBe(naoPerguntado.servicos16.motivo);
    expect(recusado.servicos16.motivo).toMatch(/informou que a empresa NÃO se enquadra/i);
    expect(naoPerguntado.servicos16.motivo).toMatch(/não foi confirmada/i);
  });

  it("⚠⚠ confirmação REBAIXADA quando a receita do trimestre sozinha já passa dos R$ 120.000", () => {
    // Aritmética, não inferência: a receita anual é ≥ à do trimestre.
    const r = apurarPresumido({
      competencia: "2026-06",
      receita: { servicos: 100_000, mercadorias: 0 },
      receitasDoTrimestre: trimestreDeServicos(100_000),
      servicos16: true,
    });
    expect(r.servicos16.estado).toBe(SERVICOS_16.IMPOSSIVEL_PELA_RECEITA);
    expect(r.irpj.base).toBe(96_000); // voltou aos 32%
    expect(r.servicos16.presuncao).toBe(PRESUNCAO.SERVICOS.irpj);
  });

  it("⚠ e o rebaixamento NÃO é silencioso — ele sai nas observações, com o número", () => {
    const r = apurarPresumido({
      competencia: "2026-06",
      receita: { servicos: 100_000, mercadorias: 0 },
      receitasDoTrimestre: trimestreDeServicos(100_000),
      servicos16: true,
    });
    expect(r.observacoes.join(" ")).toMatch(/já passa do limite anual/i);
  });

  it("⚠ o limite é fechado no valor exato: R$ 120.000 CABE, R$ 120.000,01 não", () => {
    const cabe = presuncaoIrpjDeServicos({ servicos16: true, receitaServicosDoTrimestre: 120_000 });
    const naoCabe = presuncaoIrpjDeServicos({ servicos16: true, receitaServicosDoTrimestre: 120_000.01 });
    expect(cabe.presuncao).toBe(PRESUNCAO_IRPJ_SERVICOS_16);
    expect(naoCabe.presuncao).toBe(PRESUNCAO.SERVICOS.irpj);
  });

  it("⚠ as quatro exceções do § 4º viajam junto em TODOS os estados", () => {
    // Sem elas o contador confirmaria sem saber o que está afirmando.
    for (const v of [null, true, false]) {
      expect(presuncaoIrpjDeServicos({ servicos16: v }).excecoes).toEqual(EXCECOES_SERVICOS_16);
    }
    expect(EXCECOES_SERVICOS_16).toHaveLength(4);
  });

  it("⚠ a MERCADORIA não é tocada pelo § 4º — ela segue em 8%/12%", () => {
    const r = apurarPresumido({
      competencia: "2026-06",
      receita: { servicos: 0, mercadorias: 30_000 },
      receitasDoTrimestre: [0, 1, 2].map(() => ({ servicos: 0, mercadorias: 30_000 })),
      servicos16: true,
    });
    expect(r.irpj.base).toBe(7_200);  // 90.000 × 8%
    expect(r.csll.base).toBe(10_800); // 90.000 × 12%
  });
});

describe("⚠⚠ A ALÍQUOTA EFETIVA — a base é o que impede o número de mentir", () => {
  it("mês que FECHA trimestre: base TRIMESTRE e carga completa", () => {
    const r = apurarPresumido({
      competencia: "2026-06",
      receita: { servicos: 100_000, mercadorias: 0 },
      receitasDoTrimestre: trimestreDeServicos(100_000),
    });
    expect(r.cargaEfetiva.base).toBe("TRIMESTRE");
    expect(r.cargaEfetiva.completa).toBe(true);
    expect(r.cargaEfetiva.receita).toBe(300_000);
  });

  it("⚠⚠ mês que NÃO fecha: base MÊS, `completa: false`, e o motivo DITO", () => {
    // Sem isso, 3,65% seria apresentado como "a carga do Presumido" — e ela não é.
    const r = apurarPresumido({ competencia: "2026-05", receita: { servicos: 100_000, mercadorias: 0 } });
    expect(r.cargaEfetiva.base).toBe("MES");
    expect(r.cargaEfetiva.completa).toBe(false);
    expect(r.cargaEfetiva.valor).toBeCloseTo(0.0365, 10);
    expect(r.cargaEfetiva.motivo).toMatch(/fecham no último mês do trimestre/i);
  });

  it("⚠⚠ receita ZERO devolve `null`, NUNCA `0` — zero afirmaria carga tributária zero", () => {
    for (const competencia of ["2026-05", "2026-06"]) {
      const r = apurarPresumido({
        competencia,
        receita: { servicos: 0, mercadorias: 0 },
        receitasDoTrimestre: trimestreDeServicos(0),
      });
      expect(r.cargaEfetiva.valor).toBeNull();
      expect(r.cargaEfetiva.valor).not.toBe(0);
      expect(r.cargaEfetiva.motivo).toMatch(/zero afirmaria carga zero/i);
    }
  });

  it("⚠ e o TOTAL continua saindo mesmo com a carga nula — ausência de razão não é ausência de imposto", () => {
    const r = cargaEfetiva({ total: 500, receita: 0, base: "MES", completa: false });
    expect(r.valor).toBeNull();
    expect(r.total).toBe(500);
  });

  it("a carga do trimestre é o total dos QUATRO tributos sobre a receita do trimestre", () => {
    const r = apurarPresumido({
      competencia: "2026-06",
      receita: { servicos: 100_000, mercadorias: 0 },
      receitasDoTrimestre: trimestreDeServicos(100_000),
    });
    const soma = r.trimestre.pis + r.trimestre.cofins + r.irpj.total + r.csll.total;
    expect(r.cargaEfetiva.total).toBeCloseTo(soma, 2);
    expect(r.cargaEfetiva.valor).toBeCloseTo(soma / r.trimestre.receita, 10);
  });
});

describe("⚠⚠ O DÉBITO DE IRPJ/CSLL NUM MÊS QUE NÃO FECHA TRIMESTRE", () => {
  const composicao = [
    { tributo: "PIS", total: 650 },
    { tributo: "COFINS", total: 3_000 },
    { tributo: "IRPJ", total: 6_000 },
    { tributo: "CSLL", total: 2_880 },
  ];

  it("num mês que NÃO fecha, com DARF de IRPJ/CSLL, a leitura aparece com os dois e o total", () => {
    const r = apurarPresumido({
      competencia: "2026-05",
      receita: { servicos: 100_000, mercadorias: 0 },
      composicaoDaGuia: composicao,
    });
    expect(r.irpj).toBeNull();
    expect(r.csll).toBeNull();
    expect(r.quotaDeTrimestreAnterior.total).toBe(8_880);
    expect(r.quotaDeTrimestreAnterior.tributos.map((t) => t.tributo).sort()).toEqual(["CSLL", "IRPJ"]);
  });

  it("⚠⚠ e ela NÃO diz de qual trimestre é — a composição da guia não traz o período de apuração", () => {
    // Afirmar "quota 2 do 1º trimestre" seria inventar dado fiscal.
    const q = quotaDeTrimestreAnterior({ competencia: "2026-05", composicao });
    expect(q.leitura).toMatch(/confira a que trimestre/i);
    expect(q.leitura).not.toMatch(/\b[1-4]º trimestre\b/i);
    expect(q.leitura).not.toMatch(/\bquota [1-3]\b/i);
    expect(q).not.toHaveProperty("trimestre");
    expect(q).not.toHaveProperty("quota");
  });

  it("⚠ PIS e COFINS NÃO entram — eles são mensais e o mês os apura de verdade", () => {
    const q = quotaDeTrimestreAnterior({ competencia: "2026-05", composicao });
    expect(q.total).toBe(8_880);
    expect(q.tributos.map((t) => t.tributo)).not.toContain("PIS");
  });

  it("no mês que FECHA trimestre é `null` — lá o cálculo apura os dois, não há contradição a dizer", () => {
    expect(quotaDeTrimestreAnterior({ competencia: "2026-06", composicao })).toBeNull();
  });

  it("⚠ sem DARF de IRPJ/CSLL é `null`, não um bloco vazio — nada a dizer é dizer nada", () => {
    expect(quotaDeTrimestreAnterior({ competencia: "2026-05", composicao: [] })).toBeNull();
    expect(quotaDeTrimestreAnterior({ competencia: "2026-05" })).toBeNull();
    expect(quotaDeTrimestreAnterior({ competencia: "2026-05", composicao: null })).toBeNull();
    expect(quotaDeTrimestreAnterior({
      competencia: "2026-05",
      composicao: [{ tributo: "PIS", total: 650 }],
    })).toBeNull();
  });

  it("⚠ débito ZERADO não acende o aviso — zero não é um débito a conferir", () => {
    expect(quotaDeTrimestreAnterior({
      competencia: "2026-05",
      composicao: [{ tributo: "IRPJ", total: 0 }],
    })).toBeNull();
  });

  it("⚠ o tributo é comparado sem depender de caixa — a guia grava o nome do extrato", () => {
    const q = quotaDeTrimestreAnterior({ competencia: "2026-05", composicao: [{ tributo: "irpj", total: 100 }] });
    expect(q.total).toBe(100);
  });
});

describe("⚠⚠ O QUE NÃO É CALCULADO SAI NOMEADO — célula vazia é proibida", () => {
  it("os quatro itens estão lá, cada um com rótulo e motivo", () => {
    expect(TRIBUTOS_NAO_CALCULADOS.map((t) => t.chave)).toEqual(["iss", "cpp", "majoracaoLc224", "icmsIpi"]);
    for (const t of TRIBUTOS_NAO_CALCULADOS) {
      expect(t.rotulo).toBeTruthy();
      expect(String(t.motivo).length).toBeGreaterThan(30);
    }
  });

  it("⚠ nenhum deles vira ZERO em campo nenhum da apuração", () => {
    // Zero afirmaria que a empresa não deve o tributo; a lista existe justamente para não afirmar.
    const r = apurarPresumido({ competencia: "2026-06", receita: { servicos: 100_000, mercadorias: 0 }, receitasDoTrimestre: trimestreDeServicos(100_000) });
    for (const chave of ["iss", "cpp", "icms", "ipi", "majoracaoLc224"]) {
      expect(r).not.toHaveProperty(chave);
    }
    expect(r.naoCalculado).toBe(TRIBUTOS_NAO_CALCULADOS);
  });

  it("⚠ e a lista viaja SEMPRE, inclusive no mês que não fecha trimestre", () => {
    expect(apurarPresumido({ competencia: "2026-05", receita: { servicos: 0, mercadorias: 0 } }).naoCalculado)
      .toHaveLength(4);
  });
});

describe("⚠ A APURAÇÃO NÃO ESCREVE E NÃO CHAMA NINGUÉM", () => {
  const FONTE = path.resolve(__dirname, "../apuracaoPresumido.js");

  it("o módulo não importa prisma, axios nem serviço nenhum", () => {
    const texto = fs.readFileSync(FONTE, "utf-8");
    expect(texto).not.toMatch(/^import .*(prisma|axios|Service)/m);
    expect(texto).not.toMatch(/require\(/);
  });
});

describe("⚠⚠ AS ALÍQUOTAS E AS EXCEÇÕES SÃO CÓPIA — e a cópia está AMARRADA", () => {
  // `tabelasFiscais.js` e `lucroPresumido.js` moram no app do CONTADOR e não são importáveis daqui
  // (cruzar os dois apps quebra o boot — o projeto já registra isso em `categoriaPresumido.js`).
  // A amarração é TEXTUAL, no molde de `duasTabelasDeAnexo.test.js` e do `"autorizada"` ×
  // `whereFaturamentoEmit`: este teste lê os arquivos de lá. Muda lá, cai aqui.
  const BASE = path.resolve(__dirname, "../../../../../../../web/src/features/planejamento/lib");
  const TABELAS = path.join(BASE, "tabelasFiscais.js");
  const LUCRO_PRESUMIDO = path.join(BASE, "lucroPresumido.js");

  it("os arquivos-fonte existem (se mudarem de lugar, este teste cai — que é o ponto)", () => {
    expect(fs.existsSync(TABELAS)).toBe(true);
    expect(fs.existsSync(LUCRO_PRESUMIDO)).toBe(true);
  });

  it("⚠⚠ as presunções batem com a tabela do simulador", () => {
    // Duas cópias de alíquota divergiriam, e a divergência sai como IMPOSTO ERRADO — não como erro.
    const texto = fs.readFileSync(TABELAS, "utf-8");
    const irpj = texto.slice(texto.indexOf("PRESUNCAO_IRPJ = Object.freeze({"));
    expect(irpj).toContain(`servicosGeral: ${PRESUNCAO.SERVICOS.irpj}`);
    expect(irpj).toContain(`comercioIndustria: ${PRESUNCAO.MERCADORIAS.irpj}`);
    expect(irpj).toContain(`servicosAte120k: ${PRESUNCAO_IRPJ_SERVICOS_16}`);

    const csll = texto.slice(texto.indexOf("PRESUNCAO_CSLL = Object.freeze({"));
    expect(csll).toContain(`servicosGeral: ${PRESUNCAO.SERVICOS.csll}`);
    expect(csll).toContain(`demaisReceitas: ${PRESUNCAO.MERCADORIAS.csll}`);
  });

  it("⚠ o limite dos R$ 120.000 é o MESMO número nos dois apps", () => {
    const texto = fs.readFileSync(TABELAS, "utf-8");
    expect(texto).toMatch(/LIMITE_SERVICOS_16_PCT = 120_000/);
    expect(LIMITE_SERVICOS_16_PCT_ANUAL).toBe(120_000);
  });

  it("⚠⚠ as QUATRO exceções do § 4º são as mesmas, palavra por palavra", () => {
    const texto = fs.readFileSync(LUCRO_PRESUMIDO, "utf-8");
    const bloco = texto.slice(texto.indexOf("excecoes: ["));
    for (const frase of EXCECOES_SERVICOS_16) expect(bloco).toContain(`"${frase}"`);
    // ⚠ E que não NASCEU uma quinta exceção lá sem chegar aqui.
    const fim = bloco.indexOf("],");
    const quantas = [...bloco.slice(0, fim).matchAll(/^\s{6}"/gm)].length;
    expect(quantas).toBe(EXCECOES_SERVICOS_16.length);
  });

  it("⚠ e as ALÍQUOTAS de IRPJ/CSLL/PIS/COFINS não mudaram por descuido", () => {
    expect(ALIQ).toEqual({
      irpj: 0.15,
      irpjAdicional: 0.10,
      adicionalLimiteTrimestral: 60000,
      csll: 0.09,
      pis: 0.0065,
      cofins: 0.03,
    });
  });
});
