// A LIGAÇÃO DA ABA CONFERÊNCIA — o componente lendo a regra, não reescrevendo-a.
//
// ⚠ A REGRA de tela tem teste próprio (`../../lib/__tests__/conferenciaTela.test.js`). O que se
// prende aqui é o que só se vê montando: que a procedência da data CHEGA na linha, que o botão
// bloqueado fica VISÍVEL com o motivo, que o recorte "sem competência" pede outra coisa ao
// servidor, e que a tela não oferece um caminho que o backend não tem.

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const mockGetFila = jest.fn();
// ⚠⚠ O PLANO DO MOCK tem os TRÊS estados que o seletor precisa distinguir: `400` SINTÉTICA (tem
// filhas), `401`/`402` analíticas, e `464` com `codigoCompleto` NULO. Um plano só de folhas faria
// as duas recusas do seletor nascerem inalcançáveis.
const PLANO_DO_TESTE = [
  { codigo: "5", codigoCompleto: "111010001", nome: "Caixa", analitica: true },
  { codigo: "400", codigoCompleto: "41102", nome: "Despesas Gerais", analitica: false },
  { codigo: "401", codigoCompleto: "411020001", nome: "Aluguel", analitica: true },
  { codigo: "402", codigoCompleto: "411020002", nome: "Energia Elétrica", analitica: true },
  { codigo: "464", codigoCompleto: null, nome: "Serviços PJ", analitica: null },
  // ⚠ É a conta que as sugestões dos testes deste arquivo usam. Sem ela no plano, o campo
  // nasceria vazio e o botão bloqueado — que é o comportamento CERTO para sugestão fora do plano,
  // e tem teste próprio mais abaixo.
  { codigo: "557", codigoCompleto: "411030012", nome: "Despesas com Software", analitica: true },
];
const mockGetPlano = jest.fn(async () => PLANO_DO_TESTE);
const mockPostAcao = jest.fn();

// ⚠ O `jest.mock` é HOISTED para o topo, e o componente chama `createApiClient()` no CORPO do
// módulo — ou seja, antes de o `const mockGetFila` acima ter sido inicializado. Por isso a fábrica
// devolve funções que DELEGAM na chamada: elas só tocam nos dublês quando a tela de fato pede
// alguma coisa, que é depois. Referenciá-los direto aqui estoura no TDZ.
jest.mock("../../../../api/client", () => ({
  createApiClient: () => ({
    getConferenciaFila: (...a) => mockGetFila(...a),
    postConferenciaAcao: (...a) => mockPostAcao(...a),
    // ⚠ O PLANO DE CONTAS — o seletor de conta o consome. Delega como os outros dois, pelo
    // mesmo motivo do TDZ explicado acima.
    getChartOfAccounts: (...a) => mockGetPlano(...a),
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

/**
 * ⚠⚠ A LINHA QUE AINDA PASSA PELO MODAL — desde 01/09/2026 (dono: *"tira o Confirmar duplicado"*).
 *
 * A linha em `A_CONFERIR` ganhou conta e botão **"Lançar"** na própria linha, e o `Confirmar` saiu
 * dela: dois botões para o mesmo ato faziam o contador descobrir por tentativa qual usava a conta
 * digitada ao lado.
 *
 * ⚠ O MODAL NÃO MORREU — ele é o caminho quando a ação pede **DATA**, e a data é a afirmação de
 * quando o dinheiro saiu (não se digita de passagem). É por aqui que os casos abaixo o alcançam.
 * ⚠ Cada garantia que eles guardavam continua a mesma; só mudou a porta.
 */
const itemNoModal = (extra = {}) =>
  item({ estado: "AGUARDANDO_PAGAMENTO", dataPagamento: null, origemPagamento: null, ...extra });

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

  it("⚠ competência ausente impede lançar, com o conserto nomeado", async () => {
    // ⚠ O botão da linha passou a ser "Lançar" (o `Confirmar` saiu dela em 01/09/2026). O motivo do
    // bloqueio é o MESMO — `motivoDeBloqueio("confirmar", …)` — e continua visível no `title`.
    responder([item({ competencia: null })]);
    montar();
    const botao = await screen.findByRole("button", { name: /^Lançar$/i });
    expect(botao).toBeDisabled();
    expect(botao).toHaveAttribute("title", expect.stringMatching(/competência/i));
  });

  it("⚠ quem não pode escrever vê os botões, desabilitados, com o motivo do papel", async () => {
    responder([item()]);
    montar({ podeEscrever: false });
    const botao = await screen.findByRole("button", { name: /^Lançar$/i });
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
    responder([itemNoModal()]);
    montar();
    fireEvent.click(await screen.findByRole("button", { name: /^Confirmar$/i }));
    const dialogo = await screen.findByRole("dialog");
    expect(within(dialogo).getByText(/12\.345\.678\/0001-90/)).toBeInTheDocument();
    expect(within(dialogo).getByText(/competência 2026-07/)).toBeInTheDocument();
  });

  it("com tudo preenchido, envia a ação com o segmento certo", async () => {
    responder([itemNoModal()]);
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
    responder([itemNoModal()]);
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
    responder([itemNoModal()]);
    mockPostAcao.mockRejectedValue(new Error("A competência está fechada."));
    montar();
    fireEvent.click(await screen.findByRole("button", { name: /^Confirmar$/i }));
    const dialogo = await screen.findByRole("dialog");
    fireEvent.click(within(dialogo).getByRole("button", { name: /^Confirmar$/i }));

    const alerta = await within(await screen.findByRole("dialog")).findByRole("alert");
    expect(alerta).toHaveTextContent(/A competência está fechada\./);
  });

  it("⚠ e o corpo da aba NÃO mostra o mesmo texto ao mesmo tempo", async () => {
    responder([itemNoModal()]);
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
    // ⚠ Desde 01/09/2026 esta linha lança pela PRÓPRIA LINHA, e é o lugar certo para esta garantia:
    // é o caminho que a data já provada de fato percorre. O corpo continua saindo de `montarCorpo`.
    responder([item()]);
    montar();
    // ⚠ O PLANO CHEGA DEPOIS: até ele chegar, a conta da linha não traduz e o botão fica
    // desabilitado. `fireEvent.click` num botão desabilitado não faz NADA e não avisa — esperar
    // aqui é o que separa "a tela não enviou" de "o teste clicou cedo demais".
    const lancar = await screen.findByRole("button", { name: /^Lançar$/i });
    await waitFor(() => expect(lancar).not.toBeDisabled());
    fireEvent.click(lancar);

    await waitFor(() => expect(mockPostAcao).toHaveBeenCalled());
    expect(corpoEnviado()).not.toHaveProperty("dataPagamento");
    expect(corpoEnviado()).not.toHaveProperty("origemPagamento");
  });

  it("⚠ a CONTA vai junto quando a ação cria lançamento", async () => {
    // ⚠ Pela LINHA: a conta sai do campo ao lado, traduzida para `codigoCompleto`. A chave é
    // `contaAplicada` — mandar `conta` faria o servidor ignorá-la em silêncio (defeito real de
    // 01/09/2026, achado por este bloco).
    responder([item({ sugestao: { conta: "411030012", procedencia: "REGRA_CNPJ" } })]);
    montar();
    const lancar2 = await screen.findByRole("button", { name: /^Lançar$/i });
    await waitFor(() => expect(lancar2).not.toBeDisabled());
    fireEvent.click(lancar2);
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

// ─────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ O SELETOR DE CONTA — o pedido do dono, 25/08/2026:
// *"o contador deve poder selecionar a conta das notas, e deve ser salvo dessa forma"*.
//
// ⚠ O teste da regra pura (`lib/__tests__/contaDaConferencia.test.js`) prova a TRADUÇÃO. Este prova
// a LIGAÇÃO — que é onde este projeto mais paga: uma regra certa com o componente nunca passando as
// props continuaria verde lá e quebrada aqui.
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ O SELETOR DE CONTA na Conferência", () => {
  const abrirConfirmar = async (itemDado) => {
    // ⚠⚠ O MODAL É ALCANÇADO PELA AÇÃO QUE PEDE DATA desde 01/09/2026 — na linha em `A_CONFERIR` o
    // `Confirmar` saiu (o "Lançar" da própria linha o substituiu). O seletor de conta DENTRO do
    // modal continua existindo e continua precisando de cada garantia abaixo.
    responder([{ ...itemDado, estado: "AGUARDANDO_PAGAMENTO", dataPagamento: null, origemPagamento: null }]);
    montar();
    fireEvent.click(await screen.findByRole("button", { name: /^Confirmar$/i }));
    return screen.findByRole("dialog");
  };
  const campoDaConta = (dialogo) => within(dialogo).getByLabelText(/Conta contábil da despesa/i);
  const botaoConfirmar = (dialogo) => within(dialogo).getByRole("button", { name: /^Confirmar$/i });
  const corpoEnviado = () => mockPostAcao.mock.calls[0][3];

  it("⚠⚠ o campo nasce com a sugestão traduzida para o REDUZIDO, não com o codigoCompleto", async () => {
    const d = await abrirConfirmar(item({ sugestao: { conta: "411030012", procedencia: "REGRA_CNPJ" } }));
    // `557`, o número que o contador reconhece — nunca `411030012`, que é âncora interna.
    expect(campoDaConta(d)).toHaveValue("557");
  });

  it("⚠⚠ trocar a conta manda a ESCOLHIDA, não a sugerida — é o ato do contador que vence", async () => {
    const d = await abrirConfirmar(item({ sugestao: { conta: "411030012", procedencia: "REGRA_CNPJ" } }));
    fireEvent.change(campoDaConta(d), { target: { value: "401" } });
    fireEvent.click(botaoConfirmar(d));
    await waitFor(() => expect(mockPostAcao).toHaveBeenCalled());
    // ⚠ o POST leva o `codigoCompleto` do 401, não o "401" digitado nem a sugestão antiga
    expect(corpoEnviado()).toMatchObject({ contaAplicada: "411020001" });
  });

  it("⚠⚠ conta SINTÉTICA digitada bloqueia COM o motivo — a tela antecipa o que o servidor nega", async () => {
    const d = await abrirConfirmar(item({ sugestao: { conta: "411030012", procedencia: "REGRA_CNPJ" } }));
    fireEvent.change(campoDaConta(d), { target: { value: "400" } });
    expect(botaoConfirmar(d)).toBeDisabled();
    expect(within(d).getByText(/sintética \(de agregação\)/i)).toBeInTheDocument();
    fireEvent.click(botaoConfirmar(d));
    expect(mockPostAcao).not.toHaveBeenCalled();
  });

  it("⚠⚠ conta SEM codigoCompleto tem recusa PRÓPRIA — o conserto é do plano, não da linha", async () => {
    const d = await abrirConfirmar(item({ sugestao: { conta: "411030012", procedencia: "REGRA_CNPJ" } }));
    fireEvent.change(campoDaConta(d), { target: { value: "464" } });
    expect(botaoConfirmar(d)).toBeDisabled();
    expect(within(d).getByText(/reimportação do plano/i)).toBeInTheDocument();
  });

  it("conta que não existe recusa nomeando, e NÃO envia", async () => {
    const d = await abrirConfirmar(item({ sugestao: { conta: "411030012", procedencia: "REGRA_CNPJ" } }));
    fireEvent.change(campoDaConta(d), { target: { value: "99999" } });
    expect(within(d).getByText(/não existe no plano/i)).toBeInTheDocument();
    fireEvent.click(botaoConfirmar(d));
    expect(mockPostAcao).not.toHaveBeenCalled();
  });

  it("⚠ campo APAGADO bloqueia — e NUNCA manda contaAplicada vazia", async () => {
    const d = await abrirConfirmar(item({ sugestao: { conta: "411030012", procedencia: "REGRA_CNPJ" } }));
    fireEvent.change(campoDaConta(d), { target: { value: "" } });
    expect(botaoConfirmar(d)).toBeDisabled();
    fireEvent.click(botaoConfirmar(d));
    expect(mockPostAcao).not.toHaveBeenCalled();
  });

  it("⚠⚠ sugestão FORA do plano desta empresa deixa o campo vazio — o servidor recusaria", async () => {
    const d = await abrirConfirmar(item({ sugestao: { conta: "999999999", procedencia: "REGRA_CNPJ" } }));
    expect(campoDaConta(d)).toHaveValue("");
    expect(botaoConfirmar(d)).toBeDisabled();
  });

  it("⚠⚠ a lista NÃO oferece sintética nem conta sem codigoCompleto", async () => {
    const d = await abrirConfirmar(item({ sugestao: { conta: "411030012", procedencia: "REGRA_CNPJ" } }));
    const opcoes = Array.from(d.querySelectorAll("datalist option")).map((o) => o.value);
    expect(opcoes).toContain("401");
    expect(opcoes).toContain("557");
    // `400` é sintética; `464` não tem codigoCompleto
    expect(opcoes).not.toContain("400");
    expect(opcoes).not.toContain("464");
  });

  it("⚠ a conta aceita é dita pelo NOME — código sozinho não se confere", async () => {
    const d = await abrirConfirmar(item({ sugestao: { conta: "411030012", procedencia: "REGRA_CNPJ" } }));
    fireEvent.change(campoDaConta(d), { target: { value: "401" } });
    // ⚠ "Aluguel" também é o rótulo do <option> no datalist — o que se confere aqui é o texto de
    // AJUDA abaixo do campo, que é o que a pessoa lê sem abrir a lista.
    const ajudas = within(d).getAllByText("Aluguel").filter((n) => n.tagName !== "OPTION");
    expect(ajudas.length).toBeGreaterThan(0);
  });

  // ⚠⚠ O BLOQUEIO DA LINHA CAIU — e é o ponto da entrega. Antes, linha sem conta conhecida tinha o
  // botão Confirmar DESABILITADO ("não é contabilizável por aqui"). Com o seletor, ela abre o modal
  // e o contador escolhe.
  it("⚠⚠ linha SEM conta conhecida NÃO fica bloqueada — o seletor DA LINHA é o caminho", async () => {
    // ⚠⚠ ESTE TESTE DIZIA "agora ABRE o modal", e a porta mudou em 01/09/2026: o seletor desceu para
    // a própria linha. A GARANTIA é a mesma e é a que importa — linha sem conta conhecida não é um
    // beco: há onde escolher, e ela só envia depois de escolhida.
    // ⚠ `contaSugerida` também some: ela é a SEGUNDA fonte da conta, e com as duas presentes o
    // teste provaria o contrário do que o nome dele diz.
    responder([item({ contaSugerida: null, sugestao: { conta: null, motivo: "nada_conhecido", frase: "" } })]);
    montar();
    const campo = await screen.findByLabelText(/Conta contábil de GOOGLE CLOUD BRASIL/i);
    expect(campo).toHaveValue("");
    expect(screen.getByRole("button", { name: /^Lançar$/i })).toBeDisabled();
    fireEvent.change(campo, { target: { value: "402" } });
    await waitFor(() => expect(screen.getByRole("button", { name: /^Lançar$/i })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: /^Lançar$/i }));
    await waitFor(() => expect(mockPostAcao).toHaveBeenCalled());
    expect(corpoEnviado()).toMatchObject({ contaAplicada: "411020002" });
  });

  // ⚠⚠ MAS O BLOQUEIO VOLTA QUANDO NÃO HÁ O QUE ESCOLHER. Medido em 26/08/2026 num banco real:
  // 1186 de 1186 contas SEM `codigoCompleto` — o seletor nasceria vazio, e oferecer um botão que
  // abre um modal sem opção nenhuma seria pior que dizer o motivo.
  it("⚠⚠ plano SEM conta oferecível volta a bloquear a linha, com o motivo", async () => {
    mockGetPlano.mockResolvedValueOnce([
      { codigo: "1", codigoCompleto: null, nome: "SEM COMPLETO", analitica: null },
    ]);
    responder([item({ contaSugerida: null, sugestao: { conta: null, motivo: "nada_conhecido", frase: "" } })]);
    montar();
    const botao = await screen.findByRole("button", { name: /^Lançar$/i });
    await waitFor(() => expect(botao).toBeDisabled());
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ OS CONSERTOS DA VERIFICAÇÃO ADVERSARIAL (26/08/2026).
//
// Nenhum destes ramos tinha teste, e três deles são a diferença entre a tela DIZER o que houve e a
// tela AFIRMAR algo falso.
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ quando o plano de contas NÃO vem", () => {
  const abrir = async () => {
    // ⚠ Pelo caminho que ainda usa o modal (a ação que pede data) — ver `itemNoModal`.
    responder([itemNoModal()]);
    montar();
    fireEvent.click(await screen.findByRole("button", { name: /^Confirmar$/i }));
    return screen.findByRole("dialog");
  };

  it("⚠⚠ a consulta que FALHOU não vira 'esta empresa não tem plano de contas'", async () => {
    mockGetPlano.mockRejectedValueOnce(new Error("rede fora"));
    const d = await abrir();
    await waitFor(() => {
      expect(within(d).getByText(/[Nn]ão foi possível carregar o plano/)).toBeInTheDocument();
    });
    // ⚠ a AFIRMAÇÃO sobre o cadastro não pode aparecer
    expect(within(d).queryByText(/ainda não tem plano de contas/i)).toBeNull();
  });

  it("⚠⚠ um TypeError SÍNCRONO não derruba a aba — a fila continua legível", async () => {
    // ⚠ Foi o caso real: um cliente de API sem o método estoura na CHAMADA, antes de existir
    // promessa, e o `.catch` sozinho não pega.
    mockGetPlano.mockImplementationOnce(() => { throw new TypeError("não é função"); });
    responder([item()]);
    montar();
    // o nome sai no cabecalho do grupo E na linha — dois elementos, e o que importa e a aba ter renderizado
    expect((await screen.findAllByText("GOOGLE CLOUD BRASIL")).length).toBeGreaterThan(0);
  });

  it("⚠ e a fila continua legível também na REJEIÇÃO", async () => {
    mockGetPlano.mockRejectedValueOnce(new Error("500"));
    responder([item()]);
    montar();
    // o nome sai no cabecalho do grupo E na linha — dois elementos, e o que importa e a aba ter renderizado
    expect((await screen.findAllByText("GOOGLE CLOUD BRASIL")).length).toBeGreaterThan(0);
  });

  it("⚠⚠ o plano que chega DEPOIS do modal abrir ainda preenche o campo", async () => {
    // ⚠ O `useState` inicializador roda UMA vez: sem o efeito de re-sync, a sugestão evaporava em
    // silêncio e o contador tinha de digitar o código.
    let liberar;
    mockGetPlano.mockImplementationOnce(() => new Promise((r) => { liberar = r; }));
    responder([itemNoModal({ sugestao: { conta: "411030012", procedencia: "REGRA_CNPJ" } })]);
    montar();
    fireEvent.click(await screen.findByRole("button", { name: /^Confirmar$/i }));
    const d = await screen.findByRole("dialog");
    const campo = within(d).getByLabelText(/Conta contábil da despesa/i);
    expect(campo).toHaveValue("");
    await act(async () => { liberar(PLANO_DO_TESTE); });
    await waitFor(() => expect(campo).toHaveValue("557"));
  });
});

describe("⚠⚠ o CAIXA torto derruba a linha — e a tela nunca dizia", () => {
  it("sem `111010001` no plano, o envio é bloqueado COM o motivo", async () => {
    mockGetPlano.mockResolvedValueOnce(PLANO_DO_TESTE.filter((c) => c.codigo !== "5"));
    responder([itemNoModal({ sugestao: { conta: "411030012", procedencia: "REGRA_CNPJ" } })]);
    montar();
    fireEvent.click(await screen.findByRole("button", { name: /^Confirmar$/i }));
    const d = await screen.findByRole("dialog");
    await waitFor(() => {
      expect(within(d).getByText(/não tem a conta de caixa/i)).toBeInTheDocument();
    });
    expect(within(d).getByRole("button", { name: /^Confirmar$/i })).toBeDisabled();
  });
});

describe("⚠⚠ o MOTIVO do bloqueio sai VISÍVEL, não só no title", () => {
  // ⚠ O `CLAUDE.md` deste app rejeita a forma title-only DUAS vezes, com a mesma frase:
  // *"`title` não aparece no teclado nem no toque"*. E dois dos quatro motivos (mês fechado, papel
  // insuficiente) não tinham eco NENHUM na tela.
  it("⚠⚠ mês fechado aparece em TEXTO na linha", async () => {
    responder([item({ mesFechado: true })]);
    montar();
    expect(await screen.findByText(/A competência está fechada/i)).toBeInTheDocument();
  });

  it("⚠⚠ papel insuficiente aparece em TEXTO", async () => {
    responder([item()]);
    montar({ podeEscrever: false });
    expect(await screen.findByText(/Seu perfil não pode alterar/i)).toBeInTheDocument();
  });

  it("⚠ a frase NÃO se repete quando dois botões têm o mesmo motivo", async () => {
    responder([item({ mesFechado: true })]);
    montar();
    const achadas = await screen.findAllByText(/A competência está fechada/i);
    expect(achadas).toHaveLength(1);
  });

  it("⚠ em regime normal não há linha de motivo — ela não vira ruído", async () => {
    responder([item({ sugestao: { conta: "411030012", procedencia: "REGRA_CNPJ" } })]);
    montar();
    await screen.findAllByText("GOOGLE CLOUD BRASIL");
    expect(screen.queryByText(/A competência está fechada/i)).toBeNull();
    expect(screen.queryByText(/Seu perfil não pode/i)).toBeNull();
  });
});

describe("⚠ ajustar valor exige valor — o servidor recusava e a tela liberava", () => {
  const abrirAjustar = async () => {
    responder([item({ sugestao: { conta: "411030012", procedencia: "REGRA_CNPJ" } })]);
    montar();
    fireEvent.click(await screen.findByRole("button", { name: /Ajustar valor/i }));
    return screen.findByRole("dialog");
  };

  it("⚠⚠ campo apagado, zero e negativo bloqueiam — todos davam botão HABILITADO", async () => {
    const d = await abrirAjustar();
    const campo = within(d).getByLabelText(/Valor a lançar/i);
    const botao = within(d).getByRole("button", { name: /Ajustar valor/i });
    for (const v of ["", "0", "-5"]) {
      fireEvent.change(campo, { target: { value: v } });
      expect(botao).toBeDisabled();
    }
    fireEvent.change(campo, { target: { value: "900" } });
    expect(botao).not.toBeDisabled();
  });
});
