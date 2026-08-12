// O RELATÓRIO APARECE AO CALCULAR — e não pode custar nada ao Calcular.
//
// O pedido do dono: *"deve ser exibido esse relatorio ao calcularmos e ele deve ser salvo"*. A
// decisão foi GERAR (POST) logo depois do cálculo, e não apenas exibir a foto salva: na primeira
// apuração da competência não existe foto nenhuma, e nas seguintes apareceria a de ANTES do que se
// acabou de conferir. O POST é leitura do nosso banco — não chama ADN/SEFAZ/SERPRO e roda o motor
// local com `persistir: false`, sem gravar `ApuracaoSnapshot`.
//
// ⚠ O QUE ESTE ARQUIVO TRAVA é a outra metade: a geração fica FORA do caminho do Calcular. Se ela
// falhar, o cálculo continua valendo, o sucesso já foi notificado, e a tela diz que o relatório não
// saiu — com o botão para tentar de novo.

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FechamentoModal } from "../FechamentoModal.jsx";

const ATIVIDADE = {
  idAtividade: 1, descricao: "Revenda de mercadorias", anexoImplicito: "I",
  mercado: "INTERNO", sujeitoFatorR: false, valorInterno: 9000, valorExterno: 0,
};

const RELATORIO = {
  id: "rel-1", competencia: "2026-06", geradoEm: "2026-07-02T10:30:00.000Z",
  dados: {
    competencia: "2026-06", competenciaExtenso: "Junho/2026",
    titulo: "Faturamento no Período - Consolidado", subtitulo: "Documentos Emitidos",
    empresa: { razaoSocial: "CDA MARKETING LTDA", cnpj: "65.227.792/0001-00" },
    vocabulario: { fonte: "Manual do PGDAS-D e DEFIS (RFB)", avisoCodigos: "codigos nossos" },
    naoClassificado: { valorContabil: 0, itens: 0, fracaoDoTotal: 0 },
    semDetalheCapturado: { valorContabil: 0, notas: 0, fracaoDoTotal: 0 },
    ausenciaDeNotas: { aplicavel: false },
    gruposPorTipoOperacao: [{
      chave: "REVENDA_MERCADORIA", rotulo: "Revenda de mercadoria (Anexo I)",
      tipoReceita: "REVENDA_MERCADORIA", classificado: true, temDetalhe: true,
      linhaAtividade: { rfb: null }, segregacao: null,
      qualificacoes: { estado: "NAO_APURADO", codigos: [], rotulos: [] },
      linhas: [{ notaId: "n1", itemId: "i1", numero: "1001", modeloRotulo: "55", data: "2026-06-10T12:00:00.000Z", tomadorNome: "T", descricao: "Mercadoria", codigoOperacao: "5102", codigoOperacaoFonte: "cfop", valorContabil: 9000 }],
      total: { itens: 1, valorContabil: 9000 },
    }],
    totalMes: { itens: 1, valorContabil: 9000 },
    totalConsolidado: { itens: 1, valorContabil: 9000 },
    resumoPorTipoOperacao: [],
    conferencia: { totalRelatorio: 9000, faturamentoEmit: 9000, diferenca: 0, confere: true },
    preApurado: { origem: "MOTOR_LOCAL", ok: true, das: 700, oficial: {}, diferenca: null },
    limitacoes: [],
  },
};

function dadosBase(over = {}) {
  return {
    razao: "CDA MARKETING LTDA", cnpj: "65.227.792/0001-00",
    regimeApuracao: "COMPETENCIA", cadastroCompleto: true,
    faturamento: { interno: 9000, externo: 0, total: 9000 },
    semMovimentoDisponivel: false, empresaZerada: false, semFaturamento: false,
    entregaPgdas: {}, disparidades: [], rbt12: 480000, estado: "aberta",
    atividades: [ATIVIDADE], origemAtividades: "memoria(2026-05-31)",
    prefillValor: { total: 9000, indefinido: false, mercadoAplicado: "INTERNO", origem: "faturamento_da_competencia" },
    ...over,
  };
}

function montar(apiOver = {}) {
  const calcularFechamento = jest.fn(async () => ({ ok: true, result: { dasValor: 712.34, rbt12: 480000, mensagens: [] } }));
  const gerarRelatorioFaturamento = jest.fn(async () => ({ ok: true, relatorio: RELATORIO }));
  const feedback = { notifySuccess: jest.fn(), notifyError: jest.fn() };
  const api = {
    getFechamento: jest.fn(async () => ({ ok: true, dados: dadosBase() })),
    listAtividadesPgdasd: jest.fn(async () => ({ ok: true, atividades: [] })),
    calcularFechamento,
    gerarRelatorioFaturamento,
    ...apiOver,
  };
  render(
    <FechamentoModal
      api={api} feedback={feedback} portalClientId="p1" competencia="2026-06"
      razao="CDA MARKETING LTDA" onClose={() => {}} onChanged={() => {}}
    />,
  );
  return { api, calcularFechamento, gerarRelatorioFaturamento, feedback };
}

async function clicarCalcular() {
  const btn = await screen.findByRole("button", { name: /Calcular/ });
  fireEvent.click(btn);
}

describe("FechamentoModal — o relatório ao calcular", () => {
  it("não aparece antes do Calcular — painel vazio no topo roubaria a atenção da tela", async () => {
    const { gerarRelatorioFaturamento } = montar();
    await screen.findByRole("button", { name: /Calcular/ });
    expect(screen.queryByText(/Relatório de faturamento/)).not.toBeInTheDocument();
    expect(gerarRelatorioFaturamento).not.toHaveBeenCalled();
  });

  it("depois do Calcular: gera, salva e mostra o relatório da MESMA competência", async () => {
    const { gerarRelatorioFaturamento, feedback } = montar();
    await clicarCalcular();

    await waitFor(() => expect(gerarRelatorioFaturamento).toHaveBeenCalledWith("p1", "2026-06"));
    // O cálculo continua sendo o ato principal: o sucesso dele é notificado.
    expect(feedback.notifySuccess).toHaveBeenCalledWith(expect.stringMatching(/DAS calculado/));
    // O título sai duas vezes de propósito: na tela e no cabeçalho só-no-papel.
    expect((await screen.findAllByText(/Faturamento no Período - Consolidado/)).length).toBeGreaterThan(0);
    expect(screen.getByText(/Total do mês:/)).toBeInTheDocument();
  });

  it("⚠ o relatório é chamado DEPOIS do cálculo — o Calcular não espera por ele para liberar a tela", async () => {
    const ordem = [];
    const calcularFechamento = jest.fn(async () => { ordem.push("calcular"); return { ok: true, result: { dasValor: 1 } }; });
    const gerarRelatorioFaturamento = jest.fn(async () => { ordem.push("relatorio"); return { ok: true, relatorio: RELATORIO }; });
    montar({ calcularFechamento, gerarRelatorioFaturamento });
    await clicarCalcular();
    await waitFor(() => expect(ordem).toEqual(["calcular", "relatorio"]));
  });

  it("⚠ relatório que FALHA não derruba o Calcular: o resultado fica, e a tela diz que o relatório não saiu", async () => {
    const gerarRelatorioFaturamento = jest.fn(async () => { throw new Error("timeout ao montar o relatório"); });
    const { feedback } = montar({ gerarRelatorioFaturamento });
    await clicarCalcular();

    // O DAS calculado continua na tela e o sucesso continua notificado…
    expect(await screen.findByText(/DAS calculado \(oficial SERPRO\)/)).toBeInTheDocument();
    expect(feedback.notifySuccess).toHaveBeenCalledWith(expect.stringMatching(/DAS calculado/));
    expect(feedback.notifyError).not.toHaveBeenCalled();
    // …e a falha do relatório aparece nomeada, com o caminho de tentar de novo.
    expect(await screen.findByText(/não pôde ser carregado/)).toBeInTheDocument();
    expect(screen.getByText(/timeout ao montar o relatório/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Gerar relatório/ })).toBeInTheDocument();
  });

  it("⚠ backend sem a rota (`ok:false`) também é falha nomeada, não silêncio", async () => {
    const gerarRelatorioFaturamento = jest.fn(async () => ({ ok: false, error: "relatorio_gerar_failed", message: "Empresa não encontrada" }));
    montar({ gerarRelatorioFaturamento });
    await clicarCalcular();
    expect(await screen.findByText(/Empresa não encontrada/)).toBeInTheDocument();
  });

  it("api sem `gerarRelatorioFaturamento` não quebra o Calcular", async () => {
    const { feedback } = montar({ gerarRelatorioFaturamento: undefined });
    await clicarCalcular();
    expect(await screen.findByText(/DAS calculado \(oficial SERPRO\)/)).toBeInTheDocument();
    expect(feedback.notifyError).not.toHaveBeenCalled();
  });
});
