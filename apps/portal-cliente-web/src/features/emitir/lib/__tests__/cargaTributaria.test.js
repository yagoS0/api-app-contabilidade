// A LEITURA DA CARGA TRIBUTÁRIA APROXIMADA, no portal do cliente.
//
// ⚠ ESTA SUÍTE COBRE A REGRA; a LIGAÇÃO (a tela usa mesmo esta regra, e o dado chega da rota até a
// prévia) é o `__tests__/cargaTributariaNaTela.ligacao.test.jsx`. Sozinho, um teste de regra ficaria
// VERDE com o `select` do backend nunca alterado — que é o defeito favorito deste projeto.
//
// ⚠ Nada aqui emite, cancela ou transmite nota. A regra é pura.

import {
  CAMPOS_CARGA_TRIBUTARIA,
  ESTADO_CARGA,
  frasePendencia,
  lerCargaTributaria,
  lerPercentualCarga,
} from "../cargaTributaria";

const COMPLETO = { pTotTribFed: "11.33", pTotTribEst: "0.00", pTotTribMun: "0.00" };

describe("lerPercentualCarga — o valor GRAVADO, não uma entrada de formulário", () => {
  it("string do Prisma (`Decimal` serializa como texto) vira número", () => {
    expect(lerPercentualCarga("11.33")).toEqual({ preenchido: true, valor: 11.33, problema: false });
  });

  it("número também é aceito — o contrato não promete uma forma só", () => {
    expect(lerPercentualCarga(11.33).valor).toBe(11.33);
  });

  it("⚠ ZERO É VALOR, NUNCA AUSÊNCIA — quem consumir isto não pode usar `||`", () => {
    expect(lerPercentualCarga("0.00")).toEqual({ preenchido: true, valor: 0, problema: false });
    expect(lerPercentualCarga(0).valor).toBe(0);
  });

  it("vírgula E ponto são decimais (percentual de 0 a 100 não tem milhar)", () => {
    expect(lerPercentualCarga("11,33").valor).toBe(11.33);
    // ⚠ A prova de que o normalizador de MOEDA não foi reusado: ele faria isto virar 1133.
    expect(lerPercentualCarga("11.33").valor).toBe(11.33);
  });

  it("ausente e vazio são AUSÊNCIA, não problema", () => {
    for (const v of [null, undefined, "", "   "]) {
      expect(lerPercentualCarga(v)).toEqual({ preenchido: false, valor: null, problema: false });
    }
  });

  it("fora de 0–100, ou ilegível, é PROBLEMA — e não vira número nenhum", () => {
    for (const v of ["101", "-1", "abc", "11.333"]) {
      const r = lerPercentualCarga(v);
      expect(r.valor).toBeNull();
      expect(r.problema).toBe(true);
    }
  });
});

describe("lerCargaTributaria — TRÊS estados, e o terceiro não é 'falta'", () => {
  it("os três gravados: COMPLETA, com os valores lidos na ordem da DPS", () => {
    const carga = lerCargaTributaria(COMPLETO);
    expect(carga.estado).toBe(ESTADO_CARGA.COMPLETA);
    expect(carga.faltando).toEqual([]);
    expect(carga.ilegiveis).toEqual([]);
    expect(carga.itens.map((i) => i.campo)).toEqual(["pTotTribFed", "pTotTribEst", "pTotTribMun"]);
    expect(carga.itens.map((i) => i.valor)).toEqual([11.33, 0, 0]);
  });

  it("⚠ DOIS ZEROS NÃO SÃO 'VAZIO': zero declarado deixa o cadastro COMPLETO", () => {
    // A NFS-e real versionada do projeto declara 0.00 em dois dos três campos.
    expect(lerCargaTributaria({ pTotTribFed: "0.00", pTotTribEst: "0.00", pTotTribMun: "0.00" }).estado)
      .toBe(ESTADO_CARGA.COMPLETA);
  });

  it("⚠ SÓ O MUNICIPAL GRAVADO É PENDENTE — a forma exata do defeito de `11187501`", () => {
    const carga = lerCargaTributaria({ pTotTribFed: null, pTotTribEst: null, pTotTribMun: "2.50" });
    expect(carga.estado).toBe(ESTADO_CARGA.PENDENTE);
    expect(carga.faltando.map((f) => f.campo)).toEqual(["pTotTribFed", "pTotTribEst"]);
  });

  it("os três NULL: PENDENTE, com os três nomeados", () => {
    const carga = lerCargaTributaria({ pTotTribFed: null, pTotTribEst: null, pTotTribMun: null });
    expect(carga.estado).toBe(ESTADO_CARGA.PENDENTE);
    expect(carga.faltando).toHaveLength(3);
  });

  it("⚠⚠ CHAVE AUSENTE ≠ COLUNA NULL: sem as chaves é NAO_RECEBIDA, e nada é afirmado", () => {
    // É o portal falando com uma API anterior a 19/08/2026 — dizer "falta configurar" aqui mandaria
    // o cliente ligar para o escritório atrás de algo que talvez já esteja feito.
    const semAsChaves = { regimeTributario: "LUCRO_PRESUMIDO", inscricaoMunicipal: "1" };
    const carga = lerCargaTributaria(semAsChaves);
    expect(carga.estado).toBe(ESTADO_CARGA.NAO_RECEBIDA);
    expect(carga.faltando).toEqual([]);
    expect(carga.itens).toEqual([]);
  });

  it("⚠ O PAR QUE PROVA A DISTINÇÃO: `null` é PENDENTE, chave ausente é NAO_RECEBIDA", () => {
    expect(lerCargaTributaria({ pTotTribFed: null, pTotTribEst: null, pTotTribMun: null }).estado)
      .toBe(ESTADO_CARGA.PENDENTE);
    expect(lerCargaTributaria({}).estado).toBe(ESTADO_CARGA.NAO_RECEBIDA);
  });

  it("chegou pela METADE: não se afirma nada (a rota seleciona as três juntas)", () => {
    expect(lerCargaTributaria({ pTotTribFed: "11.33" }).estado).toBe(ESTADO_CARGA.NAO_RECEBIDA);
  });

  it("sem `legacyCompany` nenhum: NAO_RECEBIDA", () => {
    expect(lerCargaTributaria(null).estado).toBe(ESTADO_CARGA.NAO_RECEBIDA);
    expect(lerCargaTributaria(undefined).estado).toBe(ESTADO_CARGA.NAO_RECEBIDA);
  });

  it("⚠ VALOR ILEGÍVEL NÃO VIRA 'COMPLETA' — não se promete um desfecho que não se mediu", () => {
    const carga = lerCargaTributaria({ pTotTribFed: "abc", pTotTribEst: "0.00", pTotTribMun: "0.00" });
    expect(carga.estado).toBe(ESTADO_CARGA.PENDENTE);
    expect(carga.ilegiveis.map((i) => i.campo)).toEqual(["pTotTribFed"]);
    // ⚠ ...e ilegível também não é "faltando": são consertos com nomes diferentes no servidor
    // (`INVALID_TOT_TRIB_NAO_SIMPLES` × `MISSING_TOT_TRIB_NAO_SIMPLES`).
    expect(carga.faltando).toEqual([]);
  });

  it("a regra NÃO olha o regime — quem decide se a pergunta se aplica é a tela", () => {
    // O mesmo cadastro devolve a mesma leitura, com regime nenhum no objeto.
    expect(lerCargaTributaria(COMPLETO).estado).toBe(ESTADO_CARGA.COMPLETA);
    expect(lerCargaTributaria({ ...COMPLETO, regimeTributario: "SIMPLES_NACIONAL" }).estado)
      .toBe(ESTADO_CARGA.COMPLETA);
  });
});

describe("frasePendencia — a tela diz QUAIS faltam, nunca 'falta a carga'", () => {
  it("uma só: singular, e o nome dela", () => {
    const frase = frasePendencia(lerCargaTributaria({ ...COMPLETO, pTotTribEst: null }));
    expect(frase).toContain("a parcela estadual");
    expect(frase).not.toContain("as parcelas");
  });

  it("duas: plural, com 'e' antes da última", () => {
    const frase = frasePendencia(
      lerCargaTributaria({ pTotTribFed: null, pTotTribEst: null, pTotTribMun: "2.50" })
    );
    expect(frase).toContain("as parcelas federal e estadual");
  });

  it("três: as três nomeadas", () => {
    const frase = frasePendencia(
      lerCargaTributaria({ pTotTribFed: null, pTotTribEst: null, pTotTribMun: null })
    );
    expect(frase).toContain("federal, estadual e municipal");
  });

  it("⚠ diz que NADA SAI E NADA SE PERDE — a recusa é da nossa camada, antes da numeração", () => {
    const frase = frasePendencia(lerCargaTributaria({ pTotTribFed: null, pTotTribEst: null, pTotTribMun: null }));
    expect(frase).toMatch(/sem consumir numeração/i);
  });

  it("cadastro completo não produz frase nenhuma", () => {
    expect(frasePendencia(lerCargaTributaria(COMPLETO))).toBe("");
    expect(frasePendencia(null)).toBe("");
  });

  it("o ILEGÍVEL também é nomeado — senão ele some da tela e a nota é recusada sem motivo", () => {
    const frase = frasePendencia(lerCargaTributaria({ ...COMPLETO, pTotTribMun: "999" }));
    expect(frase).toContain("municipal");
  });
});

describe("⚠ os NOMES dos campos, contra o XML — nada é inventado", () => {
  it("são exatamente os três da DPS, nesta ordem", () => {
    expect(CAMPOS_CARGA_TRIBUTARIA.map((c) => c.campo)).toEqual([
      "pTotTribFed",
      "pTotTribEst",
      "pTotTribMun",
    ]);
  });

  it("⚠ `pTotTribSN` NÃO está entre eles — é outro grupo, de outro regime", () => {
    expect(CAMPOS_CARGA_TRIBUTARIA.map((c) => c.campo)).not.toContain("pTotTribSN");
  });
});
