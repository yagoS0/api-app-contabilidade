// O DETECTOR TEM LEITOR — e é isto que esta suíte existe para provar.
//
// ⚠ Este projeto tem histórico ruim de guarda que não morde, e o precedente exato é a coluna
// `CompanyMonthlyCircular.hasAccountingDivergence`: escrita em TODA sincronia desde 2026-04 e lida
// por ninguém — nenhum `select`, nenhum componente, nenhum teste. A regra dela sempre esteve
// correta; o que faltava era o fio até a tela.
//
// Por isso aqui não se testa a aritmética de novo (ela tem suíte própria em
// `api: application/accounting/__tests__/divergenciaDeFonte.test.js`). O que se trava é a LIGAÇÃO:
// o campo `divergenciasFonte` do `GET /fechamento-contabil/:competencia` chegando ao painel de
// Fechamento, com o número à vista — e, na outra direção, o painel ficando CALADO quando não há
// divergência, que é o estado de quase toda competência.

import { render, screen, waitFor } from "@testing-library/react";

// ⚠ O prefixo `mock` é exigência do hoisting do `jest.mock` — sem ele o babel recusa a referência
// à variável de fora da fábrica.
const mockGetFechamentoContabil = jest.fn();

jest.mock("../../../../../api/client", () => ({
  createApiClient: () => ({
    getFechamentoContabil: (...args) => mockGetFechamentoContabil(...args),
    fecharFechamentoContabil: jest.fn(),
    reabrirFechamentoContabil: jest.fn(),
    setChecklistFechamento: jest.fn(),
    setSemFaturamento: jest.fn(),
  }),
}));

const { FechamentoCadeado, DivergenciaDeFonte } = require("../renderAccountingEntriesTab.jsx");

// Os números são os medidos em produção na LENTE 2026-07: o extrato retificado diz 19.539,95 e o
// razão ficou em 18.347,28. A mesma tela mostrava os dois, sem uma palavra sobre a diferença.
const DIVERGENCIA_LENTE = {
  eventType: "DAS_SIMPLES",
  rotulo: "DAS (Simples Nacional)",
  campo: "dasTotal",
  esperado: 19539.95,
  lancado: 18347.28,
  diferenca: 1192.67,
  entryId: "e-das",
};

function payload(extra = {}) {
  return {
    ok: true,
    competencia: "2026-07",
    fechado: false,
    checklist: { folhaProlabore: true, despesas: true, receitas: true, provisoes: true, pagamentos: true },
    checklistPendentes: [],
    podeFechar: true,
    blockers: [],
    conferenciaAdn: { status: "ok", em: null },
    faturamentoEmit: 147450,
    divergenciasFonte: [],
    ...extra,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("o painel de Fechamento LÊ o detector", () => {
  it("a divergência do payload aparece na tela, com os dois números", async () => {
    mockGetFechamentoContabil.mockResolvedValue(payload({ divergenciasFonte: [DIVERGENCIA_LENTE] }));
    render(<FechamentoCadeado companyId="c1" competencia="2026-07" entries={[]} />);

    await waitFor(() => expect(screen.getByText(/O razão não bate com o extrato/)).toBeInTheDocument());
    // ⚠ Os DOIS números, lado a lado. Só a diferença não bastaria: o contador precisa saber qual
    // deles é o do extrato para decidir o que corrigir.
    const linha = screen.getByText(/DAS \(Simples Nacional\)/);
    expect(linha).toHaveTextContent("19.539,95");
    expect(linha).toHaveTextContent("18.347,28");
  });

  it("⚠ CALA quando não há divergência — aviso que acende sempre ninguém lê", async () => {
    mockGetFechamentoContabil.mockResolvedValue(payload());
    render(<FechamentoCadeado companyId="c1" competencia="2026-07" entries={[]} />);

    await waitFor(() => expect(screen.getByText("Fechamento")).toBeInTheDocument());
    expect(screen.queryByText(/O razão não bate com o extrato/)).not.toBeInTheDocument();
  });

  it("⚠ APARECE COM O MÊS FECHADO — é aí que o número já saiu para fora", async () => {
    mockGetFechamentoContabil.mockResolvedValue(payload({
      fechado: true,
      fechadoEm: "2026-08-01T12:00:00.000Z",
      divergenciasFonte: [DIVERGENCIA_LENTE],
    }));
    render(<FechamentoCadeado companyId="c1" competencia="2026-07" entries={[]} />);

    await waitFor(() => expect(screen.getByText("✓ Mês fechado")).toBeInTheDocument());
    expect(screen.getByText(/O razão não bate com o extrato/)).toBeInTheDocument();
  });

  it("⚠ NÃO BLOQUEIA o fechamento — corrigir lançamento é ato contábil do dono", async () => {
    mockGetFechamentoContabil.mockResolvedValue(payload({ divergenciasFonte: [DIVERGENCIA_LENTE] }));
    render(<FechamentoCadeado companyId="c1" competencia="2026-07" entries={[]} />);

    await waitFor(() => expect(screen.getByText(/O razão não bate com o extrato/)).toBeInTheDocument());
    // Travar aqui prenderia hoje 12 competências em 5 empresas — inclusive as já fechadas — sem
    // oferecer saída. Mesma decisão que `conferenciaAdn` recebe quando é `nao_conferivel`.
    expect(screen.getByRole("button", { name: /Fechar mês/ })).not.toBeDisabled();
  });

  it("backend anterior ao detector (campo ausente) não quebra nem inventa aviso", async () => {
    const semCampo = payload();
    delete semCampo.divergenciasFonte;
    mockGetFechamentoContabil.mockResolvedValue(semCampo);
    render(<FechamentoCadeado companyId="c1" competencia="2026-07" entries={[]} />);

    await waitFor(() => expect(screen.getByText("Fechamento")).toBeInTheDocument());
    expect(screen.queryByText(/O razão não bate com o extrato/)).not.toBeInTheDocument();
  });
});

describe("DivergenciaDeFonte", () => {
  it("lista uma linha por tributo divergente", () => {
    render(
      <DivergenciaDeFonte
        divergencias={[
          DIVERGENCIA_LENTE,
          { eventType: "RECEITA_SERVICO", rotulo: "Receita de serviços", esperado: 9000, lancado: 7000, diferenca: 2000 },
        ]}
      />,
    );
    expect(screen.getByText(/DAS \(Simples Nacional\)/)).toBeInTheDocument();
    expect(screen.getByText(/Receita de serviços/)).toBeInTheDocument();
  });

  it("lista vazia não renderiza moldura nenhuma", () => {
    const { container } = render(<DivergenciaDeFonte divergencias={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
