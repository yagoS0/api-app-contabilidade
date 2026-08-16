// A PRÉVIA DA TELA E O QUE ELA PROMETE AO SALVAR.
//
// A regra da data mora em `lib/previaVencimentos.js` e tem teste próprio; o que se cobra aqui é a
// LIGAÇÃO: a tela não anuncia data passada, oferece a escolha explícita onde ela cabe (o cadastro
// de UMA empresa) e não a oferece onde ela seria uma afirmação sobre a carteira inteira (a regra do
// escritório).
//
// Relógio fixo em 16/08/2026 — o dia do caso reproduzido no navegador.

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ObrigacoesPage } from "../renderObrigacoesPage";
import { RegrasObrigacao } from "../renderRegrasObrigacao";

const EMPRESAS = [{ companyId: "alfa", razao: "ALFA LTDA" }];

const LISTA = {
  ok: true,
  resumo: { pendentes: 0, vencendoEm7Dias: 0, vencidas: 0 },
  obrigacoes: [],
  opcoes: { periodicidades: ["MENSAL"], ajustesDiaUtil: ["ANTECIPAR"], verificadores: [] },
};

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["performance", "queueMicrotask"] });
  jest.setSystemTime(new Date("2026-08-16T09:30:00Z"));
});
afterEach(() => { jest.useRealTimers(); });

/** Abre "Nova obrigação" e põe o vencimento no dia 15 — que, em 16/08, já passou. */
async function abrirModalComDia15(api) {
  render(<ObrigacoesPage api={api} empresas={EMPRESAS} />);
  await screen.findByText("Nenhuma obrigação cadastrada.");
  fireEvent.click(screen.getByRole("button", { name: "+ Nova obrigação" }));
  fireEvent.change(screen.getByPlaceholderText("Ex.: Transmitir apuração do Simples"), {
    target: { value: "EFD-Contribuições" },
  });
  fireEvent.change(screen.getByDisplayValue("20"), { target: { value: "15" } });
}

describe("ObrigacoesPage — o modal de cadastro", () => {
  it("⚠ 'Próximos vencimentos' começa em setembro; 14/08 não é anunciado como próximo", async () => {
    const api = { listObrigacoes: jest.fn().mockResolvedValue(LISTA), createObrigacao: jest.fn() };
    await abrirModalComDia15(api);

    expect(screen.getByText(/15\/09\/2026/)).toBeInTheDocument();
    expect(screen.queryByText(/Próximos vencimentos:.*14\/08\/2026/)).not.toBeInTheDocument();
  });

  it("a data que passou aparece — como informação, com a escolha ao lado", async () => {
    const api = { listObrigacoes: jest.fn().mockResolvedValue(LISTA), createObrigacao: jest.fn() };
    await abrirModalComDia15(api);

    expect(screen.getByText(/O vencimento deste mês \(14\/08\/2026\) já passou/)).toBeInTheDocument();
    expect(screen.getByText(/Registrar 14\/08\/2026 como pendência em atraso/)).toBeInTheDocument();
  });

  it("⚠ o DEFAULT é não criar a pendência retroativa", async () => {
    const api = {
      listObrigacoes: jest.fn().mockResolvedValue(LISTA),
      createObrigacao: jest.fn().mockResolvedValue({ ok: true, ocorrenciasCriadas: 11 }),
    };
    await abrirModalComDia15(api);
    fireEvent.click(screen.getByRole("button", { name: "Criar obrigação" }));

    await waitFor(() => expect(api.createObrigacao).toHaveBeenCalled());
    expect(api.createObrigacao.mock.calls[0][1]).toMatchObject({ incluirVencidoDoMes: false });
  });

  it("marcada a caixa, a escolha viaja para o servidor", async () => {
    const api = {
      listObrigacoes: jest.fn().mockResolvedValue(LISTA),
      createObrigacao: jest.fn().mockResolvedValue({ ok: true, ocorrenciasCriadas: 12 }),
    };
    await abrirModalComDia15(api);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Criar obrigação" }));

    await waitFor(() => expect(api.createObrigacao).toHaveBeenCalled());
    expect(api.createObrigacao.mock.calls[0][1]).toMatchObject({ incluirVencidoDoMes: true });
  });

  it("⚠ mudar o dia depois desmarca a escolha — ela não fica pegada num vencimento futuro", async () => {
    const api = {
      listObrigacoes: jest.fn().mockResolvedValue(LISTA),
      createObrigacao: jest.fn().mockResolvedValue({ ok: true }),
    };
    await abrirModalComDia15(api);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.change(screen.getByDisplayValue("15"), { target: { value: "25" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar obrigação" }));

    await waitFor(() => expect(api.createObrigacao).toHaveBeenCalled());
    expect(api.createObrigacao.mock.calls[0][1]).toMatchObject({ incluirVencidoDoMes: false });
  });

  it("sem data passada não há caixa nenhuma — a escolha só existe quando faz sentido", async () => {
    const api = { listObrigacoes: jest.fn().mockResolvedValue(LISTA), createObrigacao: jest.fn() };
    render(<ObrigacoesPage api={api} empresas={EMPRESAS} />);
    await screen.findByText("Nenhuma obrigação cadastrada.");
    fireEvent.click(screen.getByRole("button", { name: "+ Nova obrigação" }));

    expect(screen.queryByText(/já passou/)).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("a prévia declara que só olha fim de semana — o rótulo do campo fala em feriado", async () => {
    const api = { listObrigacoes: jest.fn().mockResolvedValue(LISTA), createObrigacao: jest.fn() };
    await abrirModalComDia15(api);

    expect(screen.getByText(/considera só fim de semana/)).toBeInTheDocument();
  });
});

describe("RegrasObrigacao — o wizard do escritório", () => {
  const REGRAS = {
    ok: true,
    regras: [],
    opcoes: {
      escopos: ["TODAS"], regimes: ["SIMPLES"], periodicidades: ["MENSAL"],
      ajustesDiaUtil: ["ANTECIPAR"], verificadores: [],
    },
  };

  async function abrirPassoQuando() {
    const api = {
      listRegrasObrigacao: jest.fn().mockResolvedValue(REGRAS),
      previewEscopoRegra: jest.fn().mockResolvedValue({ ok: true, total: 5, empresas: EMPRESAS }),
    };
    render(<RegrasObrigacao api={api} empresas={EMPRESAS} onVoltar={() => {}} />);
    await screen.findByText("Nenhuma regra criada.");
    fireEvent.click(screen.getByRole("button", { name: "+ Nova regra" }));
    fireEvent.change(screen.getByPlaceholderText("Ex.: EFD-Contribuições"), { target: { value: "DEFIS" } });
    fireEvent.click(screen.getByRole("button", { name: "Avançar" }));
    return api;
  }

  it("⚠ a prévia da regra não anuncia 14/08/2026 como próximo vencimento", async () => {
    await abrirPassoQuando();
    // O campo já nasce no dia 15 — foi a configuração do caso reproduzido.
    expect(screen.getByText(/15\/09\/2026/)).toBeInTheDocument();
    expect(screen.queryByText(/Próximos vencimentos:.*14\/08\/2026/)).not.toBeInTheDocument();
  });

  it("⚠ e NÃO oferece a caixa de atraso: aqui um clique afirmaria atraso da carteira inteira", async () => {
    await abrirPassoQuando();
    expect(screen.getByText(/nenhuma empresa do escopo nasce vencida/)).toBeInTheDocument();
    expect(screen.queryByText(/Registrar .* como pendência em atraso/)).not.toBeInTheDocument();
  });
});
