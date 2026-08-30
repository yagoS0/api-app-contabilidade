// O QUE A LEITURA POSICIONAL TROUXE PARA A TELA — e o que ela NÃO pode ter trazido junto.
//
// O bloco de dívida ativa (SIDA) saía como linhas cruas: o dono viu, na aba Situação Fiscal,
// *"Não conseguimos alinhar estas linhas em colunas"* seguido de `Inscrito em · Ajuizado em ·
// Processo · Tipo de Devedor · 70.2.26.028625-81 · 3551-IRPJ · …` numa fila só. Lido pela
// GEOMETRIA do PDF, ele chega com colunas e registros.
//
// ⚠ E veio junto um risco que este arquivo existe para travar: `anotacoes` deixou de ser sempre
// "Notificação de lançamento". A leitura posicional lê QUALQUER par `Rótulo: valor`, e o primeiro
// que ela trouxe foi `Situação:`. Com o rótulo fixo de antes, a tela diria "Notificação de
// lançamento: ATIVA A SER COBRADA" — rótulo FALSO sobre dado fiscal.
//
// ⚠ Os dados aqui são FABRICADOS: formato, pontuação e comprimento imitam o relatório real; o
// número da inscrição, o processo e o CNPJ são inventados — fixture entra no histórico do git
// para sempre. (`3551-IRPJ` e `8109-02 - PIS` são códigos de receita, tabela pública.)

import { render, screen } from "@testing-library/react";
import { SitfisRelatorioTabela, anotacoesComRotulo } from "../SitfisRelatorioTabela.jsx";

const COLUNAS_SIDA = ["Inscrição", "Receita", "Inscrito em", "Ajuizado em", "Processo", "Tipo de Devedor"];

const SIDA_TABULADO = {
  titulo: "Pendência - Inscrição (SIDA)",
  descricao: [],
  colunas: COLUNAS_SIDA,
  registros: [
    {
      "Inscrição": "70.2.26.028625-81", "Receita": "3551-IRPJ", "Inscrito em": "20/07/2026",
      "Ajuizado em": "", "Processo": "14966.621.428/2026-34", "Tipo de Devedor": "DEVEDOR PRINCIPAL",
    },
    {
      "Inscrição": "70.2.26.028626-62", "Receita": "8109-02 - PIS", "Inscrito em": "20/07/2026",
      "Ajuizado em": "", "Processo": "14966.621.429/2026-89", "Tipo de Devedor": "DEVEDOR PRINCIPAL",
    },
  ],
  anotacoes: ["ATIVA A SER COBRADA", "NEGOCIADA NO SISPAR"],
  anotacoesPorRegistro: [
    { "Situação": "ATIVA A SER COBRADA" },
    { "Situação": "NEGOCIADA NO SISPAR" },
  ],
  naoInterpretado: [],
};

function relatorioCom(blocos) {
  return {
    emitidoEm: "23/08/2026 09:12:03",
    contribuinte: { cnpj: "91.888.222/0001-63", nome: "EMPRESA FABRICADA LTDA" },
    diagnosticos: [
      { orgao: "Receita Federal", chave: "RFB", semPendencia: true, blocos: [] },
      { orgao: "Procuradoria-Geral da Fazenda Nacional", chave: "PGFN", semPendencia: false, blocos },
    ],
    naoInterpretado: [],
    temTexto: true,
  };
}

describe("o bloco SIDA vira tabela — é o que o dono passa a ver", () => {
  it("as SEIS colunas do relatório aparecem como cabeçalho", () => {
    render(<SitfisRelatorioTabela relatorio={relatorioCom([SIDA_TABULADO])} />);
    expect(screen.getAllByRole("columnheader").map((th) => th.textContent)).toEqual(COLUNAS_SIDA);
  });

  it("cada inscrição é uma LINHA, com o processo na coluna do processo", () => {
    const { container } = render(<SitfisRelatorioTabela relatorio={relatorioCom([SIDA_TABULADO])} />);
    const linhas = [...container.querySelectorAll("tbody tr")].map((tr) => [...tr.children].map((td) => td.textContent));
    expect(linhas).toEqual([
      ["70.2.26.028625-81", "3551-IRPJ", "20/07/2026", "—", "14966.621.428/2026-34", "DEVEDOR PRINCIPAL"],
      ["70.2.26.028626-62", "8109-02 - PIS", "20/07/2026", "—", "14966.621.429/2026-89", "DEVEDOR PRINCIPAL"],
    ]);
  });

  it("⚠ o aviso de 'não conseguimos alinhar' sai da frente quando o bloco foi lido", () => {
    render(<SitfisRelatorioTabela relatorio={relatorioCom([SIDA_TABULADO])} />);
    expect(screen.queryByText(/Não foi possível alinhar estas linhas/i)).toBeNull();
    expect(screen.queryByText(/não foi interpretado como tabela/i)).toBeNull();
  });

  it("⚠ NÃO inventa total: somar inscrições em dívida ativa não é número que o relatório afirme", () => {
    render(<SitfisRelatorioTabela relatorio={relatorioCom([SIDA_TABULADO])} />);
    expect(screen.queryByText(/^Total \(/)).toBeNull();
  });
});

describe("⚠⚠ O RÓTULO DA ANOTAÇÃO É O QUE O PDF IMPRIME", () => {
  it("a situação da inscrição sai como `Situação:`, nunca como notificação de lançamento", () => {
    render(<SitfisRelatorioTabela relatorio={relatorioCom([SIDA_TABULADO])} />);
    expect(screen.getByText(/Situação: ATIVA A SER COBRADA · NEGOCIADA NO SISPAR/)).toBeInTheDocument();
    expect(screen.queryByText(/Notificação de lançamento/i)).toBeNull();
  });

  it("sem rótulo por registro (parser de TEXTO), a tela fica exatamente como estava", () => {
    const doTexto = { ...SIDA_TABULADO, anotacoes: ["91888222202601001"], anotacoesPorRegistro: [] };
    render(<SitfisRelatorioTabela relatorio={relatorioCom([doTexto])} />);
    expect(screen.getByText(/Notificação de lançamento: 91888222202601001/)).toBeInTheDocument();
  });

  it("rótulos diferentes viram linhas diferentes — nada é fundido sob um rótulo só", () => {
    const dois = {
      ...SIDA_TABULADO,
      anotacoes: ["ATIVA A SER COBRADA", "91888222202601001"],
      anotacoesPorRegistro: [
        { "Situação": "ATIVA A SER COBRADA" },
        { "Notificação de lançamento": "91888222202601001" },
      ],
    };
    render(<SitfisRelatorioTabela relatorio={relatorioCom([dois])} />);
    expect(screen.getByText("Situação: ATIVA A SER COBRADA")).toBeInTheDocument();
    expect(screen.getByText("Notificação de lançamento: 91888222202601001")).toBeInTheDocument();
  });

  it("⚠ rótulo que NÃO cobre todas as anotações não rotula nada — não se inventa e não se esconde", () => {
    const sobrando = {
      ...SIDA_TABULADO,
      anotacoes: ["ATIVA A SER COBRADA", "AJUIZADA"],
      anotacoesPorRegistro: [{ "Situação": "ATIVA A SER COBRADA" }],
    };
    render(<SitfisRelatorioTabela relatorio={relatorioCom([sobrando])} />);
    // volta ao rótulo de hoje, com as DUAS anotações visíveis
    expect(screen.getByText(/Notificação de lançamento: ATIVA A SER COBRADA · AJUIZADA/)).toBeInTheDocument();
  });

  it("a regra pura recusa quando os valores não batem, e agrupa quando batem", () => {
    expect(anotacoesComRotulo(["A"], [])).toBeNull();
    expect(anotacoesComRotulo(["A", "B"], [{ x: "A" }])).toBeNull();
    expect(anotacoesComRotulo(["A", "B"], [{ x: "A" }, { x: "C" }])).toBeNull();
    expect(anotacoesComRotulo(["A", "B"], [{ x: "A" }, { x: "B" }]))
      .toEqual([{ rotulo: "x", valores: ["A", "B"] }]);
  });
});

describe("⚠⚠ O MODO DE FALHAR CONTINUA SENDO LINHAS CRUAS — agora NOMEANDO O MOTIVO", () => {
  const RECUSADO = {
    titulo: "Pendência - Inscrição (SIDA)",
    descricao: [],
    colunas: [],
    registros: [],
    anotacoes: [],
    anotacoesPorRegistro: [],
    naoInterpretado: ["70.2.26.028625-81 3551-IRPJ 20/07/2026", "Situação: ATIVA A SER COBRADA"],
    aviso: "bloco não conferido pela geometria: as colunas 'Processo' e 'Tipo de Devedor' se sobrepõem em x",
  };

  it("⚠⚠ nenhuma linha crua aparece — nem uma", () => {
    const { container } = render(<SitfisRelatorioTabela relatorio={relatorioCom([RECUSADO])} />);
    for (const linha of RECUSADO.naoInterpretado) {
      expect(container.textContent).not.toContain(linha);
    }
  });

  it("⚠ e nenhuma MARCA sobra no lugar — o dono escolheu 'sem marca nenhuma'", () => {
    // Meia remoção seria pior que nenhuma: uma caixa vazia, ou um título sem conteúdo, é ruído que
    // não diz nada e ainda ocupa a tela que a remoção existe para limpar.
    const { container } = render(<SitfisRelatorioTabela relatorio={relatorioCom([RECUSADO])} />);
    expect(container.textContent).not.toMatch(/Não foi possível alinhar estas linhas/i);
    expect(container.textContent).not.toMatch(/confira no PDF oficial/i);
  });

  it("⚠ o MOTIVO da recusa também não aparece — ele era a legenda daquele bloco", () => {
    const { container } = render(<SitfisRelatorioTabela relatorio={relatorioCom([RECUSADO])} />);
    expect(container.textContent).not.toMatch(/se sobrepõem em x/);
  });

  it("⚠⚠ e o resto do relatório continua inteiro — a remoção é DAQUELE bloco, não da tela", () => {
    // O modo de falhar caro desta mudança seria levar junto os blocos que VIRARAM tabela.
    const { container } = render(<SitfisRelatorioTabela relatorio={relatorioCom([RECUSADO])} />);
    expect(container.textContent).toContain(RECUSADO.titulo);
  });


  it("⚠ recusa NÃO vira tabela em hipótese nenhuma", () => {
    const { container } = render(<SitfisRelatorioTabela relatorio={relatorioCom([RECUSADO])} />);
    expect(container.querySelector("table")).toBeNull();
  });
});
