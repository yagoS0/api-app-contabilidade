// ⚠ CRIAR O CONTRATO NÃO RECARREGAVA AS FILAS DE BAIXA — o trabalho que a criação gerou ficava
// invisível.
//
// `useParcelamentos.ingest` já chamava `load()`, então o CARD do contrato aparecia na hora. As duas
// filas, porém, são requisições dos FILHOS (`ParcelasPendentesBaixa` e `ParcelasSemGuiaPendentes`),
// presas em `baixaRefreshKey` — e nada bumpava essa chave na criação. Um contrato migrado nasce com
// N prestações vencidas SEM GUIA: o painel "Prestações vencidas sem guia" continuava com o número
// antigo, e só subia depois de sair da aba e voltar.
//
// A correção é o `onClose` do wizard chamar `aposAto()` — o MESMO handler que a exclusão e o
// desfazer-rescisão já usam, pelo mesmo motivo (ato sobre o contrato mexe nas duas filas).
//
// ⚠ Este teste conta CHAMADAS, não conteúdo de lista: um teste que olhasse só a tela passaria com o
// defeito de volta, porque a fila renderiza o resultado da chamada antiga sem nenhum sinal de que
// ele envelheceu.

import { render, screen, fireEvent, act } from "@testing-library/react";
import { ParcelamentoTab } from "../renderParcelamentoTab.jsx";

const mockListPendentes = jest.fn();
const mockListSemGuia = jest.fn();

jest.mock("../../../../../api/client", () => ({
  createApiClient: () => ({
    listParcelasPendentesBaixa: (...a) => mockListPendentes(...a),
    listParcelasSemGuiaPendentes: (...a) => mockListSemGuia(...a),
    lancarBaixaManualParcela: jest.fn(),
    lancarBaixaParcela: jest.fn(),
    buscarPagamentoGuia: jest.fn(),
  }),
}));

async function montar() {
  mockListPendentes.mockResolvedValue({ ok: true, parcelas: [] });
  mockListSemGuia.mockResolvedValue({ ok: true, parcelas: [], foraDaFila: null });
  const parcelamentos = {
    parcelamentos: [], loading: false, error: null,
    load: jest.fn(),
    listConferencia: jest.fn(async () => ({ ok: true, itens: [] })),
    ingest: jest.fn(async () => ({ ok: true })),
    consultarSerpro: jest.fn(),
    getContasProvisao: jest.fn(async () => ({})),
    saving: false,
  };
  render(<ParcelamentoTab companyId="c1" parcelamentos={parcelamentos} />);
  await act(async () => { await Promise.resolve(); });
  return parcelamentos;
}

beforeAll(() => { Element.prototype.scrollIntoView = jest.fn(); });
beforeEach(() => {
  mockListPendentes.mockReset();
  mockListSemGuia.mockReset();
});

describe("⚠ fechar o wizard recarrega AS DUAS filas de baixa", () => {
  it("o número da fila 'sem guia' deixa de ficar para trás depois de criar o contrato", async () => {
    const parcelamentos = await montar();
    const antesSemGuia = mockListSemGuia.mock.calls.length;
    const antesPendentes = mockListPendentes.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: /\+ Novo parcelamento/i }));
    expect(screen.getByLabelText("Fechar")).toBeInTheDocument();  // o wizard está aberto

    // Sem nada preenchido o wizard fecha direto (não há o que perder) — é o mesmo `onClose` que
    // ele chama depois de `onIngest` dar certo.
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Fechar"));
      await Promise.resolve();
    });

    expect(mockListSemGuia.mock.calls.length).toBeGreaterThan(antesSemGuia);
    expect(mockListPendentes.mock.calls.length).toBeGreaterThan(antesPendentes);
    // ⚠ E a lista de contratos também — `aposAto` faz as duas coisas, como na exclusão.
    expect(parcelamentos.load).toHaveBeenCalled();
  });
});
