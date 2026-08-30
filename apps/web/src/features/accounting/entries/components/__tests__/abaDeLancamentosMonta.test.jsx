// ⚠⚠ A ABA DE LANÇAMENTOS MONTA — o teste de FUMAÇA que faltava (29/08/2026).
//
// ⚠⚠ **ELE NASCEU DE UM DEFEITO QUE O `npm run build` E 2.974 TESTES DEIXARAM PASSAR.** Ao pôr o
// botão da Conferência na barra, o `useState`/`useEffect` da contagem foi parar dentro de
// `FechamentoCadeado` — outro componente do MESMO arquivo. O JSX da aba passou a ler um
// `pendencias` que não existia no escopo dela, e a tela inteira morreu com
// `ReferenceError: pendencias is not defined`.
//
// ⚠ O build **compila**: identificador não declarado é erro de RUNTIME, não de sintaxe. E nenhum
// teste renderizava a aba inteira — todos mediam peças (`VerificacaoDeLancamentos`,
// `DraftEntryRow`, `BotaoDaConferencia`). É a **quarta vez** que um identificador órfão atravessa o
// build nesta base; as três anteriores estão registradas no `CLAUDE.md`.
//
// ⚠⚠ **O QUE ESTE ARQUIVO PROVA É SÓ ISTO: ela MONTA.** Não é teste de comportamento, e não deve
// virar um — o comportamento tem testes próprios. O valor dele é ser o único que exercita o corpo
// do componente de ponta a ponta, que é onde o identificador órfão aparece.

import { render, screen, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { AccountingEntriesTab } from "../renderAccountingEntriesTab";

jest.mock("../../../../../api/client", () => {
  const api = {
    getFechamentoContabil: jest.fn().mockResolvedValue({ fechado: false, checklist: {} }),
    getVerificacaoLancamentos: jest.fn().mockResolvedValue({ ok: true, resumo: {}, porRegra: [] }),
    getConferenciaPendencias: jest.fn().mockResolvedValue({ ok: true, total: 4, declarados: 2, series: 1, saidas: 1 }),
  };
  return { createApiClient: () => api, __api: api };
});

const PROPS = {
  companyId: "emp-1",
  competencia: "2026-08",
  entries: [],
  total: 0,
  loading: false,
  filters: {},
  onFilterChange: jest.fn(),
  onLoad: jest.fn(),
  onCreateEntry: jest.fn(),
  onUpdateEntry: jest.fn(),
  onDeleteEntry: jest.fn(),
  accounts: [],
  onLoadAccounts: jest.fn(),
};

async function montar(extra = {}) {
  render(<AccountingEntriesTab {...PROPS} {...extra} />);
  await act(async () => {});
}

describe("⚠⚠ ela monta sem ReferenceError", () => {
  it("com o conjunto mínimo de props", async () => {
    await montar();
    // ⚠ Uma âncora qualquer da barra serve: o que se mede é a AUSÊNCIA da exceção, não o conteúdo.
    expect(screen.getByRole("button", { name: /Configurações/ })).toBeInTheDocument();
  });

  it("⚠⚠ e o botão da Conferência aparece com o selo — o caso que quebrou", async () => {
    await montar({ onOpenConferencia: jest.fn() });
    const b = screen.getByRole("button", { name: /Conferência/ });
    expect(b).toHaveAttribute("data-pendencias", "4");
  });

  it("⚠ sem o handler, a barra monta igual — só sem o botão", async () => {
    await montar();
    expect(screen.queryByRole("button", { name: /Conferência/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Import \/ Export/ })).toBeInTheDocument();
  });
});
