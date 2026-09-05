// A COLUNA "ENVIO" NA TABELA DE GUIAS — a LIGAÇÃO, não a regra.
//
// ⚠ `lib/__tests__/envioNaTela.test.js` já prova que a leitura decide certo. Isso não prova nada
// sobre a tela: o defeito favorito deste projeto é o bloco correto que ninguém chama. O que se
// prende aqui é que `CompanyGuidesTable` monta a célula com a guia REAL da linha, e que os estados
// chegam ao DOM com desenhos diferentes.
//
// ⚠⚠ E prende o que originou tudo: em 05/09/2026 a tela disse "WhatsApp enviado" em VERDE sobre uma
// mensagem que a Meta aceitou e descartou. "Aceita, sem confirmação" não pode se parecer com
// "entregue" — nem no texto, nem no tom.

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

function guia(envio, over = {}) {
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
    linhaDigitavelSituacao: "NAO_TENTADA",
    envio,
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

const zap = (status, extra = {}) => ({
  jaEnviada: status !== "falhou",
  canais: [{ canal: "WHATSAPP", status, destino: "5521999998888", ...extra }],
});

describe("a coluna existe e substitui a de e-mail", () => {
  it("o cabeçalho é 'Envio' — e 'E-mail' saiu", () => {
    montar([guia(zap("entregue"))]);
    expect(screen.getByRole("columnheader", { name: "Envio" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "E-mail" })).toBeNull();
  });

  it("⚠ continuam NOVE colunas — a grade do CSS tem as faixas cravadas", () => {
    // Uma décima coluna aqui quebraria o alinhamento em silêncio (`App.css`, `.guides-grid`).
    montar([guia(zap("entregue"))]);
    expect(screen.getAllByRole("columnheader")).toHaveLength(9);
  });
});

describe("⚠⚠ os estados chegam ao DOM, e não se parecem", () => {
  it("WhatsApp aceito e sem confirmação NÃO diz 'entregue' nem 'enviado'", () => {
    montar([guia(zap("enviado"))]);
    expect(screen.getByText(/aceita, sem confirmação/)).toBeInTheDocument();
    expect(screen.queryByText(/entregue/)).toBeNull();
  });

  it("entregue e lida aparecem com ✓✓", () => {
    montar([guia(zap("entregue"), { guideId: "g1" })]);
    expect(screen.getByText(/entregue/)).toBeInTheDocument();
    expect(screen.getByText("✓✓")).toBeInTheDocument();
  });

  it("⚠ a falha PARCIAL aparece com a contagem — ela não some atrás do sucesso", () => {
    montar([guia({
      jaEnviada: true,
      canais: [
        { canal: "WHATSAPP", status: "entregue", destino: "5521999998888" },
        { canal: "WHATSAPP", status: "falhou", destino: "5521988887777", erroMensagem: "sem opt-in" },
      ],
    })]);
    expect(screen.getByText(/só uma parte saiu \(1\/2\)/)).toBeInTheDocument();
  });

  it("guia sem o bloco de envio não é chamada de 'não enviada'", () => {
    // Contrato antigo: dizer "não enviada" seria afirmar que ninguém tentou.
    montar([guia(undefined)]);
    expect(screen.getByText(/sem informação de envio/)).toBeInTheDocument();
  });
});

describe("⚠⚠ o aviso de reenvio vale para QUALQUER canal", () => {
  // Experimento executado antes deste bloco: devolvendo `alreadySent` para `emailStatus === "SENT"`
  // a suíte ficava VERDE — a guarda não tinha prova nenhuma. Guia enviada só por WhatsApp passava
  // direto pelo aviso, e a segunda cópia saía sem ninguém perguntar.
  function abrirLiberar(guides) {
    montar(guides);
    fireEvent.click(screen.getByRole("checkbox", { name: /Selecionar guia/ }));
    fireEvent.click(screen.getByRole("button", { name: /Liberar ao cliente/ }));
  }

  it("guia enviada SÓ por WhatsApp abre o aviso — e nomeia o canal certo", () => {
    abrirLiberar([guia(zap("entregue"))]);
    expect(screen.getByText(/Guia já enviada/)).toBeInTheDocument();
    expect(screen.getByText(/por WhatsApp/)).toBeInTheDocument();
    // ⚠ E NÃO diz "por e-mail", que é o que a frase afirmava sempre.
    expect(screen.queryByText(/por e-mail\./)).toBeNull();
  });

  it("guia nunca enviada NÃO abre o aviso — libera direto", () => {
    const onLiberarGuia = jest.fn();
    render(
      <CompanyGuidesTable
        companyId="c1" competencia={COMP} companyRegime="SIMPLES"
        guides={[guia({ jaEnviada: false, canais: [] })]} loadingGuides={false}
        onConfirmGuidePayment={jest.fn()} onRecalculateGuide={jest.fn()} onRecalcularInss={jest.fn()}
        onLiberarGuia={onLiberarGuia} onResendGuide={jest.fn()} onDeleteGuide={jest.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: /Selecionar guia/ }));
    fireEvent.click(screen.getByRole("button", { name: /Liberar ao cliente/ }));
    expect(screen.queryByText(/Guia já enviada/)).toBeNull();
    expect(onLiberarGuia).toHaveBeenCalled();
  });
});

describe("⚠⚠ a tela reolha enquanto a resposta pode mudar", () => {
  // O desfecho verdadeiro chega pelo WEBHOOK, segundos depois. Em 05/09/2026 a tela disse "enviado"
  // e nunca mais olhou: o `failed` da Meta chegou 5 s depois e só apareceria com F5.
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  function montarCom(guides, onRefresh) {
    render(
      <CompanyGuidesTable
        companyId="c1" competencia={COMP} companyRegime="SIMPLES"
        guides={guides} loadingGuides={false} onRefresh={onRefresh}
        onConfirmGuidePayment={jest.fn()} onRecalculateGuide={jest.fn()} onRecalcularInss={jest.fn()}
        onLiberarGuia={jest.fn()} onResendGuide={jest.fn()} onDeleteGuide={jest.fn()}
      />,
    );
  }

  it("com guia aguardando confirmação, pede recarga sozinha", () => {
    const onRefresh = jest.fn().mockResolvedValue();
    montarCom([guia(zap("enviado"))], onRefresh);
    expect(onRefresh).not.toHaveBeenCalled();
    act(() => { jest.advanceTimersByTime(2600); });
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("⚠ com tudo entregue, NÃO fica perguntando", () => {
    const onRefresh = jest.fn().mockResolvedValue();
    montarCom([guia(zap("entregue"))], onRefresh);
    act(() => { jest.advanceTimersByTime(30000); });
    expect(onRefresh).not.toHaveBeenCalled();
  });
});
