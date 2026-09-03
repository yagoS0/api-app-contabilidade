// ⚠⚠ O BOTÃO «SUGERIR CONTAS COM IA» NA ABA — a ligação (02/09/2026).
//
// > Dono: *"a IA é um botão em cima de tudo (…) ela deve colocar os códigos apenas naqueles que não
// > entraram a regra."*
//
// A regra do pré-voo tem teste em `lib/__tests__/classificacaoIaNaTela.test.js`. O que se prende
// AQUI é a LIGAÇÃO: o botão só aparece com a flag do servidor; desabilita COM o motivo quando não há
// linha sem regra nem histórico; a linha desenha a proposta da IA com chip PRÓPRIO e a justificativa
// VISÍVEL; e regra VENCE IA no desenho — o campo nasce com a conta da regra, não com a do modelo.

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";

const mockGetFila = jest.fn();
const mockGetPlano = jest.fn();
const mockPostAcao = jest.fn();
const mockGetPendencias = jest.fn();
const mockGetCasamentos = jest.fn();
const mockPostClassificarIa = jest.fn();

jest.mock("../../../../api/client", () => ({
  createApiClient: () => ({
    getConferenciaFila: (...a) => mockGetFila(...a),
    postConferenciaAcao: (...a) => mockPostAcao(...a),
    getChartOfAccounts: (...a) => mockGetPlano(...a),
    getConferenciaPendencias: (...a) => mockGetPendencias(...a),
    getConferenciaCasamentos: (...a) => mockGetCasamentos(...a),
    postClassificarIa: (...a) => mockPostClassificarIa(...a),
  }),
}));

import { ConferenciaTab } from "../renderConferenciaTab";

const PLANO = [
  { codigo: "5", codigoCompleto: "111010001", nome: "Caixa", analitica: true },
  { codigo: "12", codigoCompleto: "111020001", nome: "BANCO ITAU", analitica: true },
  { codigo: "401", codigoCompleto: "411020001", nome: "Aluguel", analitica: true },
  { codigo: "410", codigoCompleto: "411030012", nome: "Software e nuvem", analitica: true },
];

const LINHA = {
  id: "dec-1",
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
  contaSugerida: null,
  contaAplicada: null,
  contaCredito: null,
  sugestao: null,
  contaSugeridaIa: null,
  creditoSugeridoIa: null,
  justificativaIa: null,
  sugeridaIaModelo: null,
  sugeridaIaEm: null,
  nota: null,
};

const fila = (itens, extra = {}) =>
  mockGetFila.mockResolvedValue({ ok: true, itens, porEstado: {}, total: itens.length, iaClassificacaoLigada: true, ...extra });

beforeEach(() => {
  jest.clearAllMocks();
  mockGetPlano.mockResolvedValue(PLANO);
  mockPostAcao.mockResolvedValue({ ok: true });
  mockGetPendencias.mockResolvedValue({ pendencias: [] });
  mockGetCasamentos.mockResolvedValue({ linhas: [], totalDebitos: 0, totalNotas: 0 });
  mockPostClassificarIa.mockResolvedValue({
    ok: true, recusa: null, semLinhas: false, linhasOlhadas: 1, linhasEnviadas: 1, lotes: 1, propostas: 1, gravadas: 1,
    recusadas: [{ id: "dec-9", motivo: "conta_sintetica" }], ilegiveis: 0, erros: [], recusadaPelaGuarda: null,
    custoEstimadoCentavos: 3, modelo: "claude-opus-5",
  });
});

const montar = async () => {
  render(<ConferenciaTab companyId="emp-1" competencia="2026-07" podeEscrever />);
  // ⚠ `findAllByText`: a descrição sai no cabeçalho do grupo E na linha.
  await screen.findAllByText("GOOGLE CLOUD BRASIL");
};
const botao = () => screen.queryByRole("button", { name: "Sugerir contas com IA" });

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ o botão", () => {
  it("⚠ sem a flag do servidor, o botão NÃO aparece — integração desligada não é ação bloqueada", async () => {
    fila([LINHA], { iaClassificacaoLigada: false });
    await montar();
    expect(botao()).toBeNull();
    // e `undefined` (contrato antigo) também é desligada
    mockGetFila.mockResolvedValue({ ok: true, itens: [LINHA], porEstado: {}, total: 1 });
  });

  it("⚠⚠ com a flag e uma linha sem regra nem histórico, o botão aparece HABILITADO e diz quantas", async () => {
    fila([LINHA]);
    await montar();
    await waitFor(() => expect(botao()).toBeEnabled());
    expect(botao()).toHaveAttribute("title", expect.stringMatching(/1 linha\(s\) sem regra nem histórico/));
  });

  it("⚠⚠ quando TODAS têm conta por regra/histórico, o botão fica VISÍVEL e desabilitado COM o motivo", async () => {
    fila([{ ...LINHA, sugestao: { conta: "411020001", procedencia: "REGRA_CNPJ", frase: "regra" } }]);
    await montar();
    await waitFor(() => expect(botao()).toBeDisabled());
    expect(botao()).toHaveAttribute("title", expect.stringMatching(/regra ou histórico/i));
  });

  it("sem papel de escrita, desabilitado com o motivo do perfil", async () => {
    fila([LINHA]);
    render(<ConferenciaTab companyId="emp-1" competencia="2026-07" podeEscrever={false} />);
    // ⚠ `findAllByText`: a descrição sai no cabeçalho do grupo E na linha.
  await screen.findAllByText("GOOGLE CLOUD BRASIL");
    await waitFor(() => expect(botao()).toBeDisabled());
    expect(botao()).toHaveAttribute("title", expect.stringMatching(/perfil/i));
  });

  it("⚠⚠ o clique abre o diálogo que DIZ o que vai acontecer antes de chamar; «Sugerir» chama a rota com a competência e o relatório sai inteiro", async () => {
    fila([LINHA]);
    await montar();
    await waitFor(() => expect(botao()).toBeEnabled());
    fireEvent.click(botao());
    const dialogo = await screen.findByRole("dialog");
    // antes do clique: diz que a regra vence, que nada é lançado e que tem custo
    expect(within(dialogo).getByText(/não são enviadas/)).toBeInTheDocument();
    expect(within(dialogo).getByText(/Nada é lançado/)).toBeInTheDocument();
    expect(within(dialogo).getByText(/tem custo/)).toBeInTheDocument();
    expect(mockPostClassificarIa).not.toHaveBeenCalled();

    fireEvent.click(within(dialogo).getByRole("button", { name: "Sugerir" }));
    await waitFor(() => expect(mockPostClassificarIa).toHaveBeenCalledWith("emp-1", { competencia: "2026-07" }));
    // o relatório: gravadas, e a recusada COM o motivo em português
    expect(await within(dialogo).findByText(/receberam uma proposta da IA/)).toBeInTheDocument();
    expect(within(dialogo).getByText(/recusadas pelo sistema/)).toBeInTheDocument();
    expect(within(dialogo).getByText(/sintética/)).toBeInTheDocument();
    // ⚠ e a fila é recarregada — a proposta mora na linha
    expect(mockGetFila.mock.calls.length).toBeGreaterThan(1);
  });

  it("⚠ a guarda recusando antes do primeiro lote é dito como 'nada foi enviado', com o motivo", async () => {
    mockPostClassificarIa.mockResolvedValue({
      ok: true, recusa: null, semLinhas: false, linhasOlhadas: 1, linhasEnviadas: 0, lotes: 0, propostas: 0, gravadas: 0,
      recusadas: [], ilegiveis: 0, erros: [], recusadaPelaGuarda: { motivo: "teto_empresa", mensagem: "teto", apartirDoLote: 1 },
      custoEstimadoCentavos: 0, modelo: "claude-opus-5",
    });
    fila([LINHA]);
    await montar();
    await waitFor(() => expect(botao()).toBeEnabled());
    fireEvent.click(botao());
    const dialogo = await screen.findByRole("dialog");
    fireEvent.click(within(dialogo).getByRole("button", { name: "Sugerir" }));
    expect(await within(dialogo).findByText(/Nada foi enviado ao modelo/)).toBeInTheDocument();
    expect(within(dialogo).getByText(/teto mensal/)).toBeInTheDocument();
  });

  it("⚠ o 503 nomeado do servidor aparece por escrito, nunca 'não foi possível' mudo", async () => {
    mockPostClassificarIa.mockRejectedValue(new Error("A sugestão de contas por IA está desligada neste ambiente (INTEGRACAO_IA_CLASSIFICACAO)."));
    fila([LINHA]);
    await montar();
    await waitFor(() => expect(botao()).toBeEnabled());
    fireEvent.click(botao());
    const dialogo = await screen.findByRole("dialog");
    fireEvent.click(within(dialogo).getByRole("button", { name: "Sugerir" }));
    expect(await within(dialogo).findByText(/INTEGRACAO_IA_CLASSIFICACAO/)).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ a linha desenha a proposta — e a regra VENCE a IA", () => {
  const COM_IA = { ...LINHA, contaSugeridaIa: "411030012", creditoSugeridoIa: "111020001", justificativaIa: "serviço de nuvem = despesa com software", sugeridaIaModelo: "claude-opus-5", sugeridaIaEm: "2026-09-02T15:00:00.000Z" };

  it("⚠⚠ sem regra nem histórico: o débito e o crédito nascem com a proposta, com o chip 'proposta da IA' e a justificativa VISÍVEL", async () => {
    fila([COM_IA]);
    await montar();
    await waitFor(() => expect(screen.getByLabelText(/Conta contábil de GOOGLE CLOUD/i)).toHaveValue("410"));
    await waitFor(() => expect(screen.getByLabelText(/Conta de crédito de GOOGLE CLOUD/i)).toHaveValue("12"));
    expect(screen.getByText("proposta da IA")).toBeInTheDocument();
    // ⚠ a justificativa em TEXTO, não em `title`
    expect(screen.getByText(/serviço de nuvem = despesa com software/)).toBeInTheDocument();
    // e o botão da IA fica desabilitado: esta linha já tem proposta? NÃO — a IA só olha regra/histórico.
    // A linha continua candidata (o contador pode pedir de novo), então o botão segue habilitado.
    await waitFor(() => expect(botao()).toBeEnabled());
  });

  it("⚠⚠⚠ com REGRA e proposta da IA ao mesmo tempo, o campo nasce com a conta da REGRA e o chip é o da regra", async () => {
    fila([{ ...COM_IA, sugestao: { conta: "411020001", credito: "111010001", procedencia: "REGRA_CNPJ", motivo: null, frase: "Uma regra deste fornecedor aponta esta conta.", regraId: "r-1" } }]);
    await montar();
    await waitFor(() => expect(screen.getByLabelText(/Conta contábil de GOOGLE CLOUD/i)).toHaveValue("401"));
    await waitFor(() => expect(screen.getByLabelText(/Conta de crédito de GOOGLE CLOUD/i)).toHaveValue("5"));
    expect(screen.queryByText("proposta da IA")).toBeNull();
    expect(screen.queryByText(/serviço de nuvem = despesa com software/)).toBeNull();
  });

  it("com HISTÓRICO e proposta da IA, o histórico vence", async () => {
    fila([{ ...COM_IA, sugestao: { conta: "411020001", credito: null, procedencia: "HISTORICO", motivo: null, frase: "Você já lançou assim.", regraId: null } }]);
    await montar();
    await waitFor(() => expect(screen.getByLabelText(/Conta contábil de GOOGLE CLOUD/i)).toHaveValue("401"));
    expect(screen.queryByText("proposta da IA")).toBeNull();
  });

  it("⚠ a proposta da IA NÃO passa por cima do que o contador digitou", async () => {
    fila([COM_IA]);
    await montar();
    const debito = await screen.findByLabelText(/Conta contábil de GOOGLE CLOUD/i);
    await waitFor(() => expect(debito).toHaveValue("410"));
    fireEvent.change(debito, { target: { value: "401" } });
    expect(debito).toHaveValue("401");
  });
});
