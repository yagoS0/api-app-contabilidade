// O SEGUNDO PASSE DA CONSULTA — o que sai do navegador, e o que NUNCA sai.
//
// ⚠⚠ AS TRÊS COISAS QUE ESTA SUÍTE PROTEGE:
//   1. **CPF NÃO SE CONSULTA** — nenhuma chamada, em nenhum caminho (decisão do dono);
//   2. **uma consulta que falha não derruba o lote** — ela vira pendência DAQUELA linha;
//   3. **`cMunVerificado` só é `true` com a prova tripla feita** — é a afirmação que o backend
//      recusa aceitar sem prova, e é aqui que ela nasce.

import { consultarDocumentos, resultadoParaOBackend } from "../consultasDoLote";

const MUNICIPIOS = [
  ["3550308", "São Paulo", "SP"],
  ["4106902", "Curitiba", "PR"],
];

const RESPOSTA_COMPLETA = {
  ok: true,
  bruto: {
    razao_social: "COMERCIAL AURORA LTDA",
    cep: "01310930",
    descricao_tipo_de_logradouro: "AVENIDA",
    logradouro: "PAULISTA",
    numero: "1578",
    bairro: "BELA VISTA",
    municipio: "São Paulo",
    uf: "SP",
    codigo_municipio_ibge: "3550308",
  },
};

describe("a tradução para o que o backend espera", () => {
  test("resposta completa vira endereço com `cMunVerificado: true`", () => {
    const r = resultadoParaOBackend(RESPOSTA_COMPLETA, { municipios: MUNICIPIOS });
    expect(r).toMatchObject({ ok: true, cMunVerificado: true });
    expect(r.endereco).toMatchObject({
      cMun: "3550308",
      CEP: "01310930",
      xLgr: "AVENIDA PAULISTA",
      nro: "1578",
      xBairro: "BELA VISTA",
    });
  });

  test("⚠ o nome do campo é `CEP` (como no XML) — é o que `normalizarEndereco` do backend lê", () => {
    const r = resultadoParaOBackend(RESPOSTA_COMPLETA, { municipios: MUNICIPIOS });
    expect(Object.keys(r.endereco)).toContain("CEP");
  });

  test("recusa da consulta vira `{ ok: false, motivo }`, com a frase do fato", () => {
    const r = resultadoParaOBackend(
      { ok: false, motivo: "rede", mensagem: "Não conseguimos consultar a Receita agora." },
      { municipios: MUNICIPIOS }
    );
    expect(r).toEqual({ ok: false, motivo: "Não conseguimos consultar a Receita agora." });
  });

  test("resposta sem número não vira meio endereço — ⚠ é TUDO OU NADA", () => {
    const bruto = { ...RESPOSTA_COMPLETA.bruto, numero: "" };
    const r = resultadoParaOBackend({ ok: true, bruto }, { municipios: MUNICIPIOS });
    expect(r).toMatchObject({ ok: true, cMunVerificado: false, endereco: null });
    expect(r.faltantes).toContain("o número");
  });

  test("⚠⚠ `cMun` que não bate com o município/UF da MESMA resposta NÃO é verificado", () => {
    // 3550308 é São Paulo/SP; a resposta diz Curitiba/PR. A prova tripla existe para este caso.
    const bruto = { ...RESPOSTA_COMPLETA.bruto, municipio: "Curitiba", uf: "PR" };
    const r = resultadoParaOBackend({ ok: true, bruto }, { municipios: MUNICIPIOS });
    expect(r.cMunVerificado).toBe(false);
    expect(r.endereco).toBeNull();
  });

  test("sem a lista do IBGE não há prova, logo não há endereço", () => {
    const r = resultadoParaOBackend(RESPOSTA_COMPLETA, { municipios: null });
    expect(r.cMunVerificado).toBe(false);
    expect(r.endereco).toBeNull();
  });

  test("⚠ NÃO EXISTE caminho que produza `cMunVerificado: true` sem endereço", () => {
    const casos = [
      { ok: false },
      { ok: true, bruto: {} },
      { ok: true, bruto: { ...RESPOSTA_COMPLETA.bruto, codigo_municipio_ibge: "" } },
      { ok: true, bruto: { ...RESPOSTA_COMPLETA.bruto, logradouro: "" } },
    ];
    for (const caso of casos) {
      const r = resultadoParaOBackend(caso, { municipios: MUNICIPIOS });
      if (r.cMunVerificado === true) expect(r.endereco).toBeTruthy();
      else expect(r.endereco ?? null).toBeNull();
    }
  });
});

describe("⚠⚠ CPF NÃO SE CONSULTA", () => {
  test("nenhuma chamada sai, e nada é gravado no mapa", async () => {
    const consultar = jest.fn();
    const r = await consultarDocumentos(["12345678909"], { consultar, municipios: MUNICIPIOS });
    expect(consultar).not.toHaveBeenCalled();
    expect(r.resultados).toEqual({});
    expect(r.ignorados).toEqual([{ documento: "12345678909", motivo: "cpf" }]);
  });

  test("documento fora de forma também não vira chamada", async () => {
    const consultar = jest.fn();
    await consultarDocumentos(["123", "1122233300018"], { consultar, municipios: MUNICIPIOS });
    expect(consultar).not.toHaveBeenCalled();
  });
});

describe("a série, o progresso e o parcial", () => {
  const CNPJ_A = "11222333000181";
  const CNPJ_B = "22333444000172";

  test("consulta cada documento UMA vez e informa o progresso", async () => {
    const consultar = jest.fn(async () => RESPOSTA_COMPLETA);
    const passos = [];
    const r = await consultarDocumentos([CNPJ_A, CNPJ_B, CNPJ_A], {
      consultar,
      municipios: MUNICIPIOS,
      aoProgredir: (p) => passos.push(p),
    });
    // ⚠ O MAPA É POR DOCUMENTO: o CNPJ repetido não gasta uma segunda consulta.
    expect(consultar).toHaveBeenCalledTimes(2);
    expect(passos.map((p) => p.feitas)).toEqual([1, 2]);
    expect(passos[0].total).toBe(2);
    expect(Object.keys(r.resultados).sort()).toEqual([CNPJ_A, CNPJ_B].sort());
  });

  test("o que já se sabe não é reconsultado", async () => {
    const consultar = jest.fn(async () => RESPOSTA_COMPLETA);
    await consultarDocumentos([CNPJ_A, CNPJ_B], {
      consultar,
      municipios: MUNICIPIOS,
      jaConhecidos: { [CNPJ_A]: { ok: true } },
    });
    expect(consultar).toHaveBeenCalledTimes(1);
    expect(consultar).toHaveBeenCalledWith(CNPJ_B);
  });

  test("⚠⚠ uma consulta que FALHA não interrompe as outras", async () => {
    const consultar = jest.fn(async (cnpj) =>
      cnpj === CNPJ_A ? { ok: false, mensagem: "Não conseguimos consultar a Receita agora." } : RESPOSTA_COMPLETA
    );
    const r = await consultarDocumentos([CNPJ_A, CNPJ_B], { consultar, municipios: MUNICIPIOS });
    expect(r.feitas).toBe(2);
    expect(r.resultados[CNPJ_A].ok).toBe(false);
    expect(r.resultados[CNPJ_B].ok).toBe(true);
  });

  test("⚠ uma consulta que LANÇA vira recusa daquela linha, e o lote segue", async () => {
    const consultar = jest.fn(async (cnpj) => {
      if (cnpj === CNPJ_A) throw new Error("boom");
      return RESPOSTA_COMPLETA;
    });
    const r = await consultarDocumentos([CNPJ_A, CNPJ_B], { consultar, municipios: MUNICIPIOS });
    expect(r.resultados[CNPJ_A]).toEqual({ ok: false, motivo: "boom" });
    expect(r.resultados[CNPJ_B].ok).toBe(true);
  });

  test("⚠⚠ PARAR devolve o que já veio — resultado parcial é um estado normal", async () => {
    let feitas = 0;
    const consultar = jest.fn(async () => {
      feitas += 1;
      return RESPOSTA_COMPLETA;
    });
    const r = await consultarDocumentos([CNPJ_A, CNPJ_B], {
      consultar,
      municipios: MUNICIPIOS,
      deveParar: () => feitas >= 1,
    });
    expect(consultar).toHaveBeenCalledTimes(1);
    expect(r.parou).toBe(true);
    expect(Object.keys(r.resultados)).toEqual([CNPJ_A]);
  });

  test("lista vazia não consulta nada", async () => {
    const consultar = jest.fn();
    const r = await consultarDocumentos([], { consultar });
    expect(consultar).not.toHaveBeenCalled();
    expect(r.resultados).toEqual({});
  });
});
