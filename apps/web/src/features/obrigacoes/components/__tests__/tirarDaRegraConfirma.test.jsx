// "TIRAR DA REGRA" É ATO DE CONSEQUÊNCIA — E A CONFIRMAÇÃO REPETE OS DADOS.
//
// O clique não perguntava nada e apagava a obrigação da empresa com TODAS as ocorrências, inclusive
// as concluídas (cascade). A assimetria denunciava que não era decisão: excluir a REGRA, que causa
// o mesmo estrago, pergunta duas vezes e avisa que não dá para desfazer.
//
// O que se cobra aqui não é um "tem certeza?": é a pergunta DIZENDO o que esta empresa tem a perder
// — quantos vencimentos concluídos — e qual dos dois desfechos vai acontecer.

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { RegrasObrigacao } from "../renderRegrasObrigacao";

const EMPRESAS = [
  { companyId: "alfa", razao: "ALFA LTDA" },
  { companyId: "beta", razao: "BETA LTDA" },
];

function regraCom(empresas, extras = {}) {
  return {
    ok: true,
    opcoes: { escopos: ["TODAS"], regimes: [], periodicidades: ["MENSAL"], ajustesDiaUtil: ["ANTECIPAR"], verificadores: [] },
    regras: [{
      regraId: "r1",
      nome: "EFD-Contribuições",
      periodicidade: "MENSAL",
      diaVencimento: 15,
      resumoEscopo: "Todas as empresas · 2 empresas",
      totalEmpresas: empresas.length,
      totalExcecoes: 0,
      totalSobrescritas: 0,
      empresas,
      excecoes: [],
      ...extras,
    }],
  };
}

function apiCom(regras) {
  return {
    listRegrasObrigacao: jest.fn().mockResolvedValue(regras),
    previewEscopoRegra: jest.fn().mockResolvedValue({ ok: true, total: 2, empresas: EMPRESAS }),
    addExcecaoRegra: jest.fn().mockResolvedValue({ ok: true, desvinculadas: 1, removidas: 0 }),
    removeExcecaoRegra: jest.fn().mockResolvedValue({ ok: true, readotada: true }),
  };
}

/** Abre a lista de empresas da regra. */
async function abrirEmpresas(api) {
  render(<RegrasObrigacao api={api} empresas={EMPRESAS} onVoltar={() => {}} />);
  await screen.findByText("EFD-Contribuições");
  fireEvent.click(screen.getByRole("button", { name: "Empresas" }));
}

let confirmar;
beforeEach(() => {
  confirmar = jest.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => { confirmar.mockRestore(); });

describe("tirar da regra — a pergunta", () => {
  it("⚠ a confirmação diz QUANTOS vencimentos concluídos estão em jogo", async () => {
    const api = apiCom(regraCom([
      { companyId: "alfa", razao: "ALFA LTDA", obrigacaoId: "ob-alfa", ocorrenciasConcluidas: 3 },
    ]));
    await abrirEmpresas(api);
    fireEvent.click(await screen.findByRole("button", { name: "tirar da regra" }));

    const texto = confirmar.mock.calls[0][0];
    expect(texto).toMatch(/ALFA LTDA/);
    expect(texto).toMatch(/EFD-Contribuições/);
    expect(texto).toMatch(/3 vencimento\(s\) já concluído\(s\)/);
    expect(texto).toMatch(/NÃO é apagado/);
    await waitFor(() => expect(api.addExcecaoRegra).toHaveBeenCalledWith("r1", "alfa", null));
  });

  it("⚠ CANCELAR não chama nada — a recusa é a recusa", async () => {
    confirmar.mockReturnValue(false);
    const api = apiCom(regraCom([
      { companyId: "alfa", razao: "ALFA LTDA", obrigacaoId: "ob-alfa", ocorrenciasConcluidas: 3 },
    ]));
    await abrirEmpresas(api);
    fireEvent.click(await screen.findByRole("button", { name: "tirar da regra" }));

    expect(confirmar).toHaveBeenCalled();
    expect(api.addExcecaoRegra).not.toHaveBeenCalled();
  });

  it("sem nada concluído, a pergunta diz o outro desfecho — a obrigação some daquela empresa", async () => {
    const api = apiCom(regraCom([
      { companyId: "beta", razao: "BETA LTDA", obrigacaoId: "ob-beta", ocorrenciasConcluidas: 0 },
    ]));
    await abrirEmpresas(api);
    fireEvent.click(await screen.findByRole("button", { name: "tirar da regra" }));

    const texto = confirmar.mock.calls[0][0];
    expect(texto).toMatch(/Nenhum vencimento concluído/);
    expect(texto).toMatch(/some do calendário desta empresa/);
  });

  it("⚠ contagem AUSENTE não vira zero — a pergunta assume que pode haver histórico", async () => {
    // Um servidor que não informe o número não pode fazer a tela prometer que não há o que perder.
    const api = apiCom(regraCom([
      { companyId: "alfa", razao: "ALFA LTDA", obrigacaoId: "ob-alfa" },
    ]));
    await abrirEmpresas(api);
    fireEvent.click(await screen.findByRole("button", { name: "tirar da regra" }));

    const texto = confirmar.mock.calls[0][0];
    expect(texto).toMatch(/Não deu para contar/);
    expect(texto).not.toMatch(/Nenhum vencimento concluído/);
  });

  it("o aviso conta qual desfecho o SERVIDOR aplicou — a tela não adivinha por ele", async () => {
    const api = apiCom(regraCom([
      { companyId: "alfa", razao: "ALFA LTDA", obrigacaoId: "ob-alfa", ocorrenciasConcluidas: 2 },
    ]));
    await abrirEmpresas(api);
    fireEvent.click(await screen.findByRole("button", { name: "tirar da regra" }));

    expect(await screen.findByText(/continua nela, avulsa, com os vencimentos concluídos/)).toBeInTheDocument();
  });

  it("desvinculadas = 0 na resposta: o aviso diz que foi removida, não o contrário", async () => {
    const api = apiCom(regraCom([
      { companyId: "beta", razao: "BETA LTDA", obrigacaoId: "ob-beta", ocorrenciasConcluidas: 0 },
    ]));
    api.addExcecaoRegra.mockResolvedValue({ ok: true, desvinculadas: 0, removidas: 1 });
    await abrirEmpresas(api);
    fireEvent.click(await screen.findByRole("button", { name: "tirar da regra" }));

    expect(await screen.findByText(/foi removida do calendário dela/)).toBeInTheDocument();
  });
});

describe("o selo de exceções", () => {
  it('⚠ escreve "2 exceções" — a concatenação dizia "2 exceçãoões"', async () => {
    const api = apiCom(regraCom([], { totalExcecoes: 2, excecoes: [{ companyId: "beta" }, { companyId: "alfa" }] }));
    render(<RegrasObrigacao api={api} empresas={EMPRESAS} onVoltar={() => {}} />);

    expect(await screen.findByText("2 exceções")).toBeInTheDocument();
    expect(screen.queryByText(/exceçãoões/)).not.toBeInTheDocument();
  });

  it("no singular continua sendo 1 exceção", async () => {
    const api = apiCom(regraCom([], { totalExcecoes: 1, excecoes: [{ companyId: "beta" }] }));
    render(<RegrasObrigacao api={api} empresas={EMPRESAS} onVoltar={() => {}} />);

    expect(await screen.findByText("1 exceção")).toBeInTheDocument();
  });
});
