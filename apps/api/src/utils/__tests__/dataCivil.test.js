// A DATA CIVIL NÃO PODE ANDAR COM O FUSO DO SERVIDOR.
//
// ⚠ Estes testes existem por um defeito MEDIDO em produção (13/08/2026), não por precaução:
// o export de lançamentos e o e-mail de guia ao cliente saíam com a data UM DIA ANTES, porque
// `toLocaleDateString("pt-BR")` sem `timeZone` usa o fuso do processo — e lá é
// `TZ=America/Sao_Paulo`.
//
// ⚠ O `process.env.TZ` é forçado aqui DE PROPÓSITO. Sem isso o teste passaria numa máquina em UTC
// (a minha) e continuaria quebrado em produção — que é exatamente como o defeito sobreviveu.

import { dataCivilBR, dataCivilISO } from "../dataCivil.js";

describe("dataCivil — o dia do fato, não o instante", () => {
  const TZ_ORIGINAL = process.env.TZ;
  afterAll(() => { process.env.TZ = TZ_ORIGINAL; });

  it("⚠ o caso relatado pelo dono: 12/05 não vira 11/05", () => {
    // O lançamento da SINTROPIA (RASCAL, PRINTI, MONIQUE) está gravado assim no banco.
    expect(dataCivilBR("2026-05-12T00:00:00.000Z")).toBe("12/05/2026");
    expect(dataCivilBR("2026-05-27T00:00:00.000Z")).toBe("27/05/2026");
  });

  it("⚠ o dia 1º NÃO cai para o mês anterior — era o que mudava a competência", () => {
    // 15 lançamentos da base estão no dia 1º. Com o defeito, todos saíam no mês errado.
    expect(dataCivilBR("2026-06-01T00:00:00.000Z")).toBe("01/06/2026");
    expect(dataCivilBR("2026-01-01T00:00:00.000Z")).toBe("01/01/2026");
  });

  it("⚠ o vencimento da guia, que vai no e-mail do CLIENTE", () => {
    expect(dataCivilBR("2026-08-25T00:00:00.000Z")).toBe("25/08/2026");
    expect(dataCivilBR("2026-08-31T00:00:00.000Z")).toBe("31/08/2026");
  });

  it("não depende do fuso do processo — o mesmo instante em três fusos dá o mesmo dia", () => {
    const alvo = "2026-05-12T00:00:00.000Z";
    const vistos = new Set();
    for (const tz of ["UTC", "America/Sao_Paulo", "Asia/Tokyo"]) {
      process.env.TZ = tz;
      vistos.add(dataCivilBR(alvo));
    }
    expect([...vistos]).toEqual(["12/05/2026"]);
  });

  it("aceita Date e string, e devolve a MESMA leitura da tela (fatia da ISO)", () => {
    const d = new Date("2026-05-12T00:00:00.000Z");
    expect(dataCivilISO(d)).toBe("2026-05-12");
    expect(dataCivilISO("2026-05-12T00:00:00.000Z")).toBe("2026-05-12");
    // É literalmente o que `renderAccountingEntriesParts.jsx` faz: `String(entry.data).slice(0,10)`.
    expect(dataCivilISO(d)).toBe(d.toISOString().slice(0, 10));
  });

  it("ausência é vazio, nunca 'Invalid Date' nem a data de hoje", () => {
    expect(dataCivilBR(null)).toBe("");
    expect(dataCivilBR(undefined)).toBe("");
    expect(dataCivilBR("")).toBe("");
    expect(dataCivilBR("nao é data")).toBe("");
    expect(dataCivilISO(null)).toBe("");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// A DIREÇÃO DA ESCRITA — `dataCivilDe`
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// ⚠ O defeito documentado acima é de LEITURA (o dia saía errado). Este bloco protege a direção
// oposta: a data que o contador DIGITA virando a data que o lançamento GUARDA. Aqui o erro de um
// dia não sai num CSV — ele grava a despesa no mês errado.

describe("dataCivilDe", () => {
  const { dataCivilDe, dataCivilISO } = require("../dataCivil");

  it("lê o dia como meia-noite UTC, do mesmo jeito que o resto da base grava", () => {
    expect(dataCivilDe("2026-05-12").toISOString()).toBe("2026-05-12T00:00:00.000Z");
  });

  it("⚠ é a volta exata de `dataCivilISO`", () => {
    for (const iso of ["2026-01-01", "2026-12-31", "2024-02-29"]) {
      expect(dataCivilISO(dataCivilDe(iso))).toBe(iso);
    }
  });

  it("⚠⚠ recusa o formato americano — `new Date` o aceitaria e trocaria dia por mês", () => {
    expect(dataCivilDe("12/05/2026")).toBeNull();
    expect(dataCivilDe("05/12/2026")).toBeNull();
  });

  it("⚠⚠ recusa mês/dia sem zero à esquerda — `new Date('2026-5-12')` usa o fuso LOCAL", () => {
    expect(dataCivilDe("2026-5-12")).toBeNull();
    expect(dataCivilDe("2026-05-2")).toBeNull();
  });

  it("⚠⚠ recusa dia que NÃO EXISTE — o `Date` normalizaria em silêncio", () => {
    // `new Date("2026-02-31T00:00:00Z")` vira 3 de março. Data fiscal inventada por baixo de quem
    // digitou é exatamente o que este projeto não faz.
    expect(dataCivilDe("2026-02-31")).toBeNull();
    expect(dataCivilDe("2026-13-01")).toBeNull();
    expect(dataCivilDe("2026-04-31")).toBeNull();
  });

  it("⚠ ano bissexto de verdade passa; falso não", () => {
    expect(dataCivilDe("2024-02-29")).not.toBeNull();
    expect(dataCivilDe("2026-02-29")).toBeNull();
  });

  it("timestamp completo NÃO passa — este campo é um DIA, não um instante", () => {
    expect(dataCivilDe("2026-05-12T13:45:00.000Z")).toBeNull();
  });

  it("entrada torta devolve null", () => {
    for (const v of [null, undefined, "", "   ", "ontem", 20260512, {}]) {
      expect(dataCivilDe(v)).toBeNull();
    }
  });
});
