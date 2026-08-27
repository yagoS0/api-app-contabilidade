// MARCAR VAZIO O TRIMESTRE INTEIRO — o que entra, o que NÃO entra, e o que se diz depois.
//
// O lote poupa digitação (~176 afirmações por ano nas 11 empresas do Presumido). O que ele não pode
// poupar é registro nem verdade: o mês do fechamento não entra, mês futuro não entra, e o desfecho
// de cada mês sai nomeado.

import {
  mesesDoTrimestre, fechaOTrimestre, mesesDoLote, fraseDoLote, relatorioDoLote, DESFECHO,
} from "../loteDoTrimestre";

describe("os meses do trimestre", () => {
  it("saem completos, do primeiro ao último", () => {
    expect(mesesDoTrimestre("2026-05")).toEqual(["2026-04", "2026-05", "2026-06"]);
    expect(mesesDoTrimestre("2026-01")).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(mesesDoTrimestre("2026-12")).toEqual(["2026-10", "2026-11", "2026-12"]);
  });

  it("competência inválida devolve lista vazia, sem quebrar", () => {
    for (const v of ["", null, undefined, "2026", "2026-13", "xx-yy"]) {
      expect(mesesDoTrimestre(v)).toEqual([]);
    }
  });

  it("mar/jun/set/dez fecham; os outros não", () => {
    for (const c of ["2026-03", "2026-06", "2026-09", "2026-12"]) expect(fechaOTrimestre(c)).toBe(true);
    for (const c of ["2026-01", "2026-04", "2026-08", "2026-11"]) expect(fechaOTrimestre(c)).toBe(false);
  });
});

describe("⚠⚠ O MÊS QUE FECHA O TRIMESTRE NUNCA ENTRA NO LOTE", () => {
  it("de abril, o lote alcança maio — e junho fica de fora", () => {
    // Junho é onde IRPJ/CSLL são apurados de verdade: marcá-lo vazio junto afirmaria ausência
    // exatamente onde a guia deve existir.
    const r = mesesDoLote("2026-04", "2026-08");
    expect(r.meses).toEqual(["2026-05"]);
    expect(r.fechamento).toBe("2026-06");
    expect(r.meses).not.toContain("2026-06");
  });

  it("⚠ ABERTO NO MÊS DO FECHAMENTO, o lote não alcança nada", () => {
    // Não é um bug: de junho, os dois meses "que não fecham" são abril e maio, e marcá-los a partir
    // do fechamento seria voltar no tempo por um caminho que a tela não anuncia.
    const r = mesesDoLote("2026-06", "2026-08");
    expect(r.meses).toEqual(["2026-04", "2026-05"]);
    // ⚠ Eles ENTRAM — o que não entra é o próprio junho.
    expect(r.meses).not.toContain("2026-06");
  });

  it("⚠ a competência aberta nunca se repete no lote", () => {
    // Ela é marcada pelo caminho de sempre; incluí-la mandaria a mesma afirmação duas vezes.
    expect(mesesDoLote("2026-05", "2026-08").meses).toEqual(["2026-04"]);
  });
});

describe("⚠⚠ MÊS QUE AINDA NÃO TERMINOU NÃO É MARCADO", () => {
  it("de janeiro, com hoje em janeiro, fevereiro fica FORA", () => {
    // Não se afirma ausência de guia num mês que não aconteceu — a mesma disciplina do teto do
    // `CompetenciaSwitcher`.
    const r = mesesDoLote("2026-01", "2026-01");
    expect(r.meses).toEqual([]);
    expect(r.foraPorSeremFuturos).toEqual(["2026-02"]);
  });

  it("o mês CORRENTE entra — ele já aconteceu o bastante para ser afirmado", () => {
    const r = mesesDoLote("2026-01", "2026-02");
    expect(r.meses).toEqual(["2026-02"]);
    expect(r.foraPorSeremFuturos).toEqual([]);
  });

  it("⚠ sem `hoje` conhecido, NADA é excluído por data — inventar um 'hoje' é pior", () => {
    expect(mesesDoLote("2026-01", null).meses).toEqual(["2026-02"]);
    expect(mesesDoLote("2026-01").foraPorSeremFuturos).toEqual([]);
  });
});

describe("⚠⚠ A FRASE NOMEIA OS MESES — 'o trimestre inteiro' seria mentira", () => {
  it("ela diz quais meses, por extenso", () => {
    const f = fraseDoLote("2026-06", "2026-08");
    expect(f.podeOferecer).toBe(true);
    expect(f.texto).toMatch(/2026-04 e 2026-05/);
  });

  it("⚠⚠ e a ressalva do fechamento vai JUNTO, sempre", () => {
    // É o que impede "marcar o trimestre" de ser lido como "marcar os três meses".
    const f = fraseDoLote("2026-06", "2026-08");
    expect(f.ressalva).toMatch(/2026-06 NÃO entra/);
    expect(f.ressalva).toMatch(/fecha o trimestre/i);
  });

  it("⚠ sem meses a marcar, ela NÃO é oferecida — e o motivo é próprio de cada caso", () => {
    expect(fraseDoLote("2026-01", "2026-01").motivo).toMatch(/ainda não terminaram/i);
    expect(fraseDoLote("2026-01", "2026-01").podeOferecer).toBe(false);
    expect(fraseDoLote("", "2026-08").motivo).toMatch(/inválida/i);
  });

  it("um mês só sai no singular", () => {
    expect(fraseDoLote("2026-04", "2026-08").texto).toMatch(/Marcar também o mês 2026-05/);
  });
});

describe("⚠⚠ O RELATÓRIO — silêncio parcial é pior que falha inteira", () => {
  it("tudo marcado sai em `ok`, com os meses nomeados", () => {
    const r = relatorioDoLote([
      { competencia: "2026-04", desfecho: DESFECHO.MARCADA },
      { competencia: "2026-05", desfecho: DESFECHO.MARCADA },
    ]);
    expect(r.tom).toBe("ok");
    expect(r.texto).toMatch(/2026-04, 2026-05/);
  });

  it("⚠⚠ falha PARCIAL não se lê como sucesso — os dois lados saem nomeados, com o motivo", () => {
    // Um mês pode falhar sozinho (mês contábil fechado ⇒ 409 MES_FECHADO). Sem isto, "marquei o
    // trimestre" se lê como sucesso total e o buraco aparece na fiscalização.
    const r = relatorioDoLote([
      { competencia: "2026-04", desfecho: DESFECHO.MARCADA },
      { competencia: "2026-05", desfecho: DESFECHO.FALHOU, motivo: "Mês fechado" },
    ]);
    expect(r.tom).toBe("atencao");
    expect(r.titulo).toMatch(/Parte dos meses/i);
    expect(r.texto).toMatch(/Marcados: 2026-04/);
    expect(r.texto).toMatch(/Não marcados: 2026-05 \(Mês fechado\)/);
  });

  it("⚠ falha SEM motivo conhecido não vira silêncio — sai 'motivo desconhecido'", () => {
    const r = relatorioDoLote([{ competencia: "2026-04", desfecho: DESFECHO.FALHOU }]);
    expect(r.titulo).toMatch(/Nenhum mês foi marcado/i);
    expect(r.texto).toMatch(/motivo desconhecido/);
  });

  it("⚠ o tom NUNCA é `erro` — o lote é comodidade, e falhar nele não bloqueia nada", () => {
    // Vermelho, nesta casa, BLOQUEIA o fechamento. O contador continua podendo marcar mês a mês.
    for (const lista of [[], [{ competencia: "x", desfecho: DESFECHO.FALHOU }]]) {
      expect(relatorioDoLote(lista).tom).not.toBe("erro");
    }
  });

  it("lista vazia diz que nada foi tocado", () => {
    expect(relatorioDoLote([]).titulo).toMatch(/Nada a marcar/i);
    expect(relatorioDoLote().titulo).toMatch(/Nada a marcar/i);
  });
});
