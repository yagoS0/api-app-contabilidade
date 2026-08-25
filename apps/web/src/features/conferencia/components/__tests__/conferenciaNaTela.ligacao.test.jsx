// A LIGAÇÃO DA ABA CONFERÊNCIA — o componente lendo a regra, não reescrevendo-a.
//
// ⚠ A REGRA de tela tem teste próprio (`../../lib/__tests__/conferenciaTela.test.js`). O que se
// prende aqui é o que só se vê montando: que a procedência da data CHEGA na linha, que o botão
// bloqueado fica VISÍVEL com o motivo, que o recorte "sem competência" pede outra coisa ao
// servidor, e que a tela não oferece um caminho que o backend não tem.

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const mockGetFila = jest.fn();
const mockPostAcao = jest.fn();

// ⚠ O `jest.mock` é HOISTED para o topo, e o componente chama `createApiClient()` no CORPO do
// módulo — ou seja, antes de o `const mockGetFila` acima ter sido inicializado. Por isso a fábrica
// devolve funções que DELEGAM na chamada: elas só tocam nos dublês quando a tela de fato pede
// alguma coisa, que é depois. Referenciá-los direto aqui estoura no TDZ.
jest.mock("../../../../api/client", () => ({
  createApiClient: () => ({
    getConferenciaFila: (...a) => mockGetFila(...a),
    postConferenciaAcao: (...a) => mockPostAcao(...a),
  }),
}));

import { ConferenciaTab } from "../renderConferenciaTab";

const item = (extra = {}) => ({
  id: "d-1",
  origem: "NOTA_RECEBIDA",
  estado: "A_CONFERIR",
  valor: "1500.00",
  valorAjustado: null,
  competencia: "2026-07",
  descricaoOriginal: "GOOGLE CLOUD BRASIL",
  cnpjFornecedor: "12345678000190",
  dataDocumento: "2026-07-02",
  detalheServico: null,
  dataPagamento: "2026-07-15",
  origemPagamento: "OFX",
  mesFechado: false,
  contaSugerida: "411030012",
  sugestao: null,
  nota: { numero: "1042", serie: "1", chaveAcesso: "3".repeat(50), tipo: "NFSE" },
  ...extra,
});

const responder = (itens, porEstado = {}) =>
  mockGetFila.mockResolvedValue({ ok: true, itens, porEstado, total: itens.length });

beforeEach(() => {
  jest.clearAllMocks();
  mockPostAcao.mockResolvedValue({ ok: true });
});

const montar = (props = {}) => render(<ConferenciaTab companyId="emp-1" competencia="2026-07" {...props} />);

describe("⚠⚠ A PROCEDÊNCIA DA DATA CHEGA NA LINHA", () => {
  it("data vinda do EXTRATO aparece rotulada como tal", async () => {
    responder([item()]);
    montar();
    expect(await screen.findByText("15/07/2026")).toBeInTheDocument();
    expect(screen.getByText("Extrato bancário")).toBeInTheDocument();
  });

  it("⚠⚠ data DECLARADA pelo contador aparece marcada — e em ÂMBAR, não em silêncio", async () => {
    // Sem isto, uma data provada pelo banco e uma data digitada ficam idênticas na tela.
    responder([item({ origemPagamento: "DECLARADO_PELO_CONTADOR" })]);
    montar();
    const selo = await screen.findByText("Declarado");
    expect(selo).toBeInTheDocument();
    expect(selo).toHaveStyle({ color: "var(--state-warn)" });
  });

  it("⚠ sem data, a célula é um traço com o motivo — nunca uma data inventada", async () => {
    responder([item({ dataPagamento: null, origemPagamento: null, estado: "AGUARDANDO_PAGAMENTO" })]);
    montar();
    await screen.findAllByText("GOOGLE CLOUD BRASIL");
    expect(screen.getByTitle(/Nenhuma data de pagamento/i)).toBeInTheDocument();
  });
});

describe("⚠ o botão bloqueado fica VISÍVEL, com o motivo", () => {
  it("⚠⚠ MÊS FECHADO não esconde o botão — desabilita e diz por quê", async () => {
    responder([item({ estado: "CONTABILIZADO", mesFechado: true })]);
    montar();
    const botao = await screen.findByRole("button", { name: /Desfazer lançamento/i });
    expect(botao).toBeDisabled();
    expect(botao).toHaveAttribute("title", expect.stringMatching(/fechada/i));
  });

  it("⚠ competência ausente impede confirmar, com o conserto nomeado", async () => {
    responder([item({ competencia: null })]);
    montar();
    const botao = await screen.findByRole("button", { name: /^Confirmar$/i });
    expect(botao).toBeDisabled();
    expect(botao).toHaveAttribute("title", expect.stringMatching(/competência/i));
  });

  it("⚠ quem não pode escrever vê os botões, desabilitados, com o motivo do papel", async () => {
    responder([item()]);
    montar({ podeEscrever: false });
    const botao = await screen.findByRole("button", { name: /^Confirmar$/i });
    expect(botao).toBeDisabled();
    expect(botao).toHaveAttribute("title", expect.stringMatching(/perfil/i));
  });
});

describe("⚠⚠ O RECORTE `sem-competencia` PEDE OUTRA COISA AO SERVIDOR", () => {
  it("por padrão pede a competência da tela", async () => {
    responder([item()]);
    montar();
    await waitFor(() => expect(mockGetFila).toHaveBeenCalled());
    expect(mockGetFila).toHaveBeenCalledWith("emp-1", { competencia: "2026-07" });
  });

  it("⚠⚠ o botão troca a consulta para o literal que a rota aceita", async () => {
    // `where.competencia = "2026-07"` não casa com NULL em SQL: sem esta porta, a nota que chegou
    // sem competência fica invisível para sempre.
    responder([item()]);
    montar();
    await screen.findAllByText("GOOGLE CLOUD BRASIL");
    fireEvent.click(screen.getByRole("button", { name: /Sem competência/i }));
    await waitFor(() =>
      expect(mockGetFila).toHaveBeenLastCalledWith("emp-1", { competencia: "sem-competencia" }),
    );
  });
});

describe("⚠ a contagem vem do servidor, não da lista", () => {
  it("mostra o `porEstado` mesmo quando a lista da página é menor", async () => {
    responder([item()], { A_CONFERIR: 137, AGUARDANDO_PAGAMENTO: 42 });
    montar();
    expect(await screen.findByText(/A conferir: 137/)).toBeInTheDocument();
    expect(screen.getByText(/Sem pagamento identificado: 42/)).toBeInTheDocument();
  });

  it("⚠ estado zerado aparece com zero — sumir faria 'não há' e 'não perguntei' ficarem iguais", async () => {
    responder([item()], { A_CONFERIR: 1 });
    montar();
    expect(await screen.findByText(/Contabilizado: 0/)).toBeInTheDocument();
  });
});

describe("⚠⚠ O QUE A TELA NÃO OFERECE — e a ausência é decisão", () => {
  it("⚠⚠ NÃO existe 'anexar comprovante': `AnexoDeclarado` não tem escritor nenhum", async () => {
    responder([item()]);
    const { container } = montar();
    await screen.findAllByText("GOOGLE CLOUD BRASIL");
    expect(container.textContent).not.toMatch(/anexar|comprovante do arquivo|upload/i);
  });

  it("⚠ nenhum botão de ação é verde — verde é CONCLUÍDO nesta casa", async () => {
    responder([item()]);
    const { container } = montar();
    await screen.findAllByText("GOOGLE CLOUD BRASIL");
    expect(container.querySelector(".btn-success")).toBeNull();
  });
});

describe("⚠ o documento: quando não dá para abrir, a linha DIZ por quê", () => {
  it("nota presente mostra número e série", async () => {
    responder([item()]);
    montar();
    expect(await screen.findByText("NFSE 1042/1")).toBeInTheDocument();
  });

  it("⚠⚠ nota apagada não some — vira traço com o motivo", async () => {
    responder([item({ nota: null })]);
    montar();
    await screen.findAllByText("GOOGLE CLOUD BRASIL");
    expect(screen.getByTitle(/não está mais na base/i)).toBeInTheDocument();
  });

  it("⚠ débito de extrato diz que não há nota, e isso não é defeito", async () => {
    responder([item({ origem: "OFX_CLIENTE", nota: null, descricaoOriginal: "TARIFA" })]);
    montar();
    await screen.findAllByText("TARIFA");
    expect(screen.getByTitle(/extrato bancário — não há nota vinculada/i)).toBeInTheDocument();
  });
});

describe("⚠⚠ O MODAL PERGUNTA ANTES DE ENVIAR", () => {
  it("confirmar sem data pede a data, e não envia enquanto ela faltar", async () => {
    responder([item({ estado: "AGUARDANDO_PAGAMENTO", dataPagamento: null, origemPagamento: null, dataDocumento: null })]);
    montar();
    fireEvent.click(await screen.findByRole("button", { name: /^Confirmar$/i }));

    const dialogo = await screen.findByRole("dialog");
    const enviar = within(dialogo).getByRole("button", { name: /^Confirmar$/i });
    expect(enviar).toBeDisabled();
    expect(enviar).toHaveAttribute("title", expect.stringMatching(/data do pagamento/i));
    expect(mockPostAcao).not.toHaveBeenCalled();
  });

  it("⚠⚠ a data nasce sugerida com a EMISSÃO da nota, nunca com hoje", async () => {
    responder([item({ estado: "AGUARDANDO_PAGAMENTO", dataPagamento: null, origemPagamento: null })]);
    montar();
    fireEvent.click(await screen.findByRole("button", { name: /^Confirmar$/i }));

    const dialogo = await screen.findByRole("dialog");
    const campo = within(dialogo).getByLabelText(/Data do pagamento/i);
    expect(campo).toHaveValue("2026-07-02");
    expect(campo).not.toHaveValue(new Date().toISOString().slice(0, 10));
  });

  it("⚠ o modal diz que data sem comprovante é DECLARAÇÃO", async () => {
    responder([item({ estado: "AGUARDANDO_PAGAMENTO", dataPagamento: null, origemPagamento: null })]);
    montar();
    fireEvent.click(await screen.findByRole("button", { name: /^Confirmar$/i }));
    const dialogo = await screen.findByRole("dialog");
    expect(within(dialogo).getByText(/não é uma prova|declaração sua/i)).toBeInTheDocument();
  });

  it("⚠ recusar exige motivo — ausência nunca é resposta", async () => {
    responder([item()]);
    montar();
    fireEvent.click(await screen.findByRole("button", { name: /Recusar/i }));
    const dialogo = await screen.findByRole("dialog");
    const enviar = within(dialogo).getByRole("button", { name: /^Recusar$/i });
    expect(enviar).toBeDisabled();
    expect(mockPostAcao).not.toHaveBeenCalled();
  });

  it("⚠ a confirmação REPETE OS DADOS — 'tem certeza?' não é confirmação", async () => {
    responder([item()]);
    montar();
    fireEvent.click(await screen.findByRole("button", { name: /^Confirmar$/i }));
    const dialogo = await screen.findByRole("dialog");
    expect(within(dialogo).getByText(/12\.345\.678\/0001-90/)).toBeInTheDocument();
    expect(within(dialogo).getByText(/competência 2026-07/)).toBeInTheDocument();
  });

  it("com tudo preenchido, envia a ação com o segmento certo", async () => {
    responder([item()]);
    montar();
    fireEvent.click(await screen.findByRole("button", { name: /^Confirmar$/i }));
    const dialogo = await screen.findByRole("dialog");
    fireEvent.click(within(dialogo).getByRole("button", { name: /^Confirmar$/i }));
    await waitFor(() => expect(mockPostAcao).toHaveBeenCalled());
    const [empresa, id, acao] = mockPostAcao.mock.calls[0];
    expect([empresa, id, acao]).toEqual(["emp-1", "d-1", "confirmar"]);
  });
});

describe("⚠ o erro do servidor APARECE — 'não veio nada' e 'deu erro' não podem ficar iguais", () => {
  it("falha na carga vira mensagem, não tela vazia", async () => {
    mockGetFila.mockRejectedValue(new Error("competencia_invalida"));
    montar();
    expect(await screen.findByText(/competencia_invalida/)).toBeInTheDocument();
  });

  it("⚠ a recusa da AÇÃO chega ao contador com o texto dela", async () => {
    responder([item()]);
    mockPostAcao.mockRejectedValue(new Error("A competência está fechada."));
    montar();
    fireEvent.click(await screen.findByRole("button", { name: /^Confirmar$/i }));
    const dialogo = await screen.findByRole("dialog");
    fireEvent.click(within(dialogo).getByRole("button", { name: /^Confirmar$/i }));
    expect(await screen.findByText(/A competência está fechada\./)).toBeInTheDocument();
  });

  it("⚠⚠ o estado vazio DIZ POR QUÊ, e menciona a varredura", async () => {
    // "Nada aqui" faria "a fila está limpa" e "ninguém varreu as notas ainda" ficarem iguais.
    responder([]);
    montar();
    expect(await screen.findByText(/ainda não foram varridas para a fila/i)).toBeInTheDocument();
  });
});

describe("⚠⚠ O AGRUPAMENTO POR FORNECEDOR chega na tela", () => {
  it("duas notas do mesmo CNPJ caem no mesmo bloco, com o total", async () => {
    responder([
      item({ id: "a", valor: "1000.00" }),
      item({ id: "b", valor: "500.00", descricaoOriginal: "GOOGLE CLOUD BRASIL LTDA" }),
    ]);
    montar();
    expect(await screen.findByText(/2 lançamento\(s\)/)).toBeInTheDocument();
    expect(screen.getByText(/R\$\s*1\.500,00/)).toBeInTheDocument();
  });
});

describe("⚠⚠ O SELO DE CONTAGEM É PORTA, não só número", () => {
  it("clicar num estado pede SÓ ele ao servidor", async () => {
    // Sem isto, o painel diz "Contabilizado: 1" e não há caminho nenhum para ver esse item — o
    // contador vê o número, não acha a linha, e conclui que o sistema perdeu a despesa.
    responder([item()], { CONTABILIZADO: 1, A_CONFERIR: 3 });
    montar();
    fireEvent.click(await screen.findByRole("button", { name: /Contabilizado: 1/ }));
    await waitFor(() =>
      expect(mockGetFila).toHaveBeenLastCalledWith("emp-1", {
        competencia: "2026-07",
        estado: "CONTABILIZADO",
      }),
    );
  });

  it("⚠ clicar de novo no mesmo selo LIMPA o filtro — não é beco sem saída", async () => {
    responder([item()], { CONTABILIZADO: 1 });
    montar();
    const selo = await screen.findByRole("button", { name: /Contabilizado: 1/ });
    fireEvent.click(selo);
    await waitFor(() => expect(mockGetFila).toHaveBeenLastCalledWith("emp-1", expect.objectContaining({ estado: "CONTABILIZADO" })));
    fireEvent.click(screen.getByRole("button", { name: /Contabilizado: 1/ }));
    await waitFor(() => expect(mockGetFila).toHaveBeenLastCalledWith("emp-1", { competencia: "2026-07" }));
  });

  it("⚠⚠ vazio COM filtro diz outra coisa — e oferece a saída", async () => {
    // "A fila está limpa" e "filtrei um estado que não tem ninguém" são respostas diferentes.
    responder([], { RECUSADO: 0 });
    montar();
    fireEvent.click(await screen.findByRole("button", { name: /Recusado: 0/ }));
    expect(await screen.findByText(/Nenhuma despesa neste estado/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Ver a fila inteira/i })).toBeInTheDocument();
  });
});

describe("⚠⚠ A RECUSA DO SERVIDOR APARECE DENTRO DO MODAL (auditoria 25/08/2026)", () => {
  it("⚠⚠ o texto do erro fica DENTRO do diálogo, não atrás do overlay", async () => {
    // Era desenhado no corpo da aba — sob o scrim do `.modal-fundo` (z-index 1000). O contador via
    // o botão piscar "Enviando…", voltar, e nada mudar.
    responder([item()]);
    mockPostAcao.mockRejectedValue(new Error("A competência está fechada."));
    montar();
    fireEvent.click(await screen.findByRole("button", { name: /^Confirmar$/i }));
    const dialogo = await screen.findByRole("dialog");
    fireEvent.click(within(dialogo).getByRole("button", { name: /^Confirmar$/i }));

    const alerta = await within(await screen.findByRole("dialog")).findByRole("alert");
    expect(alerta).toHaveTextContent(/A competência está fechada\./);
  });

  it("⚠ e o corpo da aba NÃO mostra o mesmo texto ao mesmo tempo", async () => {
    responder([item()]);
    mockPostAcao.mockRejectedValue(new Error("recusa_do_servidor"));
    montar();
    fireEvent.click(await screen.findByRole("button", { name: /^Confirmar$/i }));
    const dialogo = await screen.findByRole("dialog");
    fireEvent.click(within(dialogo).getByRole("button", { name: /^Confirmar$/i }));
    await screen.findByRole("alert");
    // ⚠ Uma ocorrência só — duplicar confundiria sobre qual é a atual.
    expect(screen.getAllByText(/recusa_do_servidor/)).toHaveLength(1);
  });
});

describe("⚠⚠ A ÚLTIMA CONSULTA VENCE (auditoria 25/08/2026)", () => {
  it("⚠⚠ resposta ANTIGA chegando depois NÃO sobrescreve a nova", async () => {
    // Sintoma real: clicar ‹ ‹ no seletor de competência e ver o mês errado sob o cabeçalho certo.
    let resolverPrimeira;
    mockGetFila
      .mockImplementationOnce(() => new Promise((r) => { resolverPrimeira = r; }))
      .mockResolvedValue({ ok: true, itens: [item({ descricaoOriginal: "DA CONSULTA NOVA" })], porEstado: {} });

    montar();
    // dispara a segunda consulta (troca de recorte) antes de a primeira voltar
    fireEvent.click(await screen.findByRole("button", { name: /Sem competência/i }));
    await screen.findAllByText("DA CONSULTA NOVA");

    // ⚠ a PRIMEIRA volta agora, atrasada
    resolverPrimeira({ ok: true, itens: [item({ descricaoOriginal: "DA CONSULTA VELHA" })], porEstado: {} });
    await waitFor(() => expect(screen.queryByText("DA CONSULTA VELHA")).toBeNull());
    expect(screen.getAllByText("DA CONSULTA NOVA").length).toBeGreaterThan(0);
  });

  it("⚠⚠ FALHA antiga não apaga os dados de um sucesso novo", async () => {
    // Era o pior dos três: `setErro` + `setFila(null)` sobre uma consulta que tinha dado certo.
    let rejeitarPrimeira;
    mockGetFila
      .mockImplementationOnce(() => new Promise((_, rej) => { rejeitarPrimeira = rej; }))
      .mockResolvedValue({ ok: true, itens: [item({ descricaoOriginal: "DADOS BONS" })], porEstado: {} });

    montar();
    fireEvent.click(await screen.findByRole("button", { name: /Sem competência/i }));
    await screen.findAllByText("DADOS BONS");

    rejeitarPrimeira(new Error("timeout da consulta velha"));
    await waitFor(() => expect(screen.queryByText(/timeout da consulta velha/)).toBeNull());
    expect(screen.getAllByText("DADOS BONS").length).toBeGreaterThan(0);
  });
});

describe("⚠⚠ O CORPO QUE VAI AO SERVIDOR (a lacuna que deixou o bug crítico passar)", () => {
  // ⚠ Nenhum teste desta aba inspecionava o 4º argumento — o CORPO. Foi por isso que o defeito de
  // `origemPagamento` (que quebrava confirmar em produção e funcionava offline) passou.
  const corpoEnviado = () => mockPostAcao.mock.calls[0][3];

  it("⚠⚠ quando a tela PEDE a data, ela manda a PROCEDÊNCIA junto", async () => {
    // Sem `origemPagamento`, o servidor lê `null`, que não está em `ORIGEM_PAGAMENTO`, e recusa com
    // `origem_de_pagamento_invalida`.
    responder([item({ estado: "AGUARDANDO_PAGAMENTO", dataPagamento: null, origemPagamento: null })]);
    montar();
    fireEvent.click(await screen.findByRole("button", { name: /Informar pagamento/i }));
    const dialogo = await screen.findByRole("dialog");
    fireEvent.click(within(dialogo).getByRole("button", { name: /Informar pagamento/i }));

    await waitFor(() => expect(mockPostAcao).toHaveBeenCalled());
    expect(corpoEnviado()).toMatchObject({
      dataPagamento: "2026-07-02",
      origemPagamento: "DECLARADO_PELO_CONTADOR",
    });
  });

  it("⚠⚠ com data JÁ PROVADA pelo extrato, a data NÃO viaja — a prova não é rebaixada", async () => {
    // Mandar a mesma data de volta faria o servidor tratá-la como "trouxe o bloco", zerar a
    // procedência e gravar DECLARADO_PELO_CONTADOR por cima de um OFX.
    responder([item()]);
    montar();
    fireEvent.click(await screen.findByRole("button", { name: /^Confirmar$/i }));
    const dialogo = await screen.findByRole("dialog");
    fireEvent.click(within(dialogo).getByRole("button", { name: /^Confirmar$/i }));

    await waitFor(() => expect(mockPostAcao).toHaveBeenCalled());
    expect(corpoEnviado()).not.toHaveProperty("dataPagamento");
    expect(corpoEnviado()).not.toHaveProperty("origemPagamento");
  });

  it("⚠ a CONTA vai junto quando a ação cria lançamento", async () => {
    responder([item({ sugestao: { conta: "411030012", procedencia: "REGRA_CNPJ" } })]);
    montar();
    fireEvent.click(await screen.findByRole("button", { name: /^Confirmar$/i }));
    const dialogo = await screen.findByRole("dialog");
    fireEvent.click(within(dialogo).getByRole("button", { name: /^Confirmar$/i }));
    await waitFor(() => expect(mockPostAcao).toHaveBeenCalled());
    expect(corpoEnviado()).toMatchObject({ contaAplicada: "411030012" });
  });

  it("⚠ recusar manda o motivo e NADA de pagamento", async () => {
    responder([item()]);
    montar();
    fireEvent.click(await screen.findByRole("button", { name: /Recusar/i }));
    const dialogo = await screen.findByRole("dialog");
    fireEvent.change(within(dialogo).getByLabelText(/Motivo da recusa/i), { target: { value: "duplicada" } });
    fireEvent.click(within(dialogo).getByRole("button", { name: /^Recusar$/i }));
    await waitFor(() => expect(mockPostAcao).toHaveBeenCalled());
    expect(corpoEnviado()).toEqual({ motivoRecusa: "duplicada" });
  });
});
