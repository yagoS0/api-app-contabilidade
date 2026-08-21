// A LIGAÇÃO — a regra já está travada em `lib/__tests__/relatorioFaturamento.test.js`.
//
// O que se cobre aqui é o painel dizendo na tela o que a lib decidiu: o número do portal separado
// do da Receita, a dimensão não apurada saindo como "não apurado" (e nunca como "Sem substituição
// tributária"), o alarme do não classificado vindo ANTES do total, as limitações no rodapé — e a
// impressão usando o mecanismo único do `App.css`, não um segundo inventado aqui.

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { RelatorioFaturamentoPanel } from "../RelatorioFaturamentoPanel";

const SEGREGACAO_INDETERMINADA = {
  codigo: "INDETERMINADA",
  rotuloOficial: null,
  rotuloCurto: "Segregação não apurada",
  motivo: "O portal não extrai ST nem tributação monofásica do XML.",
};
const QUALIFICACOES_NAO_APURADAS = {
  estado: "NAO_APURADO", codigos: [], rotulos: [],
  motivo: "O portal não extrai qualificação de receita do XML.",
};

function linha(over = {}) {
  return {
    notaId: "n1", itemId: "i1", tipoDocumento: "NFE", numero: "1001", serie: "1",
    data: "2026-06-10T12:00:00.000Z", modeloRotulo: "55",
    tomadorNome: "TOMADOR MOCK", descricao: "Mercadoria mock",
    codigoOperacao: "5102", codigoOperacaoFonte: "cfop",
    valorContabil: 1000, ...over,
  };
}

function relatorioFixture(over = {}) {
  const dados = {
    versao: 2,
    competencia: "2026-06",
    competenciaExtenso: "Junho/2026",
    titulo: "Faturamento no Período - Consolidado",
    subtitulo: "Documentos Emitidos",
    empresa: { razaoSocial: "CDA MARKETING LTDA", cnpj: "65.227.792/0001-00", municipio: "São Paulo", uf: "SP" },
    vocabulario: { fonte: "Manual do PGDAS-D e DEFIS (RFB)", avisoCodigos: "Os campos `codigo` são NOSSOS." },
    naoClassificado: { valorContabil: 500, itens: 1, fracaoDoTotal: 0.3333, comoResolver: "Aba Apuração → Sugestão → Classificar competência" },
    semDetalheCapturado: { valorContabil: 0, notas: 0, fracaoDoTotal: 0 },
    ausenciaDeNotas: { aplicavel: false },
    gruposPorTipoOperacao: [
      {
        chave: "REVENDA_MERCADORIA|INDETERMINADA",
        rotulo: "Revenda de mercadoria (Anexo I) · Segregação não apurada",
        tipoReceita: "REVENDA_MERCADORIA", classificado: true, temDetalhe: true,
        linhaAtividade: { origem: "TIPO_RECEITA_LOCAL", codigo: "REVENDA_MERCADORIA", rfb: { linha: 1, descricao: "Revenda de mercadorias, exceto para o exterior", completo: false, faltam: ["mercado", "segregacao"], linhasAlternativas: [2], fonte: "docs/segregacao-receitas-simples.md" } },
        segregacao: SEGREGACAO_INDETERMINADA,
        qualificacoes: QUALIFICACOES_NAO_APURADAS,
        linhas: [linha()],
        total: { itens: 1, valorContabil: 1000 },
      },
      {
        chave: "NAO_CLASSIFICADO",
        rotulo: "NÃO CLASSIFICADO — a competência não foi classificada",
        tipoReceita: null, classificado: false, temDetalhe: true,
        linhaAtividade: { origem: "TIPO_RECEITA_LOCAL", codigo: null, rfb: null },
        segregacao: null, qualificacoes: QUALIFICACOES_NAO_APURADAS,
        linhas: [linha({ notaId: "n2", itemId: "i2", numero: "1002", valorContabil: 500, motivoNaoClassificado: "item_sem_tipo_receita" })],
        total: { itens: 1, valorContabil: 500 },
      },
    ],
    totalMes: { itens: 2, valorContabil: 1500 },
    totalConsolidado: { itens: 2, valorContabil: 1500 },
    resumoPorTipoOperacao: [
      { chave: "REVENDA_MERCADORIA|INDETERMINADA", rotulo: "Revenda de mercadoria (Anexo I) · Segregação não apurada", classificado: true, segregacao: SEGREGACAO_INDETERMINADA, qualificacoes: QUALIFICACOES_NAO_APURADAS, itens: 1, valorContabil: 1000 },
      { chave: "NAO_CLASSIFICADO", rotulo: "NÃO CLASSIFICADO — a competência não foi classificada", classificado: false, segregacao: null, qualificacoes: QUALIFICACOES_NAO_APURADAS, itens: 1, valorContabil: 500 },
    ],
    conferencia: { totalRelatorio: 1500, faturamentoEmit: 1500, diferenca: 0, confere: true },
    preApurado: {
      origem: "MOTOR_LOCAL", ok: true, das: 120.5,
      rbt12: 480000,
      semClassificacao: { valorContabil: 500, itens: 1, fracaoDoTotal: 0.3333, totalDaCompetencia: 1500 },
      oficial: { fonte: "ApuracaoSnapshot", dasRetornadoSerpro: null, dasCalculadoLocalNoSnapshot: null },
      diferenca: null,
    },
    limitacoes: [
      { codigo: "VALOR_CONTABIL_SEM_DESCONTOS", titulo: "O valor contábil não tem os descontos de IPI, ST e ICMS-ST", efeito: "Não extraímos vIPI, vST nem vICMSST do XML hoje." },
    ],
    ...over,
  };
  return { id: "rel-1", competencia: "2026-06", geradoEm: "2026-07-02T10:30:00.000Z", dados };
}

describe("RelatorioFaturamentoPanel — sem relatório salvo", () => {
  it("⚠ não gera sozinho: mostra o vazio e o botão, e diz que gerar não chama ninguém de fora", () => {
    const onGerar = jest.fn();
    render(<RelatorioFaturamentoPanel relatorio={null} onGerar={onGerar} />);
    expect(screen.getByText(/Nenhum relatório salvo para esta competência/)).toBeInTheDocument();
    expect(screen.getByText(/não consulta ADN, SEFAZ nem SERPRO/)).toBeInTheDocument();
    expect(onGerar).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Gerar relatório/ }));
    expect(onGerar).toHaveBeenCalledTimes(1);
  });

  it("erro de leitura aparece — não vira 'não há relatório'", () => {
    render(<RelatorioFaturamentoPanel relatorio={null} erro="502 Bad Gateway" onGerar={() => {}} />);
    expect(screen.getByText(/não pôde ser carregado/)).toBeInTheDocument();
    expect(screen.getByText(/502 Bad Gateway/)).toBeInTheDocument();
  });
});

describe("RelatorioFaturamentoPanel — a forma do impresso", () => {
  it("cabeçalho, bloco por tipo de operação com total próprio, total do mês e consolidado", () => {
    render(<RelatorioFaturamentoPanel relatorio={relatorioFixture()} onGerar={() => {}} />);
    expect(screen.getAllByText(/Faturamento no Período - Consolidado/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/CDA MARKETING LTDA/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/65\.227\.792\/0001-00/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Junho\/2026/).length).toBeGreaterThan(0);
    // um bloco por tipo de operação, cada um com o seu total
    expect(screen.getAllByText(/Revenda de mercadoria \(Anexo I\)/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Total do mês:/)).toBeInTheDocument();
    expect(screen.getByText(/Total consolidado:/)).toBeInTheDocument();
    // quadro-resumo no rodapé
    expect(screen.getByText("Resumo por tipo de operação")).toBeInTheDocument();
  });

  it("⚠ o alarme do NÃO CLASSIFICADO sai com valor e fração, e o grupo dele continua existindo", () => {
    render(<RelatorioFaturamentoPanel relatorio={relatorioFixture()} onGerar={() => {}} />);
    expect(screen.getByText("Há receita sem classificação nesta competência")).toBeInTheDocument();
    expect(screen.getByText(/33,3% do total do mês/)).toBeInTheDocument();
    expect(screen.getAllByText(/NÃO CLASSIFICADO/).length).toBeGreaterThan(0);
  });

  it("⚠ INDETERMINADA nunca vira 'Sem substituição tributária' na tela", () => {
    render(<RelatorioFaturamentoPanel relatorio={relatorioFixture()} onGerar={() => {}} />);
    expect(screen.getAllByText("Segregação não apurada").length).toBeGreaterThan(0);
    expect(screen.queryByText(/^Sem substituição tributária/)).not.toBeInTheDocument();
    // e a qualificação não apurada também é dita, não omitida
    expect(screen.getAllByText("Não apurado").length).toBeGreaterThan(0);
  });

  it("⚠ a linha da RFB aparece como POSSIBILIDADE, nunca como resolvida", () => {
    render(<RelatorioFaturamentoPanel relatorio={relatorioFixture()} onGerar={() => {}} />);
    expect(screen.getByText(/pode ser a 1 \(ou 2\)/)).toBeInTheDocument();
  });

  it("as limitações são nota de rodapé, com a fonte do vocabulário", () => {
    render(<RelatorioFaturamentoPanel relatorio={relatorioFixture()} onGerar={() => {}} />);
    // ⚠ O rótulo passou a contar quantas são ("… NÃO afirma (2)"): o bloco recolhe na tela, e um
    // recolhimento sem número é indistinguível de um sumiço. O CONTEÚDO continua no DOM — é isso
    // que faz o `@media print` conseguir abri-lo no papel, onde a ressalva é obrigatória.
    expect(screen.getByText(/O que este relatório NÃO afirma/)).toBeInTheDocument();
    expect(screen.getAllByText(/O valor contábil não tem os descontos/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Manual do PGDAS-D e DEFIS \(RFB\)/)).toBeInTheDocument();
  });
});

describe("RelatorioFaturamentoPanel — procedência do DAS", () => {
  it("motor local sozinho: rotulado como cálculo do portal, e sem coluna de diferença", () => {
    render(<RelatorioFaturamentoPanel relatorio={relatorioFixture()} onGerar={() => {}} />);
    expect(screen.getByText(/cálculo nosso, não é o da Receita/)).toBeInTheDocument();
    expect(screen.getByText(/Nenhum valor oficial gravado/)).toBeInTheDocument();
    expect(screen.queryByText(/Diferença \(portal − Receita\)/)).not.toBeInTheDocument();
  });

  it("com o oficial do SERPRO: os dois lado a lado, com a diferença", () => {
    const rel = relatorioFixture();
    rel.dados.preApurado.oficial.dasRetornadoSerpro = 130;
    render(<RelatorioFaturamentoPanel relatorio={rel} onGerar={() => {}} />);
    expect(screen.getByText(/DAS oficial devolvido pela Receita/)).toBeInTheDocument();
    expect(screen.getByText(/Diferença \(portal − Receita\)/)).toBeInTheDocument();
  });

  it("⚠ coluna ambígua: a tela diz que não sabe de quem é, e não mostra diferença", () => {
    const rel = relatorioFixture();
    rel.dados.preApurado.oficial.dasCalculadoLocalNoSnapshot = {
      valor: 118, procedenciaAmbigua: true, aviso: "Coluna gravada por dois caminhos.",
    };
    render(<RelatorioFaturamentoPanel relatorio={rel} onGerar={() => {}} />);
    expect(screen.getByText(/procedência ambígua/i)).toBeInTheDocument();
    expect(screen.getByText(/Coluna gravada por dois caminhos/)).toBeInTheDocument();
    expect(screen.queryByText(/Diferença \(portal − Receita\)/)).not.toBeInTheDocument();
  });

  it("⚠ recusa do motor NÃO é erro: motivo nomeado + tamanho do buraco + como resolver", () => {
    const rel = relatorioFixture();
    rel.dados.preApurado = {
      origem: "MOTOR_LOCAL", ok: false, das: null, estado: "bloqueada_pendencias",
      motivo: { code: "RECEITA_NAO_CLASSIFICADA", mensagem: "A receita da competência não está classificada" },
      semClassificacao: { valorContabil: 1500, itens: 2, fracaoDoTotal: 1, totalDaCompetencia: 1500 },
      comoResolver: "Aba Apuração → Sugestão → Classificar competência",
      oficial: { dasRetornadoSerpro: null, dasCalculadoLocalNoSnapshot: null },
    };
    render(<RelatorioFaturamentoPanel relatorio={rel} onGerar={() => {}} />);
    expect(screen.getByText("O portal não calculou o DAS desta competência")).toBeInTheDocument();
    expect(screen.getByText(/A receita da competência não está classificada/)).toBeInTheDocument();
    expect(screen.getByText(/2 itens/)).toBeInTheDocument();
    expect(screen.getByText(/100% do total da competência/)).toBeInTheDocument();
    // ⚠ "não calculado", nunca R$ 0,00 — zero afirmaria que o DAS do mês é zero.
    expect(screen.getByText("não calculado")).toBeInTheDocument();
  });
});

describe("RelatorioFaturamentoPanel — a conferência e a ausência", () => {
  it("⚠ conferência que não fecha é o relatório acusando a si mesmo — aparece", () => {
    const rel = relatorioFixture({ conferencia: { totalRelatorio: 1500, faturamentoEmit: 1250, diferenca: 250, confere: false } });
    render(<RelatorioFaturamentoPanel relatorio={rel} onGerar={() => {}} />);
    expect(screen.getByText(/não bate com o faturamento da competência/)).toBeInTheDocument();
  });

  it("⚠ zero sem confirmação: o texto do backend aparece inteiro, e não em verde", () => {
    const msg = "Nenhuma nota encontrada — isto NÃO é o mesmo que ausência de receita.";
    const rel = relatorioFixture({
      gruposPorTipoOperacao: [], resumoPorTipoOperacao: [],
      totalMes: { itens: 0, valorContabil: 0 }, totalConsolidado: { itens: 0, valorContabil: 0 },
      naoClassificado: { valorContabil: 0, itens: 0, fracaoDoTotal: 0 },
      ausenciaDeNotas: { aplicavel: true, podeAfirmarAusencia: false, mensagem: msg },
      conferencia: { totalRelatorio: 0, faturamentoEmit: 0, diferenca: 0, confere: true },
    });
    render(<RelatorioFaturamentoPanel relatorio={rel} onGerar={() => {}} />);
    expect(screen.getByText(/não prova ausência de receita/)).toBeInTheDocument();
    expect(screen.getByText(msg)).toBeInTheDocument();
  });
});

describe("RelatorioFaturamentoPanel — impressão", () => {
  const printOriginal = window.print;
  beforeEach(() => { window.print = jest.fn(); });
  afterEach(() => { window.print = printOriginal; document.body.classList.remove("imprimindo"); });

  it("⚠ reusa o mecanismo único: body.imprimindo + data-print-area + cabeçalho só-no-papel", async () => {
    const { container } = render(<RelatorioFaturamentoPanel relatorio={relatorioFixture()} onGerar={() => {}} />);
    expect(container.querySelector("[data-print-area]")).toBeTruthy();
    // O cabeçalho de papel leva razão, CNPJ, competência, data/hora E os avisos de escopo.
    const soPapel = container.querySelector("[data-print-only]");
    expect(soPapel).toBeTruthy();
    expect(soPapel.textContent).toMatch(/CDA MARKETING LTDA/);
    expect(soPapel.textContent).toMatch(/65\.227\.792\/0001-00/);
    expect(soPapel.textContent).toMatch(/Junho\/2026/);
    expect(soPapel.textContent).toMatch(/Escopo:/);
    expect(soPapel.textContent).toMatch(/cálculo do portal para/);
    // ⚠ as limitações saem IMPRESSAS, não só na tela
    expect(soPapel.textContent).toMatch(/O valor contábil não tem os descontos/);
    // As tabelas largas são marcadas para o papel não cortá-las na primeira página.
    expect(container.querySelectorAll("[data-print-tabela]").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /Imprimir/ }));
    await waitFor(() => expect(document.body.classList.contains("imprimindo")).toBe(true));
    await waitFor(() => expect(window.print).toHaveBeenCalled());
  });

  it("⚠⚠ o <details> das limitações vai ABERTO para o papel — e volta a fechar depois", async () => {
    // ⚠ ISTO EXISTE PORQUE A PRIMEIRA TENTATIVA FOI UM NO-OP. Era só uma regra `@media print`
    // mandando `display: revert` nos filhos do <details>; medido no navegador, o Chrome não
    // esconde o conteúdo por `display` — ele usa `content-visibility: hidden` no pseudo
    // `::details-content`. As ressalvas simplesmente não sairiam impressas, e o relatório
    // circularia sem o que impede que ele seja lido como apuração.
    //
    // O jsdom não implementa nem o pseudo nem a mídia de impressão, então o que se mede aqui é a
    // única coisa que dá para garantir dos dois lados: o atributo `open`.
    const { container } = render(<RelatorioFaturamentoPanel relatorio={relatorioFixture()} onGerar={() => {}} />);
    const bloco = container.querySelector("[data-print-area] details");
    expect(bloco).toBeTruthy();
    expect(bloco.open).toBe(false); // na TELA ele nasce recolhido

    fireEvent.click(screen.getByRole("button", { name: /Imprimir/ }));
    await waitFor(() => expect(window.print).toHaveBeenCalled());
    // ⚠ aberto ANTES de `window.print()` — depois seria tarde.
    expect(bloco.open).toBe(true);

    // E o que estava fechado na tela volta a fechar quando a impressão termina.
    fireEvent(window, new Event("afterprint"));
    await waitFor(() => expect(bloco.open).toBe(false));
  });

  it("⚠ `imprimivel={false}` não marca área de impressão — só pode haver UMA por página", () => {
    const { container } = render(<RelatorioFaturamentoPanel relatorio={relatorioFixture()} imprimivel={false} onGerar={() => {}} />);
    expect(container.querySelector("[data-print-area]")).toBeNull();
    expect(screen.queryByRole("button", { name: /Imprimir/ })).not.toBeInTheDocument();
  });
});
