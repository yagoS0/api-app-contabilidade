// ⚠⚠ OS TRÊS CARDS DO INÍCIO — Receita · Imposto líquido · Resultado (29/08/2026).
//
// Este arquivo existe por causa de um defeito RELATADO, com a tela na frente do dono:
//
// > *"o painel principal de receita, imposto líquido e resultado tem um bug: a receita está se
// > tratando do mês seguinte e o resultado usando o mês corrente, o que gera confusão. Ele deve
// > sempre usar o mês seguinte para as duas formas."*
//
// **O que acontecia:** a receita das notas emitidas em AGOSTO entra no fluxo em SETEMBRO
// (competência + 1, dia 1 — decisão do dono na mesma rodada). O card "Receita · agosto" mostrava
// as notas de agosto; os cards "Imposto" e "Resultado · agosto" liam a linha do mês CORRENTE, cuja
// Entrada é a receita de JULHO. Três cards lado a lado, com o mesmo rótulo de mês, falando de duas
// receitas diferentes.
//
// ⚠⚠ **OS DOIS NÚMEROS ESTAVAM CERTOS CADA UM POR SI.** O que estava errado era apresentá-los como
// se fossem do mesmo mês — a mesma família do "dois seletores para um valor" que a competência
// única já consertou neste app. Por isso o conserto tem DUAS metades, e as duas estão travadas
// aqui: o VALOR passa a vir do mês seguinte, e o RÓTULO passa a dizer que mês é.
//
// ⚠⚠ **O CARD DE RECEITA NÃO MUDOU DE FONTE, e não pode mudar:** Lei 5 da
// `CONSTITUICAO-do-produto.md` — *Receita é nota emitida no mês (competência), e nunca dinheiro
// recebido*. Ele continua sendo o `summary` de `GET /invoices` da competência ESCOLHIDA. Um teste
// abaixo prende isso pelo lado contrário: o valor da receita é diferente de tudo que está no fluxo,
// então ele cairia se alguém "alinhasse" os três lendo a mesma linha.

import { act, render, screen } from "@testing-library/react";
import { api } from "../../../api";
import { PainelPage } from "../PainelPage";

const COMPETENCIA = "2026-08";
const SEGUINTE = "2026-09";

/** Uma linha do payload, na forma que o servidor manda. */
const linha = (fonte, direcao, procedencia, valor, competencia) => ({
  fonte, direcao, procedencia, competencia, dia: 1, diaDesconhecido: null, valor,
  rotulo: `${fonte} de ${competencia}`,
  base: { frase: "de teste" },
});

/**
 * ⚠ Os números dos dois meses são DELIBERADAMENTE distantes — 1.111,11 contra 20.000,00. Números
 * próximos deixariam o teste passar com o mês errado sempre que o formato coincidisse.
 */
function payload() {
  return {
    demonstracao: false,
    cicloAtual: COMPETENCIA,
    janela: { inicio: "2026-04", podeVoltar: true, podeAvancar: true, padrao: "2026-04", horizonte: 12 },
    semMes: [],
    vencidas: [],
    emAberto: [],
    meses: [
      {
        competencia: COMPETENCIA,
        linhas: [
          linha("NOTA_EMITIDA", "ENTRADA", "PREVISAO", 1111.11, COMPETENCIA),
          linha("GUIA", "SAIDA", "COMPROMISSO", 100.5, COMPETENCIA),
        ],
      },
      {
        competencia: SEGUINTE,
        linhas: [
          linha("NOTA_EMITIDA", "ENTRADA", "PREVISAO", 20000, SEGUINTE),
          linha("GUIA", "SAIDA", "COMPROMISSO", 3000, SEGUINTE),
        ],
      },
    ],
  };
}

async function abrir({ meses } = {}) {
  const p = payload();
  if (meses) p.meses = meses;
  jest.spyOn(api, "getFluxoCaixa").mockResolvedValue(p);
  jest.spyOn(api, "getInvoices").mockResolvedValue({
    // ⚠ Um valor que NÃO existe em mês nenhum do fluxo — ver o cabeçalho.
    summary: { totalAmount: 77777, totalInvoices: 4 },
    invoices: [],
  });
  jest.spyOn(api, "getAliquotas").mockResolvedValue([]);
  render(
    <PainelPage
      empresa={{ companyId: "pc-001", nome: "Empresa de teste" }}
      competencia={COMPETENCIA}
      aoTrocarCompetencia={() => {}}
      aoNavegar={() => {}}
    />,
  );
  await act(async () => {});
  return p;
}

/** O card cujo rótulo começa com `prefixo` — devolve as três partes que ele desenha. */
function card(prefixo) {
  const achado = [...document.querySelectorAll(".card")].find((c) =>
    c.querySelector(".rotulo")?.textContent.startsWith(prefixo),
  );
  if (!achado) throw new Error(`nenhum card com rótulo começando em "${prefixo}"`);
  return {
    rotulo: achado.querySelector(".rotulo").textContent,
    numero: achado.querySelector(".numero").textContent,
    apoio: achado.querySelector(".apoio")?.textContent || "",
    status: achado.querySelector(".numero").getAttribute("data-status"),
  };
}

afterEach(() => { jest.restoreAllMocks(); });

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ Imposto e Resultado leem o mês SEGUINTE — o defeito relatado", () => {
  it("o Imposto líquido mostra a guia de SETEMBRO, não a de agosto", async () => {
    await abrir();
    expect(card("Imposto líquido").numero).toMatch(/3\.000,00/);
    expect(card("Imposto líquido").numero).not.toMatch(/100,50/);
  });

  it("o Resultado é o do mês SEGUINTE (20.000 − 3.000), não o do corrente (1.111,11 − 100,50)", async () => {
    await abrir();
    expect(card("Resultado").numero).toMatch(/17\.000,00/);
    expect(card("Resultado").numero).not.toMatch(/1\.010,61/);
  });

  it("⚠⚠ e os RÓTULOS dizem qual mês é — sem isso o conserto vira uma confusão nova", async () => {
    await abrir();
    expect(card("Imposto líquido").rotulo).toBe("Imposto líquido · 09/2026");
    expect(card("Resultado").rotulo).toBe("Resultado · 09/2026");
  });

  it("⚠ o apoio do Resultado NOMEIA a ligação entre os dois meses", async () => {
    await abrir();
    // "Receita · 08/2026" ao lado de "Resultado · 09/2026" parece erro de tela sem esta frase.
    expect(card("Resultado").apoio).toMatch(/receita de 08\/2026 entra aqui/);
  });

  it("⚠ o status continua vindo da célula — previsto não vira fato ao mudar de mês", async () => {
    await abrir();
    expect(card("Resultado").status).toBe("forecast");
    expect(card("Imposto líquido").status).toBe("forecast");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ a RECEITA não mudou de fonte — Lei 5", () => {
  it("continua sendo o `summary` das notas da competência ESCOLHIDA", async () => {
    await abrir();
    expect(card("Receita").numero).toMatch(/77\.777,00/);
    expect(card("Receita").rotulo).toBe("Receita · 08/2026");
    expect(card("Receita").apoio).toMatch(/4 nota\(s\) emitida\(s\)/);
  });

  it("⚠ e ela NÃO sai do fluxo: o valor da receita não existe em mês nenhum do payload", async () => {
    const p = await abrir();
    const valores = p.meses.flatMap((m) => m.linhas.map((l) => l.valor));
    expect(valores).not.toContain(77777);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ o mês seguinte AUSENTE vira traço, nunca zero", () => {
  it("sem a linha de setembro no payload, Imposto e Resultado saem em traço", async () => {
    // ⚠ Este é o caso do fim do horizonte, e ele é real: a janela tem 12 meses e o cliente pode
    // estar olhando o último. Zero ali AFIRMARIA que o mês que vem não tem imposto nem resultado —
    // a mesma distinção que `celula()` guarda em `tabelaDoFluxo.js` (`null` ≠ `{valor: 0}`).
    await abrir({ meses: [payload().meses[0]] });
    expect(card("Imposto líquido").numero).toBe("—");
    expect(card("Resultado").numero).toBe("—");
    // ⚠ E a receita, que não depende do fluxo, continua lá.
    expect(card("Receita").numero).toMatch(/77\.777,00/);
  });

  it("⚠ o rótulo continua nomeando o mês que ele NÃO tem — o traço é do mês, não da tela", async () => {
    await abrir({ meses: [payload().meses[0]] });
    expect(card("Resultado").rotulo).toBe("Resultado · 09/2026");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠ a virada do ano", () => {
  it("dezembro aponta para janeiro do ano seguinte", async () => {
    jest.spyOn(api, "getFluxoCaixa").mockResolvedValue({
      demonstracao: false, cicloAtual: "2026-12", janela: {}, semMes: [], vencidas: [], emAberto: [],
      meses: [{ competencia: "2027-01", linhas: [linha("GUIA", "SAIDA", "COMPROMISSO", 4242, "2027-01")] }],
    });
    jest.spyOn(api, "getInvoices").mockResolvedValue({ summary: { totalAmount: 1, totalInvoices: 1 }, invoices: [] });
    jest.spyOn(api, "getAliquotas").mockResolvedValue([]);
    render(
      <PainelPage
        empresa={{ companyId: "pc-001", nome: "Empresa de teste" }}
        competencia="2026-12"
        aoTrocarCompetencia={() => {}}
        aoNavegar={() => {}}
      />,
    );
    await act(async () => {});
    expect(card("Imposto líquido").rotulo).toBe("Imposto líquido · 01/2027");
    expect(card("Imposto líquido").numero).toMatch(/4\.242,00/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ A varredura: a fonte do card não pode voltar a ser a competência escolhida.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠ a leitura mora numa função só", () => {
  it("`somarCompetencia` é IMPORTADA da lib, nunca redeclarada na página", async () => {
    const fs = require("fs");
    const path = require("path");
    const fonte = fs.readFileSync(
      path.join(__dirname, "..", "PainelPage.jsx"), "utf8",
    );
    // ⚠ Ela nasceu como cópia local dentro de `BlocoDeDemonstracao.jsx`, e uma segunda cópia aqui
    // faria a página e o bloco discordarem sobre qual é "o mês seguinte" — em dezembro, primeiro.
    expect(fonte).toMatch(/import \{[^}]*somarCompetencia[^}]*\} from "\.\/lib\/leituraDoFluxo"/);
    expect(fonte).not.toMatch(/function somarCompetencia/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ ACHADO NO NAVEGADOR, no mock, DEPOIS de os testes acima ficarem verdes.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe('⚠⚠ o apoio do Imposto não diz "esta competência"', () => {
  // A tela mostrava *"Imposto líquido · 09/2026"* com *"nenhuma guia paga nesta competência ainda"*,
  // e a guia de que a frase fala é a de AGOSTO — a alíquota é da competência ESCOLHIDA. Sob um
  // rótulo que passou a nomear outro mês, "esta" virou ambíguo. A frase é parte do comportamento.
  it("ele NOMEIA o mês da alíquota, que é o escolhido — não o do rótulo", async () => {
    await abrir();
    const apoio = card("Imposto líquido").apoio;
    expect(apoio).toMatch(/08\/2026/);
    expect(apoio).not.toMatch(/esta competência/);
  });

  it("⚠ e o rótulo continua sendo o do mês da ENTRADA — os dois meses convivem, nomeados", async () => {
    await abrir();
    expect(card("Imposto líquido").rotulo).toBe("Imposto líquido · 09/2026");
  });
});
