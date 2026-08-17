// A REGRA DA AUDITORIA — e as invariantes que ela existe para proteger.
//
// O nome deste arquivo é o assunto, não o módulo: o que está travado aqui é (1) que ZERO ACHADOS e
// "NÃO DÁ PARA CONFERIR" são respostas DIFERENTES, (2) que ausência de dado nunca vira acusação, e
// (3) que nenhum achado é redigido como veredito.

import fs from "node:fs";
import path from "node:path";

import {
  auditarNotasDaCompetencia,
  PERGUNTAS,
  SITUACAO,
  MOTIVO_NAO_CONFERIVEL,
  MOTIVO_NOTA_NAO_AVALIADA,
  ESPECIE,
  POPULACAO,
  SELECT_PARA_AUDITORIA,
  _internos,
} from "../auditoriaNotas.js";

/** Uma NFS-e emitida e autorizada, com todos os campos fiscais preenchidos e coerentes. */
function nota(over = {}) {
  return {
    id: over.id || "n1",
    numero: "100",
    chaveAcesso: "CH1",
    type: "NFSE",
    papel: "EMIT",
    statusEfetivo: "autorizada",
    issueDate: new Date("2026-07-10T00:00:00.000Z"),
    competencia: new Date("2026-07-01T00:00:00.000Z"),
    total: "1000.00",
    cTribNac: "310104",
    xTribNac: "Serviços técnicos em telecomunicações e congêneres",
    issqnBaseCalculo: "1000.00",
    issqnAliquota: "5.0000",
    issqnValor: "50.00",
    dpsSerie: "00001",
    dpsNumero: "10",
    camposFiscaisExtraidosEm: new Date("2026-08-17T12:00:00.000Z"),
    camposFiscaisMotivo: null,
    ...over,
  };
}

const rodar = (args) => auditarNotasDaCompetencia({ competencia: "2026-07", ...args });
const pergunta = (r, id) => r.perguntas.find((p) => p.id === id);

// ────────────────────────────────────────────────────────────────────────────────────────────────
describe("as cinco perguntas — nem uma a mais, nem uma a menos", () => {
  test("a auditoria responde exatamente as cinco perguntas nomeadas pelo dono", () => {
    const r = rodar({ notas: [nota()], codigosServicoNacional: ["310104"] });
    expect(r.perguntas.map((p) => p.id)).toEqual([
      "ATIVIDADE_FORA_DO_CADASTRO",
      "EMISSAO_FORA_DA_COMPETENCIA",
      "ISS_ZERADO_ONDE_TRIBUTA",
      "NUMERACAO_DA_DPS",
      "NOTA_NAO_LIDA",
    ]);
    expect(Object.keys(PERGUNTAS)).toHaveLength(5);
  });

  test("⚠ NENHUM TEXTO DE ACHADO É VEREDITO — nada de 'errada', 'inválida', 'irregular'", () => {
    // A tela pergunta; quem julga é o contador. Um texto conclusivo aqui vira acusação em toda
    // tela que consuma esta regra, e o texto mora aqui justamente para não ser reescrito lá.
    const proibidas = /\berrad|\binválid|\birregular|\bincorret|\bilegal/i;
    for (const p of Object.values(PERGUNTAS)) {
      expect(p.achado).not.toMatch(proibidas);
      expect(p.pergunta).not.toMatch(proibidas);
      expect(p.titulo).not.toMatch(proibidas);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠ ZERO ACHADOS ≠ NÃO DÁ PARA CONFERIR", () => {
  test("empresa SEM códigos cadastrados: a atividade é NAO_CONFERIVEL, não 'tudo certo'", () => {
    const r = rodar({ notas: [nota()], codigosServicoNacional: [] });
    const p = pergunta(r, "ATIVIDADE_FORA_DO_CADASTRO");
    expect(p.situacao).toBe(SITUACAO.NAO_CONFERIVEL);
    expect(p.motivo).toBe(MOTIVO_NAO_CONFERIVEL.EMPRESA_SEM_CODIGOS_CADASTRADOS);
    expect(p.achados).toEqual([]);
  });

  test("⚠ empresa sem códigos NÃO transforma todas as notas em achado", () => {
    // O erro oposto e mais tentador: sem lista, "nenhum código é permitido" ⇒ 3 notas acusadas.
    const r = rodar({
      notas: [
        nota({ id: "a", dpsNumero: "10" }),
        nota({ id: "b", dpsNumero: "11" }),
        nota({ id: "c", dpsNumero: "12" }),
      ],
      codigosServicoNacional: [],
    });
    expect(pergunta(r, "ATIVIDADE_FORA_DO_CADASTRO").achados).toHaveLength(0);
    expect(r.totalAchados).toBe(0);
  });

  test("empresa COM códigos e nota dentro deles: CONFERIDA com zero achados", () => {
    const r = rodar({ notas: [nota()], codigosServicoNacional: ["310104", "010101"] });
    const p = pergunta(r, "ATIVIDADE_FORA_DO_CADASTRO");
    expect(p.situacao).toBe(SITUACAO.CONFERIDA);
    expect(p.motivo).toBeNull();
    expect(p.achados).toHaveLength(0);
    expect(p.avaliadas).toBe(1);
  });

  test("as duas respostas são distinguíveis pelo contador de perguntas", () => {
    const semCadastro = rodar({ notas: [nota()], codigosServicoNacional: [] });
    const comCadastro = rodar({ notas: [nota()], codigosServicoNacional: ["310104"] });
    expect(semCadastro.totalAchados).toBe(comCadastro.totalAchados); // ambos 0…
    expect(semCadastro.perguntasNaoConferiveis).toBeGreaterThan(comCadastro.perguntasNaoConferiveis); // …e mesmo assim diferentes
  });

  test("mês sem nota nenhuma: SEM_NOTAS, nunca 'nada a apontar'", () => {
    const r = rodar({ notas: [], codigosServicoNacional: ["310104"] });
    for (const p of r.perguntas) {
      expect(p.situacao).toBe(SITUACAO.NAO_CONFERIVEL);
      expect(p.motivo).toBe(MOTIVO_NAO_CONFERIVEL.SEM_NOTAS);
    }
    expect(r.perguntasConferidas).toBe(0);
  });

  test("⚠ o cadastro vazio é respondido ANTES da falta de notas", () => {
    // Senão a empresa sem código e sem nota ouviria "não houve nota" e o cadastro vazio ficaria
    // invisível até o mês em que passasse a custar dinheiro.
    const r = rodar({ notas: [], codigosServicoNacional: [] });
    expect(pergunta(r, "ATIVIDADE_FORA_DO_CADASTRO").motivo)
      .toBe(MOTIVO_NAO_CONFERIVEL.EMPRESA_SEM_CODIGOS_CADASTRADOS);
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────────────
describe("1 — atividade fora do cadastro", () => {
  test("código que não está na lista vira achado, com a lista junto", () => {
    const r = rodar({ notas: [nota({ cTribNac: "070201" })], codigosServicoNacional: ["310104"] });
    const [a] = pergunta(r, "ATIVIDADE_FORA_DO_CADASTRO").achados;
    expect(a.dados.cTribNac).toBe("070201");
    expect(a.dados.cadastrados).toEqual(["310104"]);
    expect(a.notaId).toBe("n1");
  });

  test("⚠ a comparação é DÍGITO A DÍGITO — prefixo não aprova o desdobro errado", () => {
    // `3101` é o subitem; `310104` é o desdobro. Casar por prefixo aprovaria qualquer desdobro do
    // subitem — que é exatamente a granularidade que a lista oficial de 335 existe para dar.
    const r = rodar({ notas: [nota({ cTribNac: "310199" })], codigosServicoNacional: ["310104"] });
    expect(pergunta(r, "ATIVIDADE_FORA_DO_CADASTRO").achados).toHaveLength(1);
  });

  test("⚠ nota SEM código extraído não é achado — sai em naoAvaliadas, nomeada", () => {
    const r = rodar({ notas: [nota({ cTribNac: null })], codigosServicoNacional: ["310104"] });
    const p = pergunta(r, "ATIVIDADE_FORA_DO_CADASTRO");
    expect(p.achados).toHaveLength(0);
    expect(p.naoAvaliadas).toEqual([expect.objectContaining({ motivo: MOTIVO_NOTA_NAO_AVALIADA.SEM_CODIGO_DE_SERVICO })]);
    expect(p.situacao).toBe(SITUACAO.NAO_CONFERIVEL); // nenhuma avaliável
    expect(p.motivo).toBe(MOTIVO_NAO_CONFERIVEL.NENHUMA_NOTA_AVALIAVEL);
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────────────
describe("2 — data de emissão fora da competência (DATA CIVIL)", () => {
  test("emitida em agosto e contada em julho: achado com o desvio em meses", () => {
    const r = rodar({
      notas: [nota({ issueDate: new Date("2026-08-02T13:00:00.000Z"), competencia: new Date("2026-07-31T00:00:00.000Z") })],
      codigosServicoNacional: ["310104"],
    });
    const [a] = pergunta(r, "EMISSAO_FORA_DA_COMPETENCIA").achados;
    expect(a.dados).toMatchObject({ mesDaCompetencia: "2026-07", mesDaEmissao: "2026-08", mesesDeDesvio: -1 });
  });

  test("⚠ MEIA-NOITE UTC NO DIA 1º NÃO MUDA DE MÊS — o defeito de fuso que já saiu para fora", () => {
    // `2026-08-01T00:00:00.000Z` lido no fuso de São Paulo é 31/07 às 21h: a nota mudaria de MÊS e
    // a auditoria acusaria uma divergência que não existe (ou esconderia uma que existe).
    const r = rodar({
      notas: [nota({ issueDate: new Date("2026-08-01T00:00:00.000Z"), competencia: new Date("2026-08-01T00:00:00.000Z") })],
      competencia: "2026-08",
      codigosServicoNacional: ["310104"],
    });
    expect(pergunta(r, "EMISSAO_FORA_DA_COMPETENCIA").achados).toHaveLength(0);
    expect(_internos.mesCivil(new Date("2026-08-01T00:00:00.000Z"))).toBe("2026-08");
    expect(_internos.mesCivil("2026-08-01T00:00:00.000Z")).toBe("2026-08");
  });

  test("sem data de emissão: naoAvaliada, nunca achado", () => {
    const r = rodar({ notas: [nota({ issueDate: null })], codigosServicoNacional: ["310104"] });
    const p = pergunta(r, "EMISSAO_FORA_DA_COMPETENCIA");
    expect(p.achados).toHaveLength(0);
    expect(p.naoAvaliadas[0].motivo).toBe(MOTIVO_NOTA_NAO_AVALIADA.SEM_DATA_DE_EMISSAO);
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────────────
describe("3 — ISS zerado onde a atividade tributa", () => {
  test("alíquota > 0 e valor zero: achado ALIQUOTA_SEM_VALOR", () => {
    const r = rodar({ notas: [nota({ issqnValor: "0" })], codigosServicoNacional: ["310104"] });
    expect(pergunta(r, "ISS_ZERADO_ONDE_TRIBUTA").achados[0].dados.especie).toBe(ESPECIE.ALIQUOTA_SEM_VALOR);
  });

  test("alíquota > 0 e valor NULO: também é achado (nulo não é 'não tributa')", () => {
    const r = rodar({ notas: [nota({ issqnValor: null })], codigosServicoNacional: ["310104"] });
    expect(pergunta(r, "ISS_ZERADO_ONDE_TRIBUTA").achados).toHaveLength(1);
  });

  test("base > 0 sem alíquota e sem valor: achado BASE_SEM_VALOR (o caso real da produção)", () => {
    const r = rodar({
      notas: [nota({ issqnBaseCalculo: "22900.26", issqnAliquota: null, issqnValor: "0" })],
      codigosServicoNacional: ["310104"],
    });
    expect(pergunta(r, "ISS_ZERADO_ONDE_TRIBUTA").achados[0].dados.especie).toBe(ESPECIE.BASE_SEM_VALOR);
  });

  test("⚠ nota SEM NENHUM dos três campos NÃO é achado — imune/isenta/retida não é erro", () => {
    const r = rodar({
      notas: [nota({ issqnBaseCalculo: null, issqnAliquota: null, issqnValor: null })],
      codigosServicoNacional: ["310104"],
    });
    const p = pergunta(r, "ISS_ZERADO_ONDE_TRIBUTA");
    expect(p.achados).toHaveLength(0);
    expect(p.naoAvaliadas[0].motivo).toBe(MOTIVO_NOTA_NAO_AVALIADA.SEM_ISSQN_NO_XML);
  });

  test("⚠ valor ausente NÃO vira zero em lugar nenhum do resultado", () => {
    const r = rodar({ notas: [nota({ issqnValor: null })], codigosServicoNacional: ["310104"] });
    expect(pergunta(r, "ISS_ZERADO_ONDE_TRIBUTA").achados[0].dados.issqnValor).toBeNull();
  });

  test("nota com ISS destacado corretamente: sem achado", () => {
    const r = rodar({ notas: [nota()], codigosServicoNacional: ["310104"] });
    expect(pergunta(r, "ISS_ZERADO_ONDE_TRIBUTA").achados).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────────────
describe("4 — numeração da DPS", () => {
  const serie = (numeros, over = {}) =>
    numeros.map((n, i) => nota({ id: `n${i}`, dpsNumero: String(n), ...over }));

  test("sequência sem falha: nenhum achado, e a faixa conferida volta declarada", () => {
    const r = rodar({ notas: serie([10, 11, 12]), codigosServicoNacional: ["310104"] });
    const p = pergunta(r, "NUMERACAO_DA_DPS");
    expect(p.achados).toHaveLength(0);
    expect(p.series).toEqual([expect.objectContaining({ serie: "00001", de: 10, ate: 12, pulados: 0, repetidos: 0 })]);
  });

  test("número repetido: UM achado com AS DUAS notas — nenhuma é eleita 'a errada'", () => {
    const r = rodar({
      notas: [nota({ id: "a", dpsNumero: "10" }), nota({ id: "b", dpsNumero: "10" })],
      codigosServicoNacional: ["310104"],
    });
    const [a] = pergunta(r, "NUMERACAO_DA_DPS").achados;
    expect(a.dados.especie).toBe(ESPECIE.NUMERO_REPETIDO);
    expect(a.dados.notas.map((n) => n.notaId).sort()).toEqual(["a", "b"]);
    expect(a.notaId).toBeNull();
  });

  test("buraco vira UMA faixa, não N linhas", () => {
    const r = rodar({ notas: serie([10, 14]), codigosServicoNacional: ["310104"] });
    const [a] = pergunta(r, "NUMERACAO_DA_DPS").achados;
    expect(a.dados).toMatchObject({ especie: ESPECIE.NUMERO_PULADO, de: 11, ate: 13, quantidade: 3, antes: 10, depois: 14 });
  });

  test("⚠ A BORDA NÃO É BURACO — nada é apontado antes do primeiro nem depois do último", () => {
    // Sem esta regra, toda série reportaria "faltam 1..9" só porque a janela começa no 10.
    const r = rodar({ notas: serie([10, 11]), codigosServicoNacional: ["310104"] });
    expect(pergunta(r, "NUMERACAO_DA_DPS").achados).toHaveLength(0);
  });

  test("séries diferentes não se misturam", () => {
    const r = rodar({
      notas: [nota({ id: "a", dpsSerie: "00001", dpsNumero: "10" }), nota({ id: "b", dpsSerie: "70000", dpsNumero: "1" })],
      codigosServicoNacional: ["310104"],
    });
    const p = pergunta(r, "NUMERACAO_DA_DPS");
    expect(p.achados).toHaveLength(0);
    expect(p.series.map((s) => s.serie)).toEqual(["00001", "70000"]);
  });

  test("⚠ NOTA CANCELADA CONTA NA NUMERAÇÃO — ela consumiu o número, e não há inutilização na NFS-e", () => {
    // Tirá-la faria a auditoria inventar um buraco a cada cancelamento.
    const notas = [
      nota({ id: "a", dpsNumero: "10" }),
      nota({ id: "b", dpsNumero: "11", statusEfetivo: "cancelada" }),
      nota({ id: "c", dpsNumero: "12" }),
    ];
    expect(pergunta(rodar({ notas, codigosServicoNacional: ["310104"] }), "NUMERACAO_DA_DPS").achados).toHaveLength(0);
    // …e a mesma nota cancelada NÃO entra nas perguntas da apuração:
    expect(pergunta(rodar({ notas, codigosServicoNacional: ["310104"] }), "ISS_ZERADO_ONDE_TRIBUTA").avaliadas).toBe(2);
  });

  test("⚠ a janela da numeração é a que o chamador declarou, e ela volta no resultado", () => {
    const r = auditarNotasDaCompetencia({
      competencia: "2026-07",
      notas: [nota({ dpsNumero: "50" })],
      notasDaSerie: [nota({ id: "x", dpsNumero: "48" }), nota({ dpsNumero: "50" })],
      janelaDaSerie: { de: "2025-08", ate: "2026-07", meses: 12 },
      codigosServicoNacional: ["310104"],
    });
    const p = pergunta(r, "NUMERACAO_DA_DPS");
    expect(p.janela).toEqual({ de: "2025-08", ate: "2026-07", meses: 12 });
    // O buraco 49 só existe porque a janela trouxe a 48 — dentro do mês ele seria invisível.
    expect(p.achados[0].dados).toMatchObject({ de: 49, ate: 49 });
  });

  test("número não numérico não vira zero e não some", () => {
    const r = rodar({ notas: [nota({ dpsNumero: "A12" })], codigosServicoNacional: ["310104"] });
    const p = pergunta(r, "NUMERACAO_DA_DPS");
    expect(p.naoAvaliadas[0].motivo).toBe(MOTIVO_NOTA_NAO_AVALIADA.NUMERO_DE_DPS_NAO_NUMERICO);
    expect(p.achados).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────────────
describe("5 — nota que não pôde ser lida", () => {
  test("motivo preenchido: aparece COM o motivo", () => {
    const r = rodar({ notas: [nota({ camposFiscaisMotivo: "NAO_E_NFSE" })], codigosServicoNacional: ["310104"] });
    const [a] = pergunta(r, "NOTA_NAO_LIDA").achados;
    expect(a.dados).toMatchObject({ especie: ESPECIE.LEITURA_FALHOU, motivo: "NAO_E_NFSE" });
  });

  test("⚠ O QUARTO ESTADO: carimbo NULO é 'o extrator nunca passou', e não pode sumir", () => {
    // Medido em produção: 5 notas EMIT nesse estado, com XML guardado. Lendo só
    // `camposFiscaisMotivo` elas sumiriam desta pergunta E das outras quatro, por falta de campo.
    const r = rodar({
      notas: [nota({ camposFiscaisExtraidosEm: null, camposFiscaisMotivo: null, cTribNac: null })],
      codigosServicoNacional: ["310104"],
    });
    const [a] = pergunta(r, "NOTA_NAO_LIDA").achados;
    expect(a.dados.especie).toBe(ESPECIE.NUNCA_EXTRAIDA);
    expect(a.dados.motivo).toBeNull();
  });

  test("nota lida com sucesso: nenhum achado, e a pergunta fica CONFERIDA", () => {
    const p = pergunta(rodar({ notas: [nota()], codigosServicoNacional: ["310104"] }), "NOTA_NAO_LIDA");
    expect(p.situacao).toBe(SITUACAO.CONFERIDA);
    expect(p.achados).toHaveLength(0);
  });

  test("⚠ a nota ilegível é contada MESMO cancelada — a rede não pode ter furo", () => {
    const r = rodar({
      notas: [nota({ statusEfetivo: "cancelada", camposFiscaisMotivo: "XML_ILEGIVEL" })],
      codigosServicoNacional: ["310104"],
    });
    expect(pergunta(r, "NOTA_NAO_LIDA").achados).toHaveLength(1);
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────────────
describe("a POPULAÇÃO", () => {
  test("⚠ NF-e não passa pela auditoria — outro leiaute, nenhum destes campos existe lá", () => {
    const r = rodar({ notas: [nota({ type: "NFE", cTribNac: null, dpsNumero: null })], codigosServicoNacional: ["310104"] });
    expect(r.totalNotas).toBe(0);
    // e nem entra como "nota não lida", que é o erro tentador: nela tudo é nulo POR NATUREZA.
    expect(pergunta(r, "NOTA_NAO_LIDA").situacao).toBe(SITUACAO.NAO_CONFERIVEL);
  });

  test("nota RECEBIDA (DEST) não é auditada — a auditoria é sobre o que a empresa emitiu", () => {
    const r = rodar({ notas: [nota({ papel: "DEST" })], codigosServicoNacional: ["310104"] });
    expect(r.totalNotas).toBe(0);
  });

  test("⚠ 'autorizada' é o MESMO valor da definição de faturamento do projeto", () => {
    // `FechamentoService.whereFaturamentoEmit()` é a definição única de "o que conta como
    // faturamento". Ela não é importável aqui (aquele módulo carrega o prisma no topo e este é
    // puro), então a amarração é textual: se o valor mudar lá, este teste cai.
    const fonte = fs.readFileSync(
      path.join(__dirname, "..", "..", "apuracao", "v2", "FechamentoService.js"),
      "utf8",
    );
    const corpo = fonte.slice(fonte.indexOf("export function whereFaturamentoEmit"));
    expect(corpo).toContain('papel: "EMIT"');
    expect(corpo).toContain('statusEfetivo: "autorizada"');
    // e a auditoria usa exatamente esses dois:
    expect(_internos.filtrarPopulacao([nota({ statusEfetivo: "cancelada" })], POPULACAO.APURADA)).toHaveLength(0);
    expect(_internos.filtrarPopulacao([nota()], POPULACAO.APURADA)).toHaveLength(1);
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────────────
describe("o contrato com quem chama", () => {
  test("SELECT_PARA_AUDITORIA cobre todo campo que a regra lê — e NÃO traz o xmlRaw", () => {
    for (const campo of [
      "type", "papel", "statusEfetivo", "issueDate", "competencia", "cTribNac",
      "issqnBaseCalculo", "issqnAliquota", "issqnValor", "dpsSerie", "dpsNumero",
      "camposFiscaisExtraidosEm", "camposFiscaisMotivo",
    ]) {
      expect(SELECT_PARA_AUDITORIA[campo]).toBe(true);
    }
    // 15 mil notas × ~10 KB de XML é o que este `select` existe para não carregar.
    expect(SELECT_PARA_AUDITORIA.xmlRaw).toBeUndefined();
  });

  test("a regra é PURA: a mesma entrada devolve o mesmo resultado, e a entrada não é mutada", () => {
    const notas = [nota({ cTribNac: "070201" })];
    const copia = JSON.parse(JSON.stringify(notas));
    const a = rodar({ notas, codigosServicoNacional: ["310104"] });
    const b = rodar({ notas, codigosServicoNacional: ["310104"] });
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
    expect(JSON.parse(JSON.stringify(notas))).toEqual(copia);
  });

  test("todo achado sabe dizer de qual pergunta é", () => {
    const r = rodar({
      notas: [nota({ cTribNac: "070201", issqnValor: "0", camposFiscaisMotivo: "NENHUM_CAMPO" })],
      codigosServicoNacional: ["310104"],
    });
    for (const p of r.perguntas) {
      for (const a of p.achados) expect(a.pergunta).toBe(p.id);
    }
    expect(r.totalAchados).toBeGreaterThan(0);
  });
});
