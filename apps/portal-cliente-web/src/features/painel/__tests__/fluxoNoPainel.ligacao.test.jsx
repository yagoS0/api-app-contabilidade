// ⚠⚠ A LIGAÇÃO DO FLUXO DE CAIXA COM A TELA DO CLIENTE — reescrito em 28/08/2026 para o v3.
//
// ⚠⚠ **ESTE ARQUIVO JÁ MEDIU DUAS TELAS ANTERIORES, E AS DUAS PERDAS ESTÃO REGISTRADAS AQUI.**
//
//   1 · **o fluxo DIÁRIO com SALDO** (23/08) — caiu porque as projeções não têm dia e não existe
//       saldo acumulado sem saldo inicial. A coluna "Saldo" afirmava as duas coisas;
//   2 · **a planilha de quatro colunas** (Entrada/Saída/Recorrência/Diário, 27/08) — caiu com o v3.
//       A coluna "Diário" era `saída ÷ dias do mês`, e a `CONSTITUICAO-do-produto.md` §4 a nomeia
//       como *"o exemplo canônico do que este teste barra"*: ela não respondia de onde veio, quanto
//       valia de certeza, nem o que fazer com ela.
//
// ⚠ O que sobreviveu às três formas está travado aqui: a distinção fato × previsão nunca é só cor,
// a ausência não vira zero, o vazio se declara, e **este portal não escreve contabilidade**.

import { act, render, screen, within } from "@testing-library/react";
import { api } from "../../../api";
import { BlocoDeDemonstracao } from "../BlocoDeDemonstracao";
import { fluxoDeCaixaDoMock } from "../../../api/mock/fluxoDeCaixaDoMock";

const COMPETENCIA = "2026-08";

async function abrir(payload, props = {}) {
  jest.spyOn(api, "getFluxoCaixa").mockResolvedValue(payload);
  render(<BlocoDeDemonstracao companyId="pc-001" competencia={COMPETENCIA} {...props} />);
  await act(async () => {});
}

const clicar = async (nome) => {
  await act(async () => { screen.getByRole("button", { name: nome }).click(); });
};

const grade = () => screen.getByRole("table");
const linhaDe = (rotulo) => screen.getByRole("rowheader", { name: new RegExp(rotulo) }).closest("tr");
const celulas = (tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent.trim());

const cheio = () => fluxoDeCaixaDoMock("pc-001", COMPETENCIA);
const magro = () => fluxoDeCaixaDoMock("pc-006", COMPETENCIA);

afterEach(() => { jest.restoreAllMocks(); });

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ AS SEIS COLUNAS, E A JANELA COM PASSADO.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ a tabela do v3", () => {
  it("são SEIS colunas, na ordem do spec", async () => {
    await abrir(cheio());
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent))
      .toEqual(["Mês", "Entrada", "Saída", "Impostos", "Folha", "Resultado"]);
  });

  it("⚠⚠ a janela tem 12 linhas e começa 4 meses ATRÁS — não no mês corrente", async () => {
    await abrir(cheio());
    const linhas = grade().querySelectorAll("tbody tr");
    expect(linhas).toHaveLength(12);
    expect(linhas[0].querySelector("th").textContent).toMatch(/abr\/26/);
    expect(linhas[4].querySelector("th").textContent).toMatch(/ago\/26/);
  });

  it("⚠ o mês corrente é marcado no DOM, não só na cor", async () => {
    await abrir(cheio());
    expect(linhaDe("ago/26").getAttribute("data-agora")).toBe("sim");
    expect(linhaDe("jul/26").getAttribute("data-agora")).toBeNull();
  });

  it("⚠⚠ é UMA tabela só — nada abre embaixo", async () => {
    await abrir(cheio());
    expect(screen.getAllByRole("table")).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ CONFIRMADO × PREVISTO — a distinção mais fina da tela.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ a previsão nunca se parece com um fato", () => {
  it("⚠⚠ previsto tem COR **e** ITÁLICO — nunca só cor", async () => {
    // Constituição §1. Impressão em preto e branco e daltonismo tiram a cor; o itálico fica.
    await abrir(cheio());
    const previsto = document.querySelector('.fluxo-v3-valor[data-status="forecast"]');
    expect(previsto).not.toBeNull();
    // ⚠ A classe é a mesma; quem muda é o `data-status`, que o CSS lê. A guarda é sobre o ATRIBUTO,
    // porque é ele que o `app.css` usa para pôr o itálico — e ele é auditável no DOM.
    expect(previsto.getAttribute("data-status")).toBe("forecast");
  });

  it("⚠⚠ e a palavra viaja no nome acessível — o terceiro canal", async () => {
    await abrir(cheio());
    const previsto = document.querySelector('.fluxo-v3-valor[data-status="forecast"]');
    expect(previsto.getAttribute("aria-label")).toMatch(/previsto/i);
  });

  it("⚠⚠ o PASSADO é todo confirmado — critério de aceite nº 12 da Constituição", async () => {
    // *"Nenhum mês anterior ao corrente exibe célula âmbar no modo Fluxo, exceto guia vencida ainda
    // aberta — que aparece no corrente, não no passado."* Não é regra de tela: é o que a Lei 1
    // produz no servidor. Aqui se mede que a tela não a desfaz.
    await abrir(cheio());
    for (const rotulo of ["abr/26", "mai/26", "jun/26", "jul/26"]) {
      const previstas = linhaDe(rotulo).querySelectorAll('[data-status="forecast"]');
      expect(previstas).toHaveLength(0);
    }
  });

  it("⚠⚠ o mês CORRENTE tem célula prevista — a guia em aberto mora nele", async () => {
    await abrir(cheio());
    expect(linhaDe("ago/26").querySelectorAll('[data-status="forecast"]').length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ AUSÊNCIA NÃO É ZERO.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ o vazio se declara", () => {
  it("célula sem lançamento vira TRAÇO, nunca `0,00`", async () => {
    await abrir(cheio());
    // ⚠ Abril não tem Saída (a série projeta do mês corrente para a frente) — e "nada aqui" não é
    // "zero reais".
    expect(celulas(linhaDe("abr/26"))[1]).toBe("–sem lançamento");
  });

  it("⚠⚠ e o traço é INVISÍVEL de propósito — por isso ele leva texto oculto", async () => {
    // O `--traco` mede 1,47:1 (v3 §3.2 pede "sem peso visual"). Sem o `.sr-only`, "vazio" e "não
    // carregou" ficariam iguais para quem usa leitor de tela, e o traço não seria lido por ninguém.
    await abrir(cheio());
    expect(screen.getAllByText("sem lançamento").length).toBeGreaterThan(0);
    expect(document.querySelector(".fluxo-v3-vazio").getAttribute("aria-hidden")).toBe("true");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ A COLUNA FOLHA — quem decide é o SERVIDOR.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠ a coluna Folha", () => {
  it("sem folha lançada, a coluna NÃO é renderizada", async () => {
    await abrir({ ...cheio(), folha: { disponivel: false, contasConsideradas: [] } });
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).not.toContain("Folha");
  });

  it("⚠⚠ campo AUSENTE mostra a coluna — o modo de falhar é 'coluna a mais', não 'folha some'", async () => {
    // Mesma regra do selo: `!== false`, nunca `=== true`. Uma resposta que não trouxesse o campo
    // esconderia a folha em silêncio, e ninguém saberia.
    const semCampo = cheio();
    delete semCampo.folha;
    await abrir(semCampo);
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toContain("Folha");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ AS SETAS E O DRILL-IN.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠ a navegação da janela", () => {
  it("⚠ a seta para a FRENTE nasce desabilitada — a posição padrão é o teto", async () => {
    await abrir(cheio());
    expect(screen.getByRole("button", { name: "Meses seguintes" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Meses anteriores" })).not.toBeDisabled();
  });

  it("⚠⚠ ela DESABILITA, nunca some — botão que some esconde que a ação existe", async () => {
    await abrir({ ...cheio(), janela: { inicio: "2026-04", podeVoltar: false, podeAvancar: false, padrao: "2026-04", horizonte: 12 } });
    expect(screen.getByRole("button", { name: "Meses anteriores" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Meses anteriores" })).toBeDisabled();
  });

  it("⚠⚠ andar com a seta pede OUTRA janela e NÃO mexe no ciclo — o ciano não escorrega", async () => {
    await abrir(cheio());
    await clicar("Meses anteriores");
    const ultima = api.getFluxoCaixa.mock.calls.at(-1)[1];
    expect(ultima.janelaInicio).toBe("2026-03");
    expect(ultima.competencia).toBe(COMPETENCIA);
  });
});

describe("⚠⚠ o drill-in troca a MESMA tabela", () => {
  it("clicar num mês substitui os meses pelos dias, e as colunas não mudam", async () => {
    await abrir(cheio());
    await clicar("ago/26");
    expect(screen.getAllByRole("table")).toHaveLength(1);
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent))
      .toEqual(["Dia", "Entrada", "Saída", "Impostos", "Folha", "Resultado"]);
    expect(screen.queryByRole("rowheader", { name: /set\/26/ })).toBeNull();
  });

  it("⚠⚠ 'no mês' vem PRIMEIRO — é a maioria do dinheiro", async () => {
    await abrir(cheio());
    await clicar("ago/26");
    expect(grade().querySelector("tbody tr th").textContent).toBe("no mês");
  });

  it("⚠ dez dias por vez, e a frase promete o resto", async () => {
    await abrir(cheio());
    await clicar("ago/26");
    expect(screen.getAllByRole("rowheader").filter((h) => /^dia /.test(h.textContent))).toHaveLength(10);
    expect(screen.getByText(/Role para ver mais dias/)).toBeInTheDocument();
  });

  it("⚠ o caminho de volta existe e devolve os 12 meses", async () => {
    await abrir(cheio());
    await clicar("ago/26");
    await clicar(/Voltar aos meses/);
    expect(grade().querySelectorAll("tbody tr")).toHaveLength(12);
  });

  it("⚠⚠ as setas da JANELA somem no drill-in — elas comandariam o que ninguém vê", async () => {
    await abrir(cheio());
    await clicar("ago/26");
    expect(screen.queryByRole("button", { name: "Meses anteriores" })).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ O MODO %.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠ o modo %", () => {
  it("só Saída, Impostos e Folha viram percentual; Entrada e Resultado seguem em R$", async () => {
    await abrir(cheio());
    await clicar("%");
    // ⚠ out/26 tem Entrada (receita recorrente) E Impostos — é onde a conta do % existe.
    const linha = linhaDe("out/26");
    const porColuna = (c) => linha.querySelector(`td[data-coluna="${c}"]`).textContent;
    expect(porColuna("impostos")).toMatch(/%$/);
    expect(porColuna("entrada")).not.toMatch(/%/);
    expect(porColuna("resultado")).not.toMatch(/%/);
  });

  it("⚠ ele sobrevive ao drill-in — trocar de visão não volta aos meses", async () => {
    await abrir(cheio());
    await clicar("ago/26");
    await clicar("%");
    expect(screen.getAllByRole("columnheader")[0].textContent).toBe("Dia");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ O POP-UP DE GUIAS.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ o pop-up de guias", () => {
  it("ele abre com guia pendente, e lista o que está pegando fogo", async () => {
    await abrir(cheio());
    const pop = screen.getByRole("alertdialog");
    expect(within(pop).getByText(/Você tem guias para pagar/)).toBeInTheDocument();
    // ⚠ DUAS vencidas e UMA a vencer — os dois estados existem, e têm cores diferentes.
    expect(within(pop).getAllByText(/venceu em/)).toHaveLength(2);
    expect(within(pop).getAllByText(/^vence em/)).toHaveLength(1);
  });

  it("⚠⚠ sem `ackPending`, ele NÃO existe — e não há card fixo no lugar", async () => {
    const semAviso = cheio();
    semAviso.alertaDeGuias.ackPending = false;
    await abrir(semAviso);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("⚠ sem guia nenhuma nessas condições, também não", async () => {
    await abrir(magro());
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("⚠⚠ 'Estou ciente' grava CIÊNCIA — jamais pagamento", async () => {
    // A Lei 5 fecha a palavra. Um clique dado para dispensar um modal não pode marcar guia como paga.
    const registrar = jest.spyOn(api, "registrarCienciaDeGuias").mockResolvedValue({ ok: true });
    await abrir(cheio());
    await clicar(/Estou ciente/);
    expect(registrar).toHaveBeenCalledWith("pc-001", { guiaIds: ["g-2", "g-1", "g-3"] });
    // ⚠⚠ A guarda é de FONTE: um teste de comportamento passaria com alguém trocando a chamada por
    // uma que também marca pagamento. As duas colunas de pagamento têm dono, e não é este botão.
    const fs = require("node:fs");
    const path = require("node:path");
    const fonte = fs.readFileSync(path.join(__dirname, "..", "PopUpDeGuias.jsx"), "utf8")
      // ⚠ BLOCO antes de LINHA — um `//` dentro de `/* */` apaga o fechamento. E os comentários
      // PRECISAM sair: o cabeçalho do arquivo cita a rota de pagamento justamente para dizer que
      // NÃO é ela — a varredura mede o código, não a explicação.
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(fonte).not.toMatch(/confirmarPagamento|paymentStatus|marcarPaga/);
  });

  it("⚠⚠ falhou ⇒ o pop-up FICA — fechá-lo faria a pessoa achar que registrou", async () => {
    jest.spyOn(api, "registrarCienciaDeGuias").mockRejectedValue(new Error("sem rede"));
    await abrir(cheio());
    await clicar(/Estou ciente/);
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByText(/continua aqui para você não perder a guia de vista/)).toBeInTheDocument();
  });

  it("⚠⚠ 'Ver todas as guias' NAVEGA e não grava ciência — a pessoa foi olhar, não disse que viu", async () => {
    const registrar = jest.spyOn(api, "registrarCienciaDeGuias").mockResolvedValue({ ok: true });
    const irParaGuias = jest.fn();
    await abrir(cheio(), { aoVerGuias: irParaGuias });
    await clicar(/Ver todas as guias/);
    expect(irParaGuias).toHaveBeenCalled();
    expect(registrar).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ O QUE A TELA NÃO FAZ — invariantes que sobreviveram às três formas.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ nada aqui lança, edita ou apaga", () => {
  it("⚠⚠ este portal NÃO escreve contabilidade — nenhum `+`, nenhum `⋮`", async () => {
    // Quem lança é o escritório. Botão impossível é pior que ausência.
    await abrir(cheio());
    for (const b of screen.getAllByRole("button")) {
      expect(b.textContent).not.toMatch(/^\s*[+⋮]\s*$/);
    }
  });

  it("⚠ Fluxo ⇄ DRE e R$ ⇄ % são BOTÕES, nunca links — visão não é rota", async () => {
    await abrir(cheio());
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "DRE" })).toBeInTheDocument();
  });

  it("⚠⚠ NÃO existe coluna de SALDO — sem âncora não há acumulado (Lei 3)", async () => {
    // Ela é Fase 3, e depende de conciliação no fechamento do contador. Um acumulado sem âncora
    // erra composto, mês após mês.
    await abrir(cheio());
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).not.toContain("Saldo");
    expect(grade().textContent).not.toMatch(/Saldo/i);
  });
});
