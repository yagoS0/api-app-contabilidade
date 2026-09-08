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


describe("seleção e lançamento em lote", () => {
  const pronta = (id, extra={}) => ({ ...LINHA, id, descricaoOriginal: id, contaSugeridaIa: "411030012", creditoSugeridoIa: "111020001", ...extra });
  async function abrir(itens) { fila(itens); render(<ConferenciaTab companyId="emp-1" competencia="2026-07" podeEscrever />); await waitFor(() => expect(screen.getByLabelText("Selecionar um")).toBeEnabled()); }
  it("envia apenas selecionadas, com débito/crédito editados e sem alterar prova de pagamento", async () => {
    await abrir([pronta("um"),pronta("dois")]);
    fireEvent.change(screen.getByLabelText(/Conta contábil de um/), {target:{value:"401"}});
    fireEvent.click(screen.getByLabelText("Selecionar um"));
    fireEvent.click(screen.getByRole("button",{name:/Lançar selecionados/}));
    const modal=await screen.findByRole("dialog");
    expect(within(modal).queryByText("dois")).toBeNull();
    fireEvent.click(within(modal).getByRole("button",{name:/Confirmar 1/}));
    await waitFor(()=>expect(mockPostAcao).toHaveBeenCalledTimes(1));
    expect(mockPostAcao).toHaveBeenCalledWith("emp-1","um","confirmar",{contaAplicada:"411020001",contaCredito:"111020001"});
  });
  it("selecionar todas exclui mês fechado e informa resultado parcial sem reenviar sucessos", async () => {
    await abrir([pronta("um"),pronta("dois"),pronta("fechada",{mesFechado:true})]);
    expect(screen.getByLabelText("Selecionar fechada")).toBeDisabled();
    mockPostAcao.mockResolvedValueOnce({ok:true}).mockRejectedValueOnce(new Error("Mês fechado no servidor"));
    await waitFor(()=>expect(screen.getByLabelText("Selecionar dois")).toBeEnabled());
    fireEvent.click(screen.getByLabelText("Selecionar todas as linhas prontas desta página"));
    await waitFor(()=>expect(screen.getByRole("button",{name:"Lançar selecionados (2)"})).toBeEnabled());
    fireEvent.click(screen.getByRole("button",{name:/Lançar selecionados/}));
    const modal=await screen.findByRole("dialog");
    fireEvent.click(within(modal).getByRole("button",{name:/Confirmar 2/}));
    expect(await within(modal).findByText("Mês fechado no servidor")).toBeInTheDocument();
    expect(within(modal).getByText("Lançado")).toBeInTheDocument();
    expect(mockPostAcao).toHaveBeenCalledTimes(2);
    expect(within(modal).queryByRole("button",{name:/Confirmar/})).toBeNull();
  });
  it("nova suspeita de duplicidade impede abrir o lote", async () => {
    await abrir([pronta("um")]);
    fireEvent.click(screen.getByLabelText("Selecionar um"));
    mockGetCasamentos.mockResolvedValue({linhas:[{debito:{id:"um"},sugestao:{nota:{id:"nota"}}}]});
    fireEvent.click(screen.getByRole("button",{name:/Lançar selecionados/}));
    expect(await screen.findByText(/Há débitos selecionados/)).toBeInTheDocument();
    expect(mockPostAcao).not.toHaveBeenCalled();
  });
});
