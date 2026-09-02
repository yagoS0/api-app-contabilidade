// ⚠⚠ A COMPETÊNCIA É UMA SÓ, E ELA ATRAVESSA AS ABAS.
//
// O defeito: `HomePage` e `NotasPage` tinham, cada uma, o seu `useState(competenciaPadrao)`.
// Trocar o mês no Início e ir para Notas voltava ao padrão, sem nada dizendo que voltou — e o
// cliente lia dois meses diferentes em duas abas do mesmo portal, sobre a MESMA empresa.
//
// É o mesmo defeito que o portal do escritório já pagou e consertou ("o mesmo defeito repetido
// cinco vezes: dois seletores para um valor", em `renderCompanyDetailHeader.jsx`).
//
// ⚠ POR QUE UM TESTE DE LIGAÇÃO, E NÃO DE REGRA: não há regra nenhuma aqui. As duas telas sempre
// souberam ler uma competência; o que faltava era ALGUÉM PASSAR A MESMA. Um teste de unidade de
// qualquer uma das duas continuaria verde com o defeito de pé — que é exatamente o que o
// `CLAUDE.md` deste app diz sobre o caso da descrição ("a regra estava certa e passava; a tela
// mostrava vazio").

import { StrictMode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { api } from "../../../api";
import { AppShell } from "../AppShell";
import { competenciaPadrao, competenciasRecentes } from "../../../lib/format";

const CNPJ = "11222333000181";

function empresa() {
  return {
    companyId: "pc-001",
    razao: "ACME SERVICOS LTDA",
    cnpj: CNPJ,
    myRole: "OWNER",
    emissaoNfseLiberada: true,
    legacyCompany: { regimeTributario: "SIMPLES_NACIONAL" },
  };
}

beforeEach(() => {
  window.localStorage.clear();
  window.location.hash = "";
  jest.spyOn(api, "getCompanies").mockResolvedValue([empresa()]);
  jest.spyOn(api, "getInvoices").mockResolvedValue({
    data: [],
    page: 1,
    limit: 25,
    total: 0,
    summary: { totalInvoices: 0, totalAmount: 0, pageAmount: 0 },
  });
  jest.spyOn(api, "getAliquotas").mockResolvedValue([]);
  jest.spyOn(api, "getFluxo").mockResolvedValue({ data: [], total: 0 });
});

afterEach(() => {
  window.location.hash = "";
  jest.restoreAllMocks();
});

async function abrirApp() {
  render(
    <StrictMode>
      <AppShell user={{ defaultClientId: "pc-001" }} />
    </StrictMode>
  );
  await act(async () => {});
}

async function irPara(aba) {
  // ⚠ `link`, não `button`: as abas são `<a href="#/…">` desde 20/08/2026. O clique NORMAL
  // continua SPA (`preventDefault` + `irPara` na casca) — é por isso que ele funciona aqui, onde
  // o jsdom não executa a navegação padrão de uma âncora.
  fireEvent.click(screen.getByRole("link", { name: aba }));
  // ⚠ O flush precisa passar por uma TAREFA, não só por microtarefas: o `useRota` escuta
  // `hashchange`, e o jsdom entrega esse evento numa tarefa. Com `await act(async () => {})` puro,
  // a rota trocava DEPOIS da asserção e a tela medida ainda era a anterior.
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

/**
 * O mês alvo da troca: um que os dois seletores oferecem e que NÃO é o padrão.
 *
 * ⚠ Sai da MESMA fonte que popula os dois `<select>` (`competenciasRecentes`), não do DOM: lido
 * do DOM, ele dependeria de qual aba está montada na hora, e um `undefined` silencioso viraria
 * `value=""` — que é o "Todas" de Notas. O teste passaria a medir outra coisa.
 */
const OUTRO_MES = competenciasRecentes(12).find((c) => c !== competenciaPadrao());

/** As competências que `getInvoices` recebeu, na ordem — `undefined` quando foi "Todas". */
function competenciasPedidas() {
  return api.getInvoices.mock.calls.map(([, params]) => params?.competencia);
}

/**
 * ⚠⚠ TETO DE TEMPO DESTE ARQUIVO — 20 s, e ele é DAQUI, nunca do `jest.config` (02/09/2026).
 *
 * ⚠⚠ **O PADRÃO DE 5 s NÃO SOBE NA CONFIGURAÇÃO**, e a razão é concreta: foi ele que expôs, em
 * 01/09/2026, uma rota que PENDURAVA (a varredura de notas consultando o banco sem dublê). Um teto
 * global maior teria transformado aquele defeito em *"a suíte está lenta hoje"* — que é exatamente
 * como esta flutuação foi lida por semanas.
 *
 * ⚠⚠ **A MEDIÇÃO QUE JUSTIFICA O NÚMERO** (`jest --json`, 1.434 casos deste app): **17 casos** levam
 * 3 s ou mais, e eles se concentram em **5 arquivos** — este é um deles. O mais pesado marcou
 * 6,3 s. Ou seja: o corte de 5 s cai NO MEIO de uma população densa, e quem estoura não é o teste
 * errado — é o que estava rodando quando a máquina engasgou. Subir teste a teste seria correr atrás
 * de um alvo que muda a cada execução.
 *
 * ⚠ O custo é jsdom montando tabela de verdade (dezenas de células com estilo próprio, várias
 * renderizações por caso). Não há espera, relógio nem rede aqui — em navegador isto é instantâneo.
 * ⚠ Os outros ~1.417 casos deste app continuam com os 5 s de sempre.
 */
jest.setTimeout(20000);

describe("a competência atravessa Início ⇄ Notas", () => {
  test("⚠ trocar o mês no Início muda o que NOTAS pede à API", async () => {
    await abrirApp();

    // O Início já perguntou pelo mês padrão.
    expect(competenciasPedidas()).toContain(competenciaPadrao());

    const outroMes = OUTRO_MES;

    fireEvent.change(screen.getByLabelText("Competência"), { target: { value: outroMes } });
    await act(async () => {});

    api.getInvoices.mockClear();
    await irPara("Notas");

    // ⚠ O ponto do teste: a lista de notas abre no mês escolhido no Início, não no padrão.
    expect(competenciasPedidas()).toEqual(expect.arrayContaining([outroMes]));
    expect(competenciasPedidas()).not.toContain(competenciaPadrao());
  });

  test("⚠ trocar o mês em NOTAS muda o resumo do Início", async () => {
    await abrirApp();
    await irPara("Notas");

    const outroMes = OUTRO_MES;
    fireEvent.change(screen.getByLabelText("Competência"), { target: { value: outroMes } });
    await act(async () => {});

    api.getAliquotas.mockClear();
    await irPara("Início");

    // O resumo do mês sai de `getAliquotas(from, to)` — as duas pontas são a competência.
    expect(api.getAliquotas).toHaveBeenCalledWith("pc-001", { from: outroMes, to: outroMes });
  });

  test('⚠⚠ "Todas" é conceito de NOTAS: o Início cai no mês corrente e DIZ qual está mostrando', async () => {
    await abrirApp();
    await irPara("Notas");

    // "Todas" = string vazia. Notas passa a pedir sem competência…
    fireEvent.change(screen.getByLabelText("Competência"), { target: { value: "" } });
    await act(async () => {});
    expect(competenciasPedidas()).toContain(undefined);

    api.getAliquotas.mockClear();
    await irPara("Início");

    // …e o Início, que precisa de UM mês para somar, cai no padrão — nunca em "o período todo"
    // chamado de mês.
    expect(api.getAliquotas).toHaveBeenCalledWith("pc-001", {
      from: competenciaPadrao(),
      to: competenciaPadrao(),
    });
    // ⚠ E não esconde: o rótulo do card nomeia QUAL competência está sendo mostrada. A asserção
    // olha o mês, não só o prefixo — `/^Receita ·/` passaria com o card dizendo março/2019.
    // ⚠ O RÓTULO ERA "Faturamento" ATÉ 28/08/2026. A Lei 5 da `CONSTITUICAO-do-produto.md` fechou o
    // glossário: *Receita* é nota emitida no mês, e nunca dinheiro recebido — quem responde
    // "dinheiro que entra no caixa" é a coluna **Entrada** da tabela, que é outra conta.
    const [ano, mes] = competenciaPadrao().split("-");
    expect(screen.getByText(new RegExp(`^Receita ·.*${mes}/${ano}`))).toBeInTheDocument();
  });

  test("⚠ GUIAS entra na mesma competência — era a TERCEIRA cópia do mesmo estado", async () => {
    // ⚠ Esta era a que faltava, e ela só apareceu NO NAVEGADOR: unificados Início e Notas, a tela
    // ficou com 06/2026 nas duas e 08/2026 em Guias, sobre a mesma empresa — a mesma divergência,
    // agora entre outro par de abas. Meia unificação é o "filtro fantasma" do outro portal.
    jest.spyOn(api, "getGuides").mockResolvedValue({ data: [], page: 1, limit: 25, total: 0 });
    await abrirApp();

    await irPara("Notas");
    fireEvent.change(screen.getByLabelText("Competência"), { target: { value: OUTRO_MES } });
    await act(async () => {});

    api.getGuides.mockClear();
    await irPara("Guias");

    expect(document.querySelector("#competencia-guias").value).toBe(OUTRO_MES);
    expect(api.getGuides).toHaveBeenCalledWith(
      "pc-001",
      expect.objectContaining({ competencia: OUTRO_MES }),
    );
  });

  test("⚠⚠ a aba é `<a href>` de verdade, e o modificador NÃO é interceptado", async () => {
    // Esta é a razão inteira de a aba ter virado link, e era a única coisa nova de comportamento
    // sem teste nenhum. Um refactor que sempre chamasse `preventDefault()` manteria todas as
    // outras provas verdes e mataria os cinco comportamentos que vêm de graça com o `href`.
    //
    // ⚠⚠ O QUE SE MEDE É O `preventDefault`, NÃO O DESFECHO. O jsdom não implementa a regra de
    // INTERFACE "Ctrl+clique abre em outra guia" — para ele o modificador não muda nada e a
    // navegação de fragmento acontece igual. Afirmar `location.hash` (ou o que ficou montado na
    // tela) seria medir uma emulação errada e ainda ficaria à mercê de quando o `hashchange` é
    // entregue: o teste passava sozinho e falhava na suíte inteira.
    // `fireEvent.click` devolve `false` quando algum handler chamou `preventDefault`.
    await abrirApp();

    const guias = screen.getByRole("link", { name: "Guias" });
    expect(guias.getAttribute("href")).toBe("#/guias");

    // Clique simples: NÓS assumimos (SPA), então o padrão é cancelado.
    expect(fireEvent.click(guias)).toBe(false);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    // Com modificador: o navegador assume, e não cancelamos nada.
    const notas = screen.getByRole("link", { name: "Notas" });
    expect(fireEvent.click(notas, { ctrlKey: true })).toBe(true);
    expect(fireEvent.click(notas, { metaKey: true })).toBe(true);
    expect(fireEvent.click(notas, { shiftKey: true })).toBe(true);

    // A regra em si (e o caso do botão do meio) está em `lib/__tests__/cliqueDeLink.test.js`.
  });

  test("o valor é o MESMO nos dois seletores — não há dois estados para uma pergunta", async () => {
    await abrirApp();
    const outroMes = OUTRO_MES;

    await irPara("Notas");
    fireEvent.change(screen.getByLabelText("Competência"), { target: { value: outroMes } });
    await act(async () => {});
    expect(document.querySelector("#competencia-notas").value).toBe(outroMes);

    await irPara("Início");
    expect(document.querySelector("#competencia-home").value).toBe(outroMes);
  });
});
