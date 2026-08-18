// A LINHA DIGITÁVEL NA TELA DO CONTADOR — a LIGAÇÃO, não a regra.
//
// ⚠ `lib/__tests__/linhaDigitavelTela.test.js` já prova que a leitura decide certo. Isso não prova
// nada sobre a tela: o defeito favorito deste projeto é o bloco correto que ninguém chama —
// componente renderizando `null` para sempre porque a prop nunca é passada. O que se prende aqui é
// que `CompanyGuidesTable` REALMENTE monta a célula, com a guia REAL da linha, e que os quatro
// estados chegam ao DOM com desenhos diferentes.
//
// ⚠ E prende também a promessa que mais importa: **o botão copia os 48 dígitos LIMPOS**, não a
// máscara que está na tela — e, sem `navigator.clipboard`, ele diz "não deu" em vez de "✓".

import { render, screen, fireEvent, act } from "@testing-library/react";
import { CompanyGuidesTable } from "../renderCompanyGuidesTable.jsx";

jest.mock("../../../../../api/client", () => ({
  createApiClient: () => ({
    getExpectedGuides: jest.fn().mockResolvedValue({ compliance: {} }),
    getFechamentoContabil: jest.fn().mockResolvedValue({ fechado: false }),
    markGuideVazio: jest.fn(),
    undoGuideVazio: jest.fn(),
  }),
}));
jest.mock("../../../capture/components/renderGuideCaptureModal", () => ({
  GuideCaptureModal: () => null,
}));
jest.mock("../GuiaDeParcelamentoModal", () => ({ GuiaDeParcelamentoModal: () => null }));

const COMP = "2026-06";
// DAS real do banco local: codifica R$ 3.422,00.
const LINHA = "858800000342220003282624010720261829070844066762";
const MASCARA = "85880000034-2 22000328262-4 01072026182-9 07084406676-2";

function guia(over = {}) {
  return {
    guideId: "g1",
    tipo: "SIMPLES",
    competencia: COMP,
    status: "PROCESSED",
    paymentStatus: "OPEN",
    emailStatus: "PENDING",
    valor: 3422,
    canRecalculate: false,
    canConfirmPayment: false,
    parcelamentoId: null,
    linhaDigitavel: null,
    linhaDigitavelSituacao: "NAO_TENTADA",
    linhaDigitavelMotivo: null,
    linhaDigitavelValorLidoCentavos: null,
    linhaDigitavelLidaEm: null,
    ...over,
  };
}

function montar(guides) {
  render(
    <CompanyGuidesTable
      companyId="c1"
      competencia={COMP}
      companyRegime="SIMPLES"
      guides={guides}
      loadingGuides={false}
      onConfirmGuidePayment={jest.fn()}
      onRecalculateGuide={jest.fn()}
      onRecalcularInss={jest.fn()}
      onLiberarGuia={jest.fn()}
      onResendGuide={jest.fn()}
      onDeleteGuide={jest.fn()}
    />,
  );
}

const disponivel = () =>
  guia({ linhaDigitavel: LINHA, linhaDigitavelSituacao: "DISPONIVEL", linhaDigitavelLidaEm: new Date().toISOString() });

/** O clique dispara Promise + setTimeout; sem drenar os dois, o estado do botão não chega ao DOM. */
async function clicarECHegarAoFim(botao) {
  await act(async () => {
    fireEvent.click(botao);
    await Promise.resolve();
  });
}

describe("a coluna existe e está ligada", () => {
  it("a tabela monta o cabeçalho e a célula — a prop chega até lá", () => {
    montar([disponivel()]);
    expect(screen.getByRole("columnheader", { name: "Linha digitável" })).toBeInTheDocument();
    expect(screen.getByText(MASCARA)).toBeInTheDocument();
  });
});

describe("⚠⚠ as TRÊS ausências não são desenhadas iguais", () => {
  it("NÃO TENTAMOS: diz que ninguém leu, e não afirma que o documento não tem", () => {
    montar([guia()]);
    expect(screen.getByText("não lida")).toBeInTheDocument();
    expect(screen.getByTitle(/Ainda não lemos o documento/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Copiar a linha digitável/ })).toBeNull();
  });

  it("NÃO ENCONTRADA: afirma a tentativa, com o motivo catalogado", () => {
    montar([
      guia({
        linhaDigitavelSituacao: "NAO_ENCONTRADA",
        linhaDigitavelMotivo: "linha_digitavel_nao_encontrada_no_texto",
        linhaDigitavelLidaEm: new Date().toISOString(),
      }),
    ]);
    expect(screen.getByText("sem linha no documento")).toBeInTheDocument();
    expect(screen.getByTitle(/Lemos o documento e o documento não traz uma linha de arrecadação legível/)).toBeInTheDocument();
  });

  it("⚠ DIVERGENTE: mostra OS DOIS VALORES e NUNCA a linha — esconder o conflito é pior", () => {
    montar([
      guia({
        valor: 100,
        linhaDigitavelSituacao: "DIVERGENTE",
        linhaDigitavelMotivo: "valor_divergente_do_documento",
        linhaDigitavelValorLidoCentavos: 79079,
        linhaDigitavelLidaEm: new Date().toISOString(),
      }),
    ]);
    expect(screen.getByText("confira: valores divergentes")).toBeInTheDocument();
    const aviso = screen.getByTitle(/não bate com o valor da guia/);
    expect(aviso.getAttribute("title")).toContain("790,79"); // o que o documento imprime
    expect(aviso.getAttribute("title")).toContain("100,00"); // o que a guia tem gravado
    // ⚠ O número em conflito não pode aparecer nem para copiar.
    expect(screen.queryByRole("button", { name: /Copiar a linha digitável/ })).toBeNull();
    expect(screen.queryByText(MASCARA)).toBeNull();
  });

  it("as três convivem na MESMA lista, cada uma com o seu texto", () => {
    // ⚠ Juntas de propósito: é assim que o contador as vê, e é aqui que "desenhar os três iguais"
    // apareceria — três linhas seguidas dizendo a mesma coisa sobre situações diferentes.
    montar([
      guia({ guideId: "g1" }),
      guia({
        guideId: "g2",
        linhaDigitavelSituacao: "NAO_ENCONTRADA",
        linhaDigitavelMotivo: "linha_digitavel_nao_encontrada_no_texto",
        linhaDigitavelLidaEm: new Date().toISOString(),
      }),
      guia({
        guideId: "g3",
        valor: 100,
        linhaDigitavelSituacao: "DIVERGENTE",
        linhaDigitavelMotivo: "valor_divergente_do_documento",
        linhaDigitavelValorLidoCentavos: 79079,
        linhaDigitavelLidaEm: new Date().toISOString(),
      }),
    ]);
    expect(screen.getByText("não lida")).toBeInTheDocument();
    expect(screen.getByText("sem linha no documento")).toBeInTheDocument();
    expect(screen.getByText("confira: valores divergentes")).toBeInTheDocument();
  });
});

describe("⚠ motivo NÃO CATALOGADO não ganha frase inventada", () => {
  it("cai no texto neutro e preserva o valor cru no title, para a auditoria recuperar", () => {
    montar([
      guia({
        linhaDigitavelSituacao: "NAO_ENCONTRADA",
        linhaDigitavelMotivo: "motivo_que_ainda_nao_existe_na_tela",
        linhaDigitavelLidaEm: new Date().toISOString(),
      }),
    ]);
    const cel = screen.getByTitle(/não foi possível obter a linha digitável/);
    expect(cel.getAttribute("title")).toContain("motivo_que_ainda_nao_existe_na_tela");
  });
});

describe("copiar", () => {
  afterEach(() => {
    delete navigator.clipboard;
  });

  it("copia os 48 DÍGITOS LIMPOS, não a máscara que está na tela", async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    montar([disponivel()]);
    await clicarECHegarAoFim(screen.getByRole("button", { name: /Copiar a linha digitável/ }));
    expect(writeText).toHaveBeenCalledWith(LINHA);
    expect(writeText.mock.calls[0][0]).not.toContain("-");
    expect(writeText.mock.calls[0][0]).not.toContain(" ");
  });

  it("⚠ sem `navigator.clipboard` o botão NÃO finge que copiou", async () => {
    // http://ip:porta — como o portal roda em rede local — não expõe a API.
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    montar([disponivel()]);
    await clicarECHegarAoFim(screen.getByRole("button", { name: /Copiar a linha digitável/ }));
    expect(screen.getByTitle(/Não foi possível copiar/)).toBeInTheDocument();
  });
});
