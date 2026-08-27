// ⚠⚠ O SELO É DIRIGIDO PELO DADO, E ESTE TESTE EXISTE PARA FICAR VERMELHO SE ALGUÉM O PRENDER AO
// `api.mode`.
//
// A tentação é óbvia — "estamos em modo mock, logo é demonstração" — e ela falha exatamente onde
// importa: `api.mode` vale `"real"` em produção, e no dia em que estas duas funções ainda
// devolverem número fictício de um backend que não existe, o selo teria sumido sozinho. O aviso
// "Modo demonstração" do login vive de `api.mode`; ESTE não pode.
//
// ⚠ Experimento executado: trocando a leitura por `api.mode === "mock"`, esta suíte fica **1
// vermelho**; restaurada, 7 verdes.
//
// ⚠ O outro lado da regra: a leitura é `demonstracao !== false`, nunca `=== true`. Resposta que não
// traga o campo (backend novo que esqueceu, coluna fora de um `select` explícito — a armadilha que
// já mordeu três vezes neste projeto) apresentaria ficção como fato, em silêncio.

import { act, render, screen } from "@testing-library/react";
import { api } from "../../../api";
import { BlocoDeDemonstracao } from "../BlocoDeDemonstracao";
// ⚠ O payload do FLUXO passou a ser o do CONTRATO REAL (27/08/2026) — o gerador de demonstração
// ficou só com o DRE. Montar estes casos sobre a forma antiga faria a suíte provar a regra do selo
// em cima de uma resposta que o servidor não devolve mais.
import { fluxoDeCaixaDoMock } from "../../../api/mock/fluxoDeCaixaDoMock";

const COMPETENCIA = "2026-08";
const FRASE = /Dados de demonstração/i;

function fluxo(extra) {
  return { ...fluxoDeCaixaDoMock("pc-001", COMPETENCIA), ...extra };
}

async function abrir() {
  render(<BlocoDeDemonstracao companyId="pc-001" competencia={COMPETENCIA} />);
  await act(async () => {});
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("o selo de demonstração", () => {
  test("aparece quando a resposta se declara demonstração", async () => {
    jest.spyOn(api, "getFluxoCaixa").mockResolvedValue(fluxo({ demonstracao: true }));
    await abrir();

    expect(screen.getByText(FRASE)).toBeInTheDocument();
    expect(document.querySelector('[data-demonstracao="sim"]')).toBeTruthy();
  });

  test("⚠⚠ SOME quando o servidor AFIRMA que o dado é real — e é aqui que o `api.mode` cairia", async () => {
    // A suíte roda no modo padrão do app, que é `mock`. Um selo preso ao ambiente continuaria
    // aceso nesta linha, com o dado dizendo o contrário.
    expect(api.mode).toBe("mock");

    jest.spyOn(api, "getFluxoCaixa").mockResolvedValue(fluxo({ demonstracao: false }));
    await abrir();

    expect(screen.queryByText(FRASE)).toBeNull();
    expect(document.querySelector('[data-demonstracao="nao"]')).toBeTruthy();
    // E os números continuam na tela: o que saiu foi o aviso, não o conteúdo.
    expect(screen.getByRole("heading", { name: "Fluxo de caixa" })).toBeInTheDocument();
  });

  test("⚠ resposta SEM o campo continua com selo — ausente não é `false`", async () => {
    const semCampo = fluxo();
    delete semCampo.demonstracao;
    jest.spyOn(api, "getFluxoCaixa").mockResolvedValue(semCampo);
    await abrir();

    expect(screen.getByText(FRASE)).toBeInTheDocument();
  });

  test("⚠ enquanto NADA respondeu, o selo já está lá", async () => {
    // O bloco nasce sem dados, e `undefined?.demonstracao` é `undefined` — que não é `false`.
    // Um instante de números fictícios sem aviso é o que esta leitura existe para impedir.
    jest.spyOn(api, "getFluxoCaixa").mockReturnValue(new Promise(() => {}));
    await abrir();

    expect(screen.getByText(FRASE)).toBeInTheDocument();
  });

  test("⚠ o DRE também é selado — e ele é o que se lê como peça contábil", async () => {
    jest.spyOn(api, "getFluxoCaixa").mockResolvedValue(fluxo());
    jest.spyOn(api, "getDre").mockResolvedValue({
      demonstracao: true,
      competencia: COMPETENCIA,
      linhas: [{ chave: "receita", rotulo: "Receita bruta de serviços", valor: 1000, tipo: "entrada" }],
    });
    await abrir();

    await act(async () => {
      screen.getByRole("button", { name: "DRE" }).click();
    });

    expect(screen.getByRole("heading", { name: "DRE" })).toBeInTheDocument();
    expect(screen.getByText(FRASE)).toBeInTheDocument();
  });

  test("⚠ a visão do DRE não oferece exportar, imprimir nem baixar", async () => {
    // O risco não é a tela: é ela SAIR da tela sem o selo junto (print, PDF, e-mail ao banco).
    jest.spyOn(api, "getFluxoCaixa").mockResolvedValue(fluxo());
    jest.spyOn(api, "getDre").mockResolvedValue({
      demonstracao: true,
      competencia: COMPETENCIA,
      linhas: [{ chave: "resultado", rotulo: "= Resultado do período", valor: -500, tipo: "resultado" }],
    });
    await abrir();

    await act(async () => {
      screen.getByRole("button", { name: "DRE" }).click();
    });

    const rotulos = screen.getAllByRole("button").map((b) => b.textContent);
    expect(rotulos).toEqual(["Fluxo de caixa", "DRE"]);
    expect(document.body.textContent).not.toMatch(/exportar|imprimir|baixar/i);
  });

  test("⚠ trocar de visão NÃO navega — nenhum `<a href>` nasce do seletor", async () => {
    // Visão não é rota. `#/dre` cairia no destino padrão do `useRota` — o "filtro fantasma"
    // dentro da própria tela.
    jest.spyOn(api, "getFluxoCaixa").mockResolvedValue(fluxo());
    await abrir();

    // ⚠ O seletor de visão vive no cabeçalho do bloco; a classe `.demonstracao` da moldura só
    // existe quando a visão ATIVA é ficção, então a busca é pelo bloco, não pela classe.
    expect(document.querySelector("[aria-label=\"Fluxo de caixa e DRE\"] a")).toBeNull();
    expect(window.location.hash).toBe("");
  });
});
