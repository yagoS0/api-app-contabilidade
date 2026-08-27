// ⚠⚠ A LIGAÇÃO DO FLUXO DE CAIXA REAL COM A TELA DO CLIENTE (27/08/2026).
//
// ⚠⚠ ESTE ARQUIVO SUBSTITUI `diaDoFluxo.ligacao.test.jsx`, e a substituição é o registro de uma
// PERDA DELIBERADA: o fluxo era DIÁRIO (dia · entradas · saídas · SALDO, com um painel que abria o
// dia) e era FICÇÃO. Com o payload real ele é MENSAL, e as duas peças de lá não podiam sobreviver:
//
//   · **as projeções não têm dia** — o prazo de recebimento é contado em meses e a recorrência diz
//     o ciclo, então uma coluna "dia" obrigaria a inventar precisão que ninguém informou;
//   · **não existe saldo acumulado** — sem saldo inicial não há o que acumular, e a coluna "Saldo"
//     afirmava justamente isso.
//
// ⚠ O que NÃO se perdeu está travado aqui embaixo: a lei de cor, a ausência do total, o vazio que
// se declara, e a invariante de que **este portal não escreve contabilidade** (não há `+` nem `⋮`),
// que veio inteira do teste antigo.
//
// ⚠ `PainelDoDia.jsx` e `lib/dadosDeDemonstracao.diasDoMes` ficaram sem consumidor e **não foram
// apagados** — apagar componente é decisão à parte, com precedente escrito neste projeto.

import { act, render, screen, within } from "@testing-library/react";
import { api } from "../../../api";
import { BlocoDeDemonstracao } from "../BlocoDeDemonstracao";
import { fluxoDeCaixaDoMock } from "../../../api/mock/fluxoDeCaixaDoMock";

const COMPETENCIA = "2026-08";

async function abrir(payload) {
  jest.spyOn(api, "getFluxoCaixa").mockResolvedValue(payload);
  render(<BlocoDeDemonstracao companyId="pc-001" competencia={COMPETENCIA} />);
  await act(async () => {});
}

const cheio = () => fluxoDeCaixaDoMock("pc-001", COMPETENCIA);
const magro = () => fluxoDeCaixaDoMock("pc-006", COMPETENCIA);

afterEach(() => {
  jest.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ A LEI DE COR, NA TELA.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ a previsão nunca se parece com um fato", () => {
  test("⚠⚠ a palavra 'Previsto' está no TEXTO — não só na cor", async () => {
    await abrir(cheio());
    // Cor não sobrevive à impressão em preto e branco nem ao daltonismo; o texto sobrevive.
    expect(screen.getAllByText("Previsto").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Já existe").length).toBeGreaterThan(0);
  });

  test("⚠⚠ nenhuma linha prevista é pintada com a classe do CONCLUÍDO", async () => {
    await abrir(cheio());
    // ⚠ Verde, nesta casa, quer dizer *pago/concluído*. A varredura é sobre o DOM inteiro do bloco.
    expect(document.querySelector('[data-procedencia="PREVISAO"].ok')).toBeNull();
    expect(document.querySelectorAll('[data-procedencia="PREVISAO"]').length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ O QUE A TELA NÃO MOSTRA.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ não existe total, nem saldo", () => {
  test("⚠⚠ a tela não escreve 'saldo' em lugar nenhum", async () => {
    await abrir(cheio());
    // ⚠ A tabela antiga tinha uma coluna Saldo e um "saldo no fim do mês". Sem saldo inicial não há
    // o que acumular — a coluna afirmava um número que este sistema não conhece.
    expect(document.body.textContent).not.toMatch(/saldo (do mês|final|acumulado)/i);
  });

  test("⚠⚠ e ela DIZ por que não há um total dos 12 meses", async () => {
    await abrir(cheio());
    expect(screen.getByText(/Não há um total dos 12 meses/i)).toBeInTheDocument();
  });

  test("⚠⚠ o aviso da previsão é obrigatório e está na tela", async () => {
    await abrir(cheio());
    expect(screen.getByText(/ainda não aconteceu/i)).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ ESTE PORTAL NÃO ESCREVE CONTABILIDADE — invariante herdada do teste antigo.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ nada aqui lança, edita ou apaga", () => {
  test("os únicos botões são as duas visões e o de recolher os meses distantes", async () => {
    await abrir(cheio());
    const nomes = screen.getAllByRole("button").map((b) => b.textContent.trim());
    expect(nomes).toEqual(["Fluxo de caixa", "DRE", "Mostrar mês a mês"]);
  });

  test("⚠ nenhum `+` nem `⋮` — quem lança é o escritório, e botão impossível é pior que ausência", async () => {
    await abrir(cheio());
    for (const b of screen.getAllByRole("button")) {
      expect(b.textContent).not.toMatch(/[+⋮]/);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ O QUE FALTA APARECE, NOMEADO.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ nada some em silêncio", () => {
  test("⚠⚠ a guia VENCIDA aparece, com o valor — ela não mora em mês nenhum", async () => {
    await abrir(cheio());
    expect(screen.getByText(/Guias já vencidas/)).toBeInTheDocument();
    expect(screen.getByText(/18\.638,39/)).toBeInTheDocument();
  });

  test("⚠⚠ a guia sem vencimento é nomeada, com o conserto", async () => {
    await abrir(cheio());
    expect(screen.getByText(/Sem mês — SIMPLES/)).toBeInTheDocument();
    expect(screen.getByText(/Recapture a guia/)).toBeInTheDocument();
  });

  test("⚠⚠ 'ninguém configurou o prazo' aparece — o padrão não passa por decisão", async () => {
    await abrir(cheio());
    expect(screen.getByText(/PADRÃO do sistema/)).toBeInTheDocument();
  });

  test("⚠⚠ e na empresa sem apuração a AUSÊNCIA do imposto é dita", async () => {
    await abrir(magro());
    expect(screen.getByText(/Sem imposto previsto/)).toBeInTheDocument();
    expect(screen.getByText(/Repetições não lidas/)).toBeInTheDocument();
  });

  test("⚠ mês vazio DIZ que está vazio — senão 'não há movimento' e 'não carregou' ficam iguais", async () => {
    await abrir(magro());
    expect(screen.getAllByText(/Nada previsto nem lançado para este mês/).length).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ A EVIDÊNCIA E O DIA QUE NÃO EXISTE.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ por que esta linha está aqui", () => {
  test("⚠⚠ a faixa e o 'visto N vezes' saem no TEXTO, não num `title`", async () => {
    await abrir(cheio());
    // ⚠ `title` não aparece no teclado nem no toque, e este portal é lido no celular.
    expect(screen.getByText(/visto 3 vezes · entre R\$ 120,00 e R\$ 140,00/)).toBeInTheDocument();
  });

  test("⚠⚠ o CONFRONTO da recorrência declarada aparece, e fala com quem declarou", async () => {
    await abrir(cheio());
    expect(screen.getByText(/Você informou R\$ 1\.000,00/)).toBeInTheDocument();
  });

  test("⚠⚠ o dia ausente vira 'ao longo do mês' COM O MOTIVO — nunca um dia inventado", async () => {
    await abrir(cheio());
    expect(screen.getAllByText("ao longo do mês").length).toBeGreaterThan(0);
    expect(screen.getByText(/O prazo de recebimento é contado em meses/)).toBeInTheDocument();
  });

  test("⚠ a guia, essa, tem dia próprio", async () => {
    await abrir(cheio());
    // ⚠ Duas: a do mês corrente e a do seguinte. Nas duas o dia é o `vencimento` de verdade.
    expect(screen.getAllByText("dia 20")).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ OS 12 MESES, COM 3 ABERTOS.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ a tela abre com 3 meses", () => {
  test("três meses abertos e nove recolhidos, com o total do bloco à vista", async () => {
    await abrir(cheio());
    expect(screen.getByRole("heading", { name: "agosto de 2026" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "setembro de 2026" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "outubro de 2026" })).toBeInTheDocument();
    // ⚠ O quarto mês NÃO está aberto.
    expect(screen.queryByRole("heading", { name: "novembro de 2026" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Mais 9 mês(es)" })).toBeInTheDocument();
    // ⚠⚠ O total do bloco recolhido fica à vista: sem ele os nove meses sumiriam.
    expect(screen.getByText("No bloco recolhido")).toBeInTheDocument();
  });

  test("⚠ e o bloco abre quando a pessoa pede", async () => {
    await abrir(cheio());
    const botao = screen.getByRole("button", { name: "Mostrar mês a mês" });
    expect(botao).toHaveAttribute("aria-expanded", "false");
    await act(async () => { botao.click(); });
    expect(screen.getByRole("heading", { name: "novembro de 2026" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recolher" })).toHaveAttribute("aria-expanded", "true");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ O SELO.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ o selo de demonstração some com o fluxo real", () => {
  test("o fluxo real não tem selo, e a moldura tracejada sai junto", async () => {
    await abrir(cheio());
    expect(screen.queryByText(/Dados de demonstração/i)).toBeNull();
    const bloco = document.querySelector('[data-demonstracao="nao"]');
    expect(bloco).toBeTruthy();
    // ⚠ A moldura tracejada é do que É demonstração. Mantê-la diria "isto é maquete" por desenho,
    // depois de o selo ter sumido.
    expect(bloco.className).not.toMatch(/\bdemonstracao\b/);
  });

  test("⚠⚠ mas ele volta se o servidor deixar de AFIRMAR — ausente não é `false`", async () => {
    const { demonstracao, ...semOCampo } = cheio();
    expect(demonstracao).toBe(false);
    await abrir(semOCampo);
    expect(screen.getByText(/Dados de demonstração/i)).toBeInTheDocument();
  });

  test("⚠ e os números continuam na tela nos dois casos", async () => {
    await abrir(cheio());
    const tabela = screen.getAllByRole("table")[0];
    expect(within(tabela).getByText("SIMPLES")).toBeInTheDocument();
  });
});
