// O DIA QUE ABRE — a ligação.
//
// Pedido do dono (23/08/2026): *"mostrando os dias do mês, com ação para abrir o dia e ver quais
// foram as despesas daquele dia específico"*.
//
// ⚠ Por que LIGAÇÃO e não regra: a lib (`fluxoDiario.test.js`) já prova que a série tem os ramos, e
// continuaria verde com a tela abrindo o dia ERRADO, sem botão de fechar, ou oferecendo um "+" que
// não pode existir. O que se mede aqui é o que a TELA faz.

import { StrictMode } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { api } from "../../../api";
import { BlocoDeDemonstracao } from "../BlocoDeDemonstracao";
import { fluxoDeCaixaDeDemonstracao } from "../lib/dadosDeDemonstracao";

const COMPETENCIA = "2026-08";
const DADOS = fluxoDeCaixaDeDemonstracao("pc-001", COMPETENCIA);

/** O primeiro dia do mês com movimento — e os outros dois casos que a tela desenha diferente. */
const COM_MOVIMENTO = DADOS.dias.find((d) => d.lancamentos.length > 0);
const VAZIO = DADOS.dias.find((d) => d.lancamentos.length === 0);
const numero = (d) => Number(d.dia.slice(8, 10));

async function abrir() {
  render(
    <StrictMode>
      <BlocoDeDemonstracao companyId="pc-001" competencia={COMPETENCIA} />
    </StrictMode>
  );
  await act(async () => {});
}

/** Clica no botão do dia — o caminho de teclado, que é o que o leitor de tela enxerga. */
async function abrirDia(d) {
  fireEvent.click(screen.getByRole("button", { name: `Abrir o dia ${numero(d)}` }));
  await act(async () => {});
}

beforeEach(() => {
  jest.spyOn(api, "getFluxoCaixa").mockResolvedValue(DADOS);
});

afterEach(() => jest.restoreAllMocks());

describe("a tabela é DIÁRIA", () => {
  test("uma linha por dia do mês, e as quatro colunas pedidas", async () => {
    await abrir();
    expect(document.querySelectorAll(".table--fluxo tbody tr")).toHaveLength(31);
    const colunas = screen.getAllByRole("columnheader").map((th) => th.textContent);
    expect(colunas).toEqual(["Dia", "Entradas", "Saídas", "Saldo"]);
  });

  test("⚠ o rodapé traz os totais do mês — e a célula do saldo é o SALDO FINAL, não uma soma", async () => {
    await abrir();
    const rodape = document.querySelector(".table--fluxo tfoot tr");
    const celulas = [...rodape.children].map((c) => c.textContent);
    expect(celulas[0]).toBe("No mês");
    // Somar uma coluna de saldo acumulado não significaria nada; o `title` diz o que ela é.
    expect(rodape.querySelector('[title="Saldo no fim do mês"]')).toBeTruthy();
  });

  test("⚠ dia sem movimento é marcado no DOM — é o que o esmaece", async () => {
    await abrir();
    const linhas = [...document.querySelectorAll(".table--fluxo tbody tr")];
    expect(linhas.filter((tr) => tr.dataset.vazio === "sim").length).toBeGreaterThan(15);
  });
});

describe("⚠⚠ abrir o dia", () => {
  test("o botão do dia tem NOME ACESSÍVEL — sem ele a ação some para quem usa leitor de tela", async () => {
    await abrir();
    expect(screen.getByRole("button", { name: "Abrir o dia 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Abrir o dia 31" })).toBeInTheDocument();
  });

  test("abre o painel DAQUELE dia, com os lançamentos dele", async () => {
    await abrir();
    await abrirDia(COM_MOVIMENTO);

    const painel = screen.getByRole("dialog");
    expect(within(painel).getByRole("heading", { level: 2 }).textContent)
      .toMatch(new RegExp(`^${numero(COM_MOVIMENTO)} de `));
    for (const l of COM_MOVIMENTO.lancamentos) {
      expect(within(painel).getByText(l.descricao)).toBeInTheDocument();
    }
    expect(within(painel).getAllByRole("listitem")).toHaveLength(COM_MOVIMENTO.lancamentos.length);
  });

  test("⚠ clicar na LINHA abre o mesmo dia que o botão — e é a primeira linha clicável deste app", async () => {
    await abrir();
    const linha = document.querySelector(
      `.table--fluxo tbody tr:nth-child(${numero(COM_MOVIMENTO)})`
    );
    fireEvent.click(linha);
    await act(async () => {});

    expect(within(screen.getByRole("dialog")).getByRole("heading", { level: 2 }).textContent)
      .toMatch(new RegExp(`^${numero(COM_MOVIMENTO)} de `));
  });

  test("⚠ DIA VAZIO abre e DIZ que está vazio — ausência é resposta, não falha", async () => {
    await abrir();
    await abrirDia(VAZIO);

    const painel = screen.getByRole("dialog");
    expect(within(painel).getByText("Nenhum lançamento neste dia.")).toBeInTheDocument();
    expect(within(painel).queryAllByRole("listitem")).toHaveLength(0);
  });

  test("⚠ o SELO se repete no painel — o diálogo cobre o do bloco", async () => {
    await abrir();
    await abrirDia(COM_MOVIMENTO);
    expect(within(screen.getByRole("dialog")).getByText(/Dados de demonstração/i)).toBeInTheDocument();
  });
});

describe("⚠⚠ o painel NÃO oferece o que não pode existir", () => {
  test("só há três botões: fechar, dia anterior e próximo dia", async () => {
    // O print do dono tem `+` e `⋮`. O portal do cliente NÃO escreve contabilidade: quem lança é o
    // escritório, não há rota para criar nem editar, e botão impossível é pior que ausência.
    await abrir();
    await abrirDia(COM_MOVIMENTO);

    const painel = screen.getByRole("dialog");
    const rotulos = within(painel).getAllByRole("button").map((b) => b.getAttribute("aria-label"));
    expect(rotulos).toEqual(["Fechar", "Dia anterior", "Próximo dia"]);
    expect(painel.textContent).not.toMatch(/adicionar|novo lançamento|editar|excluir/i);
  });
});

describe("⚠⚠ o ‹ › não sai do mês", () => {
  test("no dia 1 o anterior fica DESABILITADO", async () => {
    await abrir();
    await abrirDia(DADOS.dias[0]);
    const painel = screen.getByRole("dialog");
    expect(within(painel).getByRole("button", { name: "Dia anterior" })).toBeDisabled();
    expect(within(painel).getByRole("button", { name: "Próximo dia" })).toBeEnabled();
  });

  test("no último dia o próximo fica DESABILITADO", async () => {
    // Passar daqui ou trocaria a competência da casca em silêncio, ou mostraria um dia que não
    // está na tabela atrás.
    await abrir();
    await abrirDia(DADOS.dias[DADOS.dias.length - 1]);
    const painel = screen.getByRole("dialog");
    expect(within(painel).getByRole("button", { name: "Próximo dia" })).toBeDisabled();
    expect(within(painel).getByRole("button", { name: "Dia anterior" })).toBeEnabled();
  });

  test("⚠ e ele DESABILITA, não some — controle que aparece e some deixa a barra instável", async () => {
    await abrir();
    await abrirDia(DADOS.dias[0]);
    expect(within(screen.getByRole("dialog")).getByRole("button", { name: "Dia anterior" }))
      .toBeInTheDocument();
  });

  test("andar um dia troca o conteúdo do painel", async () => {
    await abrir();
    await abrirDia(DADOS.dias[0]);
    fireEvent.click(screen.getByRole("button", { name: "Próximo dia" }));
    await act(async () => {});
    expect(within(screen.getByRole("dialog")).getByRole("heading", { level: 2 }).textContent)
      .toMatch(/^2 de /);
  });
});

describe("fechar", () => {
  test("Esc fecha", async () => {
    await abrir();
    await abrirDia(COM_MOVIMENTO);
    fireEvent.keyDown(window, { key: "Escape" });
    await act(async () => {});
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("o botão fechar fecha", async () => {
    await abrir();
    await abrirDia(COM_MOVIMENTO);
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    await act(async () => {});
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("⚠ trocar de VISÃO fecha — senão o painel fica falando de um dia com a DRE atrás", async () => {
    jest.spyOn(api, "getDre").mockResolvedValue({
      demonstracao: true, competencia: COMPETENCIA,
      linhas: [{ chave: "receita", rotulo: "Receita bruta de serviços", valor: 1000, tipo: "entrada" }],
    });
    await abrir();
    await abrirDia(COM_MOVIMENTO);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "DRE" }));
    await act(async () => {});
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
