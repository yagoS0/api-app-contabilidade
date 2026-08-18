// A LIGAÇÃO — a tela de guias do CLIENTE mostra mesmo a linha digitável, e as três ausências
// chegam ao DOM com desenhos diferentes.
//
// ⚠⚠ **COMPONENTE SEM CHAMADOR É O DEFEITO FAVORITO DESTE PROJETO.** A regra vive em
// `lib/linhaDigitavelTela.js` e tem suíte própria ao lado; o que se prende AQUI é que ela é
// chamada — que a coluna existe, que a guia real desce até a célula, e que o botão copia.
//
// ⚠ **O CLIENTE NÃO PODE VER OS DOIS VALORES DA DIVERGÊNCIA.** Essa é a diferença deliberada em
// relação ao portal do contador, e é a invariante mais fácil de quebrar sem perceber (bastaria
// reusar o texto de lá). Há teste negativo explícito.
//
// ⚠ **NENHUM TESTE TOCA A REDE.** `fetch` é substituído por um espião que explode e as respostas
// entram pelo objeto `api` — o mesmo módulo que a tela importa, sem `jest.mock` de fábrica, como no
// harness de `emitir/__tests__/emitirNotaPage.ligacao.test.jsx`.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { api } from "../../../api";
import { GuiasPage } from "../GuiasPage";

const EMPRESA = { companyId: "pc-001", razao: "ACME SERVICOS LTDA", cnpj: "11222333000181", myRole: "OWNER" };

// DAS real do banco local: codifica R$ 3.422,00.
const LINHA = "858800000342220003282624010720261829070844066762";
const MASCARA = "85880000034-2 22000328262-4 01072026182-9 07084406676-2";

const guia = (over = {}) => ({
  guideId: "g1",
  tipo: "SIMPLES",
  competencia: "2026-06",
  valor: 3422,
  valorRecalculado: null,
  vencimento: "2026-07-20T00:00:00.000Z",
  paymentStatus: "OPEN",
  paymentConfirmedAt: null,
  numeroParcela: null,
  quantidadeParcelas: null,
  parcelamentoLabel: null,
  linhaDigitavel: null,
  linhaDigitavelSituacao: "NAO_TENTADA",
  linhaDigitavelMotivo: null,
  linhaDigitavelValorLidoCentavos: null,
  linhaDigitavelLidaEm: null,
  ...over,
});

let getGuidesOriginal;
let downloadOriginal;
let fetchOriginal;

beforeEach(() => {
  getGuidesOriginal = api.getGuides;
  downloadOriginal = api.downloadGuide;
  fetchOriginal = global.fetch;
  global.fetch = jest.fn(() => {
    throw new Error("⚠ nenhum teste desta suíte pode tocar a rede");
  });
  // Baixar guia é ação real do cliente: aqui ela nunca é exercida.
  api.downloadGuide = jest.fn(() => {
    throw new Error("⚠ downloadGuide não deveria ser chamado");
  });
});

afterEach(() => {
  expect(api.downloadGuide).not.toHaveBeenCalled();
  api.getGuides = getGuidesOriginal;
  api.downloadGuide = downloadOriginal;
  global.fetch = fetchOriginal;
});

async function montar(guias) {
  api.getGuides = jest.fn(async () => ({ data: guias, page: 1, limit: 25, total: guias.length }));
  render(<GuiasPage empresa={EMPRESA} />);
  await waitFor(() => expect(api.getGuides).toHaveBeenCalled());
  await screen.findByRole("columnheader", { name: "Linha digitável" });
}

/** O clique dispara Promise + setTimeout; sem drenar os dois o estado do botão não chega ao DOM. */
async function clicarECHegarAoFim(botao) {
  await act(async () => {
    fireEvent.click(botao);
    await Promise.resolve();
  });
}

describe("a coluna está ligada", () => {
  it("a guia com linha lida mostra o número INTEIRO, com máscara", async () => {
    await montar([guia({ linhaDigitavel: LINHA, linhaDigitavelSituacao: "DISPONIVEL", linhaDigitavelLidaEm: "2026-08-18T00:00:00.000Z" })]);
    expect(screen.getByText(MASCARA)).toBeInTheDocument();
  });
});

describe("⚠⚠ as TRÊS ausências não são desenhadas iguais", () => {
  it("NÃO TENTAMOS: diz que ainda não lemos — não que o documento não tem", async () => {
    await montar([guia()]);
    expect(screen.getByText(/Ainda não lemos a linha digitável/)).toBeInTheDocument();
    // ⚠ Em toda ausência o PDF continua sendo o caminho para pagar.
    expect(screen.getByText(/Baixe o PDF para pagar/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Copiar a linha digitável/ })).toBeNull();
  });

  it("NÃO ENCONTRADA: afirma que o documento não traz", async () => {
    await montar([guia({ linhaDigitavelSituacao: "NAO_ENCONTRADA", linhaDigitavelMotivo: "linha_digitavel_nao_encontrada_no_texto", linhaDigitavelLidaEm: "x" })]);
    expect(screen.getByText(/Este documento não traz linha digitável/)).toBeInTheDocument();
  });

  it("⚠ DIVERGENTE: diz que está em conferência, e NÃO entrega os dois valores ao cliente", async () => {
    await montar([
      guia({
        valor: 100,
        linhaDigitavelSituacao: "DIVERGENTE",
        linhaDigitavelMotivo: "valor_divergente_do_documento",
        linhaDigitavelValorLidoCentavos: 79079,
        linhaDigitavelLidaEm: "x",
      }),
    ]);
    expect(screen.getByText(/Em conferência com o contador/)).toBeInTheDocument();
    // ⚠ O valor lido do documento é material de trabalho do CONTADOR. Aparecer aqui entregaria um
    // conflito de números na tela de quem só quer saber quanto pagar.
    expect(document.body.textContent).not.toContain("790,79");
    // E o número em conflito nunca vira meio de pagamento.
    expect(screen.queryByText(MASCARA)).toBeNull();
    expect(screen.queryByRole("button", { name: /Copiar a linha digitável/ })).toBeNull();
  });

  it("as três convivem na mesma lista com textos distintos", async () => {
    await montar([
      guia({ guideId: "a" }),
      guia({ guideId: "b", linhaDigitavelSituacao: "NAO_ENCONTRADA", linhaDigitavelLidaEm: "x" }),
      guia({ guideId: "c", linhaDigitavelSituacao: "DIVERGENTE", linhaDigitavelValorLidoCentavos: 79079, linhaDigitavelLidaEm: "x" }),
    ]);
    expect(screen.getByText(/Ainda não lemos/)).toBeInTheDocument();
    expect(screen.getByText(/não traz linha digitável/)).toBeInTheDocument();
    expect(screen.getByText(/Em conferência com o contador/)).toBeInTheDocument();
  });
});

describe("copiar", () => {
  afterEach(() => {
    delete navigator.clipboard;
  });

  it("copia os 48 DÍGITOS LIMPOS, não a máscara que está na tela", async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await montar([guia({ linhaDigitavel: LINHA, linhaDigitavelSituacao: "DISPONIVEL", linhaDigitavelLidaEm: "x" })]);
    await clicarECHegarAoFim(screen.getByRole("button", { name: /Copiar a linha digitável/ }));
    expect(writeText).toHaveBeenCalledWith(LINHA);
    expect(writeText.mock.calls[0][0]).not.toMatch(/[^0-9]/);
  });

  it("⚠ sem `navigator.clipboard` o botão NÃO finge que copiou", async () => {
    // http://ip:porta — como o portal roda em rede local — não expõe a API.
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    await montar([guia({ linhaDigitavel: LINHA, linhaDigitavelSituacao: "DISPONIVEL", linhaDigitavelLidaEm: "x" })]);
    const botao = screen.getByRole("button", { name: /Copiar a linha digitável/ });
    await clicarECHegarAoFim(botao);
    expect(screen.getByText("Não deu")).toBeInTheDocument();
    expect(screen.queryByText("Copiado")).toBeNull();
  });
});
