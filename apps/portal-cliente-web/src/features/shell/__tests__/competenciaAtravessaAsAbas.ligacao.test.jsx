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
    // ⚠ E não esconde: o rótulo do card nomeia a competência que está sendo mostrada.
    expect(screen.getByText(/^Faturamento ·/)).toBeInTheDocument();
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
