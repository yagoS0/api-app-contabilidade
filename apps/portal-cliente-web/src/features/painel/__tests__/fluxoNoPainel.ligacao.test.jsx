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
  // ⚠⚠ EM 27/08/2026 A GRADE PASSOU A DIZER `fato` × `previsão` PELA COR (decisão do dono: *"verde é
  // o que sabemos, amarelo é previsto, no caso da saída é vermelho e laranja"*), e com isso a palavra
  // quase sumiu dela — ela ficaria só no detalhe do mês aberto, e só para as linhas daquele mês.
  // ⚠ A lei não afrouxou: entrou uma legenda de UMA LINHA que decodifica as quatro tintas. É ela que
  // este caso mede agora, além das palavras do detalhe.
  test("⚠⚠ a palavra 'Previsto' está no TEXTO — não só na cor", async () => {
    await abrir(cheio());
    // A legenda da grade: sem ela, quem imprime em preto e branco não distingue nada. Ela nomeia o
    // DESENHO (sólido × contorno), porque a cor passou a marcar a categoria.
    expect(screen.getByText("preenchido")).toBeInTheDocument();
    expect(screen.getByText("contorno")).toBeInTheDocument();
    // E o detalhe do mês continua dizendo a procedência por extenso, linha a linha.
    await abrirMes("set/26");
    expect(screen.getAllByText("Previsto").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Já existe").length).toBeGreaterThan(0);
  });

  // ⚠ O chip do DETALHE não mudou de lei: a reversão de 27/08 vale para a CÉLULA da grade, onde a
  // pergunta é *"para que lado o dinheiro vai?"*, não para o chip, onde a pergunta é *"isto já
  // aconteceu?"*. Por isso este caso continua exigindo que a previsão não use a classe do concluído.
  test("⚠⚠ nenhuma linha prevista é pintada com a classe do CONCLUÍDO", async () => {
    await abrir(cheio());
    await abrirMes("set/26");
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
  // ⚠⚠ ESTES DOIS CASOS MEDIAM A PRESENÇA E AGORA MEDEM A AUSÊNCIA — decisão do dono em 27/08/2026,
  // em duas etapas (*"tire esses avisos da página"* → *"pode excluir isso também"*), e contra a minha
  // ressalva, que fica registrada aqui e no componente: o critério escrito deste app manda ficar o
  // texto que avisa de consequência fiscal, e *"2 guias venceram, somando R$ 18.638,39"* é isso.
  //
  // ⚠ O que impede este caso de ser a prova de um dado perdido: **o fato continua chegando ao cliente
  // por dois caminhos que já existiam** — o card "A vencer" do Painel (mesma tela, acima) e a aba
  // Guias. E a REGRA não foi tocada: `ressalvasDoFluxo` continua produzindo as duas, e o portal do
  // contador continua mostrando-as.
  test("⚠⚠ a guia VENCIDA não aparece neste portal — decisão do dono", async () => {
    await abrir(cheio());
    expect(screen.queryByText(/Guias já vencidas/)).toBeNull();
    expect(screen.queryByText(/18\.638,39/)).toBeNull();
  });

  test("⚠⚠ a guia sem vencimento também não", async () => {
    await abrir(cheio());
    expect(screen.queryByText(/Sem mês — SIMPLES/)).toBeNull();
    expect(screen.queryByText(/Recapture a guia/)).toBeNull();
  });

  // ⚠⚠ E O CORTE É NOMINAL, NÃO POR TOM — a primeira versão filtrava `tom !== "aviso"` e levava junto
  // *"Repetições não lidas"*, que o dono não pediu para tirar. Foi ESTE arquivo que pegou (o caso da
  // empresa sem apuração, logo abaixo, ficou vermelho na hora). Um aviso NOVO tem de aparecer.
  test("⚠⚠ um aviso que ele NÃO pediu para tirar continua na tela", async () => {
    await abrir(magro());
    expect(screen.getByText(/Repetições não lidas/)).toBeInTheDocument();
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
// ⚠⚠ A PLANILHA — MESES NAS LINHAS, CATEGORIAS NAS COLUNAS (27/08/2026).
//
// Ela nasceu transposta (12 meses em COLUNAS) e foi virada no mesmo dia, por pedido do dono:
// *"colocando entrada, saída, recorrência, diário, todos no MESMO PESO, e em linha não em coluna; a
// diferença deles será a cor de suas COLUNAS"*.
//
// ⚠ O ganho é medível: com 12 colunas a grade exigia 1.132px de largura mínima e ROLAVA no celular;
// com cinco ela cabe. E o custo do caminho anterior está registrado no CSS — `width: 100%` com cinco
// colunas dava 226px por coluna, que foi o que o dono chamou de *"colunas muito largas"*.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ a planilha: meses nas linhas, quatro categorias nas colunas", () => {
  test("⚠⚠ é UMA tabela — as categorias sao as colunas, os meses as linhas", async () => {
    await abrir(cheio());
    // ⚠ A segunda tabela é o DETALHE do mês aberto; é por existirem só duas que a queixa se desfaz.
    expect(screen.getAllByRole("table")).toHaveLength(2);
    const grade = screen.getAllByRole("table")[0];
    expect(within(grade).getAllByRole("columnheader").map((t) => t.textContent.trim()))
      .toEqual(["Entrada", "Saída", "Recorrência", "Diário"]);
    // Doze meses, um por linha.
    expect(within(grade).getAllByRole("rowheader")).toHaveLength(12);
  });

  test("⚠⚠ as quatro colunas têm o MESMO PESO — nenhuma é filha de outra", async () => {
    // Elas já foram desenhadas como decomposição da saída, com recuo. O dono desfez: *"todos no
    // mesmo peso"*. `Diário` continua SENDO derivada (`(Saída − Recorrência) ÷ dias`), e isso agora
    // é dito no `title` da coluna, não no desenho.
    await abrir(cheio());
    expect(document.querySelectorAll('[data-filha="sim"]')).toHaveLength(0);
  });

  test("⚠⚠ a cor é da COLUNA, e está no DOM — não vive só no CSS", async () => {
    // Auditável como `data-status` e `data-procedencia` já são: dá para provar qual célula afirma o
    // quê sem depender de enxergar a cor.
    await abrir(cheio());
    const grade = screen.getAllByRole("table")[0];
    const colunas = new Set([...grade.querySelectorAll("[data-coluna]")].map((e) => e.dataset.coluna));
    expect([...colunas].sort()).toEqual(["diario", "entrada", "recorrencia", "saida"]);
  });

  test("⚠⚠ sólido × contorno separa o que JÁ EXISTE do que é PREVISTO", async () => {
    // ⚠ Com a cor ocupada pela categoria, é o preenchimento que carrega a certeza — e ele é a metade
    // que sobrevive à impressão em preto e branco e ao daltonismo.
    await abrir(cheio());
    const grade = screen.getAllByRole("table")[0];
    const marcas = new Set([...grade.querySelectorAll(".planilha-valor")]
      .map((e) => e.dataset.procedenciaCelula));
    expect(marcas.has("fato")).toBe(true);
    expect(marcas.has("previsao")).toBe(true);
  });

  test("⚠⚠ ZERO sai como TRAÇO, nunca `R$ 0,00`", async () => {
    await abrir(cheio());
    const grade = screen.getAllByRole("table")[0];
    expect(within(grade).queryByText("R$ 0,00")).toBeNull();
    expect(within(grade).getAllByText("—").length).toBeGreaterThan(0);
  });

  test("⚠⚠ e NÃO há linha nem coluna de TOTAL — a ausência é o contrato", async () => {
    await abrir(cheio());
    const grade = screen.getAllByRole("table")[0];
    // `fato` e `previsão` nunca viram um número só; um "No mês" recriaria exatamente esse número.
    expect(grade.textContent).not.toMatch(/No m[êe]s|Total|Saldo/i);
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
