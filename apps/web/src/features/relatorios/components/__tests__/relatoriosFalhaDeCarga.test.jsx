// O CAMINHO DA FALHA DO RELATÓRIO — o mais caro dos cinco, porque o defeito SAI EM PAPEL.
//
// A troca de período que falhava NÃO limpava `dados`: a tabela e os totais do período ANTERIOR
// continuavam na tela sob o rótulo do período NOVO, com o botão Imprimir ativo em cima. O PDF que
// sai daí declara um período e traz o movimento de outro — e esse PDF circula sem esta tela por
// perto para desmenti-lo.
//
// O que se trava aqui: na falha não sobra NADA do período anterior — nem número, nem tabela, nem
// impressão.

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { RelatoriosTab } from "../RelatoriosTab";

const mockGetRelatorioResumo = jest.fn();
jest.mock("../../../../api/client", () => ({
  createApiClient: () => ({ getRelatorioResumo: (...a) => mockGetRelatorioResumo(...a) }),
}));

/** Um mês com movimento — `total` é o número que não pode sobreviver à troca de período. */
function linha(competencia, total) {
  return { competencia, porTipo: { RECEITA: total }, total };
}

const PERIODO_A = { ok: true, linhas: [linha("2026-06", 111111), linha("2026-07", 111111)] };

beforeEach(() => { mockGetRelatorioResumo.mockReset(); });

describe("RelatoriosTab — recarga que falha não deixa o período anterior na tela", () => {
  it("⚠ o total do período ANTERIOR some, e o Imprimir vai junto", async () => {
    mockGetRelatorioResumo.mockResolvedValue(PERIODO_A);
    render(<RelatoriosTab companyId="c1" competenciaReferencia="2026-07" razaoSocial="ALFA LTDA" />);

    // 1) O período que carregou: o número está na tela e dá para imprimir.
    await screen.findByRole("button", { name: /Imprimir/ });
    expect(screen.getAllByText(/222\.222,00/).length).toBeGreaterThan(0);

    // 2) A troca de período falha.
    mockGetRelatorioResumo.mockRejectedValue(new Error("consulta expirou"));
    fireEvent.click(screen.getByRole("button", { name: "Mês" }));

    await screen.findByText("Não foi possível carregar o relatório");
    // 3) NADA do período anterior sobrou — e é isto que impede o PDF trocado.
    expect(screen.queryByText(/222\.222,00/)).not.toBeInTheDocument();
    expect(screen.queryByText(/111\.111,00/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Imprimir/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Total do período")).not.toBeInTheDocument();
    expect(screen.getByText("consulta expirou")).toBeInTheDocument();
  });

  it("⚠ resposta sem `linhas` não vira tabela de zeros", async () => {
    mockGetRelatorioResumo.mockResolvedValue({ ok: true });
    render(<RelatoriosTab companyId="c1" competenciaReferencia="2026-07" />);

    await screen.findByText("Não foi possível carregar o relatório");
    expect(screen.queryByRole("button", { name: /Imprimir/ })).not.toBeInTheDocument();
    expect(screen.queryByText("R$ 0,00")).not.toBeInTheDocument();
  });

  it("403 diz que é acesso, não que o relatório não existe", async () => {
    mockGetRelatorioResumo.mockRejectedValue(Object.assign(new Error("forbidden"), { status: 403 }));
    render(<RelatoriosTab companyId="c1" competenciaReferencia="2026-07" />);

    await screen.findByText("Você não tem acesso a estes dados");
    expect(screen.queryByText(/Não foi possível carregar o relatório/)).not.toBeInTheDocument();
  });

  it("a falha vai embora quando o período seguinte carrega", async () => {
    mockGetRelatorioResumo.mockRejectedValue(new Error("consulta expirou"));
    render(<RelatoriosTab companyId="c1" competenciaReferencia="2026-07" />);
    await screen.findByText("Não foi possível carregar o relatório");

    mockGetRelatorioResumo.mockResolvedValue(PERIODO_A);
    fireEvent.click(screen.getByRole("button", { name: "Trimestre" }));

    await waitFor(() => expect(screen.getByRole("button", { name: /Imprimir/ })).toBeInTheDocument());
    expect(screen.queryByText("Não foi possível carregar o relatório")).not.toBeInTheDocument();
  });
});
