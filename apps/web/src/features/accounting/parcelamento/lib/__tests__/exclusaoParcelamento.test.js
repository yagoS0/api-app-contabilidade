// A REGRA DE TELA DOS ATOS DO CONTRATO.
//
// ⚠ O QUE ESTE ARQUIVO PROTEGE é o texto — porque aqui o texto É a ética da tela. "Tem certeza que
// deseja excluir?" e "12 prestações somem, 1 guia é desvinculada, 1 lançamento sai do razão
// (R$ 12.000,00)" são o mesmo botão com dois contratos diferentes com o contador: o primeiro pede a
// decisão e sonega o que a sustenta; o segundo entrega os números e deixa a decisão com ele.
//
// Por isso os testes cobrem O QUE É DITO, e não só o que é calculado.

import {
  linhasDoQueVaiAcontecer, linhasDoDesfazerRescisao, avisoForaDaFila,
  explicarRecusaAto, motivoCurto, formatarMoeda, formatarCompetencia, MOTIVO_MIN,
} from "../exclusaoParcelamento";

const texto = (linhas, chave) => linhas.find((l) => l.chave === chave)?.texto || "";

const PREVIEW_BASE = {
  parcelamento: { id: "p1", label: "OUTRO Nº 3", numeroParcelamento: "3" },
  modo: "DELECAO",
  competenciaContraLancamento: null,
  competenciasFechadas: [],
  cabecalhoRemovido: true,
  prestacoes: { total: 12, quitadas: 0, semEvidencia: 12 },
  guias: { total: 0, baixadas: 0, voltamAContarComo: [], lista: [] },
  lancamentos: { total: 0, apagados: 0, preservados: 0, linhasDeRastreio: 0, lista: [] },
  totalDesfeito: 0,
  avisos: [],
  bloqueios: [],
};

describe("o que vai acontecer — números reais, não 'tem certeza?'", () => {
  it("diz quantos lançamentos saem e quanto somam", () => {
    const linhas = linhasDoQueVaiAcontecer({
      ...PREVIEW_BASE,
      lancamentos: { ...PREVIEW_BASE.lancamentos, total: 3, apagados: 3 },
      totalDesfeito: 12633.96,
    });
    expect(texto(linhas, "lancamentos_apagados")).toBe(
      "3 lançamentos saem do razão, somando R$ 12.633,96 em débitos.",
    );
  });

  it("⚠ MÊS FECHADO: diz que a ação ACONTECEU DE OUTRO JEITO — não que foi negada", () => {
    const linhas = linhasDoQueVaiAcontecer({
      ...PREVIEW_BASE,
      modo: "CONTRA_LANCAMENTO",
      competenciaContraLancamento: "2026-08",
      competenciasFechadas: ["2026-01"],
      cabecalhoRemovido: false,
      lancamentos: { ...PREVIEW_BASE.lancamentos, total: 2, apagados: 0, preservados: 2 },
    });
    const t = texto(linhas, "contra_lancamento");
    expect(t).toMatch(/competência fechada \(01\/2026\)/);
    expect(t).toMatch(/NÃO serão apagados/);
    expect(t).toMatch(/nascem contra-lançamentos espelhados em 08\/2026/);
    // A frase que explica por que o saldo do mês fechado não muda para trás.
    expect(t).toMatch(/corrigido no mês corrente/);
  });

  it("⚠ AUTONOMIA: prestação QUITADA aparece com o peso — e não vira bloqueio", () => {
    const linhas = linhasDoQueVaiAcontecer({
      ...PREVIEW_BASE,
      prestacoes: { total: 12, quitadas: 3, semEvidencia: 9 },
    });
    const t = texto(linhas, "prestacoes");
    expect(t).toMatch(/3 delas constam QUITADAS/);
    // A frase que devolve a decisão a quem sabe: o contador.
    expect(t).toMatch(/só você sabe se ele saiu/);
    expect(linhas.find((l) => l.chave === "prestacoes").tom).toBe("atencao");
  });

  it("a guia é DESVINCULADA e a tela diz em que ela se transforma no painel", () => {
    const linhas = linhasDoQueVaiAcontecer({
      ...PREVIEW_BASE,
      guias: { total: 1, baixadas: 1, voltamAContarComo: ["DAS"], lista: [] },
    });
    const t = texto(linhas, "guias");
    expect(t).toMatch(/1 guia é DESVINCULADA/);
    expect(t).toMatch(/continua na aba Guias/);
    expect(t).toMatch(/volta a contar como DAS/);
  });

  it("cabeçalho preservado é EXPLICADO — 'excluí e ainda está lá' sem motivo é pior", () => {
    const comCabecalho = linhasDoQueVaiAcontecer({ ...PREVIEW_BASE, cabecalhoRemovido: false });
    expect(texto(comCabecalho, "cabecalho")).toMatch(/some de todas as telas/);
    expect(texto(comCabecalho, "cabecalho")).toMatch(/fechamento daquele mês travaria/);

    const semCabecalho = linhasDoQueVaiAcontecer(PREVIEW_BASE);
    expect(texto(semCabecalho, "cabecalho")).toBe("O contrato deixa de existir.");
  });

  it("as linhas de rastreio são contadas SEPARADAS — elas não mudam saldo nenhum", () => {
    const linhas = linhasDoQueVaiAcontecer({
      ...PREVIEW_BASE,
      lancamentos: { ...PREVIEW_BASE.lancamentos, linhasDeRastreio: 12 },
    });
    expect(texto(linhas, "linhas_leves")).toMatch(/12 linhas de rastreio saem junto/);
  });

  it("preview ausente não quebra a tela", () => {
    expect(linhasDoQueVaiAcontecer(null)).toEqual([]);
  });
});

describe("⚠ a ausência que deixou de ser muda", () => {
  it("conta as prestações escondidas, nomeia o contrato e o caminho de volta", () => {
    const aviso = avisoForaDaFila({
      prestacoes: 12,
      contratos: [{ parcelamentoId: "p1", label: "OUTRO 2026", numeroParcelamento: "3", prestacoes: 12 }],
      motivo: "PARCELAMENTO_RESCINDIDO",
    });
    expect(aviso.total).toBe(12);
    expect(aviso.titulo).toMatch(/12 prestações estão fora desta fila/);
    expect(aviso.detalhe).toMatch(/desfaça-a e elas voltam para cá/);
    expect(aviso.linhas[0].texto).toBe("OUTRO 2026 nº 3 — 12 prestações");
    expect(aviso.linhas[0].parcelamentoId).toBe("p1");
  });

  it("nada escondido → nenhum aviso: aviso que aparece sempre é aviso que ninguém lê", () => {
    expect(avisoForaDaFila({ prestacoes: 0, contratos: [] })).toBeNull();
    expect(avisoForaDaFila(null)).toBeNull();
  });
});

describe("desfazer a rescisão", () => {
  const BASE = {
    modo: "DELECAO",
    competenciaContraLancamento: null,
    lancamentos: { total: 0, preservados: 0, lista: [] },
    totalDesfeito: 0,
    prestacoes: { total: 12, quitadas: 0, semEvidencia: 12, voltamParaFila: 12 },
    riscoAoReativar: null,
    bloqueios: [],
  };

  it("diz quantas prestações voltam para a fila — é o que a rescisão tinha engolido", () => {
    const linhas = linhasDoDesfazerRescisao(BASE);
    expect(texto(linhas, "fila")).toMatch(/12 prestações vencidas voltam/);
  });

  it("⚠ ZERO LANÇAMENTO É RESPOSTA — é o caso das cascas vazias de produção", () => {
    const linhas = linhasDoDesfazerRescisao(BASE);
    expect(texto(linhas, "lancamentos")).toMatch(/não gerou lançamento contábil nenhum/);
  });

  it("avisa quando o contrato volta JÁ rescindível", () => {
    const linhas = linhasDoDesfazerRescisao({
      ...BASE,
      riscoAoReativar: { avaliavel: true, nivel: "rescindivel", emAtraso: 12 },
    });
    expect(texto(linhas, "risco")).toMatch(/já estará com 12 prestações em atraso/);
  });

  it("⚠ diz o que NÃO faz: isto não fala com a Receita", () => {
    const linhas = linhasDoDesfazerRescisao(BASE);
    expect(texto(linhas, "escopo")).toMatch(/rescisão do acordo perante a Receita é ato dela/);
  });
});

describe("as recusas chegam com a SAÍDA, nunca só o código", () => {
  it("a mensagem do servidor vence — ela é a única que sabe o número e a competência", () => {
    expect(explicarRecusaAto("MES_CORRENTE_FECHADO", "Reabra 08/2026 para excluir."))
      .toBe("Reabra 08/2026 para excluir.");
  });

  it("sem mensagem, cai no texto que nomeia o caminho", () => {
    expect(explicarRecusaAto("MES_CORRENTE_FECHADO")).toMatch(/Reabra o mês corrente/);
    expect(explicarRecusaAto("LOTE_JA_EXPORTADO")).toMatch(/já saiu daqui para a contabilidade/);
    expect(explicarRecusaAto("PARCELAMENTO_NAO_RESCINDIDO")).toMatch(/não está rescindido/);
  });

  it("mensagem igual ao código NÃO vai para a tela (é o nome da flag, não o motivo)", () => {
    expect(explicarRecusaAto("CONTRATO_MUDOU", "CONTRATO_MUDOU")).toMatch(/Nada foi feito/);
  });

  it("código desconhecido ainda diz alguma coisa", () => {
    expect(explicarRecusaAto("BUM")).toBe("O servidor recusou a operação.");
  });
});

describe("o gate do motivo", () => {
  it("é sobre o texto APARADO — cinco espaços não são um motivo", () => {
    expect(motivoCurto("     ")).toBe(true);
    expect(motivoCurto("erro")).toBe(true);
    expect(motivoCurto("errado")).toBe(false);
    expect(MOTIVO_MIN).toBe(5);
  });
});

describe("formatação", () => {
  it("moeda em pt-BR, e ausência não vira R$ 0,00", () => {
    expect(formatarMoeda(1234.5)).toBe("R$ 1.234,50");
    expect(formatarMoeda(null)).toBe("—");
  });
  it("competência em MM/AAAA", () => {
    expect(formatarCompetencia("2026-01")).toBe("01/2026");
    expect(formatarCompetencia(null)).toBe("—");
  });
});
