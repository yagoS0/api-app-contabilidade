// O `catch {}` MUDO DAS FUNÇÕES DE LANÇAMENTO.
//
// Excluir e duplicar chamavam o hook dentro de um `catch {}` vazio: a lista não mudava e nenhuma
// mensagem aparecia — indistinguível de "o botão não fez nada". O motivo SEMPRE existiu (o hook
// gravava `error` desde o começo); o que faltava era alguém lê-lo.
//
// Aqui o teste percorre a corrente inteira — hook + modal — porque foi exatamente no meio dela que
// a mensagem se perdia. Um teste só do modal, com a mensagem escrita à mão, passaria com o defeito
// de volta.

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { useAccountingFunctions } from "../../hooks/useAccountingFunctions";
import { FunctionListModal } from "../AccountingFunctionModals";

const FUNCAO_DA_EMPRESA = {
  id: "f1", name: "Pagamento de aluguel", portalClientId: "c1", isSystem: false,
  entries: [{ historico: "ALUGUEL", tipo: "DESPESA", lines: [] }],
};
const FUNCAO_GLOBAL = { id: "g1", name: "Provisão de DAS", portalClientId: null, isSystem: true, entries: [] };

const noop = () => {};

/** A tela de verdade: o hook alimentando o modal, como no `renderAccountingEntriesTab`. */
function Tela({ api }) {
  const accountingFunctions = useAccountingFunctions({ api, companyId: "c1" });
  return (
    <FunctionListModal
      functions={accountingFunctions.functions}
      loading={accountingFunctions.loading}
      falha={accountingFunctions.falha}
      onApply={noop}
      onEdit={noop}
      onCreate={noop}
      onClose={noop}
      onDelete={async (f) => {
        try { await accountingFunctions.remove(f.id); } catch { /* exibido em `falha` */ }
      }}
      onDuplicate={async (f) => {
        try { await accountingFunctions.create({ name: `${f.name} (cópia)` }); } catch { /* idem */ }
      }}
    />
  );
}

function apiCom(overrides = {}) {
  return {
    listAccountingFunctions: jest.fn().mockResolvedValue([FUNCAO_DA_EMPRESA, FUNCAO_GLOBAL]),
    createAccountingFunction: jest.fn(),
    updateAccountingFunction: jest.fn(),
    deleteAccountingFunction: jest.fn(),
    applyAccountingFunction: jest.fn(),
    ...overrides,
  };
}

beforeEach(() => { jest.spyOn(window, "confirm").mockReturnValue(true); });
afterEach(() => { jest.restoreAllMocks(); });

describe("Funções de Lançamento — a recusa deixa de ser silêncio", () => {
  it("⚠ EXCLUIR que falha aparece na tela, com o verbo certo", async () => {
    const api = apiCom({ deleteAccountingFunction: jest.fn().mockRejectedValue(new Error("função em uso por 3 lançamentos")) });
    render(<Tela api={api} />);

    await screen.findByText("Pagamento de aluguel");
    fireEvent.click(screen.getByRole("button", { name: "Excluir" }));

    await screen.findByText("Não foi possível excluir a função");
    expect(screen.getByText("função em uso por 3 lançamentos")).toBeInTheDocument();
    // ⚠ "excluir", não "carregar": a tela não pode mentir sobre o que ela tentou fazer.
    expect(screen.queryByText(/Não foi possível carregar/)).not.toBeInTheDocument();
    // E a função continua lá — o estado da lista não foi alterado por engano.
    expect(screen.getByText("Pagamento de aluguel")).toBeInTheDocument();
  });

  it("⚠ DUPLICAR que falha também fala", async () => {
    const api = apiCom({ createAccountingFunction: jest.fn().mockRejectedValue(new Error("nome já existe")) });
    render(<Tela api={api} />);

    await screen.findByText("Provisão de DAS");
    fireEvent.click(screen.getByRole("button", { name: "Duplicar" }));

    await screen.findByText("Não foi possível criar a função");
    expect(screen.getByText("nome já existe")).toBeInTheDocument();
  });

  it("⚠ LISTAGEM que falha não vira 'Nenhuma função cadastrada'", async () => {
    const api = apiCom({ listAccountingFunctions: jest.fn().mockRejectedValue(new Error("banco fora do ar")) });
    render(<Tela api={api} />);

    await screen.findByText("Não foi possível carregar as funções");
    expect(screen.queryByText(/Nenhuma função cadastrada/)).not.toBeInTheDocument();
  });

  it("lista vazia DE VERDADE continua convidando a criar a primeira", async () => {
    const api = apiCom({ listAccountingFunctions: jest.fn().mockResolvedValue([]) });
    render(<Tela api={api} />);

    await screen.findByText(/Nenhuma função cadastrada/);
    expect(screen.queryByText(/Não foi possível/)).not.toBeInTheDocument();
  });

  it("403 na exclusão diz que é acesso, não que a função sumiu", async () => {
    const err = Object.assign(new Error("insufficient_role"), { status: 403, code: "insufficient_role" });
    const api = apiCom({ deleteAccountingFunction: jest.fn().mockRejectedValue(err) });
    render(<Tela api={api} />);

    await screen.findByText("Pagamento de aluguel");
    fireEvent.click(screen.getByRole("button", { name: "Excluir" }));

    await screen.findByText("Você não tem acesso a estes dados");
    expect(screen.getByText(/administrador/)).toBeInTheDocument();
  });

  it("a exclusão que DÁ CERTO não deixa banner nenhum", async () => {
    const api = apiCom({
      deleteAccountingFunction: jest.fn().mockResolvedValue({ ok: true }),
      listAccountingFunctions: jest.fn()
        .mockResolvedValueOnce([FUNCAO_DA_EMPRESA, FUNCAO_GLOBAL])
        .mockResolvedValue([FUNCAO_GLOBAL]),
    });
    render(<Tela api={api} />);

    await screen.findByText("Pagamento de aluguel");
    fireEvent.click(screen.getByRole("button", { name: "Excluir" }));

    await waitFor(() => expect(screen.queryByText("Pagamento de aluguel")).not.toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
