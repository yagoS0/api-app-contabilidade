// O CAMINHO DA FALHA — que é o que está sendo consertado.
//
// A api é forçada a REJEITAR e o que se cobra da tela é que ela NÃO afirme um estado que não
// conhece. Um teste do caminho feliz aqui não testaria nada do que este trabalho faz: a tela feliz
// já funcionava, e era justamente por parecer com a tela falha que o defeito passava.
//
// Os dois defeitos travados aqui:
//  1. `ObrigacoesPage` — carga falhada saía como "0 pendentes · 0 vencendo · 0 vencidas" em corpo
//     de 1.5rem, mais "Nenhuma obrigação cadastrada". O contador lê, conclui que está tudo em dia
//     e fecha a página.
//  2. `RegrasObrigacao` (wizard, passo "Para quem") — prévia falhada virava "0 empresas serão
//     incluídas" e o "Criar regra" cinza SEM MOTIVO. São 11 empresas no Presumido.

import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ObrigacoesPage } from "../renderObrigacoesPage";
import { RegrasObrigacao } from "../renderRegrasObrigacao";

const EMPRESAS = [
  { companyId: "c1", razao: "ALFA LTDA" },
  { companyId: "c2", razao: "BETA LTDA" },
];

const RESPOSTA_FELIZ = {
  ok: true,
  resumo: { pendentes: 7, vencendoEm7Dias: 2, vencidas: 3 },
  obrigacoes: [],
  opcoes: { periodicidades: ["MENSAL"], ajustesDiaUtil: ["ANTECIPAR"], verificadores: [] },
};

function erroDe(mensagem, extras = {}) {
  return Object.assign(new Error(mensagem), extras);
}

describe("ObrigacoesPage — a carga que falha não vira 'está tudo em dia'", () => {
  it("⚠ os três cartões dizem — e NÃO zero", async () => {
    const api = { listObrigacoes: jest.fn().mockRejectedValue(erroDe("gateway timeout")) };
    render(<ObrigacoesPage api={api} empresas={EMPRESAS} />);

    await screen.findByText("Não foi possível carregar as obrigações");

    // O número que existia era mentira; o que existe agora é a recusa, no lugar dele.
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    expect(screen.getAllByText("—")).toHaveLength(3);
    expect(screen.getAllByText("não carregou")).toHaveLength(3);
    expect(screen.getByText("gateway timeout")).toBeInTheDocument();
  });

  it("⚠ NÃO diz 'Nenhuma obrigação cadastrada' — ela não sabe se há ou não", async () => {
    const api = { listObrigacoes: jest.fn().mockRejectedValue(erroDe("gateway timeout")) };
    render(<ObrigacoesPage api={api} empresas={EMPRESAS} />);

    await screen.findByText("Não foi possível carregar as obrigações");
    expect(screen.queryByText("Nenhuma obrigação cadastrada.")).not.toBeInTheDocument();
    expect(screen.getByText(/esta tela não conseguiu vê-las/)).toBeInTheDocument();
  });

  it("403 é a TERCEIRA resposta: sem acesso ≠ não carregou ≠ não há", async () => {
    const api = { listObrigacoes: jest.fn().mockRejectedValue(erroDe("forbidden", { status: 403, code: "forbidden" })) };
    render(<ObrigacoesPage api={api} empresas={EMPRESAS} />);

    await screen.findByText("Você não tem acesso a estes dados");
    expect(screen.getAllByText("sem acesso")).toHaveLength(3);
    expect(screen.queryByText("Não foi possível carregar as obrigações")).not.toBeInTheDocument();
  });

  it("o corpo `{ ok:false }` cai no mesmo lugar do throw", async () => {
    const api = { listObrigacoes: jest.fn().mockResolvedValue({ ok: false, message: "Escritório sem escopo." }) };
    render(<ObrigacoesPage api={api} empresas={EMPRESAS} />);

    await screen.findByText("Não foi possível carregar as obrigações");
    expect(screen.getByText("Escritório sem escopo.")).toBeInTheDocument();
  });

  it("'Tentar de novo' recarrega — e o sucesso apaga a falha e devolve os números", async () => {
    const api = {
      listObrigacoes: jest.fn()
        .mockRejectedValueOnce(erroDe("gateway timeout"))
        .mockResolvedValue(RESPOSTA_FELIZ),
    };
    render(<ObrigacoesPage api={api} empresas={EMPRESAS} />);

    await screen.findByText("Não foi possível carregar as obrigações");
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));

    await waitFor(() => expect(screen.getByText("7")).toBeInTheDocument());
    expect(screen.queryByText("—")).not.toBeInTheDocument();
    expect(screen.queryByText("não carregou")).not.toBeInTheDocument();
    // Agora sim: lista vazia é "não há", e a tela pode dizer isso.
    expect(screen.getByText("Nenhuma obrigação cadastrada.")).toBeInTheDocument();
  });

  it("no caminho FELIZ nada mudou — os números aparecem, sem legenda de falha", async () => {
    const api = { listObrigacoes: jest.fn().mockResolvedValue(RESPOSTA_FELIZ) };
    render(<ObrigacoesPage api={api} empresas={EMPRESAS} />);

    await waitFor(() => expect(screen.getByText("7")).toBeInTheDocument());
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.queryByText(/Não foi possível carregar/)).not.toBeInTheDocument();
  });
});

describe("RegrasObrigacao — a lista", () => {
  const apiBase = {
    listRegrasObrigacao: jest.fn(),
    previewEscopoRegra: jest.fn(),
  };

  it("⚠ falha de carga NÃO convida a criar de novo o que já existe", async () => {
    const api = { ...apiBase, listRegrasObrigacao: jest.fn().mockRejectedValue(erroDe("banco fora")) };
    render(<RegrasObrigacao api={api} empresas={EMPRESAS} onVoltar={() => {}} />);

    await screen.findByText("Não foi possível carregar as regras");
    expect(screen.queryByText("Nenhuma regra criada.")).not.toBeInTheDocument();
  });

  it("lista vazia de verdade continua dizendo que está vazia", async () => {
    const api = { ...apiBase, listRegrasObrigacao: jest.fn().mockResolvedValue({ ok: true, regras: [], opcoes: {} }) };
    render(<RegrasObrigacao api={api} empresas={EMPRESAS} onVoltar={() => {}} />);

    await screen.findByText("Nenhuma regra criada.");
    expect(screen.queryByText(/Não foi possível carregar/)).not.toBeInTheDocument();
  });
});

describe("RegrasObrigacao — a PRÉVIA DE ESCOPO do wizard", () => {
  const OPCOES = {
    ok: true,
    regras: [],
    opcoes: {
      periodicidades: ["MENSAL"],
      ajustesDiaUtil: ["ANTECIPAR"],
      escopos: ["TODAS", "POR_FILTRO", "SELECAO_MANUAL"],
      regimes: ["SIMPLES", "LUCRO_PRESUMIDO"],
      verificadores: [],
    },
  };

  /** Abre o wizard e caminha até o passo 3 ("Para quem") com um filtro válido escolhido. */
  async function abrirPassoParaQuem(api) {
    render(<RegrasObrigacao api={api} empresas={EMPRESAS} onVoltar={() => {}} />);
    await screen.findByText("Nenhuma regra criada.");
    fireEvent.click(screen.getByRole("button", { name: "+ Nova regra" }));
    fireEvent.change(screen.getByPlaceholderText("Ex.: EFD-Contribuições"), { target: { value: "DEFIS" } });
    fireEvent.click(screen.getByRole("button", { name: "Avançar" }));
    fireEvent.click(screen.getByRole("button", { name: "Avançar" }));
    // Sem critério o escopo certo seria "Todas" — escolher o regime tira o impedimento do caminho
    // e deixa a prévia ser a única coisa em jogo.
    fireEvent.click(await screen.findByRole("button", { name: "Lucro Presumido" }));
  }

  it("⚠ prévia que falha NÃO vira '0 empresas serão incluídas'", async () => {
    const api = {
      listRegrasObrigacao: jest.fn().mockResolvedValue(OPCOES),
      previewEscopoRegra: jest.fn().mockRejectedValue(erroDe("o servidor caiu")),
    };
    await abrirPassoParaQuem(api);

    await screen.findByText(/não foi possível carregar a prévia do escopo/i);
    expect(screen.queryByText(/0 empresas serão incluídas/)).not.toBeInTheDocument();
    expect(screen.getByText(/o alcance desta regra não foi medido/i)).toBeInTheDocument();
  });

  it("⚠ o 'Criar regra' desabilitado DIZ POR QUÊ", async () => {
    const api = {
      listRegrasObrigacao: jest.fn().mockResolvedValue(OPCOES),
      previewEscopoRegra: jest.fn().mockRejectedValue(erroDe("o servidor caiu")),
    };
    await abrirPassoParaQuem(api);

    const botao = await screen.findByRole("button", { name: "Criar regra" });
    await waitFor(() => expect(botao).toBeDisabled());
    expect(botao.getAttribute("title")).toMatch(/Não foi possível carregar a prévia do escopo/);
    expect(botao.getAttribute("title")).toMatch(/o servidor caiu/);
  });

  it("zero de verdade continua sendo zero — e o motivo do botão é OUTRO", async () => {
    const api = {
      listRegrasObrigacao: jest.fn().mockResolvedValue(OPCOES),
      previewEscopoRegra: jest.fn().mockResolvedValue({ ok: true, total: 0, empresas: [] }),
    };
    await abrirPassoParaQuem(api);

    await screen.findByText(/0 empresas serão incluídas/);
    const botao = screen.getByRole("button", { name: "Criar regra" });
    expect(botao).toBeDisabled();
    expect(botao.getAttribute("title")).toMatch(/Nenhuma empresa entra neste escopo/);
  });

  it("caminho feliz: o total aparece e o botão libera", async () => {
    const api = {
      listRegrasObrigacao: jest.fn().mockResolvedValue(OPCOES),
      previewEscopoRegra: jest.fn().mockResolvedValue({
        ok: true, total: 11, empresas: EMPRESAS,
      }),
    };
    await abrirPassoParaQuem(api);

    await screen.findByText(/11 empresas serão incluídas/);
    const botao = screen.getByRole("button", { name: "Criar regra" });
    await waitFor(() => expect(botao).not.toBeDisabled());
    expect(botao.getAttribute("title")).toBeNull();
  });

  it("resposta sem `total` é falha, não escopo vazio", async () => {
    const api = {
      listRegrasObrigacao: jest.fn().mockResolvedValue(OPCOES),
      previewEscopoRegra: jest.fn().mockResolvedValue({ ok: true, empresas: [] }),
    };
    await abrirPassoParaQuem(api);

    const caixa = await screen.findByText(/não foi possível carregar a prévia do escopo/i);
    expect(within(caixa.parentElement).queryByText(/empresas serão incluídas/)).not.toBeInTheDocument();
  });
});
