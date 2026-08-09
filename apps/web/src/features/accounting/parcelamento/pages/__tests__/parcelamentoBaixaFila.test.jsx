// ⚠ "NÃO CONSIGO DAR BAIXA EM NENHUMA PARCELA" — o segundo defeito do incidente, e ele NÃO é o
// mesmo do acordeão.
//
// O `Dar baixa` do card não lança nada: ele TRAZ o contador até a fila "Parcelas pagas aguardando
// lançamento" e destaca as parcelas do contrato clicado. Quando o contrato não tem nenhuma parcela
// nessa fila — o caso de um contrato inteiro sem guia — o clique rolava a página, destacava zero
// linhas, e o subtítulo ainda afirmava *"Destacadas: as do contrato que você clicou"*. Um botão que
// promete uma ação e devolve silêncio é indistinguível de um botão quebrado.
//
// A fila é alimentada por `guia.paymentStatus = PAID` (a rota `parcelas-pendentes-baixa` filtra por
// `guia`), então prestação SEM guia não tem por onde entrar. Isso é capacidade que FALTA, não botão
// que promete demais — e a tela precisa dizer isso, não escondê-lo.

import { render, screen, fireEvent, act } from "@testing-library/react";
import { ParcelamentoTab } from "../renderParcelamentoTab.jsx";

const mockListPendentes = jest.fn();

jest.mock("../../../../../api/client", () => ({
  createApiClient: () => ({
    listParcelasPendentesBaixa: (...a) => mockListPendentes(...a),
    lancarBaixaParcela: jest.fn(),
    buscarPagamentoGuia: jest.fn(),
  }),
}));

const contrato = (over = {}) => ({
  id: "parc-sem-guia", label: "OUTRO 2026 — migrado", tipo: "OUTRO", numeroParcelamento: "3",
  status: "ATIVO", numParcelas: 60, parcelasTotal: 60, parcelasPagas: 0,
  principalPerParcela: 1200, totalValue: 38037.74, formaPagamento: null,
  guides: [], parcelas: [],
  parcelasContratadas: Array.from({ length: 3 }, (_, i) => ({
    id: `p${i + 1}`, numeroParcela: i + 1, vencimento: null, guia: null,
  })),
  ...over,
});

function montar(pendentes = []) {
  mockListPendentes.mockResolvedValue({ ok: true, parcelas: pendentes });
  return render(
    <ParcelamentoTab
      companyId="c1"
      parcelamentos={{
        parcelamentos: [contrato()], loading: false, error: null,
        load: jest.fn(), listConferencia: jest.fn(async () => ({ ok: true, itens: [] })),
      }}
    />,
  );
}

beforeAll(() => { Element.prototype.scrollIntoView = jest.fn(); });
beforeEach(() => { mockListPendentes.mockReset(); });

// ⚠ O ÚLTIMO, não o primeiro: a fila fica ACIMA dos cards, e o "Dar baixa" dela (o que realmente
// lança) apareceria primeiro no DOM sempre que houvesse parcela pendente. O botão sob teste é o do
// CARD — o que só navega até a fila.
const darBaixaDoCard = () => screen.getAllByRole("button", { name: "Dar baixa" }).at(-1);

describe("o 'Dar baixa' do card responde mesmo quando não há o que baixar", () => {
  it("fila vazia para aquele contrato: diz que não há nenhuma, e por quê", async () => {
    await act(async () => { montar([]); });
    await act(async () => { fireEvent.click(darBaixaDoCard()); });

    expect(screen.getByText(/Nenhuma parcela de OUTRO 2026/i)).toBeTruthy();
    // ⚠ E NOMEIA A CAPACIDADE QUE FALTA, em vez de deixar o contador procurando o que fez de errado.
    expect(screen.getByText(/ainda não existe no sistema/i)).toBeTruthy();
  });

  // A afirmação falsa que existia: "Destacadas: as do contrato que você clicou", com zero destacadas.
  it("não afirma que destacou nada quando não destacou", async () => {
    await act(async () => { montar([]); });
    await act(async () => { fireEvent.click(darBaixaDoCard()); });
    expect(screen.queryByText(/Destacadas: as do contrato/i)).toBeNull();
  });

  it("com parcela na fila daquele contrato, o destaque é afirmado e o aviso não aparece", async () => {
    await act(async () => {
      montar([{ guideId: "g1", parcelaId: "p1", parcelamentoId: "parc-sem-guia", numeroParcela: 1, competencia: "2026-05", valor: 1200, comprovante: null, confirmadoEm: null }]);
    });
    await act(async () => { fireEvent.click(darBaixaDoCard()); });

    expect(screen.getByText(/Destacadas: as do contrato/i)).toBeTruthy();
    expect(screen.queryByText(/ainda não existe no sistema/i)).toBeNull();
  });

  // ⚠ Falha de rede NÃO pode virar "não há nada pendente" — são a mesma quantidade de linhas na
  // tela e significados opostos. O painel já distinguia os dois; o aviso novo não pode desfazer isso.
  it("erro ao carregar a fila não vira 'não há nada deste contrato'", async () => {
    mockListPendentes.mockRejectedValue(new Error("rede caiu"));
    await act(async () => {
      render(
        <ParcelamentoTab
          companyId="c1"
          parcelamentos={{
            parcelamentos: [contrato()], loading: false, error: null,
            load: jest.fn(), listConferencia: jest.fn(async () => ({ ok: true, itens: [] })),
          }}
        />,
      );
    });
    await act(async () => { fireEvent.click(darBaixaDoCard()); });

    expect(screen.getByText(/quer dizer que não há nada pendente/i)).toBeTruthy();
    expect(screen.queryByText(/ainda não existe no sistema/i)).toBeNull();
  });
});
