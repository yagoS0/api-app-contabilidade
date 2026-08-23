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
  MOTIVO_FORA_DA_CONFERENCIA,
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
    camposFiscaisExtraidosEm: new Date("2026-08-17T12:00:00.000Z"),
    camposFiscaisMotivo: null,
    ...over,
  };
}

const rodar = (args) => auditarNotasDaCompetencia({ competencia: "2026-07", ...args });
const pergunta = (r, id) => r.perguntas.find((p) => p.id === id);

// ────────────────────────────────────────────────────────────────────────────────────────────────
describe("as três perguntas — nem uma a mais, nem uma a menos", () => {
  test("a auditoria responde exatamente as TRÊS perguntas que sobreviveram ao corte de 21/08/2026", () => {
    const r = rodar({ notas: [nota()], codigosServicoNacional: ["310104"] });
    expect(r.perguntas.map((p) => p.id)).toEqual([
      "ATIVIDADE_FORA_DO_CADASTRO",
      "EMISSAO_FORA_DA_COMPETENCIA",
      "ISS_ZERADO_ONDE_TRIBUTA",
    ]);
  });

  // ⚠⚠ ESTE TESTE É O CADEADO DO CORTE, e ele existe porque a tentação de "melhorar" a auditoria
  // devolvendo a pergunta de numeração é grande e o argumento contra ela está numa planilha oficial
  // que ninguém tem aberta. NÃO reintroduza `NUMERACAO_DA_DPS` sem a norma: a regra E0014
  // (ANEXO_I, aba `RN DPS_NFS-e`, linha 148) define a unicidade da DPS por QUATRO componentes
  // (Série + Número + Município Emissor + CNPJ/CPF), e nas 653 regras do ANEXO_I não existe
  // nenhuma que exija numeração CONTÍNUA da DPS — o único campo com regra de sequência é o `nNFSe`,
  // gerado pela Receita. Medido: 0 repetidos, 54 "buracos", e os buracos eram da NOSSA captura.
  test("⚠ NÃO existe pergunta de numeração da DPS — não há norma atrás dela", () => {
    const r = rodar({ notas: [nota()], codigosServicoNacional: ["310104"] });
    expect(r.perguntas.some((p) => p.id === "NUMERACAO_DA_DPS")).toBe(false);
    expect(PERGUNTAS.NUMERACAO_DA_DPS).toBeUndefined();
    expect(ESPECIE.NUMERO_PULADO).toBeUndefined();
    expect(ESPECIE.NUMERO_REPETIDO).toBeUndefined();
  });

  test("⚠ NOTA_NAO_LIDA continua definida, e declara que NÃO é pergunta de tela", () => {
    expect(PERGUNTAS.NOTA_NAO_LIDA.manutencao).toBe(true);
    for (const id of ["ATIVIDADE_FORA_DO_CADASTRO", "EMISSAO_FORA_DA_COMPETENCIA", "ISS_ZERADO_ONDE_TRIBUTA"]) {
      expect(PERGUNTAS[id].manutencao).toBeUndefined();
    }
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
        nota({ id: "a" }),
        nota({ id: "b" }),
        nota({ id: "c" }),
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
  // ⚠⚠ O RECORTE MUDOU EM 21/08/2026. Medido: 1.738 divergências, **1.727 de exatamente um mês** —
  // a virada normal (serviço de julho faturado em 1º de agosto). Listá-las afogava as 11 que valiam.
  // Um mês virou CONTAGEM; dois ou mais viram linha.
  test("⚠ desvio de UM mês NÃO é linha — vira a contagem `viradaDeMes`", () => {
    const r = rodar({
      notas: [nota({ issueDate: new Date("2026-08-02T13:00:00.000Z"), competencia: new Date("2026-07-31T00:00:00.000Z") })],
      codigosServicoNacional: ["310104"],
    });
    const p = pergunta(r, "EMISSAO_FORA_DA_COMPETENCIA");
    expect(p.achados).toHaveLength(0);
    // ⚠ MAS ELA NÃO SOME: a contagem é o que mantém verdadeira a promessa "nada some em silêncio".
    expect(p.viradaDeMes).toBe(1);
    expect(p.avaliadas).toBe(1);
  });

  test("desvio de DOIS meses ou mais vira achado, com o desvio junto", () => {
    const r = rodar({
      notas: [nota({ issueDate: new Date("2026-09-02T13:00:00.000Z"), competencia: new Date("2026-07-31T00:00:00.000Z") })],
      codigosServicoNacional: ["310104"],
    });
    const p = pergunta(r, "EMISSAO_FORA_DA_COMPETENCIA");
    expect(p.achados).toHaveLength(1);
    expect(p.achados[0].dados).toMatchObject({ mesDaCompetencia: "2026-07", mesDaEmissao: "2026-09", mesesDeDesvio: -2 });
    expect(p.viradaDeMes).toBe(0);
  });

  test("o piso vale nos DOIS sentidos — emissão adiantada também só conta a partir de 2 meses", () => {
    const r = rodar({
      notas: [
        nota({ id: "um", issueDate: new Date("2026-06-28T00:00:00.000Z") }),   // −1: contagem
        nota({ id: "tres", issueDate: new Date("2026-04-28T00:00:00.000Z") }), // −3: achado
      ],
      codigosServicoNacional: ["310104"],
    });
    const p = pergunta(r, "EMISSAO_FORA_DA_COMPETENCIA");
    expect(p.achados.map((a) => a.notaId)).toEqual(["tres"]);
    expect(p.viradaDeMes).toBe(1);
  });

  test("⚠ `viradaDeMes` sobe mesmo zerado — ausência de campo obrigaria a tela a adivinhar", () => {
    const p = pergunta(rodar({ notas: [nota()], codigosServicoNacional: ["310104"] }), "EMISSAO_FORA_DA_COMPETENCIA");
    expect(p.viradaDeMes).toBe(0);
    expect(p.mesesDeDesvioMinimo).toBe(2);
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
describe("4 — as notas que a conferência mensal NÃO alcança", () => {
  // ⚠⚠ ESTE BLOCO SUBSTITUIU O DA NUMERAÇÃO DA DPS (21/08/2026), e a troca não é coincidência: era
  // a nota invisível conferida aqui que ajudava a FABRICAR os "buracos" que aquela pergunta acusava.
  // O filtro `competencia: { gte, lt }` do serviço nunca alcança NULL, então a nota sem competência
  // sumia da série sem deixar rastro — e sem aparecer sequer em "notas fora desta conferência".
  test("a nota sem competência aparece, com o motivo, e NÃO entra na conferência do mês", () => {
    const r = rodar({
      notas: [nota()],
      notasSemCompetencia: [nota({ id: "orfa", numero: "777", competencia: null })],
      totalSemCompetencia: 1,
      codigosServicoNacional: ["310104"],
    });
    expect(r.foraDaConferencia.motivo).toBe(MOTIVO_FORA_DA_CONFERENCIA.SEM_COMPETENCIA_GRAVADA);
    expect(r.foraDaConferencia.notas).toEqual([expect.objectContaining({ notaId: "orfa", numero: "777" })]);
    // ⚠ Ela não é ACHADO: não há nada de errado provado, e ela não é do mês.
    expect(r.totalAchados).toBe(0);
    expect(r.totalNotas).toBe(1);
  });

  test("⚠ o total é o do BANCO, não o da lista — amostra truncada não pode virar o número", () => {
    const r = rodar({
      notas: [nota()],
      notasSemCompetencia: [nota({ id: "o1", competencia: null })],
      totalSemCompetencia: 137,
      codigosServicoNacional: ["310104"],
    });
    expect(r.foraDaConferencia).toMatchObject({ total: 137, listadas: 1, truncada: true });
  });

  test("total ausente cai no tamanho da lista — nunca em zero", () => {
    const r = rodar({
      notas: [nota()],
      notasSemCompetencia: [nota({ id: "o1", competencia: null }), nota({ id: "o2", competencia: null })],
      codigosServicoNacional: ["310104"],
    });
    expect(r.foraDaConferencia).toMatchObject({ total: 2, listadas: 2, truncada: false });
  });

  test("sem órfã, o bloco existe zerado — a tela precisa poder dizer 'nenhuma'", () => {
    const r = rodar({ notas: [nota()], codigosServicoNacional: ["310104"] });
    expect(r.foraDaConferencia).toMatchObject({ total: 0, listadas: 0, truncada: false, notas: [] });
  });

  test("⚠ NF-e e nota recebida não entram nem aqui — a população é a mesma do resto", () => {
    const r = rodar({
      notas: [nota()],
      notasSemCompetencia: [
        nota({ id: "nfe", type: "NFE", competencia: null }),
        nota({ id: "dest", papel: "DEST", competencia: null }),
      ],
      totalSemCompetencia: 2,
      codigosServicoNacional: ["310104"],
    });
    expect(r.foraDaConferencia.notas).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────────────
describe("MANUTENÇÃO — nota que não pôde ser lida (⚠ fora da tela do contador)", () => {
  // ⚠ Ela SAIU das perguntas em 21/08/2026 (é defeito do NOSSO extrator, não pergunta de contador)
  // e continua sendo calculada, porque o sinal é real. Nada se esconde da conferência por isso: a
  // nota ilegível segue saindo em `naoAvaliadas` das perguntas que dependem do campo que faltou.
  const leitura = (r) => r.manutencao.leitura;

  test("motivo preenchido: aparece COM o motivo, dentro de `manutencao`", () => {
    const r = rodar({ notas: [nota({ camposFiscaisMotivo: "NAO_E_NFSE" })], codigosServicoNacional: ["310104"] });
    const [a] = leitura(r).achados;
    expect(a.dados).toMatchObject({ especie: ESPECIE.LEITURA_FALHOU, motivo: "NAO_E_NFSE" });
    expect(r.manutencao.notasNaoLidas).toBe(1);
  });

  test("⚠ ela NÃO conta em totalAchados — não é ponto a conferir do contador", () => {
    const r = rodar({ notas: [nota({ camposFiscaisMotivo: "NAO_E_NFSE" })], codigosServicoNacional: ["310104"] });
    expect(r.totalAchados).toBe(0);
    expect(r.perguntas.some((p) => p.id === "NOTA_NAO_LIDA")).toBe(false);
  });

  test("⚠ O QUARTO ESTADO: carimbo NULO é 'o extrator nunca passou', e não pode sumir", () => {
    // Medido em produção: 5 notas EMIT nesse estado, com XML guardado.
    const r = rodar({
      notas: [nota({ camposFiscaisExtraidosEm: null, camposFiscaisMotivo: null, cTribNac: null })],
      codigosServicoNacional: ["310104"],
    });
    const [a] = leitura(r).achados;
    expect(a.dados.especie).toBe(ESPECIE.NUNCA_EXTRAIDA);
    expect(a.dados.motivo).toBeNull();
  });

  test("⚠ e a MESMA nota continua visível na conferência, em naoAvaliadas, com o motivo", () => {
    // É isto que autoriza tirá-la da tela: nada fica escondido do contador por causa do corte.
    const r = rodar({
      notas: [nota({ camposFiscaisExtraidosEm: null, camposFiscaisMotivo: null, cTribNac: null })],
      codigosServicoNacional: ["310104"],
    });
    const p = pergunta(r, "ATIVIDADE_FORA_DO_CADASTRO");
    expect(p.naoAvaliadas).toEqual([expect.objectContaining({ motivo: MOTIVO_NOTA_NAO_AVALIADA.SEM_CODIGO_DE_SERVICO })]);
  });

  test("nota lida com sucesso: nenhum achado, e a leitura fica CONFERIDA", () => {
    const r = rodar({ notas: [nota()], codigosServicoNacional: ["310104"] });
    expect(leitura(r).situacao).toBe(SITUACAO.CONFERIDA);
    expect(leitura(r).achados).toHaveLength(0);
  });

  test("⚠ a nota ilegível é contada MESMO cancelada — a rede não pode ter furo", () => {
    const r = rodar({
      notas: [nota({ statusEfetivo: "cancelada", camposFiscaisMotivo: "XML_ILEGIVEL" })],
      codigosServicoNacional: ["310104"],
    });
    expect(leitura(r).achados).toHaveLength(1);
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────────────
describe("a POPULAÇÃO", () => {
  test("⚠ NF-e não passa pela auditoria — outro leiaute, nenhum destes campos existe lá", () => {
    const r = rodar({ notas: [nota({ type: "NFE", cTribNac: null })], codigosServicoNacional: ["310104"] });
    expect(r.totalNotas).toBe(0);
    // e nem entra como "nota não lida", que é o erro tentador: nela tudo é nulo POR NATUREZA.
    expect(r.manutencao.leitura.situacao).toBe(SITUACAO.NAO_CONFERIVEL);
    expect(r.manutencao.notasNaoLidas).toBe(0);
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
      "issqnBaseCalculo", "issqnAliquota", "issqnValor",
      "camposFiscaisExtraidosEm", "camposFiscaisMotivo",
    ]) {
      expect(SELECT_PARA_AUDITORIA[campo]).toBe(true);
    }
    // 15 mil notas × ~10 KB de XML é o que este `select` existe para não carregar.
    expect(SELECT_PARA_AUDITORIA.xmlRaw).toBeUndefined();
    // ⚠ E os campos da DPS saíram junto com a pergunta de numeração (21/08/2026): carregá-los sem
    // ninguém os ler faria a próxima sessão supor que a conferência de numeração ainda acontece.
    expect(SELECT_PARA_AUDITORIA.dpsSerie).toBeUndefined();
    expect(SELECT_PARA_AUDITORIA.dpsNumero).toBeUndefined();
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
