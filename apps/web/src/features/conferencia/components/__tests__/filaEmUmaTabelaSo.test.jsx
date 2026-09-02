// ⚠⚠⚠ A FILA É **UMA** TABELA — conserto medido, 01/09/2026.
//
// > Dono, com a tela na frente: *"o ui e UX dessa pagina é um total loucura"*.
//
// O QUE FOI MEDIDO NO NAVEGADOR ANTES DE MEXER (empresa de teste, mock, 1440×900):
//
//   · a página tinha **6.302px** — 7 telas de rolagem;
//   · a fila renderizava **11 `<table>` para 11 linhas** (uma por grupo), ou seja o cabeçalho de
//     **9 colunas repetido 11 vezes** para 11 linhas de dado;
//   · e as 11 tabelas tinham **11 arranjos de coluna DIFERENTES** — cada `<table>` se dimensiona
//     pelo próprio conteúdo. A coluna Valor começava em x=733 numa e em x=657 na seguinte: o
//     número que o contador varre de cima a baixo **serpenteava** pela página.
//
// ⚠ AGRUPAR NÃO SAIU, e este arquivo é o que impede alguém de "consertar" desfazendo o agrupamento:
// o fornecedor continua sendo a unidade de conferência, agora como `<tbody>`. O que a moldura única
// entrega é o alinhamento — e o alinhamento é a única coisa que faz uma coluna de dinheiro ser
// legível.
//
// ⚠ A regra de QUANDO a linha de grupo aparece mora em `lib/conferenciaTela.js`
// (`cabecalhoDoGrupo`), com teste próprio. Aqui se trava a LIGAÇÃO, não a regra de novo.

import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

const mockGetFila = jest.fn();
const mockGetPlano = jest.fn();
const mockGetPendencias = jest.fn();

jest.mock("../../../../api/client", () => ({
  createApiClient: () => ({
    getConferenciaFila: (...a) => mockGetFila(...a),
    postConferenciaAcao: jest.fn(),
    postConferenciaFluxo: jest.fn(),
    getChartOfAccounts: (...a) => mockGetPlano(...a),
    getConferenciaPendencias: (...a) => mockGetPendencias(...a),
  }),
}));

import { ConferenciaTab } from "../renderConferenciaTab";

const base = {
  origem: "OFX_CLIENTE",
  estado: "A_CONFERIR",
  valorAjustado: null,
  competencia: "2026-07",
  cnpjFornecedor: null,
  dataDocumento: null,
  detalheServico: null,
  dataPagamento: "2026-07-15",
  origemPagamento: "OFX",
  mesFechado: false,
  contaSugerida: null,
  sugestao: null,
  nota: null,
  previstoNoFluxoEm: null,
};

// ⚠ Três linhas de EXTRATO, sem CNPJ — é o caso real que produzia um grupo por linha: a chave de
// `agruparPorFornecedor` cai na descrição quando não há CNPJ.
const TRES_SOZINHAS = [
  { ...base, id: "d-1", descricaoOriginal: "PAGTO KODA BEAR", valor: "890.00" },
  { ...base, id: "d-2", descricaoOriginal: "TARIFA PACOTE DE SERVICOS", valor: "175.00" },
  { ...base, id: "d-3", descricaoOriginal: "PAGTO MENSALIDADE", valor: "500.00" },
];

const montar = async (itens) => {
  mockGetFila.mockResolvedValue({ ok: true, itens, porEstado: {}, total: itens.length });
  const r = render(<ConferenciaTab companyId="emp-1" competencia="2026-07" />);
  await waitFor(() => expect(screen.getAllByRole("row").length).toBeGreaterThan(1));
  return r;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetPlano.mockResolvedValue([
    { codigo: "5", codigoCompleto: "111010001", nome: "Caixa", analitica: true },
    { codigo: "401", codigoCompleto: "411020001", nome: "Aluguel", analitica: true },
  ]);
  mockGetPendencias.mockResolvedValue({ ok: true, declaradosForaDaCompetencia: 0 });
});

describe("⚠⚠ a fila inteira cabe numa tabela só", () => {
  it("três fornecedores distintos ⇒ UMA `<table>`, UM cabeçalho de coluna", async () => {
    const { container } = await montar(TRES_SOZINHAS);
    // ⚠ O número que importa não é "uma tabela por gosto": é que o cabeçalho de 9 colunas seja lido
    // UMA vez. Antes eram 3 tabelas e 3 cabeçalhos para 3 linhas.
    expect(container.querySelectorAll("table")).toHaveLength(1);
    expect(container.querySelectorAll("thead")).toHaveLength(1);
    expect(screen.getAllByRole("columnheader", { name: "Valor" })).toHaveLength(1);
  });

  it("⚠ e o agrupamento CONTINUA — um `<tbody>` por fornecedor", async () => {
    const { container } = await montar(TRES_SOZINHAS);
    expect(container.querySelectorAll("tbody")).toHaveLength(3);
  });

  it("⚠⚠ grupo de uma linha sem CNPJ não repete a descrição acima dela", async () => {
    await montar(TRES_SOZINHAS);
    // Antes: "PAGTO KODA BEAR" saía no cabeçalho do grupo E na linha — duas vezes, a mesma frase.
    expect(screen.getAllByText("PAGTO KODA BEAR")).toHaveLength(1);
    expect(screen.queryByText(/1 lançamento\(s\)/)).toBeNull();
  });

  it("⚠ com CNPJ o cabeçalho do grupo VOLTA, e é `<th>` de grupo de linhas", async () => {
    const { container } = await montar([
      { ...base, id: "d-9", descricaoOriginal: "GOOGLE CLOUD", valor: "1500.00", cnpjFornecedor: "12345678000190" },
    ]);
    expect(screen.getByText("12.345.678/0001-90")).toBeInTheDocument();
    expect(container.querySelector('th[scope="colgroup"]')).not.toBeNull();
    // ⚠ Só o CNPJ entra: o "1 lançamento(s) · R$ …" repetiria a coluna Valor da única linha.
    expect(screen.queryByText(/1 lançamento\(s\)/)).toBeNull();
  });

  it("⚠ dois lançamentos do mesmo fornecedor ⇒ cabeçalho com o total, que nenhuma linha mostra", async () => {
    await montar([
      { ...base, id: "d-a", descricaoOriginal: "ENERGIA", valor: "100.00" },
      { ...base, id: "d-b", descricaoOriginal: "ENERGIA", valor: "50.00" },
    ]);
    expect(screen.getByText(/2 lançamento\(s\)/)).toBeInTheDocument();
  });
});

describe("⚠⚠ e a tela ganhou esqueleto de cabeçalhos", () => {
  it("as três seções são `<h2>` de verdade — antes eram `<strong>`, e a página tinha UM heading", async () => {
    await montar(TRES_SOZINHAS);
    const h2 = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(h2).toEqual([
      "Vira lançamento contábil",
      "Só entra no fluxo — não lança nada",
      "Regras — o que decide sozinho",
    ]);
  });
});
