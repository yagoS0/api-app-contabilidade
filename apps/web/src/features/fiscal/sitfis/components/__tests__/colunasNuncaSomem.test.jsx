// A TABELA DE DÉBITOS MOSTRA O QUE O PDF MOSTRA — TODAS AS COLUNAS, SEMPRE.
//
// Pedido do dono (17/08/2026), com o relatório de uma empresa na frente dele:
// *"é a tabela de débitos, preciso que essa tabela seja consistente"*.
//
// ⚠ O CASO QUE TRAVA A REGRESSÃO É A TABELA CURTA. A tela tinha uma regra (`colunasConstantes`,
// commit f8768d10) que tirava da tabela toda coluna NÃO-monetária cujo valor se repetisse em todas
// as linhas — e a mostrava uma vez, como nota ("Situação: DEVEDOR (todas as linhas)"). Numa tabela
// de DUAS linhas isso é devastador: `PA/Exerc.`, `Dt. Vcto` e `Situação` coincidem POR ACASO, e as
// seis colunas do relatório viram três. Medido nos 22 relatórios reais de produção: 19 colunas
// perdidas em 13 tabelas, em 12 das 17 empresas com tabela.
//
// A coincidência não tem significado fiscal nenhum — e um conjunto de colunas que muda conforme os
// dados faz a MESMA empresa mostrar 6 colunas num mês e 3 no outro, sem nada explicando. É o oposto
// de consistente.
//
// ⚠ Os dados aqui são FABRICADOS. Formato, pontuação e comprimento imitam o relatório real; os
// identificadores e valores são inventados — fixture entra no histórico do git para sempre.

import { render, screen } from "@testing-library/react";
import { SitfisRelatorioTabela } from "../SitfisRelatorioTabela.jsx";

const COLUNAS_DEBITO = ["Receita", "PA/Exerc.", "Dt. Vcto", "Vl.Original", "Sdo.Devedor", "Situação"];

// Duas linhas em que período, vencimento e situação COINCIDEM — o caso que colapsava.
const DUAS_LINHAS_QUE_COINCIDEM = [
  {
    "Receita": "1099-01 - CP-SEGUR.", "PA/Exerc.": "02/2026", "Dt. Vcto": "20/03/2026",
    "Vl.Original": "178,31", "Sdo.Devedor": "178,31", "Situação": "DEVEDOR",
  },
  {
    "Receita": "SIMPLES NAC.", "PA/Exerc.": "02/2026", "Dt. Vcto": "20/03/2026",
    "Vl.Original": "2.382,50", "Sdo.Devedor": "2.382,50", "Situação": "DEVEDOR",
  },
];

function relatorioCom(blocos) {
  return {
    emitidoEm: "17/08/2026 09:12:03",
    contribuinte: { cnpj: "11.222.333/0001-44", nome: "EMPRESA FABRICADA LTDA" },
    diagnosticos: [
      { orgao: "Receita Federal", chave: "RFB", semPendencia: false, blocos },
      { orgao: "Procuradoria-Geral da Fazenda Nacional", chave: "PGFN", semPendencia: true, blocos: [] },
    ],
    naoInterpretado: [],
    temTexto: true,
  };
}

const blocoDebito = (over = {}) => ({
  titulo: "Pendência - Débito (SIEF)",
  descricao: [], colunas: COLUNAS_DEBITO, registros: DUAS_LINHAS_QUE_COINCIDEM,
  anotacoes: [], naoInterpretado: [],
  ...over,
});

describe("tabela de débitos — as colunas do relatório sobrevivem", () => {
  it("⚠ tabela de DUAS linhas com período, vencimento e situação iguais: as SEIS colunas aparecem", () => {
    render(<SitfisRelatorioTabela relatorio={relatorioCom([blocoDebito()])} />);

    const cabecalhos = screen.getAllByRole("columnheader").map((th) => th.textContent);
    expect(cabecalhos).toEqual(COLUNAS_DEBITO);
  });

  it("o valor repetido aparece EM CADA LINHA, não como nota acima da tabela", () => {
    render(<SitfisRelatorioTabela relatorio={relatorioCom([blocoDebito()])} />);

    // Uma célula "DEVEDOR" por linha — não uma menção única.
    expect(screen.getAllByText("DEVEDOR")).toHaveLength(2);
    expect(screen.getAllByText("02/2026")).toHaveLength(2);
    expect(screen.getAllByText("20/03/2026")).toHaveLength(2);
    // A nota que a regra antiga escrevia. Se ela voltar, a coluna sumiu de novo.
    expect(screen.queryByText(/todas as linhas/i)).toBeNull();
  });

  it("com MUITAS linhas idênticas na mesma coluna também não some nada", () => {
    // A regra antiga colapsava a partir de 2 linhas; o bloco longo é o caso que a inspirou
    // ("Situação: DEVEDOR" repetido). Continua na tabela, agora com o mesmo desenho do resto.
    const registros = [...DUAS_LINHAS_QUE_COINCIDEM, {
      "Receita": "4406-01 - MAED - PGDAS-D", "PA/Exerc.": "02/2026", "Dt. Vcto": "20/03/2026",
      "Vl.Original": "50,00", "Sdo.Devedor": "50,00", "Situação": "DEVEDOR",
    }];
    render(<SitfisRelatorioTabela relatorio={relatorioCom([blocoDebito({ registros })])} />);

    expect(screen.getAllByRole("columnheader").map((th) => th.textContent)).toEqual(COLUNAS_DEBITO);
    expect(screen.getAllByText("DEVEDOR")).toHaveLength(3);
  });

  it("⚠ o dado não some para caber: quem cede é o layout (rolagem horizontal)", () => {
    // Se um dia a tabela não couber, a saída é esta — nunca esconder coluna de relatório fiscal.
    const { container } = render(<SitfisRelatorioTabela relatorio={relatorioCom([blocoDebito()])} />);
    const tabela = container.querySelector("table");
    expect(tabela.parentElement.style.overflowX).toBe("auto");
  });
});

// ⚠ O QUARTO ESTADO: bloco que não virou tabela e TAMBÉM não caiu em `naoInterpretado`.
//
// `montarTabela` só põe algo em `naoInterpretado` depois de achar um cabeçalho conhecido. Quando
// NENHUM rótulo bate, o bloco inteiro sai em `descricao` e `naoInterpretado` fica vazio — e a tela
// mostrava as linhas soltas, sem nenhum aviso de que não foram interpretadas.
//
// ⚠ O CASO QUE ORIGINOU ESTE ESTADO SAIU DELE EM 17/08/2026 (ver o `describe` seguinte): o bloco do
// parcelamento (SIEFPAR) virou tabela. Quem continua aqui — medido nos 22 relatórios reais — é o
// "Parcelamento com Exigibilidade Suspensa (PARCSN/PARCMEI)", cuja única linha é uma descrição
// livre, sem rótulo nenhum. Ele NÃO é forçado a virar tabela: não há par a ler.
describe("bloco não interpretado — a ausência de leitura tem de aparecer", () => {
  const SO_DESCRICAO = {
    titulo: "Parcelamento com Exigibilidade Suspensa (PARCSN/PARCMEI)",
    descricao: ["SIMPLES NACIONAL - EM PARCELAMENTO"],
    colunas: [], registros: [], anotacoes: [], naoInterpretado: [],
  };

  it("diz que não foi interpretado, e por quê", () => {
    render(<SitfisRelatorioTabela relatorio={relatorioCom([SO_DESCRICAO])} />);

    expect(screen.getByText(/não foi interpretado como tabela/i)).toBeInTheDocument();
    expect(screen.getByText(/cabeçalho de\s+coluna conhecido/i)).toBeInTheDocument();
    expect(screen.getByText(/PDF oficial/i)).toBeInTheDocument();
  });

  it("as linhas continuam TODAS visíveis, na ordem impressa", () => {
    render(<SitfisRelatorioTabela relatorio={relatorioCom([SO_DESCRICAO])} />);

    for (const linha of SO_DESCRICAO.descricao) expect(screen.getByText(linha)).toBeInTheDocument();
  });

  it("⚠ NÃO vira tabela: sem rótulo não há par, e forçar layout aqui seria inventá-lo", () => {
    const { container } = render(<SitfisRelatorioTabela relatorio={relatorioCom([SO_DESCRICAO])} />);

    expect(container.querySelector("table")).toBeNull();
  });

  it("descrição de bloco QUE VIROU TABELA não é acusada de não-interpretada", () => {
    // "SIMPLES NACIONAL - EM PARCELAMENTO" vem antes do cabeçalho e é contexto legítimo:
    // o bloco tem colunas e foi lido. Avisar aqui seria alarme falso em relatório normal.
    const comDescricao = blocoDebito({ descricao: ["SIMPLES NACIONAL - EM PARCELAMENTO"] });
    render(<SitfisRelatorioTabela relatorio={relatorioCom([comDescricao])} />);

    expect(screen.getByText("SIMPLES NACIONAL - EM PARCELAMENTO")).toBeInTheDocument();
    expect(screen.queryByText(/não foi interpretado como tabela/i)).toBeNull();
  });
});

// ── ESTE `describe` É A INVERSÃO DE UMA TRAVA ───────────────────────────────────────────────────
//
// Até 17/08/2026 havia aqui um teste travando o OPOSTO — "⚠ NÃO vira tabela — tabular o SIEFPAR é
// decisão do dono, ainda não respondida", com `expect(container.querySelector("table")).toBeNull()`.
// Ele foi escrito de propósito, para ninguém "consertar" por conta própria o que era decisão de
// produto. O dono decidiu; a trava não foi apagada, mudou de lado.
//
// ⚠ Os blocos abaixo são a SAÍDA do parser (`montarTabelaDePares`) para os dois textos reais
// guardados em produção — um com UM parcelamento, outro com TRÊS. Os números do parcelamento são
// FABRICADOS, com formato e comprimento reais.
describe("SIEFPAR — o bloco do parcelamento chega como tabela e é desenhado como tabela", () => {
  const UM_PARCELAMENTO = {
    titulo: "Pendência - Parcelamento (SIEFPAR)",
    descricao: [],
    colunas: ["Parcelamento", "Parcelas em Atraso", "Valor em Atraso"],
    registros: [{
      "Parcelamento": "0211.00012.0055566677.26-45",
      "Parcelas em Atraso": "3",
      "Valor em Atraso": "1.585,74",
    }],
    anotacoes: [],
    // A modalidade vem solta no relatório, sem rótulo — não virou coluna e não sumiu.
    naoInterpretado: ["Parcelamento Simplificado"],
  };

  const TRES_PARCELAMENTOS = {
    titulo: "Parcelamento com Exigibilidade Suspensa (SIEFPAR)",
    descricao: [],
    colunas: ["Parcelamento", "Valor Suspenso"],
    registros: [
      { "Parcelamento": "0211.00012.0055566677.26-45", "Valor Suspenso": "37.067,11" },
      { "Parcelamento": "0211.00012.0088899900.25-31", "Valor Suspenso": "19.840,14" },
      { "Parcelamento": "0211.00012.0011122233.25-77", "Valor Suspenso": "76.377,88" },
    ],
    anotacoes: [],
    naoInterpretado: ["Parcelamento Simplificado", "Parcelamento Simplificado", "Parcelamento Simplificado"],
  };

  it("um parcelamento: as três colunas viram cabeçalho, e o aviso de não-interpretado sai da frente", () => {
    render(<SitfisRelatorioTabela relatorio={relatorioCom([UM_PARCELAMENTO])} />);

    expect(screen.getAllByRole("columnheader").map((th) => th.textContent))
      .toEqual(["Parcelamento", "Parcelas em Atraso", "Valor em Atraso"]);
    expect(screen.getByText("0211.00012.0055566677.26-45")).toBeInTheDocument();
    expect(screen.getByText("1.585,74")).toBeInTheDocument();
    expect(screen.queryByText(/não foi interpretado como tabela/i)).toBeNull();
  });

  it("três parcelamentos: três linhas, cada número junto do SEU valor", () => {
    const { container } = render(<SitfisRelatorioTabela relatorio={relatorioCom([TRES_PARCELAMENTOS])} />);

    expect(container.querySelectorAll("tbody tr")).toHaveLength(3);
    const linhas = [...container.querySelectorAll("tbody tr")].map((tr) => [...tr.children].map((td) => td.textContent));
    expect(linhas).toEqual([
      ["0211.00012.0055566677.26-45", "37.067,11"],
      ["0211.00012.0088899900.25-31", "19.840,14"],
      ["0211.00012.0011122233.25-77", "76.377,88"],
    ]);
  });

  // ⚠ O QUE NÃO ENTROU NA TABELA CONTINUA NA TELA. "Parcelamento Simplificado" não tem rótulo no
  // relatório; inventar um ("Modalidade") seria fabricar cabeçalho de documento fiscal. Ela sai no
  // aviso, que é onde a ausência de leitura já mora.
  it("a linha sem rótulo não vira coluna — e também não some", () => {
    render(<SitfisRelatorioTabela relatorio={relatorioCom([UM_PARCELAMENTO])} />);

    expect(screen.getAllByRole("columnheader").map((th) => th.textContent)).not.toContain("Modalidade");
    expect(screen.getByText(/Não foi possível alinhar estas linhas/i)).toBeInTheDocument();
    expect(screen.getByText(/Parcelamento Simplificado/)).toBeInTheDocument();
  });

  // O valor do parcelamento é dinheiro e tem de ser lido como dinheiro — à direita, monoespaçado.
  it("as colunas de dinheiro do SIEFPAR são tratadas como dinheiro", () => {
    const { container } = render(<SitfisRelatorioTabela relatorio={relatorioCom([TRES_PARCELAMENTOS])} />);

    const celula = [...container.querySelectorAll("tbody td")].find((td) => td.textContent === "37.067,11");
    expect(celula.style.textAlign).toBe("right");
    expect(celula.style.fontFamily).toBe("monospace");
  });

  // ⚠ NÃO HÁ LINHA DE TOTAL AQUI, e isso é de propósito: o total da tela só existe para
  // `Sdo. Dev. Cons.` (o saldo consolidado do débito). Somar "Valor Suspenso" de três
  // parcelamentos diferentes produziria um número que o relatório não afirma em lugar nenhum.
  it("não inventa total para as colunas do parcelamento", () => {
    render(<SitfisRelatorioTabela relatorio={relatorioCom([TRES_PARCELAMENTOS])} />);

    expect(screen.queryByText(/^Total \(/)).toBeNull();
  });
});
