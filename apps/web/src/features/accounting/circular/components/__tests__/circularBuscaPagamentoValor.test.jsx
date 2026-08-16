// O VALOR DO PAGAMENTO NÃO SAI EM FORMATO AMERICANO.
//
// O desfecho da busca no SERPRO era o único número desta aba escrito com `toFixed(2)`: a tela
// inteira diz "R$ 1.234,56" e o alerta dizia "R$ 193.03". Ponto onde se lê vírgula não é detalhe
// tipográfico num valor pago — é a leitura de milhar contra a de centavo, no exato momento em que
// o contador confere o comprovante contra a provisão que vai baixar.
//
// ⚠ Não há formatador novo: é o `fmtValor` que a célula, o popover e o rodapé desta mesma aba já
// usam. O que se trava aqui é que ele continua sendo o de lá.

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CircularTab } from "../renderCircularTab.jsx";

jest.mock("../../../baixa/components/renderBaixaModal", () => ({ BaixaModal: () => null }));

const mockBuscarPagamentoGuia = jest.fn();
jest.mock("../../../../../api/client", () => ({
  createApiClient: () => ({ buscarPagamentoGuia: (...a) => mockBuscarPagamentoGuia(...a) }),
}));

const HOJE = new Date();
const COMP = `${HOJE.getFullYear()}-${String(HOJE.getMonth() + 1).padStart(2, "0")}`;

function renderTab() {
  return render(
    <CircularTab
      companyId="c1"
      circularData={{
        provisoes: [{
          id: "e1",
          subtipo: "DAS",
          competencia: COMP,
          statusPagamento: "ABERTO",
          valor: 193.03,
          baixas: [],
          sourceGuide: { id: "g1", tipo: "DAS", envios: [], vencimento: null },
        }],
        receitas: {},
        acrescimos: {},
        extrato: {},
        entries: [],
      }}
      loading={false}
      year={HOJE.getFullYear()}
      competencia={COMP}
      companyRegime="SIMPLES"
      accounts={[]}
      onCompetenciaChange={jest.fn()}
      onYearChange={jest.fn()}
      onLoad={jest.fn().mockResolvedValue(undefined)}
      onCreateBaixa={jest.fn()}
      savingBaixa={false}
    />,
  );
}

function buscar() {
  fireEvent.click(screen.getByRole("button", { name: "R$ 193,03" }));
  fireEvent.click(screen.getByRole("button", { name: /Buscar pagamento/ }));
}

describe("Circular — o desfecho da busca de pagamento fala pt-BR", () => {
  let alerta;
  beforeEach(() => {
    mockBuscarPagamentoGuia.mockReset();
    alerta = jest.spyOn(window, "alert").mockImplementation(() => {});
  });
  afterEach(() => { alerta.mockRestore(); });

  it("⚠ 'R$ 193,03' — vírgula decimal, como o resto da tela", async () => {
    mockBuscarPagamentoGuia.mockResolvedValue({
      encontrado: true,
      comprovante: { dataArrecadacao: "20/07/2026", total: 193.03 },
    });
    renderTab();
    buscar();

    await waitFor(() => expect(alerta).toHaveBeenCalled());
    const texto = alerta.mock.calls[0][0];
    expect(texto).toContain("R$ 193,03");
    expect(texto).not.toContain("193.03");
  });

  it("o milhar separa com ponto e os centavos com vírgula — 1.234,56", async () => {
    mockBuscarPagamentoGuia.mockResolvedValue({
      encontrado: true,
      comprovante: { dataArrecadacao: "20/07/2026", total: 1234.56 },
    });
    renderTab();
    buscar();

    await waitFor(() => expect(alerta).toHaveBeenCalled());
    expect(alerta.mock.calls[0][0]).toContain("R$ 1.234,56");
  });

  it("⚠ comprovante sem total NÃO vira 'R$ 0,00' — a frase omite o valor", async () => {
    mockBuscarPagamentoGuia.mockResolvedValue({
      encontrado: true,
      comprovante: { dataArrecadacao: "20/07/2026", total: null },
    });
    renderTab();
    buscar();

    await waitFor(() => expect(alerta).toHaveBeenCalled());
    const texto = alerta.mock.calls[0][0];
    expect(texto).toContain("Pagamento localizado em 20/07/2026");
    expect(texto).not.toMatch(/R\$/);
    expect(texto).not.toContain("null");
  });
});
