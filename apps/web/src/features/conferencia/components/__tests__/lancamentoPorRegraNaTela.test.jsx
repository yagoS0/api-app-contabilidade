// ⚠⚠ AS DUAS TELAS DA REGRA QUE LANÇA SOZINHA (29/08/2026).
//
// > Dono: *"o contador deve poder colocar o código de débito e crédito nessa despesa, e todo mês
// > que essa nota aparecer ela já é lançada em despesa."*
//
// ⚠⚠ O que este arquivo protege, acima de tudo, é que a tela **diga o que está fazendo**: marcar
// uma regra aqui faz nascer lançamento contábil sem ninguém clicar, e a data com que ele nasce é
// PRESUMIDA. Uma tela silenciosa sobre isso deixaria o contador descobrir no razão.
//
// ⚠ E ele carrega o teste de FUMAÇA que esta base já pagou quatro vezes: identificador órfão passa
// pelo `npm run build` e derruba a aba inteira em runtime.

import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { createApiClient } from "../../../../api/client";
import { PainelDeRegras } from "../PainelDeRegras";
import { PainelDeLancadosPorRegra } from "../PainelDeLancadosPorRegra";

jest.mock("../../../../api/client", () => {
  const api = {
    getConferenciaRegras: jest.fn(),
    postConferenciaRegra: jest.fn(),
    patchConferenciaRegraAutomatico: jest.fn(),
    getLancadosPorRegra: jest.fn(),
    postDesfazerLancadosPorRegra: jest.fn(),
  };
  return { createApiClient: () => api, __api: api };
});

const api = createApiClient();

const CONTAS = [
  { codigo: "557", codigoCompleto: "411030012", nome: "SOFTWARE", analitica: true },
  { codigo: "1", codigoCompleto: "111010001", nome: "CAIXA MATRIZ", analitica: true },
  { codigo: "2", codigoCompleto: "111020003", nome: "BANCO ITAU", analitica: true },
  { codigo: "9", codigoCompleto: "411", nome: "DESPESAS ADMINISTRATIVAS", analitica: false },
];

const REGRAS = {
  ok: true,
  indisponivel: false,
  regras: [
    {
      id: "reg-1", ativa: true, cnpjFornecedor: "12345678000190", padraoDescricao: null,
      valorMin: "1050.00", valorMax: "1180.00", contaDestino: "411030012", contaCredito: "111010001",
      lancaSozinha: true, diaDoLancamento: 15, aplicacoes: 3,
    },
    {
      id: "reg-2", ativa: true, cnpjFornecedor: "98765432000110", padraoDescricao: null,
      valorMin: "312.40", valorMax: "418.90", contaDestino: "411020008", contaCredito: null,
      lancaSozinha: false, diaDoLancamento: null, aplicacoes: 7,
    },
    {
      id: "reg-3", ativa: true, cnpjFornecedor: null, padraoDescricao: "TARIFA PACOTE",
      valorMin: "46.20", valorMax: "46.20", contaDestino: "411050003", contaCredito: null,
      lancaSozinha: false, diaDoLancamento: null, aplicacoes: 11,
    },
  ],
};

const EXTRATO = {
  ok: true,
  indisponivel: false,
  competencia: "2026-08",
  total: 2,
  valor: 2230,
  linhas: [
    {
      id: "dec-r1", descricaoOriginal: "ALESSANDRO NIGRO", cnpjFornecedor: "12345678000190",
      valor: "1180.00", valorAjustado: null, competencia: "2026-08",
      dataPagamento: "2026-08-15", contaAplicada: "411030012", accountingEntryId: "ae-r1",
    },
    {
      id: "dec-r2", descricaoOriginal: "ALESSANDRO NIGRO", cnpjFornecedor: "12345678000190",
      valor: "1050.00", valorAjustado: null, competencia: "2026-08",
      dataPagamento: "2026-08-15", contaAplicada: "411030012", accountingEntryId: "ae-r2",
    },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  api.getConferenciaRegras.mockResolvedValue(REGRAS);
  api.postConferenciaRegra.mockResolvedValue({ ok: true, regra: { id: "reg-nova" } });
  api.patchConferenciaRegraAutomatico.mockResolvedValue({ ok: true, regra: { id: "reg-2", lancaSozinha: true } });
  api.getLancadosPorRegra.mockResolvedValue(EXTRATO);
  api.postDesfazerLancadosPorRegra.mockResolvedValue({ pedidos: 2, desfeitos: 2, ids: ["dec-r1", "dec-r2"], recusados: [] });
});

async function montarRegras(props = {}) {
  render(<PainelDeRegras companyId="emp-1" contas={CONTAS} {...props} />);
  await act(async () => {});
}

async function montarExtrato(props = {}) {
  render(<PainelDeLancadosPorRegra companyId="emp-1" competencia="2026-08" {...props} />);
  await act(async () => {});
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ o painel das regras MONTA", () => {
  // ⚠⚠ O TESTE DE FUMAÇA. É a QUINTA vez que esta base se protege disso: um identificador órfão
  // passa pelo `npm run build` e só aparece como aba em branco no navegador.
  it("monta e mostra as três regras sem estourar", async () => {
    await montarRegras();
    expect(screen.getByText(/Regras do fornecedor/i)).toBeInTheDocument();
    expect(screen.getByText(/12\.345\.678\/0001-90/)).toBeInTheDocument();
    expect(screen.getByText(/TARIFA PACOTE/)).toBeInTheDocument();
  });

  it("⚠⚠ a regra que lança sozinha DIZ o dia e DIZ que a data é presumida", async () => {
    await montarRegras();
    expect(screen.getByText(/todo dia 15/i)).toBeInTheDocument();
    expect(screen.getByText(/presumida/i)).toBeInTheDocument();
  });

  it("⚠⚠ a regra de DESCRIÇÃO não oferece o botão de lançar — é impedimento, com o motivo", async () => {
    await montarRegras({ podeEscrever: true });
    const botoes = screen.getAllByRole("button", { name: /Lançar sozinha/i });
    // A de descrição é a terceira: o botão existe (some esconderia que a ação existe) e está
    // desabilitado, com a frase do impedimento no `title`.
    const desabilitado = botoes.find((b) => b.disabled);
    expect(desabilitado).toBeTruthy();
    expect(desabilitado.getAttribute("title")).toMatch(/não pode lançar sozinha/i);
  });

  it("⚠ sem permissão de escrita não há botão de criar nem de ligar", async () => {
    await montarRegras({ podeEscrever: false });
    expect(screen.queryByRole("button", { name: /Nova regra/i })).not.toBeInTheDocument();
  });
});

describe("⚠⚠ o formulário da regra", () => {
  const abrir = async () => {
    await montarRegras();
    fireEvent.click(screen.getByRole("button", { name: /Nova regra/i }));
  };

  it("⚠⚠ o seletor do CRÉDITO oferece só caixa e banco — nunca despesa", async () => {
    await abrir();
    const credito = screen.getByLabelText(/Crédito \(caixa ou banco\)/i);
    const opcoes = [...credito.querySelectorAll("option")].map((o) => o.value);
    expect(opcoes).toContain("111010001");
    expect(opcoes).toContain("111020003");
    expect(opcoes).not.toContain("411030012");
    // ⚠ E o vazio continua sendo uma opção: "não escolhi" mantém o caixa de hoje.
    expect(opcoes).toContain("");
  });

  it("⚠ o seletor do DÉBITO não oferece conta sintética", async () => {
    await abrir();
    const debito = screen.getByLabelText(/Débito \(a despesa\)/i);
    const opcoes = [...debito.querySelectorAll("option")].map((o) => o.value);
    expect(opcoes).toContain("411030012");
    expect(opcoes).not.toContain("411");
  });

  it("⚠⚠ o botão nasce DESABILITADO e DIZ o que falta", async () => {
    await abrir();
    expect(screen.getByRole("button", { name: /Criar regra/i })).toBeDisabled();
    expect(screen.getByText(/âncora/i)).toBeInTheDocument();
  });

  it("⚠⚠ marcar 'lançar sozinha' pede o DIA, e diz o custo da data fixa", async () => {
    await abrir();
    fireEvent.change(screen.getByLabelText(/CNPJ do fornecedor/i), { target: { value: "12345678000190" } });
    fireEvent.change(screen.getByLabelText(/Valor mínimo/i), { target: { value: "1000" } });
    fireEvent.change(screen.getByLabelText(/Valor máximo/i), { target: { value: "1500" } });
    fireEvent.change(screen.getByLabelText(/Débito/i), { target: { value: "411030012" } });
    expect(screen.getByRole("button", { name: /Criar regra/i })).toBeEnabled();

    fireEvent.click(screen.getByRole("checkbox"));
    // ⚠⚠ Sem o dia o botão volta a recusar — a data não se arbitra.
    expect(screen.getByRole("button", { name: /Criar regra/i })).toBeDisabled();
    expect(screen.getByText(/em que dia do mês/i)).toBeInTheDocument();
    // ⚠⚠ E o custo da decisão vai ESCRITO NA TELA, não num comentário.
    expect(screen.getByText(/ninguém provou que o dinheiro saiu nesse dia/i)).toBeInTheDocument();
  });

  it("⚠⚠ o que chega ao servidor tem `lancaSozinha` e o dia — e o resto vem `null`, não vazio", async () => {
    await abrir();
    fireEvent.change(screen.getByLabelText(/CNPJ do fornecedor/i), { target: { value: "12345678000190" } });
    fireEvent.change(screen.getByLabelText(/Valor mínimo/i), { target: { value: "1050" } });
    fireEvent.change(screen.getByLabelText(/Valor máximo/i), { target: { value: "1180" } });
    fireEvent.change(screen.getByLabelText(/Débito/i), { target: { value: "411030012" } });
    fireEvent.change(screen.getByLabelText(/Crédito/i), { target: { value: "111010001" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.change(screen.getByLabelText(/Dia do mês/i), { target: { value: "15" } });

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Criar regra/i })); });

    expect(api.postConferenciaRegra).toHaveBeenCalledWith("emp-1", expect.objectContaining({
      cnpjFornecedor: "12345678000190",
      contaDestino: "411030012",
      contaCredito: "111010001",
      valorMin: 1050,
      valorMax: 1180,
      lancaSozinha: true,
      diaDoLancamento: 15,
    }));
    // ⚠ Descrição vazia vira `null`, nunca `""` — o servidor lê ausência, não string vazia.
    expect(api.postConferenciaRegra.mock.calls[0][1].padraoDescricao).toBeNull();
  });

  it("⚠⚠ com o automático DESLIGADO, o dia NÃO viaja", async () => {
    // Mandá-lo daria a impressão de que existe uma data configurada esperando ser ligada.
    await abrir();
    fireEvent.change(screen.getByLabelText(/CNPJ do fornecedor/i), { target: { value: "12345678000190" } });
    fireEvent.change(screen.getByLabelText(/Valor mínimo/i), { target: { value: "1000" } });
    fireEvent.change(screen.getByLabelText(/Valor máximo/i), { target: { value: "1500" } });
    fireEvent.change(screen.getByLabelText(/Débito/i), { target: { value: "411030012" } });

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Criar regra/i })); });

    expect(api.postConferenciaRegra.mock.calls[0][1].lancaSozinha).toBe(false);
    expect(api.postConferenciaRegra.mock.calls[0][1].diaDoLancamento).toBeNull();
  });

  it("⚠ a recusa do SERVIDOR aparece com a frase dele — a tela não a reescreve", async () => {
    // Ele pode recusar por algo que o espelho não sabe (conta ambígua, plano da empresa).
    api.postConferenciaRegra.mockRejectedValue({ body: { message: "Duas contas apontam para este código." } });
    await abrir();
    fireEvent.change(screen.getByLabelText(/CNPJ do fornecedor/i), { target: { value: "12345678000190" } });
    fireEvent.change(screen.getByLabelText(/Valor mínimo/i), { target: { value: "1000" } });
    fireEvent.change(screen.getByLabelText(/Valor máximo/i), { target: { value: "1500" } });
    fireEvent.change(screen.getByLabelText(/Débito/i), { target: { value: "411030012" } });

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Criar regra/i })); });

    expect(await screen.findByText(/Duas contas apontam/)).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ o EXTRATO do que entrou sem clique", () => {
  it("monta, lista o que nasceu sozinho e diz que a data é presumida", async () => {
    await montarExtrato();
    expect(screen.getByText(/Lançados por regra/i)).toBeInTheDocument();
    expect(screen.getAllByText(/ALESSANDRO NIGRO/)).toHaveLength(2);
    expect(screen.getByText(/nasceram sozinhos, por regra/i)).toBeInTheDocument();
  });

  it("⚠⚠ o painel SOME quando não há nada lançado por regra", async () => {
    // Com a automação desligada — o estado normal — um bloco permanente dizendo "nenhum lançamento
    // automático" ocuparia a tela para afirmar o óbvio.
    api.getLancadosPorRegra.mockResolvedValue({ ok: true, competencia: "2026-08", total: 0, valor: 0, linhas: [] });
    const { container } = render(<PainelDeLancadosPorRegra companyId="emp-1" competencia="2026-08" />);
    await act(async () => {});
    expect(container).toBeEmptyDOMElement();
  });

  it("⚠ sem a migration aplicada ele também some — e não afirma que não há nada", async () => {
    api.getLancadosPorRegra.mockResolvedValue({ ok: true, indisponivel: true, total: 0, valor: 0, linhas: [] });
    const { container } = render(<PainelDeLancadosPorRegra companyId="emp-1" competencia="2026-08" />);
    await act(async () => {});
    expect(container).toBeEmptyDOMElement();
  });

  it("⚠⚠ duas linhas do MESMO fornecedor são distinguíveis por leitor de tela", async () => {
    // O caso normal desta tela é a mesma regra lançando o mesmo fornecedor várias vezes no mês.
    // Com o nome sozinho no rótulo, desfazer a linha errada apagaria lançamento certo.
    await montarExtrato({ podeEscrever: true });
    const rotulos = screen.getAllByRole("checkbox").map((c) => c.getAttribute("aria-label"));
    expect(new Set(rotulos).size).toBe(rotulos.length);
  });

  it("⚠⚠ o desfazer manda SÓ o que foi marcado", async () => {
    await montarExtrato({ podeEscrever: true });
    fireEvent.click(screen.getByRole("checkbox", { name: /ALESSANDRO NIGRO.*1\.180,00/i }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^Desfazer/i })); });

    expect(api.postDesfazerLancadosPorRegra).toHaveBeenCalledWith("emp-1", ["dec-r1"]);
  });

  it("⚠ sem nada marcado o botão fica desabilitado", async () => {
    await montarExtrato({ podeEscrever: true });
    expect(screen.getByRole("button", { name: /^Desfazer/i })).toBeDisabled();
  });

  it("⚠⚠ o que FALHA aparece NOMEADO — o lote não para, e a linha recusada não some", async () => {
    api.postDesfazerLancadosPorRegra.mockResolvedValue({
      pedidos: 2, desfeitos: 1, ids: ["dec-r1"],
      recusados: [{ id: "dec-r2", motivo: "mes_fechado", frase: "A competência está fechada." }],
    });
    await montarExtrato({ podeEscrever: true });
    fireEvent.click(screen.getByRole("checkbox", { name: /ALESSANDRO NIGRO.*1\.180,00/i }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^Desfazer/i })); });

    expect(await screen.findByText(/1 de 2 desfeitos/i)).toBeInTheDocument();
    expect(screen.getByText(/A competência está fechada/i)).toBeInTheDocument();
  });

  it("⚠ sem permissão de escrita não há caixa de seleção nem botão", async () => {
    await montarExtrato({ podeEscrever: false });
    expect(screen.queryByRole("button", { name: /^Desfazer/i })).not.toBeInTheDocument();
    for (const caixa of screen.getAllByRole("checkbox")) expect(caixa).toBeDisabled();
  });

  it("⚠ a competência pedida é a da tela — o painel não escolhe o mês que audita", async () => {
    render(<PainelDeLancadosPorRegra companyId="emp-1" competencia="2026-07" />);
    await act(async () => {});
    await waitFor(() => expect(api.getLancadosPorRegra).toHaveBeenCalledWith("emp-1", "2026-07"));
  });
});

// -------------------------------------------------------------------------------------------------
describe("a montagem dentro da Conferencia", () => {
  it("o painel do extrato NAO leva `key` amarrada a `versao`", () => {
    // ⚠⚠ ACHADO NO NAVEGADOR (30/08/2026), e o teste existe porque a tela continuava "funcionando".
    //
    // Com `key={`lpr-${versao}`}`, desfazer bumpava a versao, a key mudava, o React DESMONTAVA o
    // painel — e o relatorio "1 de 2 desfeitos · dec-r2: a competencia esta fechada" morria no
    // mesmo instante em que nascia. Sobrava a metade que ja funcionava (o desfazer) e sumia a
    // metade que este extrato existe para dar: saber o que NAO foi desfeito.
    const fs = require("node:fs");
    const path = require("node:path");
    // ⚠⚠ O PAINEL MUDOU DE TELA em 01/09/2026 (virou a aba «Lançamentos automáticos»), e a
    // garantia veio junto: ela é sobre o RELATÓRIO do desfazer, que morre se o React desmontar o
    // painel. Onde ele é montado mudou; o que não pode mudar é ele não levar `key` variável.
    const daAba = fs.readFileSync(
      path.join(__dirname, "..", "..", "..", "companies", "detail", "pages", "renderCompanyDetailPage.jsx"),
      "utf8",
    );
    const i = daAba.indexOf("<PainelDeLancadosPorRegra");
    expect(i).toBeGreaterThan(-1);
    expect(daAba.slice(i, i + 400)).not.toMatch(/key=/);

    // ⚠ E o painel de casamentos CONTINUA com a dele, na Conferência: ele nao tem recarga propria.
    const fonte = fs.readFileSync(path.join(__dirname, "..", "renderConferenciaTab.jsx"), "utf8");
    const j = fonte.indexOf("<PainelDeCasamentos");
    expect(fonte.slice(j, j + 200)).toMatch(/key=\{versao\}/);
  });
});
