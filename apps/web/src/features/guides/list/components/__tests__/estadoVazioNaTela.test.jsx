// A LIGAÇÃO entre a regra do vazio e a tela — a regra tem teste próprio (`lib/estadoVazioGuias.js`).
//
// O que se prova aqui é o que só o componente pode errar: se ele **busca** o contexto, se busca
// **só quando há vazio a explicar**, e se a falha da busca chega à tela como falha — nunca como
// "não há guia". Era esse o defeito: a competência sem guia dizia *"Nenhuma guia encontrada para os
// filtros atuais."* tanto quando não havia nada a pagar quanto quando o servidor não respondeu.
import { render, screen, waitFor } from "@testing-library/react";
import { CompanyGuidesTable } from "../renderCompanyGuidesTable.jsx";

const mockGetFechamento = jest.fn();
const mockGetFechamentoContabil = jest.fn();

jest.mock("../../../../../api/client", () => ({
  createApiClient: () => ({
    getExpectedGuides: jest.fn().mockResolvedValue({ compliance: {} }),
    getFechamento: (...a) => mockGetFechamento(...a),
    getFechamentoContabil: (...a) => mockGetFechamentoContabil(...a),
    markGuideVazio: jest.fn(),
    undoGuideVazio: jest.fn(),
  }),
}));
jest.mock("../../../capture/components/renderGuideCaptureModal", () => ({ GuideCaptureModal: () => null }));
jest.mock("../GuiaDeParcelamentoModal", () => ({ GuiaDeParcelamentoModal: () => null }));

const COMP = "2026-08";

function montar(props = {}) {
  return render(
    <CompanyGuidesTable
      companyId="c1" competencia={COMP} companyRegime="SIMPLES"
      guides={[]} loadingGuides={false}
      onIrParaApuracao={jest.fn()}
      {...props}
    />,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetFechamento.mockResolvedValue({ ok: true, dados: { estado: "aberta" } });
  mockGetFechamentoContabil.mockResolvedValue({ fechado: false, semFaturamento: false });
});

describe("⚠ o vazio deixou de ser uma frase só", () => {
  it("a frase antiga não existe mais", async () => {
    montar();
    await waitFor(() => expect(mockGetFechamento).toHaveBeenCalled());
    expect(screen.queryByText(/Nenhuma guia encontrada para os filtros atuais/i)).not.toBeInTheDocument();
  });

  it("competência não apurada: diz o que falta e oferece o caminho", async () => {
    const onIrParaApuracao = jest.fn();
    montar({ onIrParaApuracao });
    expect(await screen.findByText(new RegExp(`${COMP} ainda não foi apurada`))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Ir para Apuração/i })).toBeInTheDocument();
  });

  it("apurada e sem guia: o próximo passo é a guia, não a apuração", async () => {
    mockGetFechamento.mockResolvedValue({ ok: true, dados: { estado: "transmitida" } });
    montar();
    expect(await screen.findByText(/foi apurada, mas nenhuma guia foi gravada/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Ir para Apuração/i })).not.toBeInTheDocument();
  });

  it("mês declarado sem faturamento: o DAS não é exigido", async () => {
    mockGetFechamentoContabil.mockResolvedValue({ fechado: false, semFaturamento: true });
    montar();
    expect(await screen.findByText(new RegExp(`Sem faturamento em ${COMP}`))).toBeInTheDocument();
  });
});

describe("⚠ falha da consulta NÃO pode virar 'não apurado'", () => {
  it("a chamada que não volta produz a resposta de falha, com o aviso de que não se sabe", async () => {
    mockGetFechamento.mockRejectedValue(new Error("Servidor fora do ar"));
    montar();
    expect(await screen.findByText(/não é possível dizer se deveria haver/i)).toBeInTheDocument();
    expect(screen.queryByText(/ainda não foi apurada/i)).not.toBeInTheDocument();
  });

  it("403 diz que é acesso, não ausência", async () => {
    mockGetFechamentoContabil.mockRejectedValue(Object.assign(new Error("FORBIDDEN"), { status: 403 }));
    montar();
    expect(await screen.findByText(/Você não tem acesso a estes dados/i)).toBeInTheDocument();
  });
});

describe("⚠ o contexto só é consultado quando há vazio a explicar", () => {
  it("com guia na lista, nenhuma chamada extra sai", async () => {
    montar({
      guides: [{
        id: "g1", guideId: "g1", tipo: "SIMPLES", competencia: COMP, status: "PROCESSED",
        valor: 100, vencimento: "2026-09-20",
      }],
    });
    await waitFor(() => expect(screen.getByText(/2026-09-20|20\/09\/2026/)).toBeInTheDocument());
    expect(mockGetFechamento).not.toHaveBeenCalled();
  });

  it("carregando a lista, também não — o vazio ainda não é vazio", () => {
    montar({ loadingGuides: true });
    expect(mockGetFechamento).not.toHaveBeenCalled();
  });
});
