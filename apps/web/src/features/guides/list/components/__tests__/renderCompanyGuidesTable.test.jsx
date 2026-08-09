// A BARRA DE AÇÕES DA GUIA SELECIONADA — a ligação entre o vínculo de parcelamento e o que a
// tela oferece.
//
// ⚠ Existe por causa do Recalcular. A PARCELA de parcelamento é `tipo:"SIMPLES"`, idêntica ao DAS
// do mês, e a barra escolhia a ação pelo `tipo` — então a parcela ganhava um "Recalcular" que
// dispara o PGDAS-D DO MÊS por cima dela (o backend não recusa: `canGuideRecalculate` só olha
// source/tipo/pago). Quem separa as duas é o `parcelamentoId`, e a leitura é uma só:
// `ehGuiaDeParcelamento` (`lib/rotuloGuia.js`), com teste próprio.
//
// Aqui se testa a LIGAÇÃO: que o botão certo aparece, desabilitado, com o motivo à vista, e que
// clicar nele não chama endpoint nenhum — e que Confirmar pagamento / Liberar ao cliente
// continuam valendo para a parcela, porque agem sobre a própria guia.
import { render, screen, fireEvent } from "@testing-library/react";
import { CompanyGuidesTable } from "../renderCompanyGuidesTable.jsx";

// O componente instancia o client no topo do módulo (dropdown "Marcar vazio" é auto-contido).
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
// ⚠ O modal de anexo trocou de casa e de desenho (R4): era `ParcelamentoIngestaoModal` +
// `ParcelamentoEntradaModal`, os dois do fluxo guia-first. Hoje é o `GuiaDeParcelamentoModal`, com o
// parcelamento no primeiro campo.
jest.mock("../GuiaDeParcelamentoModal", () => ({
  GuiaDeParcelamentoModal: () => null,
}));

const COMP = "2026-03";

// Molde do DTO de `toGuideResponse`: a parcela chega com `tipo:"SIMPLES"` e `canRecalculate:true`
// — é exatamente essa combinação que fazia o botão aparecer habilitado.
function guiaDoDas(over = {}) {
  return {
    guideId: "g-das",
    tipo: "SIMPLES",
    competencia: COMP,
    status: "PROCESSED",
    paymentStatus: "OPEN",
    emailStatus: "PENDING",
    canRecalculate: true,
    canConfirmPayment: true,
    parcelamentoId: null,
    ...over,
  };
}

function guiaDaParcela(over = {}) {
  return guiaDoDas({
    guideId: "g-parc",
    parcelamentoId: "p1",
    parcelamentoTipo: "PARCSN",
    parcelamentoNumero: "1234567",
    numeroParcela: 3,
    quantidadeParcelas: 10,
    ...over,
  });
}

function renderTabela(guides, handlers = {}) {
  const props = {
    companyId: "c1",
    competencia: COMP,
    companyRegime: "SIMPLES",
    guides,
    loadingGuides: false,
    onConfirmGuidePayment: jest.fn(),
    onRecalculateGuide: jest.fn(),
    onRecalcularInss: jest.fn(),
    onLiberarGuia: jest.fn(),
    onResendGuide: jest.fn(),
    onDeleteGuide: jest.fn(),
    ...handlers,
  };
  render(<CompanyGuidesTable {...props} />);
  return props;
}

function selecionar(guide) {
  // A seleção é por checkbox; o aria-label carrega o rótulo, que na parcela não é "SIMPLES".
  fireEvent.click(screen.getByRole("checkbox", { name: /^Selecionar guia/ }));
  return guide;
}

describe("Recalcular × parcela de parcelamento", () => {
  it("⚠ na PARCELA o botão aparece DESABILITADO — o mesmo tipo do DAS não o habilita", () => {
    renderTabela([guiaDaParcela()]);
    selecionar();

    const btn = screen.getByRole("button", { name: "Recalcular" });
    expect(btn).toBeDisabled();
  });

  it("o motivo viaja com o botão: diz que Recalcular emite o DAS DO MÊS, outro documento", () => {
    renderTabela([guiaDaParcela()]);
    selecionar();

    const titulo = screen.getByRole("button", { name: "Recalcular" }).getAttribute("title");
    expect(titulo).toMatch(/parcelamento/i);
    expect(titulo).toMatch(/DAS do MÊS/);
    expect(titulo).toMatch(/PGDAS-D/);
  });

  it("⚠ clicar não dispara o recálculo do PGDAS-D — nem por INSS, nem por DAS", () => {
    const props = renderTabela([guiaDaParcela()]);
    selecionar();

    fireEvent.click(screen.getByRole("button", { name: "Recalcular" }));
    expect(props.onRecalculateGuide).not.toHaveBeenCalled();
    expect(props.onRecalcularInss).not.toHaveBeenCalled();
  });

  it("⚠ vale para a parcela de INSS parcelado também — o vínculo vence o tipo nos dois", () => {
    const props = renderTabela([guiaDaParcela({ tipo: "INSS", canRecalculate: false })]);
    selecionar();

    fireEvent.click(screen.getByRole("button", { name: "Recalcular" }));
    expect(screen.getByRole("button", { name: "Recalcular" })).toBeDisabled();
    expect(props.onRecalcularInss).not.toHaveBeenCalled();
  });

  it("o DAS do mês (sem vínculo) continua recalculando — a guarda não pegou quem devia trabalhar", () => {
    const props = renderTabela([guiaDoDas()]);
    selecionar();

    const btn = screen.getByRole("button", { name: "Recalcular" });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    expect(props.onRecalculateGuide).toHaveBeenCalledWith("g-das");
  });

  it("o INSS do mês (sem vínculo) continua indo para o DCTFweb, pela competência", () => {
    const props = renderTabela([guiaDoDas({ guideId: "g-inss", tipo: "INSS", canRecalculate: false })]);
    selecionar();

    fireEvent.click(screen.getByRole("button", { name: "Recalcular" }));
    expect(props.onRecalcularInss).toHaveBeenCalledWith(COMP);
    expect(props.onRecalculateGuide).not.toHaveBeenCalled();
  });
});

describe("As outras ações da barra seguem valendo para a parcela", () => {
  it("Confirmar pagamento age sobre a própria guia — parcela paga é fato real", () => {
    const props = renderTabela([guiaDaParcela()]);
    selecionar();

    const btn = screen.getByRole("button", { name: "Confirmar pagamento" });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    expect(props.onConfirmGuidePayment).toHaveBeenCalledWith("g-parc");
  });

  it("Liberar ao cliente envia o PDF DESTA linha — numa parcela, o DAS da parcela", () => {
    const props = renderTabela([guiaDaParcela()]);
    selecionar();

    fireEvent.click(screen.getByRole("button", { name: "Liberar ao cliente" }));
    expect(props.onLiberarGuia).toHaveBeenCalledWith("g-parc");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// R4/R1 — a guia de parcelamento virou ANEXO, e o desenho guia-first saiu do menu.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("+ Subir Guia → PARCELAMENTO", () => {
  const parcelamentosFake = () => ({
    parcelamentos: [{ id: "p1", status: "ATIVO", tipo: "PARCSN", numeroParcelamento: "1234567" }],
    ingest: jest.fn().mockResolvedValue({ ok: true }),
    saving: false,
  });

  it("PARCELAMENTO é um TIPO NORMAL do menu — não um item à parte", () => {
    renderTabela([], { onUploadGuide: jest.fn(), parcelamentos: parcelamentosFake() });
    fireEvent.click(screen.getByRole("button", { name: /Subir Guia/ }));

    expect(screen.getByRole("button", { name: "PARCELAMENTO" })).toBeEnabled();
    // ⚠ O item antigo (âmbar, fora da lista de tipos) abria o modal de três opções que CRIAVA
    // parcelamento a partir da guia.
    expect(screen.queryByRole("button", { name: "Parcelamento…" })).toBeNull();
  });

  it("PARCELAMENTO vale em QUALQUER regime — parcelamento de INSS existe no Presumido também", () => {
    renderTabela([], { onUploadGuide: jest.fn(), companyRegime: "LUCRO_PRESUMIDO", parcelamentos: parcelamentosFake() });
    fireEvent.click(screen.getByRole("button", { name: /Subir Guia/ }));
    expect(screen.getByRole("button", { name: "PARCELAMENTO" })).toBeInTheDocument();
  });

  it("⚠ desabilitado COM MOTIVO quando os parcelamentos não foram carregados", () => {
    renderTabela([], { onUploadGuide: jest.fn(), parcelamentos: null });
    fireEvent.click(screen.getByRole("button", { name: /Subir Guia/ }));

    const item = screen.getByRole("button", { name: "PARCELAMENTO" });
    expect(item).toBeDisabled();
    expect(item.getAttribute("title")).toMatch(/não foram carregados/i);
  });
});
