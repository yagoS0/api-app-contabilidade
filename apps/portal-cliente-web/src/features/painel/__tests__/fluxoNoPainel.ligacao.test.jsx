// ⚠⚠ A LIGAÇÃO DO FLUXO DE CAIXA COM A TELA DO CLIENTE — reescrito em 29/08/2026 para o v4.
//
// ⚠⚠ **ESTE ARQUIVO JÁ MEDIU TRÊS TELAS ANTERIORES, E AS TRÊS PERDAS ESTÃO REGISTRADAS AQUI.**
//
//   1 · **o fluxo DIÁRIO com SALDO** (23/08) — caiu porque as projeções não têm dia e não existe
//       saldo acumulado sem saldo inicial. A coluna "Saldo" afirmava as duas coisas;
//   2 · **a planilha de quatro colunas** (Entrada/Saída/Recorrência/Diário, 27/08) — caiu com o v3.
//       A coluna "Diário" era `saída ÷ dias do mês`, e a `CONSTITUICAO-do-produto.md` §4 a nomeia
//       como *"o exemplo canônico do que este teste barra"*;
//   3 · **a tabela de 12 MESES com drill-in de dias** (28/08, o v3) — caiu por decisão de produto,
//       não por defeito: *"ao invés de mostrar o mês ele vai mostrar os dias mesmo"*. Ela tinha
//       12 linhas, as setas sumiam dentro do mergulho e os dias entravam de 10 em 10.
//
// **Hoje (v4):** dois meses LADO A LADO, cada um dia a dia; setas que andam MÊS A MÊS; e o botão
// **Horizonte**, que troca a grade pela tabela de meses TRANSPOSTA — categoria em linha, mês em
// coluna, com o nome do mês embaixo.
//
// ⚠ O que sobreviveu às quatro formas está travado aqui: a distinção fato × previsão nunca é só
// cor, a ausência não vira zero, o vazio se declara, não há saldo acumulado, e **este portal não
// escreve contabilidade**.

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

/**
 * ⚠⚠ OS CABEÇALHOS **DO FLUXO**, e não os da página inteira (30/08/2026).
 *
 * A tabela de GUIAS EM ATRASO passou a ser desenhada ACIMA do fluxo, e ela também tem
 * `columnheader` ("Guia", "Quando", "Valor"). `screen.getAllByRole("columnheader")[0]` passou a
 * devolver "Guia" — e os testes caíram dizendo que a tela nasce em MESES, o que é falso: eles
 * estavam lendo outra tabela.
 *
 * ⚠ O recorte é pelo BLOCO do fluxo, nunca por índice: contar posições faria o próximo bloco
 * acrescentado acima quebrar tudo de novo, e pelo mesmo motivo invisível.
 */
/**
 * ⚠ O ESCOPO DO HORIZONTE, pelo mesmo motivo: a tabela de guias em atraso também tem `tbody tr th`
 * e `tfoot`. Sem o recorte, "Entrada, Saída, Impostos…" vinha precedido de "INSS · 2026-06".
 */
const horizonte = () => document.querySelector(".table--fluxo-v4-horizonte");

const cabecalhosDoFluxo = () => {
  const escopo = document.querySelector(".fluxo-v4-bloco, .table--fluxo-v4-horizonte");
  return [...(escopo?.querySelectorAll("th[scope='col']") || [])].map((h) => h.textContent);
};

/** Os dois blocos da visão de dias, na ordem em que a tela os desenha. */
const blocos = () => [...document.querySelectorAll(".fluxo-v4-bloco")];
const blocoDe = (competencia) => document.querySelector(`.fluxo-v4-bloco[data-mes="${competencia}"]`);
const linhaDe = (rotulo, escopo = document) =>
  [...escopo.querySelectorAll("tbody tr")]
    .find((tr) => new RegExp(rotulo).test(tr.querySelector("th")?.textContent || "")) || null;
const celulas = (tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent.trim());

const irAoHorizonte = () => clicar("Horizonte");

const cheio = () => fluxoDeCaixaDoMock("pc-001", COMPETENCIA);
const magro = () => fluxoDeCaixaDoMock("pc-006", COMPETENCIA);

afterEach(() => { jest.restoreAllMocks(); });

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ DOIS MESES LADO A LADO, EM DIAS — o estado inicial do v4.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ a visão de dias é o estado INICIAL", () => {
  it("⚠⚠ nasce em DIAS, não em meses — isto inverte o v3", async () => {
    await abrir(cheio());
    expect(cabecalhosDoFluxo()[0]).toBe("Dia");
  });

  it("são DOIS blocos: o mês corrente e o seguinte", async () => {
    await abrir(cheio());
    const b = blocos();
    expect(b).toHaveLength(2);
    expect(b.map((x) => x.getAttribute("data-mes"))).toEqual(["2026-08", "2026-09"]);
  });

  it("⚠ cada bloco nomeia o mês dele, e o corrente é marcado no DOM — não só na cor", async () => {
    await abrir(cheio());
    expect(within(blocoDe("2026-08")).getByRole("heading", { level: 3 }).textContent).toMatch(/agosto/i);
    expect(blocoDe("2026-08").querySelector(".fluxo-v4-mes").getAttribute("data-agora")).toBe("sim");
    expect(blocoDe("2026-09").querySelector(".fluxo-v4-mes").getAttribute("data-agora")).toBeNull();
  });

  it("são SEIS colunas em CADA bloco, na mesma ordem", async () => {
    await abrir(cheio());
    for (const b of blocos()) {
      expect([...b.querySelectorAll("thead th")].map((h) => h.textContent))
        .toEqual(["Dia", "Entrada", "Saída", "Impostos", "Folha", "Resultado"]);
    }
  });

  it("⚠⚠ o MÊS INTEIRO é desenhado — a paginação de 10 dias saiu", async () => {
    // O v3 mostrava 10 por vez e anexava +10 na rolagem. O dono descreveu "30 dias à esquerda e 30
    // à direita": mostrar 10 e exigir rolagem para ver o dia 12 contraria o pedido. Quem cede é a
    // rolagem interna do bloco, não a quantidade de dias.
    await abrir(cheio());
    const dias = [...blocoDe("2026-08").querySelectorAll("tbody tr th")]
      .filter((h) => /^dia /.test(h.textContent));
    expect(dias).toHaveLength(31);
    expect(screen.queryByText(/Role para ver mais dias/)).toBeNull();
  });

  it("⚠⚠ 'no mês' vem PRIMEIRO em cada bloco — é a maioria do dinheiro", async () => {
    // As projeções sem dia (recorrência, imposto previsto, folha) vivem ali. Espalhá-las pelos dias
    // inventaria precisão que ninguém informou.
    await abrir(cheio());
    expect(blocoDe("2026-08").querySelector("tbody tr th").textContent).toBe("no mês");
  });

  it("⚠⚠ a entrada da nota cai no DIA 1 — decisão do dono, e é o que o servidor manda", async () => {
    await abrir(cheio());
    const dia1 = linhaDe("^dia 01", blocoDe("2026-08"));
    expect(dia1).not.toBeNull();
    expect(celulas(dia1)[0]).not.toBe("–sem lançamento");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ AS SETAS ANDAM MÊS A MÊS.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ as setas andam MÊS A MÊS na visão de dias", () => {
  it("o rótulo acessível diz o tamanho do passo", async () => {
    await abrir(cheio());
    expect(screen.getByRole("button", { name: "Mês anterior" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mês seguinte" })).toBeInTheDocument();
  });

  it("⚠⚠ o passo DENTRO da janela não vai ao servidor — os 12 meses já vieram", async () => {
    await abrir(cheio());
    const antes = api.getFluxoCaixa.mock.calls.length;
    await clicar("Mês anterior");
    expect(api.getFluxoCaixa.mock.calls.length).toBe(antes);
    expect(blocos().map((b) => b.getAttribute("data-mes"))).toEqual(["2026-07", "2026-08"]);
  });

  it("⚠⚠ na BORDA da janela ele pede outra — e NÃO mexe no ciclo, o ciano não escorrega", async () => {
    await abrir(cheio());
    // ⚠ A janela padrão do mock começa em 2026-04 e a esquerda em 2026-08: QUATRO passos chegam à
    // borda e o QUINTO é o que precisa de janela nova. Os quatro primeiros são de graça — é
    // exatamente essa diferença que `precisaDeConsultaParaVoltar` existe para medir.
    for (let i = 0; i < 5; i += 1) await clicar("Mês anterior");
    const ultima = api.getFluxoCaixa.mock.calls.at(-1)[1];
    expect(ultima.competencia).toBe(COMPETENCIA);
    expect(ultima.janelaInicio).toBeTruthy();
  });

  it("⚠⚠ ela DESABILITA no limite, nunca some — botão que some esconde que a ação existe", async () => {
    const travado = {
      ...cheio(),
      meses: cheio().meses.slice(4, 6),
      janela: { inicio: "2026-08", podeVoltar: false, podeAvancar: false, padrao: "2026-08", horizonte: 12 },
    };
    await abrir(travado);
    expect(screen.getByRole("button", { name: "Mês anterior" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mês anterior" })).toBeDisabled();
  });

  it("⚠⚠ o mês que a janela não cobre volta NOMEADO — nunca como bloco de 30 traços", async () => {
    // Um bloco todo em traço afirmaria "este mês não tem nada". O certo é "este mês não veio nesta
    // consulta", e a tela diz isso.
    const parcial = { ...cheio(), meses: cheio().meses.slice(4, 5) };
    await abrir(parcial);
    expect(blocoDe("2026-09").getAttribute("data-ausente")).toBe("sim");
    expect(blocoDe("2026-09").textContent).toMatch(/não veio nesta consulta/i);
    expect(blocoDe("2026-09").textContent).toMatch(/não quer dizer que o mês esteja sem lançamento/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ O HORIZONTE — a grade transposta.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ o Horizonte transpõe a grade", () => {
  it("categoria vira LINHA e mês vira COLUNA", async () => {
    await abrir(cheio());
    await irAoHorizonte();
    const linhas = [...horizonte().querySelectorAll("tbody tr th")].map((h) => h.textContent);
    expect(linhas).toEqual(["Entrada", "Saída", "Impostos", "Folha", "Resultado"]);
  });

  it("⚠⚠ o nome do mês fica EMBAIXO, e é `<th scope=\"col\">` num `<tfoot>` — nunca um `<td>`", async () => {
    // Uma tabela transposta continua sendo tabela para quem usa leitor de tela. Sem o `scope`, cada
    // número perde o nome da coluna a que pertence.
    await abrir(cheio());
    await irAoHorizonte();
    const pes = [...document.querySelectorAll("tfoot th")];
    expect(pes.length).toBeGreaterThan(1);
    expect(document.querySelectorAll("tfoot td")).toHaveLength(0);
    for (const th of pes.slice(1)) expect(th.getAttribute("scope")).toBe("col");
  });

  it("⚠⚠ NÃO há cabeçalho de cima — o nome do mês não pode aparecer DUAS vezes", async () => {
    // A primeira versão tinha um <thead> com "Categoria" visível e os meses em .sr-only: no
    // navegador ele virava uma faixa cinza com uma palavra e onze células vazias, e dava DOIS
    // cabeçalhos de coluna para o mesmo mês — que o leitor de tela lê duas vezes.
    await abrir(cheio());
    await irAoHorizonte();
    // ⚠ A proibição é sobre a tabela DO HORIZONTE: a de guias em atraso tem `thead` e ele é
    // legítimo — ela não é transposta, e o nome da coluna dela só existe em cima.
    expect(horizonte().querySelectorAll("thead")).toHaveLength(0);
    // ⚠ E a tabela continua íntegra: caption + th de linha + th de coluna no rodapé.
    expect(horizonte().querySelector("caption")).not.toBeNull();
    expect(horizonte().querySelectorAll("tbody tr th[scope=\"row\"]").length).toBe(5);
  });

  it("⚠ o mês corrente é marcado no rodapé", async () => {
    await abrir(cheio());
    await irAoHorizonte();
    const marcado = [...document.querySelectorAll('tfoot th[data-agora="sim"]')];
    expect(marcado).toHaveLength(1);
    expect(marcado[0].textContent).toMatch(/ago/i);
  });

  it("⚠⚠ clicar na coluna volta para os DIAS daquele mês — a ida e a volta são o mesmo caminho", async () => {
    await abrir(cheio());
    await irAoHorizonte();
    await clicar("out/26");
    expect(blocos().map((b) => b.getAttribute("data-mes"))).toEqual(["2026-10", "2026-11"]);
    expect(cabecalhosDoFluxo()[0]).toBe("Dia");
  });

  it("⚠ é um ALTERNADOR, e ele diz o estado em vez de trocar de rótulo", async () => {
    await abrir(cheio());
    expect(screen.getByRole("button", { name: "Horizonte" }).getAttribute("aria-pressed")).toBe("false");
    await irAoHorizonte();
    expect(screen.getByRole("button", { name: "Horizonte" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("⚠ no horizonte as setas andam a JANELA — o que está na tela é ela", async () => {
    await abrir(cheio());
    await irAoHorizonte();
    expect(screen.getByRole("button", { name: "Meses anteriores" })).toBeInTheDocument();
    await clicar("Meses anteriores");
    expect(api.getFluxoCaixa.mock.calls.at(-1)[1].janelaInicio).toBe("2026-03");
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
    /**
     * ⚠⚠ O RÓTULO MUDOU DE ELEMENTO EM 30/08/2026, e a guarda continua a mesma.
     *
     * A célula virou CLICÁVEL (a gaveta do dia), e o valor passou a viver dentro de um `<button>`.
     * O `aria-label` foi para o botão, de propósito: ele é quem tem papel de ação, e deixá-lo
     * também no `<span>` faria o leitor de tela anunciar o número DUAS vezes.
     *
     * ⚠ O que este teste protege não é o elemento — é a PALAVRA chegar a quem não vê a tela. Por
     * isso ele pergunta pelo nome acessível de quem carrega o valor, seja o botão ou o span.
     */
    await abrir(cheio());
    const previsto = document.querySelector('.fluxo-v3-valor[data-status="forecast"]');
    expect(previsto).not.toBeNull();
    const quemRotula = previsto.closest("button") || previsto;
    expect(quemRotula.getAttribute("aria-label")).toMatch(/previsto/i);
    // ⚠ E o número não é anunciado duas vezes: com o botão rotulando, o span fica sem rótulo.
    if (quemRotula !== previsto) expect(previsto.getAttribute("aria-label")).toBeNull();
  });

  it("⚠⚠ o PASSADO é todo confirmado — critério de aceite nº 12 da Constituição", async () => {
    // *"Nenhum mês anterior ao corrente exibe célula âmbar no modo Fluxo, exceto guia vencida ainda
    // aberta — que aparece no corrente, não no passado."* Não é regra de tela: é o que a Lei 1
    // produz no servidor. Aqui se mede que a tela não a desfaz.
    // ⚠ No v4 a leitura é pelo HORIZONTE, onde os meses passados são COLUNAS.
    await abrir(cheio());
    await irAoHorizonte();
    for (const rotulo of ["abr", "mai", "jun", "jul"]) {
      const i = [...horizonte().querySelectorAll("tfoot th")].findIndex((th) => th.textContent.includes(rotulo));
      expect(i).toBeGreaterThan(0);
      for (const tr of horizonte().querySelectorAll("tbody tr")) {
        const td = tr.querySelectorAll("td")[i - 1];
        expect(td?.querySelector('[data-status="forecast"]')).toBeNull();
      }
    }
  });

  it("⚠⚠ o mês CORRENTE tem célula prevista — a guia em aberto mora nele", async () => {
    await abrir(cheio());
    expect(blocoDe("2026-08").querySelectorAll('[data-status="forecast"]').length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ AUSÊNCIA NÃO É ZERO.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ o vazio se declara", () => {
  it("célula sem lançamento vira TRAÇO, nunca `0,00`", async () => {
    await abrir(cheio());
    // ⚠ Um dia sem nada — e "nada aqui" não é "zero reais".
    const vazio = linhaDe("^dia 07", blocoDe("2026-08"));
    expect(celulas(vazio)[0]).toBe("–sem lançamento");
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
    expect(cabecalhosDoFluxo()).not.toContain("Folha");
  });

  it("⚠⚠ campo AUSENTE mostra a coluna — o modo de falhar é 'coluna a mais', não 'folha some'", async () => {
    // Mesma regra do selo: `!== false`, nunca `=== true`. Uma resposta que não trouxesse o campo
    // esconderia a folha em silêncio, e ninguém saberia.
    const semCampo = cheio();
    delete semCampo.folha;
    await abrir(semCampo);
    expect(cabecalhosDoFluxo()).toContain("Folha");
  });

  it("⚠ e a decisão vale nos DOIS modos — o horizonte perde a LINHA da folha", async () => {
    await abrir({ ...cheio(), folha: { disponivel: false, contasConsideradas: [] } });
    await irAoHorizonte();
    expect([...horizonte().querySelectorAll("tbody tr th")].map((h) => h.textContent))
      .toEqual(["Entrada", "Saída", "Impostos", "Resultado"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ O MODO %.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠ o modo %", () => {
  it("só Saída, Impostos e Folha viram percentual; Entrada e Resultado seguem em R$", async () => {
    await abrir(cheio());
    await irAoHorizonte();
    await clicar("%");
    const porCategoria = (c) =>
      document.querySelector(`tbody tr[data-categoria="${c}"] td`).textContent;
    expect(porCategoria("impostos")).toMatch(/%|–/);
    expect(porCategoria("entrada")).not.toMatch(/%/);
    expect(porCategoria("resultado")).not.toMatch(/%/);
  });

  it("⚠ ele sobrevive à troca de modo — o % continua ligado ao voltar para os dias", async () => {
    await abrir(cheio());
    await clicar("%");
    await irAoHorizonte();
    expect(screen.getByRole("button", { name: "%" }).getAttribute("aria-pressed")).toBe("true");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ O POP-UP DE GUIAS.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ o pop-up de guias", () => {
  it("ele abre com guia pendente, e lista o que está pegando fogo", async () => {
    await abrir(cheio());
    const dialogo = screen.getByRole("alertdialog");
    expect(within(dialogo).getByText(/INSS/)).toBeInTheDocument();
    // ⚠ SÃO DUAS vencidas no mock, e o plural é o ponto: o pop-up lista TODAS, não a pior.
    expect(within(dialogo).getAllByText(/venceu em/).length).toBeGreaterThan(1);
  });

  it("⚠⚠ sem `ackPending`, ele NÃO existe — e não há card fixo no lugar", async () => {
    const p = cheio();
    await abrir({ ...p, alertaDeGuias: { ...p.alertaDeGuias, ackPending: false } });
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("⚠ sem guia nenhuma nessas condições, também não", async () => {
    await abrir(magro());
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("⚠⚠ 'Estou ciente' grava CIÊNCIA — jamais pagamento", async () => {
    // Lei 5: *"Ciência nunca significa pagamento."* Um clique dado para dispensar um modal não pode
    // tirar do contador a cobrança nem do cliente a dívida.
    const registrar = jest.spyOn(api, "registrarCienciaDeGuias").mockResolvedValue({ ok: true });
    await abrir(cheio());
    await act(async () => {
      within(screen.getByRole("alertdialog")).getByRole("button", { name: /Estou ciente/ }).click();
    });
    expect(registrar).toHaveBeenCalled();
    const [, corpo] = registrar.mock.calls[0];
    expect(JSON.stringify(corpo)).not.toMatch(/pag|paid|confirmou/i);
  });

  it("⚠⚠ falhou ⇒ o pop-up FICA — fechá-lo faria a pessoa achar que registrou", async () => {
    jest.spyOn(api, "registrarCienciaDeGuias").mockRejectedValue(new Error("sem tabela"));
    await abrir(cheio());
    await act(async () => {
      within(screen.getByRole("alertdialog")).getByRole("button", { name: /Estou ciente/ }).click();
    });
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("⚠⚠ 'Ver todas as guias' NAVEGA e não grava ciência — a pessoa foi olhar, não disse que viu", async () => {
    const registrar = jest.spyOn(api, "registrarCienciaDeGuias").mockResolvedValue({ ok: true });
    const aoVerGuias = jest.fn();
    await abrir(cheio(), { aoVerGuias });
    await act(async () => {
      within(screen.getByRole("alertdialog")).getByRole("button", { name: /Ver todas as guias/ }).click();
    });
    expect(aoVerGuias).toHaveBeenCalled();
    expect(registrar).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ O QUE ESTA TELA NÃO FAZ.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ nada aqui lança, edita ou apaga", () => {
  it("⚠⚠ este portal NÃO escreve contabilidade — nenhum `+`, nenhum `⋮`", async () => {
    // Quem lança é o escritório. Botão impossível é pior que ausência.
    // ⚠ O "+ Saída" da Fase 4 NÃO fura esta regra e a guarda continua exata: ele cria uma linha de
    // PLANEJAMENTO que vai para a fila de conferência do contador — nunca um lançamento contábil,
    // que exigiria afirmar que o dinheiro saiu. O que se proíbe aqui é o botão MUDO (`+`/`⋮`), o
    // vocabulário de quem edita a contabilidade dentro da grade.
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
    expect(cabecalhosDoFluxo()).not.toContain("Saldo");
    expect(document.body.textContent).not.toMatch(/Saldo/i);
  });

  it("⚠⚠ e NÃO existe linha nem coluna de TOTAL, nos dois modos", async () => {
    // Um total somaria fato com previsão — exatamente o número único que a API se recusa a entregar.
    await abrir(cheio());
    expect(document.body.textContent).not.toMatch(/\bTotal\b/);
    await irAoHorizonte();
    expect(document.body.textContent).not.toMatch(/\bTotal\b/);
  });
});
