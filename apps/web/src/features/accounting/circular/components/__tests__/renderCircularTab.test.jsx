// A CIRCULAR NA TELA — o que a regra decide e o componente precisa mostrar.
//
// ⚠ Esta suíte nunca tinha rodado: quebrava em tempo de PARSE no `import.meta.env` de
// `src/api/client.js` (ver `apps/web/babel.config.js`), e "1 failed" virou paisagem. O que ela
// descrevia era o painel "Operações Fiscais" e o histórico de execuções — removidos na Q7.2
// (as ações moraram para as abas Guias/Configurações). Teste verde sobre uma tela que não existe
// mais é pior que teste nenhum, então foram substituídos pelo que a aba faz hoje: popover da
// célula, vencida × a vencer e desfazer baixa.
//
// A REGRA em si (estadoDaGuia/aparenciaDaGuia/totaisEmAberto) tem cobertura própria em
// `../../lib/__tests__/estadoGuia.test.js`. Aqui se testa a LIGAÇÃO: que a cor da célula, o chip do
// popover e o rodapé saem da mesma leitura, e que a tela não contradiz a regra.
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { CircularTab } from "../renderCircularTab.jsx";
import { MemoryRouter } from "react-router-dom";
import { informacaoRecalculo } from "../../../components/RecalculoGuiaAviso";

jest.mock("../../../baixa/components/renderBaixaModal", () => ({
  BaixaModal: ({ entry }) => <div data-testid="baixa-aberta">{entry.id}</div>,
}));

// ⚠⚠ AS ASSERÇÕES SÃO O TOKEN, NÃO O HEX — e elas eram o hex até 24/08/2026, com o comentário ao
// lado já dizendo qual token era a intenção (`// var(--danger)`). O código tinha o literal
// `#FF4757` cravado, então o teste travou o literal e a intenção ficou só no comentário.
//
// ⚠ Isso não era neutro: `#FF4757` **não é** `--danger` (`#FF5757`), é um vizinho de um dígito, e
// mede **4,27:1 sobre `--bg-subtle`** — reprovado no mínimo de 4,5:1 da WCAG AA, justamente na
// linha em hover. O token mede 4,58:1. Trocar o literal pelo token conserta o contraste; travar o
// literal no teste era o que mantinha o defeito no lugar.
//
// ⚠ `jsdom` NÃO resolve `var(--…)`: ele devolve a string como está, e é ela que se compara. É o
// mesmo motivo pelo qual `--state-warn` continua sendo comparado por `rgb()` abaixo — aquele valor
// não foi trocado, então o literal ainda é o que está no DOM.
const VERMELHO = "var(--danger)";      // vencida
const AMBAR = "rgb(255, 179, 71)";     // #FFB347 — a vencer / em aberto sem data (ainda literal)
const VERDE = "var(--success)";        // paga

// Meio-dia LOCAL de N dias a partir de hoje. O horário importa: a data crua "2026-03-20" seria
// parseada como UTC e viraria o dia 19 em qualquer fuso a oeste — o teste passaria a depender da
// máquina. E são datas RELATIVAS, não fixas, porque `aparenciaDaGuia` lê o relógio de verdade.
function emDias(n) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return d.toISOString();
}

const HOJE = new Date();
const ANO = HOJE.getFullYear();
const COMP = `${ANO}-${String(HOJE.getMonth() + 1).padStart(2, "0")}`;

test.each(['ABERTO', 'PARCIAL', 'PAGO'])('SERPRO e baixa são estados separados para PIS %s sem flag legada', (statusPagamento) => {
  renderTab([provisao({ subtipo: 'PIS', statusPagamento,
    sourceGuide: guia({ paymentStatus: 'PAID', paymentStatusSource: 'SERPRO' }),
  })], { companyRegime: 'LUCRO_PRESUMIDO' });
  expect(screen.getByText('SERPRO')).toBeInTheDocument();
  expect(screen.getByText(statusPagamento === 'PAGO' ? 'Baixada' : statusPagamento === 'PARCIAL' ? 'Conferir baixa' : 'Baixa pendente')).toBeInTheDocument();
});

test.each([['100', 100], [100.001, 100], [0, 0]])('não mostra recálculo com valores iguais em centavos %s/%s', (antes, depois) => {
  expect(informacaoRecalculo({ recalculatedAt: '2026-10-01', recalculatedFromValor: antes, recalculatedToValor: depois })).toBeNull();
});

test('recálculo real permanece nos detalhes, inclusive quando reduz o valor', () => {
  expect(informacaoRecalculo({ recalculatedAt: '2026-10-01', recalculatedFromValor: 200, recalculatedToValor: 100 })).toMatchObject({ atual: expect.stringContaining('100,00') });
});

test.each(["Lucro Presumido", "PRESUMIDO", "LUCRO_PRESUMIDO"])("regime %s mantém PIS e COFINS acessíveis no fechamento", (companyRegime) => {
  renderTab([provisao({ id: "pis", subtipo: "PIS", valor: 150 }), provisao({ id: "cofins", subtipo: "COFINS", valor: 300 })], { companyRegime });
  expect(screen.getByRole("columnheader", { name: "PIS" })).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "COFINS" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /R\$ 150,00/ }));
  fireEvent.click(screen.getByRole("button", { name: "Dar baixa" }));
  expect(screen.getByTestId("baixa-aberta")).toHaveTextContent("pis");
});

test("lançamento fora das colunas também permite baixar sem editar a provisão", () => {
  renderTab([provisao({ id: "pis-legado", subtipo: "PIS_COFINS", valor: 150 })]);
  fireEvent.click(screen.getByRole("button", { name: "R$ 150,00" }));
  fireEvent.click(screen.getByRole("button", { name: "Dar baixa" }));
  expect(screen.getByTestId("baixa-aberta")).toHaveTextContent("pis-legado");
});

test("editar baixa de IRPJ abre o pagamento e preserva a edição separada da provisão", () => {
  renderTab([provisao({ id: "irpj", tipo: "PROVISAO", subtipo: "IRPJ", valor: 150, statusPagamento: "PAGO",
    baixas: [{ id: "b-irpj", tipo: "BAIXA", historico: "PAGAMENTO IRPJ", lines: [{ tipo: "D", conta: "250", valor: 150 }, { tipo: "C", conta: "5", valor: 150 }] }] })], { companyRegime: "LUCRO_PRESUMIDO" });
  fireEvent.click(screen.getByRole("button", { name: /R\$ 150,00/ }));
  expect(screen.getByRole("button", { name: "✎ Editar provisão" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Editar baixa 1/ }));
  expect(screen.getByLabelText("Tipo")).toHaveValue("BAIXA");
});

function guia(over = {}) {
  return { id: "g1", tipo: "DAS", envios: [], ...over };
}

test('confirmação do WhatsApp aparece com data e mantém a baixa como ação do contador', () => {
  const onCreateBaixa = jest.fn();
  renderTab([provisao({ pagamentoLocalizado: true, sourceGuide: guia({ paymentStatus: 'PAID', paymentStatusSource: 'CLIENTE', paymentConfirmedAt: '2026-10-09T00:00:00.000Z' }) })], { onCreateBaixa });
  expect(screen.getByText('Cliente')).toBeInTheDocument();
  abrirCelula('R$ 1.234,56');
  expect(screen.getByText('Pagamento informado pelo cliente')).toBeInTheDocument();
  expect(screen.getByText('09/10/2026')).toBeInTheDocument();
  expect(screen.getByText('Falta lançar a baixa')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Dar baixa' })).toBeInTheDocument();
  expect(onCreateBaixa).not.toHaveBeenCalled();
});

function provisao(over = {}) {
  return {
    id: "e1",
    subtipo: "DAS",
    competencia: COMP,
    statusPagamento: "ABERTO",
    valor: 1234.56,
    baixas: [],
    sourceGuide: guia({ vencimento: emDias(-12) }),
    ...over,
  };
}

function renderTab(provisoes, { acrescimos = {}, ...over } = {}) {
  const props = {
    companyId: "c1",
    circularData: { provisoes, receitas: {}, acrescimos, extrato: {}, entries: [] },
    loading: false,
    year: ANO,
    competencia: COMP,
    companyRegime: "SIMPLES",
    accounts: [],
    onCompetenciaChange: jest.fn(),
    onYearChange: jest.fn(),
    onLoad: jest.fn().mockResolvedValue(undefined),
    onCreateBaixa: jest.fn(),
    savingBaixa: false,
    onUpdateEntry: jest.fn(),
    onSaveCircular: jest.fn(),
    savingCircular: false,
    // ⚠ Estorno, não DELETE. `onCancelBaixa` ficou aqui DE PROPÓSITO, como prop morta: é o que
    // torna a regressão literal — nenhum caminho da tela pode voltar a chamá-lo (a rota antiga
    // responde `409 USE_ESTORNO` para toda baixa com vínculo).
    onCancelBaixa: jest.fn().mockResolvedValue(undefined),
    onPreviewEstorno: jest.fn().mockResolvedValue(previewPadrao()),
    onEstornarBaixa: jest.fn().mockResolvedValue({ ok: true, modo: "DELECAO", lancamentosDesfeitos: [] }),
    ...over,
  };
  return { props, ...render(<MemoryRouter><CircularTab {...props} /></MemoryRouter>) };
}

test("origem parcelada não indica pagamento e leva à composição do acordo", () => {
  renderTab([provisao({ parcelamentoOrigem: { parcelamentoId: "acordo-1", statusContrato: "ATIVO" } })]);
  const valor = screen.getByRole("button", { name: "R$ 1.234,56" });
  expect(valor.closest("td")).toHaveTextContent("Parcelado");
  expect(valor.closest("td")).not.toHaveTextContent("✓");
  fireEvent.click(valor);
  expect(screen.getByRole("link", { name: "Ver parcelamento" })).toHaveAttribute("href", "/companies/c1/parcelamento?composicao=acordo-1");
  expect(screen.queryByRole("button", { name: "Dar baixa" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "✎ Editar provisão" })).not.toBeInTheDocument();
});

test("INSS pago mostra baixa corrigida e separa a guia consultada dos encargos pagos", () => {
  renderTab([provisao({ subtipo: "INSS", valor: 1000, statusPagamento: "PAGO", synthetic: true,
    baixas: [{ id: "b" }], baixaEntry: { id: "b", tipo: "BAIXA", subtipo: "INSS", lines: [] },
    sourceGuide: guia({ tipo: "INSS", paymentStatus: "PAID" }), recalculatedToValor: 1100,
    pagamentoEfetivo: { fonte: "BAIXA_CONTABIL", total: 1000, principal: 1000, juros: 0, multa: 0, composicaoConhecida: true, data: "2026-06-20T00:00:00.000Z" },
  })], { acrescimos: { [COMP]: { INSS: { principal: 1000, juros: 50, multa: 50 } } } });
  fireEvent.click(screen.getByRole("button", { name: "R$ 1.000,00" }));
  expect(screen.getByText("Valor baixado")).toBeInTheDocument();
  expect(screen.getByText("Juros pagos").parentElement).toHaveTextContent("R$ 0,00");
  expect(screen.getByText("Multa paga").parentElement).toHaveTextContent("R$ 0,00");
  expect(screen.getByText("Guia consultada").parentElement).toHaveTextContent("R$ 1.100,00");
  expect(screen.getByText("Data do pagamento").parentElement).toHaveTextContent("20/06/2026");
  expect(screen.queryByText("Valor atualizado")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Editar baixa/ }));
  expect(screen.queryByText(/Juros\/multa.*INSS/)).not.toBeInTheDocument();
});

test("baixa sem valor confiável permanece visível como pendência", () => {
  renderTab([provisao({ subtipo: "INSS", valor: 1100, statusPagamento: "PAGO", synthetic: true,
    baixas: [{ id: "b" }], pagamentoEfetivo: { fonte: "BAIXA_CONTABIL", total: null, pendencia: "BAIXA_SEM_VALOR_CONFIAVEL" },
  })]);
  fireEvent.click(screen.getByRole("button", { name: "R$ 1.100,00" }));
  expect(screen.getByText(/Baixa sem valor confiável/)).toBeInTheDocument();
});

/**
 * A prévia do servidor — o LOTE, com valores. É ela que a confirmação repete na tela.
 * Três lançamentos porque uma baixa são até três (principal, juros e multa, em contas diferentes).
 */
function previewPadrao(over = {}) {
  return {
    ok: true,
    modo: "DELECAO",
    mesFechado: false,
    competenciaOriginal: COMP,
    competenciaContraLancamento: null,
    lancamentos: [
      { id: "b1", historico: "PAGO PARCELA 03/12", competencia: COMP, tipoLinha: "PRINCIPAL", valor: 392.58, linhas: [] },
      { id: "b2", historico: "PAGO PARCELA 03/12 (juros)", competencia: COMP, tipoLinha: "JUROS", valor: 57.52, linhas: [] },
      { id: "b3", historico: "PAGO PARCELA 03/12 (multa)", competencia: COMP, tipoLinha: "MULTA", valor: 78.48, linhas: [] },
    ],
    totalEstornado: 528.58,
    guia: {
      id: "g1", tipo: "DAS", numeroParcela: 3, valor: 528.58,
      parcelaEstado: "CONFIRMADA", parcelaEstadoAposEstorno: "ESTORNADA",
      paymentStatusSource: "MANUAL", pagamentoSeraDesfeito: true, reabre: true,
    },
    parcelamentoId: "parc-1",
    motivoObrigatorio: true,
    bloqueios: [],
    ...over,
  };
}

/** Erro de recusa com CÓDIGO — é assim que a camada de api entrega o 4xx do backend. */
function recusa(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/**
 * Espera o modal do estorno sair do "Carregando…".
 *
 * ⚠ O `<dialog>` aparece ANTES da prévia: ele monta e só então busca no servidor o que será
 * desfeito. Esperar só pelo papel `dialog` deixava o teste correndo contra o carregamento — passava
 * ou falhava conforme o microtask, que é o pior tipo de teste instável.
 */
async function esperarPrevia() {
  await screen.findByRole("dialog", { name: "Desfazer baixa" });
  await waitFor(() =>
    expect(screen.queryByText("Carregando o que será desfeito…")).not.toBeInTheDocument());
}

/** Abre o popover da célula cujo número é `texto` e devolve o botão da célula. */
function abrirCelula(texto) {
  const botao = screen.getByRole("button", { name: texto });
  fireEvent.click(botao);
  return botao;
}

test.each(['DAS', 'PIS', 'COFINS', 'INSS'])('provisão de %s permanece principal mesmo com recálculo e baixa maior', (subtipo) => {
  renderTab([provisao({ subtipo, valor: 1120, totalD: 1120, valorProvisionado: 1000,
    statusPagamento: 'PAGO', recalculatedAt: '2026-09-18T12:00:00Z', recalculatedToValor: 1150,
    pagamentoEfetivo: { total: 1120, fonte: 'BAIXA_CONTABIL' },
  })], { companyRegime: subtipo === 'DAS' ? 'SIMPLES' : 'LUCRO_PRESUMIDO' });
  expect(screen.getByRole('button', { name: 'R$ 1.000,00' })).toBeInTheDocument();
  expect(screen.getByText('Valor pago: R$ 1.120,00')).toBeInTheDocument();
  abrirCelula('R$ 1.000,00');
  expect(screen.getByText('Valor baixado')).toBeInTheDocument();
  expect(screen.getByText('R$ 1.120,00')).toBeInTheDocument();
});

test('março sem lançamentos não exibe valores antigos da consulta nem os imprime', () => {
  const tributos = ['IRPJ', 'CSLL', 'PIS', 'COFINS'];
  renderTab(tributos.map((subtipo, i) => provisao({ id: subtipo, subtipo,
    competencia: `${ANO}-04`, valor: 100 + i })), {
    companyRegime: 'LUCRO_PRESUMIDO', acrescimos: { [`${ANO}-03`]: {
      IRPJ: { principal: 83623.68 }, CSLL: { principal: 32264.53 },
      PIS: { principal: 2512.76, juros: 582.70 }, COFINS: { principal: 11597.36, multa: 2689.42 },
    } },
  });
  const marco = screen.getByRole('row', { name: /^Mar\// });
  expect(within(marco).queryByText(/R\$/)).not.toBeInTheDocument();
  expect(screen.queryByText(/83\.623,68|32\.264,53|2\.512,76|11\.597,36/)).not.toBeInTheDocument();
  // Os valores provisionados em abril continuam visíveis.
  expect(screen.getByRole('button', { name: 'R$ 100,00' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Imprimir/ }));
  expect(within(screen.getByRole('row', { name: /^Mar\// })).queryByText(/R\$/)).not.toBeInTheDocument();
});

test("valores iguais não exibem recálculo e preservam o estado da circular", () => {
  renderTab([provisao({ recalculoGuia: {
    guiaId: "g1", recalculadoEm: "2026-09-18T12:00:00Z", valorAnterior: 1234.56,
    valorAtual: 1234.56, escopoValor: "TOTAL_GUIA",
  } })]);
  expect(screen.queryByText(/Valor pago:/)).not.toBeInTheDocument();
  abrirCelula("R$ 1.234,56");
  expect(screen.queryByText(/Total da guia recalculada|Recálculo em/)).not.toBeInTheDocument();
  expect(screen.queryByText(/não confirma pagamento/)).not.toBeInTheDocument();
  expect(screen.getByText("Vencida · 12 dias")).toBeInTheDocument();
});

describe("a cor da célula É o estado — e nunca viaja sozinha", () => {
  it("vencida sai vermelha, e o popover diz há quantos dias", () => {
    renderTab([provisao({ valor: 1234.56, sourceGuide: guia({ vencimento: emDias(-12) }) })]);

    const celula = abrirCelula("R$ 1.234,56");
    expect(celula).toHaveStyle({ color: VERMELHO });
    expect(screen.getByText("Vencida · 12 dias")).toBeInTheDocument();
  });

  it("dentro do prazo sai ÂMBAR e diz a data — não é a mesma coisa que vencida", () => {
    renderTab([provisao({ valor: 900, sourceGuide: guia({ vencimento: emDias(9) }) })]);

    const celula = abrirCelula("R$ 900,00");
    expect(celula).toHaveStyle({ color: AMBAR });
    expect(screen.getByText(/^A vencer · \d{2}\/\d{2}$/)).toBeInTheDocument();
    expect(screen.queryByText(/Vencida/)).not.toBeInTheDocument();
  });

  it("⚠ sem vencimento a tela NÃO afirma atraso — diz 'Em aberto'", () => {
    renderTab([provisao({ valor: 500, sourceGuide: guia({ vencimento: null }) })]);

    const celula = abrirCelula("R$ 500,00");
    expect(celula).toHaveStyle({ color: AMBAR });
    expect(screen.getByText("Em aberto")).toBeInTheDocument();
    expect(screen.queryByText(/Vencida/)).not.toBeInTheDocument();
  });

  it("paga sai verde e ganha o ✓ na célula", () => {
    renderTab([provisao({
      valor: 300,
      statusPagamento: "PAGO",
      baixas: [{ id: "b1" }],
      sourceGuide: guia({ vencimento: emDias(-40) }),
    })]);

    const celula = abrirCelula("R$ 300,00");
    expect(celula).toHaveStyle({ color: VERDE });
    expect(screen.getByText("Baixada")).toBeInTheDocument();
    expect(screen.getByText("Paga")).toBeInTheDocument();
  });

  it("⚠⚠ O ✓ VEM DO LANÇAMENTO, NÃO DO `paymentStatus` DA GUIA — os dois são fatos diferentes", () => {
    // Eu troquei as duas fontes numa primeira versão e este bloco pegou: uma provisão pode ter BAIXA
    // LANÇADA sem que a GUIA conste paga (o contador lançou à mão). Lendo a guia, o ✓ sumiria de
    // toda linha quitada nessa situação.
    renderTab([provisao({
      valor: 300,
      statusPagamento: "PAGO",
      baixas: [{ id: "b1" }],
      sourceGuide: guia({ vencimento: emDias(-40) }), // ⚠ sem `paymentStatus`
    })]);
    expect(screen.getByText("Baixada")).toBeInTheDocument();
  });

  it("⚠⚠ e quando a guia DIZ de onde veio a confirmação, isso sai em TEXTO ao lado do ✓", () => {
    // Antes as três origens imprimiam o MESMO símbolo, com a diferença num `title` — que não
    // aparece no teclado nem no toque.
    renderTab([provisao({
      valor: 300,
      statusPagamento: "PAGO",
      baixas: [{ id: "b1" }],
      sourceGuide: guia({ vencimento: emDias(-40), paymentStatus: "PAID", paymentStatusSource: "CLIENTE" }),
    })]);
    expect(screen.getByText("Cliente")).toBeInTheDocument();
  });

  it("provisão prevista não é dívida: sem ✓ e sem alarme", () => {
    renderTab([provisao({ valor: 700, placeholder: true, sourceGuide: null })]);

    abrirCelula("R$ 700,00");
    expect(screen.getByText("Prevista")).toBeInTheDocument();
    expect(screen.queryByText("Baixada")).not.toBeInTheDocument();
  });
});

describe("o popover — onde mora o que estava escondido em `title`", () => {
  it("abre no clique e fecha no segundo", () => {
    renderTab([provisao()]);

    const celula = screen.getByRole("button", { name: "R$ 1.234,56" });
    expect(celula).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(celula);
    expect(celula).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Valor original")).toBeInTheDocument();

    fireEvent.click(celula);
    expect(celula).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Valor original")).not.toBeInTheDocument();
  });

  it("mantém o recálculo nos detalhes sem apresentá-lo como pagamento", () => {
    renderTab(
      [provisao({ valor: 1000, sourceGuide: guia({ vencimento: emDias(-30) }) })],
      { acrescimos: { [COMP]: { DAS: { principal: 1000, juros: 30, multa: 20 } } } },
    );

    expect(screen.queryByText(/Valor pago:|Recalculado:/)).not.toBeInTheDocument();

    abrirCelula("R$ 1.000,00");
    expect(screen.getByText("Juros/multa")).toBeInTheDocument();
    expect(screen.getByText("+ R$ 50,00")).toBeInTheDocument();
    expect(screen.getByText("Valor atualizado")).toBeInTheDocument();
    expect(screen.getByText("R$ 1.050,00")).toBeInTheDocument();
  });

  it("o envio ao cliente sai de envios_guia, com o canal do envio", () => {
    renderTab([provisao({
      valor: 800,
      sourceGuide: guia({
        vencimento: emDias(5),
        emailStatus: "PENDING", // ⚠ o campo legado diria "não enviada"; quem responde é `envios`
        envios: [{ canal: "WHATSAPP", status: "entregue", entregueEm: emDias(-2) }],
      }),
    })]);

    abrirCelula("R$ 800,00");
    expect(screen.getByText("Enviada ao cliente")).toBeInTheDocument();
    expect(screen.getByText(/^✓ .+ · WhatsApp$/)).toBeInTheDocument();
  });

  it("sem envio a linha continua lá dizendo 'ainda não' — ausência não é resposta", () => {
    renderTab([provisao({ valor: 640, sourceGuide: guia({ vencimento: emDias(5), envios: [] }) })]);

    abrirCelula("R$ 640,00");
    expect(screen.getByText("Enviada ao cliente")).toBeInTheDocument();
    expect(screen.getByText("ainda não")).toBeInTheDocument();
  });
});

describe("desfazer baixa — ESTORNO, não DELETE", () => {
  const pagaComTres = () => provisao({
    valor: 2000,
    statusPagamento: "PAGO",
    // principal, juros e multa são TRÊS lançamentos separados, em contas diferentes.
    baixas: [{ id: "b1" }, { id: "b2" }, { id: "b3" }],
    sourceGuide: guia({ vencimento: emDias(-50) }),
  });

  /** Abre a célula paga, clica em "Desfazer baixa" e espera a PRÉVIA chegar. */
  async function abrirEstorno(over = {}) {
    const r = renderTab([pagaComTres()], over);
    abrirCelula("R$ 2.000,00");
    fireEvent.click(screen.getByRole("button", { name: /↩ Desfazer baixa/ }));
    await esperarPrevia();
    return r;
  }

  it("o rótulo diz quantos lançamentos vão embora", () => {
    renderTab([pagaComTres()]);

    abrirCelula("R$ 2.000,00");
    expect(screen.getByRole("button", { name: "↩ Desfazer baixa (3 lançamentos)" })).toBeInTheDocument();
  });

  it("⚠ NÃO chama mais o DELETE — pede a PRÉVIA do lote ao servidor", async () => {
    const { props } = await abrirEstorno();

    // A rota antiga responde `409 USE_ESTORNO` para toda baixa com vínculo: se este caminho voltar,
    // o botão volta a estar quebrado em produção.
    expect(props.onCancelBaixa).not.toHaveBeenCalled();
    // O PRINCIPAL basta: o servidor carrega o lote inteiro a partir dele (pela guia), e assim não
    // há como confirmar um pedaço do lote.
    expect(props.onPreviewEstorno).toHaveBeenCalledWith("b1");
  });

  it("a prévia mostra os VALORES — confirmação repete os dados, não pergunta 'tem certeza?'", async () => {
    await abrirEstorno();

    expect(screen.getByText("PAGO PARCELA 03/12")).toBeInTheDocument();
    expect(screen.getByText("R$ 392,58")).toBeInTheDocument();
    expect(screen.getByText("R$ 57,52")).toBeInTheDocument();
    expect(screen.getByText("R$ 78,48")).toBeInTheDocument();
    // O total é o que volta como `totalConferido` — é o número que o contador declara ter visto.
    expect(screen.getByText("Total a estornar")).toBeInTheDocument();
    expect(screen.getByText("R$ 528,58")).toBeInTheDocument();
    // E o que acontece com a guia depois.
    expect(screen.getByText("A guia volta para a fila")).toBeInTheDocument();
    expect(screen.getByText(/CONFIRMADA → ESTORNADA/)).toBeInTheDocument();
  });

  it("motivo curto NÃO deixa confirmar — e diz quanto falta", async () => {
    await abrirEstorno();

    const confirmar = screen.getByRole("button", { name: "Desfazer 3 lançamentos" });
    expect(confirmar).toBeDisabled();
    expect(screen.getByText(/Mínimo de 5 caracteres/)).toBeInTheDocument();

    // ⚠ Espaço em branco não é motivo: campo obrigatório que aceita espaço não é obrigatório.
    fireEvent.change(screen.getByPlaceholderText(/baixa lançada na guia errada/), { target: { value: "      " } });
    expect(confirmar).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText(/baixa lançada na guia errada/), { target: { value: "baixa na guia errada" } });
    expect(confirmar).toBeEnabled();
  });

  it("confirmar manda o motivo E o total conferido, e recarrega a Circular", async () => {
    const { props } = await abrirEstorno();

    fireEvent.change(screen.getByPlaceholderText(/baixa lançada na guia errada/), { target: { value: "  pagamento era da parcela 04  " } });
    fireEvent.click(screen.getByRole("button", { name: "Desfazer 3 lançamentos" }));

    await waitFor(() => expect(props.onEstornarBaixa).toHaveBeenCalledWith(
      "b1",
      // O motivo vai APARADO; o total é o da prévia, não um recalculado na tela.
      { motivo: "pagamento era da parcela 04", totalConferido: 528.58 },
    ));
    await waitFor(() => expect(props.onLoad).toHaveBeenCalledWith(ANO, COMP));
  });

  it("desistir não estorna nada", async () => {
    const { props } = await abrirEstorno();

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(props.onEstornarBaixa).not.toHaveBeenCalled();
    expect(props.onCancelBaixa).not.toHaveBeenCalled();
  });

  it("guia em aberto não oferece desfazer — não há o que desfazer", () => {
    renderTab([provisao({ valor: 111 })]);

    abrirCelula("R$ 111,00");
    expect(screen.queryByText(/Desfazer baixa/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dar baixa" })).toBeInTheDocument();
  });
});

// ⚠ AUSÊNCIA NUNCA É RESPOSTA. Cada recusa do servidor tem uma saída diferente — corrigir o campo,
// recarregar a prévia, reabrir a competência — e nenhuma delas é descobrível se a tela só deixar de
// fazer nada. Um por um, porque foi o silêncio de UM deles que quebraria o fluxo em produção.
describe("as recusas do estorno chegam à tela, com o motivo", () => {
  const pagaComTres = () => provisao({
    valor: 2000, statusPagamento: "PAGO",
    baixas: [{ id: "b1" }, { id: "b2" }, { id: "b3" }],
    sourceGuide: guia({ vencimento: emDias(-50) }),
  });

  async function abrir(over) {
    renderTab([pagaComTres()], over);
    abrirCelula("R$ 2.000,00");
    fireEvent.click(screen.getByRole("button", { name: /↩ Desfazer baixa/ }));
    await esperarPrevia();
  }

  it("MES_CORRENTE_FECHADO vem como BLOQUEIO da prévia e trava a confirmação", async () => {
    await abrir({
      onPreviewEstorno: jest.fn().mockResolvedValue(previewPadrao({
        modo: "CONTRA_LANCAMENTO",
        mesFechado: true,
        competenciaContraLancamento: "2026-09",
        bloqueios: [{
          code: "MES_CORRENTE_FECHADO",
          competencia: "2026-09",
          message: "A baixa está em 2026-06, que já foi fechada … Reabra 2026-09 para estornar.",
        }],
      })),
    });

    // A mensagem traz o CAMINHO DE SAÍDA, não só o código.
    expect(screen.getByText(/Reabra 2026-09 para estornar/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Desfazer 3 lançamentos" })).toBeDisabled();
  });

  it("mês fechado sem bloqueio avisa que NÃO apaga — nasce contra-lançamento", async () => {
    await abrir({
      onPreviewEstorno: jest.fn().mockResolvedValue(previewPadrao({
        modo: "CONTRA_LANCAMENTO", mesFechado: true, competenciaContraLancamento: "2026-09",
      })),
    });

    expect(screen.getByText(/não serão apagados/)).toBeInTheDocument();
    expect(screen.getByText("09/2026")).toBeInTheDocument();
  });

  it("CONFERENCIA_DIVERGENTE aparece depois do clique — a baixa mudou desde a prévia", async () => {
    await abrir({
      onEstornarBaixa: jest.fn().mockRejectedValue(recusa(
        "CONFERENCIA_DIVERGENTE",
        "O que está para ser estornado (R$ 610,10) não é o que foi confirmado (R$ 528,58).",
      )),
    });

    fireEvent.change(screen.getByPlaceholderText(/baixa lançada na guia errada/), { target: { value: "conferindo de novo" } });
    fireEvent.click(screen.getByRole("button", { name: "Desfazer 3 lançamentos" }));

    expect(await screen.findByText(/não é o que foi confirmado/)).toBeInTheDocument();
  });

  it("MOTIVO_OBRIGATORIO do servidor também aparece (o gate da tela não é o único)", async () => {
    await abrir({
      onEstornarBaixa: jest.fn().mockRejectedValue(recusa(
        "MOTIVO_OBRIGATORIO",
        "Informe o motivo do estorno (mínimo 5 caracteres).",
      )),
    });

    fireEvent.change(screen.getByPlaceholderText(/baixa lançada na guia errada/), { target: { value: "motivo" } });
    fireEvent.click(screen.getByRole("button", { name: "Desfazer 3 lançamentos" }));

    expect(await screen.findByText(/mínimo 5 caracteres/)).toBeInTheDocument();
  });

  it("recusa da PRÉVIA some com o fluxo, nunca com a explicação", async () => {
    await abrir({
      onPreviewEstorno: jest.fn().mockRejectedValue(recusa(
        "LOTE_JA_EXPORTADO",
        "A baixa tem 3 lançamento(s) e um deles já foi exportado. O lote é estornado inteiro ou nenhum.",
      )),
    });

    expect(await screen.findByText(/já foi exportado/)).toBeInTheDocument();
    // Sem prévia não há o que confirmar — e sem o que confirmar não há campo de motivo.
    expect(screen.queryByPlaceholderText(/baixa lançada na guia errada/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Desfazer 3 lançamentos" })).toBeDisabled();
  });
});

describe("Total em aberto — somar vencido com a vencer responde a pergunta errada", () => {
  it("o rodapé do mês separa vencido, a vencer e sem data", () => {
    renderTab([
      provisao({ id: "a", subtipo: "DAS", valor: 1000, sourceGuide: guia({ id: "ga", vencimento: emDias(-20) }) }),
      provisao({ id: "b", subtipo: "INSS", valor: 200, sourceGuide: guia({ id: "gb", tipo: "INSS", vencimento: emDias(6) }) }),
      provisao({ id: "c", subtipo: "IRRF", valor: 30, sourceGuide: guia({ id: "gc", tipo: "IRRF", vencimento: null }) }),
    ]);

    expect(screen.getByText("vencido").parentElement).toHaveTextContent("R$ 1.000,00");
    expect(screen.getByText("a vencer").parentElement).toHaveTextContent("R$ 200,00");
    // ⚠ Rótulo PRÓPRIO: chamar isto de "a vencer" afirmaria um prazo que a célula acima se recusa
    // a afirmar — a mesma tela dizendo duas coisas.
    expect(screen.getByText("em aberto").parentElement).toHaveTextContent("R$ 30,00");
  });

  it("mês sem nada em aberto não inventa linha de vencido", () => {
    renderTab([provisao({ valor: 400, statusPagamento: "PAGO", baixas: [{ id: "b1" }] })]);

    expect(screen.queryByText("vencido")).not.toBeInTheDocument();
    expect(screen.queryByText("a vencer")).not.toBeInTheDocument();
  });
});

// ⚠ AUSÊNCIA NUNCA É RESPOSTA — e aqui ela chegava a SOMAR.
//
// `visibleRows` filtra as colunas pelo regime da empresa; `abertoByMonth` varre o quadro INTEIRO.
// Numa empresa do Simples com PIS e COFINS abertos, a linha do mês mostrava só o INSS e um "Total
// em aberto" que incluía os outros dois: R$ 5.900 sem NENHUMA célula para clicar. E dava para cair
// nisso pela própria Circular — o seletor de Subtipo do modal oferecia ISS/PIS/COFINS (e a opção
// vazia) para qualquer regime: salvando, a célula sumia na hora e o valor migrava para o total,
// sem dono e sem caminho de volta.
describe("provisão fora do regime / sem subtipo — continua clicável em algum lugar", () => {
  const vencida = (over) => provisao({ statusPagamento: "ABERTO", ...over });

  function comForaDoRegime(over = {}) {
    return renderTab([
      vencida({ id: "i", subtipo: "INSS", valor: 487.30, sourceGuide: guia({ id: "gi", tipo: "INSS", vencimento: emDias(-10) }) }),
      vencida({ id: "p", subtipo: "PIS", valor: 2900, historico: "PIS 07", sourceGuide: guia({ id: "gp", tipo: "DARF", vencimento: emDias(-10) }) }),
      vencida({ id: "c", subtipo: "COFINS", valor: 3000, historico: "COFINS 07", sourceGuide: guia({ id: "gc", tipo: "DARF", vencimento: emDias(-10) }) }),
    ], { companyRegime: "SIMPLES", ...over });
  }

  it("indica recálculo no bucket e mostra o detalhe apenas no lançamento marcado", () => {
    renderTab([
      vencida({ id: "p", subtipo: "PIS", valor: 250, historico: "PIS recalculado", recalculoGuia: {
        guiaId: "gp", recalculadoEm: "2026-09-18T12:00:00Z", valorAnterior: 850,
        valorAtual: 910, escopoValor: "TOTAL_GUIA", especie: "DARF_PRESUMIDO",
      } }),
      vencida({ id: "c", subtipo: "COFINS", valor: 600, historico: "COFINS sem recálculo" }),
    ], { companyRegime: "SIMPLES" });
    expect(screen.getByText("Recalculada")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "R$ 850,00" }));
    const pis = screen.getByText("PIS recalculado").parentElement.parentElement;
    const cofins = screen.getByText("COFINS sem recálculo").parentElement.parentElement;
    fireEvent.click(within(pis).getByText("Guia recalculada"));
    expect(within(pis).getByText(/Recálculo em/)).toHaveTextContent("18/09/2026");
    expect(within(pis).getByText(/Total anterior da guia/)).toHaveTextContent("850,00");
    expect(within(pis).getByText(/Total da guia recalculada/)).toHaveTextContent("910,00");
    expect(within(pis).getByText(/não confirma pagamento nem altera/)).toBeInTheDocument();
    expect(within(cofins).queryByText("Guia recalculada")).not.toBeInTheDocument();
    expect(within(cofins).queryByText(/Recálculo em/)).not.toBeInTheDocument();
    expect(within(pis).getByRole("button", { name: /Editar/ })).toBeInTheDocument();
  });

  it("não sugere recálculo no bucket quando nenhum lançamento tem o registro", () => {
    comForaDoRegime();
    expect(screen.queryByText("Recalculada")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "R$ 5.900,00" }));
    expect(screen.queryByText("Guia recalculada")).not.toBeInTheDocument();
  });

  it("⚠ o que o total soma tem coluna: R$ 5.900 de PIS+COFINS não fica sem célula", () => {
    comForaDoRegime();

    // O total continua sendo o mesmo — o defeito nunca foi o total, foi o que a matriz escondia.
    expect(screen.getByText("vencido").parentElement).toHaveTextContent("R$ 6.387,30");
    // E agora existe onde clicar nos R$ 5.900 que o regime não exibe.
    expect(screen.getByRole("columnheader", { name: /Lançamentos a classificar/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "R$ 5.900,00" })).toBeInTheDocument();
  });

  it("a célula do bucket NOMEIA cada lançamento e leva de volta à edição", () => {
    const { props } = comForaDoRegime();

    fireEvent.click(screen.getByRole("button", { name: "R$ 5.900,00" }));
    expect(screen.getByText("PIS 07")).toBeInTheDocument();
    expect(screen.getByText("COFINS 07")).toBeInTheDocument();

    // O caminho de volta é editar o lançamento (é lá que se corrige o subtipo).
    fireEvent.click(screen.getAllByRole("button", { name: /✎ Editar/ })[0]);
    expect(screen.getByText(/^Editar:/)).toBeInTheDocument();
    expect(props.onLoad).not.toHaveBeenCalled();
  });

  it("provisão SEM subtipo também tem lugar — ela nem entrava na matriz", () => {
    renderTab([
      vencida({ id: "s", subtipo: null, valor: 1500, historico: "SEM SUBTIPO", sourceGuide: guia({ id: "gs", vencimento: emDias(-4) }) }),
    ], { companyRegime: "SIMPLES" });

    expect(screen.getByText("vencido").parentElement).toHaveTextContent("R$ 1.500,00");
    expect(screen.getByRole("button", { name: "R$ 1.500,00" })).toBeInTheDocument();
  });

  it("empresa sem nada fora do regime NÃO ganha a coluna", () => {
    renderTab([provisao({ subtipo: "DAS", valor: 900 })], { companyRegime: "SIMPLES" });
    expect(screen.queryByRole("columnheader", { name: /Lançamentos a classificar/ })).not.toBeInTheDocument();
  });

  it("⚠ o seletor de Subtipo não oferece tributo que o regime não exibe", () => {
    renderTab([provisao({ subtipo: "DAS", valor: 900 })], { companyRegime: "SIMPLES" });

    abrirCelula("R$ 900,00");
    fireEvent.click(screen.getByRole("button", { name: /✎ Editar/ }));

    const seletor = screen.getByLabelText("Subtipo");
    const oferecidos = Array.from(seletor.options).filter((o) => !o.disabled).map((o) => o.value);
    expect(oferecidos).toContain("DAS");
    // Simples não tem ISS/PIS/COFINS — oferecê-los é a porta pela qual a célula some.
    expect(oferecidos).not.toContain("ISS");
    expect(oferecidos).not.toContain("PIS");
    expect(oferecidos).not.toContain("COFINS");
    // E a opção vazia não é escolha: ela existe só para representar o que ainda não foi respondido.
    expect(oferecidos).not.toContain("");
  });

  it("o subtipo JÁ GRAVADO continua no seletor, mesmo fora do regime", () => {
    // Escondê-lo faria o select exibir outra coisa e reclassificar o lançamento no primeiro salvar.
    renderTab([provisao({ subtipo: "PIS", valor: 250, historico: "PIS" })], { companyRegime: "SIMPLES" });

    fireEvent.click(screen.getByRole("button", { name: "R$ 250,00" }));
    fireEvent.click(screen.getAllByRole("button", { name: /✎ Editar/ })[0]);

    const seletor = screen.getByLabelText("Subtipo");
    expect(seletor.value).toBe("PIS");
    expect(Array.from(seletor.options).map((o) => o.value)).toContain("PIS");
  });
});

describe("estados de carga", () => {
  it("carregando não mostra a tabela", () => {
    renderTab([], { loading: true });
    expect(screen.getByText("Carregando...")).toBeInTheDocument();
    expect(screen.queryByText("Total em aberto")).not.toBeInTheDocument();
  });

  it("sem dados, diz o que fazer", () => {
    renderTab([], { circularData: null });
    expect(screen.getByText(/Nenhum dado disponível/)).toBeInTheDocument();
  });
});

test('pagamento parcial mostra o total efetivamente baixado também na impressão', () => {
  renderTab([provisao({ valor: 1000, valorProvisionado: 1000, statusPagamento: 'PARCIAL', saldo: 600,
    pagamentoEfetivo: { fonte: 'BAIXA_CONTABIL', total: 430, principal: 400, juros: 20, multa: 10 },
  })]);
  expect(screen.getByText('Valor pago: R$ 430,00')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'R$ 1.000,00' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Imprimir/ }));
  expect(screen.getByText('Valor pago: R$ 430,00')).toBeInTheDocument();
});

test.each([null, { fonte: 'COMPROVANTE', total: 1150 }])('não confunde consulta ou recálculo com baixa contábil: %j', (pagamentoEfetivo) => {
  renderTab([provisao({ pagamentoEfetivo, recalculatedToValor: 1150 })]);
  expect(screen.queryByText(/Valor pago:/)).not.toBeInTheDocument();
});

test('baixa sem valor confiável não inventa valor pago', () => {
  renderTab([provisao({ pagamentoEfetivo: { fonte: 'BAIXA_CONTABIL', total: null } })]);
  expect(screen.getByText('Baixa a conferir')).toBeInTheDocument();
  expect(screen.queryByText(/Valor pago:/)).not.toBeInTheDocument();
});
