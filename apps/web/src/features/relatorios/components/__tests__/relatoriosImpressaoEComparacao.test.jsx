// O QUE O PAPEL PRECISA CARREGAR SOZINHO — a marca das barras e o nome do período comparado.
//
// Os dois defeitos são do MESMO tipo: a tela sabe a resposta e o PDF não, e é o PDF que circula.
//
//   1. A regra de impressão (compartilhada, `@media print` no `App.css`) zera o fundo de todo
//      descendente da área impressa. A barra do mês COM movimento é só fundo colorido; a do mês
//      VAZIO é transparente com tracejado. No papel sobrava a marca de exatamente os meses em que
//      NADA foi lançado — o inverso do que a tela mostra. O contorno que conserta isso é escolhido
//      pelo CSS a partir do `data-print-barra`, então é ele que se trava aqui.
//   2. A comparação com o período anterior nunca era NOMEADA. "▲ 12,4% vs. período anterior" não
//      diz contra o quê, e no PDF não há como descobrir.
//
// ⚠ LIMITE DECLARADO: o Jest não carrega o `App.css` e o jsdom não tem `@media print`. O que se
// prova aqui é a LIGAÇÃO (a marca existe, com o valor certo, dentro da área impressa) — que o
// contorno de fato aparece no papel só se confere imprimindo.

import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { RelatoriosTab } from "../RelatoriosTab";

const mockGetRelatorioResumo = jest.fn();
jest.mock("../../../../api/client", () => ({
  createApiClient: () => ({ getRelatorioResumo: (...a) => mockGetRelatorioResumo(...a) }),
}));

const comMovimento = (competencia, total) => ({ competencia, porTipo: { RECEITA: total }, total });
const semLancamento = (competencia) => ({ competencia, porTipo: {}, total: 0, semLancamento: true });

// Referência 2026-07 → "Últimos 12 meses" (o default) = 2025-08 a 2026-07; o anterior, do MESMO
// tamanho, é 2024-08 a 2025-07.
const ATUAL = { de: "2025-08", ate: "2026-07" };
const ANTERIOR = { de: "2024-08", ate: "2025-07" };

function responder({ anteriorTem = true } = {}) {
  mockGetRelatorioResumo.mockImplementation((_id, de, ate) => {
    if (de === ATUAL.de && ate === ATUAL.ate) {
      return Promise.resolve({ linhas: [comMovimento("2026-06", 5000), semLancamento("2026-07")] });
    }
    if (de === ANTERIOR.de && ate === ANTERIOR.ate) {
      return Promise.resolve(anteriorTem ? { linhas: [comMovimento("2025-07", 4000)] } : {});
    }
    return Promise.resolve({ linhas: [] });
  });
}

beforeEach(() => { mockGetRelatorioResumo.mockReset(); });

describe("RelatoriosTab — o que o PDF precisa dizer sozinho", () => {
  it("⚠ a barra do mês COM movimento se declara, e a do mês vazio se declara diferente", async () => {
    responder();
    const { container } = render(<RelatoriosTab companyId="c1" competenciaReferencia="2026-07" />);
    await screen.findByRole("button", { name: /Imprimir/ });

    const barras = container.querySelectorAll("[data-print-barra]");
    // Uma marca por mês da série: sem isso, o mês some do papel.
    expect(barras).toHaveLength(2);
    expect(barras[0]).toHaveAttribute("data-print-barra", "movimento");
    expect(barras[1]).toHaveAttribute("data-print-barra", "vazio");

    // ⚠ E as duas dentro da área impressa — marca fora dela não é alcançada por regra nenhuma.
    const area = container.querySelector("[data-print-area]");
    expect(area).toContainElement(barras[0]);
    expect(area).toContainElement(barras[1]);
  });

  it("⚠ o período comparado é NOMEADO, e sai no papel (dentro da área impressa)", async () => {
    responder();
    const { container } = render(<RelatoriosTab companyId="c1" competenciaReferencia="2026-07" />);

    const rotulo = await screen.findByText(`${ANTERIOR.de} a ${ANTERIOR.ate}`);
    expect(container.querySelector("[data-print-area]")).toContainElement(rotulo);
    // O intervalo é o MESMO que foi buscado — o rótulo não pode ser um segundo cálculo.
    expect(mockGetRelatorioResumo).toHaveBeenCalledWith("c1", ANTERIOR.de, ANTERIOR.ate);
  });

  it("o rótulo acompanha a troca de período — 2026-05 a 2026-07 compara com 2026-02 a 2026-04", async () => {
    responder();
    mockGetRelatorioResumo.mockImplementation((_id, de, ate) => Promise.resolve({
      linhas: [comMovimento(de, de === "2026-02" ? 4000 : 5000)],
      _de: de,
      _ate: ate,
    }));
    render(<RelatoriosTab companyId="c1" competenciaReferencia="2026-07" />);
    await screen.findByRole("button", { name: /Imprimir/ });

    fireEvent.click(screen.getByRole("button", { name: "Trimestre" }));
    expect(await screen.findByText("2026-02 a 2026-04")).toBeInTheDocument();
  });

  it("sem período anterior para comparar, nada é afirmado", async () => {
    responder({ anteriorTem: false });
    render(<RelatoriosTab companyId="c1" competenciaReferencia="2026-07" />);
    await screen.findByRole("button", { name: /Imprimir/ });

    // Sem a resposta do anterior não há comparação na tela; nomear um período que não foi
    // comparado seria pior que não nomear nada.
    expect(screen.queryByText(`${ANTERIOR.de} a ${ANTERIOR.ate}`)).not.toBeInTheDocument();
    expect(screen.queryByText(/Comparação com o período anterior/)).not.toBeInTheDocument();
  });
});
