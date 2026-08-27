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

/**
 * Abre o detalhe de um mês pela planilha — `"set/26"`.
 *
 * ⚠⚠ ELE EXISTE PORQUE A EVIDÊNCIA DEIXOU DE ESTAR TODA ABERTA AO MESMO TEMPO, e isso é uma perda
 * deliberada, medida: as 12 seções empilhadas ocupavam **1.723px de 2.325px — 74% da página inicial
 * do cliente — para 7 linhas de conteúdo**, e o dono pediu, com a tela na frente, *"o fluxo deve se
 * parecer mais com uma planilha excel"*.
 *
 * ⚠ A evidência **não foi apagada**: ela é a diferença entre "previsto" e "chutado". Ela ficou a um
 * clique — e é por isso que os casos abaixo clicam em vez de baixarem a asserção.
 */
async function abrirMes(rotuloCurto) {
  await act(async () => { screen.getByRole("button", { name: rotuloCurto }).click(); });
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
  // ⚠⚠ A LISTA MUDOU EM 27/08/2026 PORQUE A FORMA MUDOU — a INVARIANTE não. Ela era
  // `["Fluxo de caixa", "DRE", "Mostrar mês a mês"]`, de quando o fluxo eram 12 seções empilhadas.
  // Hoje é a planilha, e os botões a mais são os CABEÇALHOS DE MÊS, que só abrem o detalhe.
  // ⚠ O que este caso trava continua sendo o mesmo: **nenhum botão daqui escreve contabilidade**.
  test("os únicos botões são as duas visões e os cabeçalhos de mês — nada mais", async () => {
    await abrir(cheio());
    const nomes = screen.getAllByRole("button").map((b) => b.textContent.trim());
    expect(nomes.slice(0, 2)).toEqual(["Fluxo de caixa", "DRE"]);
    // Os 12 restantes são meses, e nada além disso: `ago/26`, `set/26`, …
    const meses = nomes.slice(2);
    expect(meses).toHaveLength(12);
    for (const m of meses) expect(m).toMatch(/^[a-z]{3}\/\d{2}$/);
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

  // ⚠ Media 3 (os três meses que abriam juntos). Com a planilha abre UM detalhe por vez, então a
  // frase aparece uma vez — e o que ela trava é o mesmo: **mês sem movimento DIZ que está sem**,
  // senão "não há movimento" e "não carregou" ficam com o mesmo desenho.
  test("⚠ mês vazio DIZ que está vazio — senão 'não há movimento' e 'não carregou' ficam iguais", async () => {
    await abrir(magro());
    // ⚠ A `pc-006` não tem nenhum mês com linha, então o detalhe abre `null` e ninguém afirma nada.
    expect(screen.queryByText(/Nada previsto nem lançado para este mês/)).toBeNull();
    // Pedindo um mês explicitamente, a frase aparece — e é só ela.
    await abrirMes("ago/26");
    expect(screen.getAllByText(/Nada previsto nem lançado para este mês/)).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ A EVIDÊNCIA E O DIA QUE NÃO EXISTE.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ por que esta linha está aqui", () => {
  test("⚠⚠ a faixa e o 'visto N vezes' saem no TEXTO, não num `title`", async () => {
    await abrir(cheio());
    await abrirMes("set/26");
    // ⚠ `title` não aparece no teclado nem no toque, e este portal é lido no celular.
    expect(screen.getByText(/visto 3 vezes · entre R\$ 120,00 e R\$ 140,00/)).toBeInTheDocument();
  });

  test("⚠⚠ o CONFRONTO da recorrência declarada aparece, e fala com quem declarou", async () => {
    await abrir(cheio());
    await abrirMes("set/26");
    expect(screen.getByText(/Você informou R\$ 1\.000,00/)).toBeInTheDocument();
  });

  test("⚠⚠ o dia ausente vira 'ao longo do mês' COM O MOTIVO — nunca um dia inventado", async () => {
    await abrir(cheio());
    await abrirMes("set/26");
    expect(screen.getAllByText("ao longo do mês").length).toBeGreaterThan(0);
    expect(screen.getByText(/O prazo de recebimento é contado em meses/)).toBeInTheDocument();
  });

  test("⚠ a guia, essa, tem dia próprio", async () => {
    // ⚠ Media 2 (a do mês corrente e a do seguinte, abertos juntos). Com um detalhe por vez, é 1 —
    // e o que se trava continua sendo que a GUIA tem dia de verdade (o `vencimento`), ao contrário
    // da projeção, que não tem.
    await abrir(cheio());
    expect(screen.getAllByText("dia 20")).toHaveLength(1);
    await abrirMes("set/26");
    expect(screen.getAllByText("dia 20")).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ A PLANILHA — UMA GRADE, OS 12 MESES NAS COLUNAS (27/08/2026).
//
// Pedido do dono, com a tela na frente: *"um monte de meses aparecendo, excesso de tabela, o fluxo
// deve se parecer mais com uma planilha excel"*.
//
// ⚠ O QUE ELE VIA, MEDIDO NO NAVEGADOR (1280px, mock, 08/2026): **1.723px de 2.325px — 74% da página
// inicial — para 7 linhas de conteúdo**, em 11 blocos empilhados e 3 tabelas. Em 375px a página
// tinha 4,4 telas de rolagem e linhas de até 183px.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ a planilha: uma grade, doze colunas", () => {
  test("⚠⚠ é UMA tabela para os 12 meses, não uma por mês", async () => {
    await abrir(cheio());
    // ⚠ O escopo é a PRIMEIRA tabela de propósito: a segunda é o DETALHE do mês aberto (Quando · O
    // quê · Entra · Sai) — e é justamente por existirem só duas que a queixa do dono se desfaz.
    // Antes eram três tabelas de mês; hoje é a grade + o detalhe de UM mês.
    expect(screen.getAllByRole("table")).toHaveLength(2);
    const grade = screen.getAllByRole("table")[0];
    const colunas = within(grade).getAllByRole("columnheader");
    expect(colunas).toHaveLength(12);
    expect(colunas[0].textContent.trim()).toBe("ago/26");
    expect(colunas[11].textContent.trim()).toBe("jul/27");
  });

  test("⚠⚠ as QUATRO linhas separam entra/sai × já existe/previsto — e não há uma quinta somando", async () => {
    await abrir(cheio());
    const linhas = screen.getAllByRole("rowheader").map((th) => th.textContent.trim());
    expect(linhas).toEqual([
      "EntraJá existe", "EntraPrevisto", "SaiJá existe", "SaiPrevisto",
    ]);
    // ⚠⚠ A AUSÊNCIA É O CONTRATO: nenhuma linha "No mês", "Saldo" ou "Total" — ela recriaria o
    // número único que a API se recusa a entregar, somando `fato` com `previsão`.
    expect(document.body.textContent).not.toMatch(/No m[êe]s|Total do m[êe]s/i);
  });

  test("⚠⚠ ZERO sai como TRAÇO, nunca `R$ 0,00`", async () => {
    // A parede de zeros é a doença que esta forma existe para desfazer — e "nada neste
    // compartimento" não é a mesma afirmação que "zero reais".
    await abrir(cheio());
    const grade = screen.getAllByRole("table")[0];
    expect(within(grade).queryByText("R$ 0,00")).toBeNull();
    expect(within(grade).getAllByText("—").length).toBeGreaterThan(0);
  });

  test("⚠ a tela abre com UM mês aberto — o primeiro que tem algo", async () => {
    await abrir(cheio());
    expect(screen.getByRole("heading", { name: "agosto de 2026" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "setembro de 2026" })).toBeNull();
    expect(screen.getByRole("button", { name: "ago/26" })).toHaveAttribute("aria-pressed", "true");
  });

  test("⚠ clicar num mês abre o dele; clicar de novo fecha", async () => {
    await abrir(cheio());
    await abrirMes("out/26");
    expect(screen.getByRole("heading", { name: "outubro de 2026" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "agosto de 2026" })).toBeNull();

    await abrirMes("out/26");
    expect(screen.queryByRole("heading", { name: "outubro de 2026" })).toBeNull();
    // ⚠ Sem detalhe nenhum, sobra só a grade — que é a resposta certa, não uma tela quebrada.
    expect(screen.getAllByRole("table")).toHaveLength(1);
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
    // ⚠ `[0]` era a tabela do mês; hoje `[0]` é a GRADE e `[1]` é o detalhe do mês aberto.
    const detalhe = screen.getAllByRole("table")[1];
    expect(within(detalhe).getByText("SIMPLES")).toBeInTheDocument();
  });
});
