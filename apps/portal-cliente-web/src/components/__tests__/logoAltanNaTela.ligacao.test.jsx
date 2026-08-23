// ⚠⚠ A MARCA SUBSTITUIU O TEXTO — e é por isso que este teste existe.
//
// Até 23/08/2026 o portal se identificava por texto puro: `<h1>Portal do Cliente</h1>` no login e
// `<span class="brand">Portal do Cliente</span>` na barra do topo. O dono pediu a logo da Altan no
// lugar e mandou tirar o texto escrito.
//
// ⚠ O RISCO DA TROCA NÃO É ESTÉTICO, É DE ACESSIBILIDADE. Texto some da tela e o que fica é um
// gráfico; se esse gráfico não tiver nome acessível, o portal passa a não se identificar para quem
// usa leitor de tela — e ninguém percebe, porque na tela está bonito. Por isso a asserção é sobre o
// PAPEL `img` COM NOME, nunca sobre a existência de um `<svg>`.
//
// ⚠ E a varredura do texto é do `textContent` da PÁGINA INTEIRA, não do nó que eu troquei: o rótulo
// antigo podia ter sobrado num `title`, num `aria-label` ou numa terceira tela que eu não abri.

import { StrictMode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { api } from "../../api";
import { LoginPage } from "../../features/auth/LoginPage";
import { AppShell } from "../../features/shell/AppShell";
import { LogoAltan } from "../LogoAltan";

const NOME_DA_MARCA = "Altan Contabilidade";

function empresa() {
  return {
    companyId: "pc-001",
    razao: "ACME SERVICOS LTDA",
    cnpj: "11222333000181",
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
    data: [], page: 1, limit: 25, total: 0,
    summary: { totalInvoices: 0, totalAmount: 0, pageAmount: 0 },
  });
  jest.spyOn(api, "getAliquotas").mockResolvedValue([]);
  jest.spyOn(api, "getFluxo").mockResolvedValue({ data: [], total: 0 });
});

afterEach(() => {
  window.location.hash = "";
  jest.restoreAllMocks();
});

async function abrirCasca() {
  render(<StrictMode><AppShell user={{ defaultClientId: "pc-001" }} /></StrictMode>);
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

/** ⚠ O flush precisa passar por uma TAREFA: o `useRota` escuta `hashchange`, que o jsdom entrega
 *  numa tarefa — com microtarefas só, a rota trocaria DEPOIS da asserção. */
async function irPara(aba) {
  fireEvent.click(screen.getByRole("link", { name: aba }));
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

describe("o componente", () => {
  it("⚠ é um gráfico COM NOME — sem isto o portal fica mudo para leitor de tela", () => {
    render(<LogoAltan />);
    expect(screen.getByRole("img", { name: NOME_DA_MARCA })).toBeInTheDocument();
  });

  it("⚠⚠ o letreiro é `<text>` DE VERDADE, e é isso que exige a fonte carregada pela PÁGINA", () => {
    // Se algum dia alguém trocar o SVG inline por `<img src="logo.svg">`, esta asserção cai — e é o
    // ponto: imagem externa é documento isolado, não enxerga a Inter que a página carregou, e o
    // letreiro passa a ser Segoe UI / Arial / Roboto conforme a máquina de quem abre.
    const { container } = render(<LogoAltan />);
    const textos = [...container.querySelectorAll("text")].map((t) => t.textContent);
    expect(textos).toEqual(["ALTAN", "CONTABILIDADE"]);
    expect(container.querySelector("img")).toBeNull();
  });

  it("⚠ as cores saem do TEMA, não cravadas — é o que faz a mesma peça servir aos dois portais", () => {
    // "claro"/"escuro" no nome dos arquivos da Altan é o FUNDO em que a logo se apoia. Cravar hex
    // aqui obrigaria a manter duas cópias do desenho, que divergem na primeira correção.
    const { container } = render(<LogoAltan />);
    expect(container.querySelector("path").getAttribute("fill")).toBe("var(--logo-sol)");
    expect(container.querySelector("line").getAttribute("stroke")).toBe("var(--logo-horizonte)");
  });

  it('⚠⚠ `tom="papel"` crava o par de fundo CLARO — a tinta do tema sairia invisível no branco', () => {
    const { container } = render(<LogoAltan tom="papel" />);
    const estilo = container.querySelector("svg").style;
    expect(estilo.getPropertyValue("--logo-tinta")).toBe("#1A1B26");
    // Sem isto o navegador descarta a cor da cúpula na impressão.
    expect(estilo.printColorAdjust || estilo.getPropertyValue("print-color-adjust")).toBe("exact");
  });

  it("a altura manda e a largura sai da proporção — nada de esticar a marca", () => {
    const { container } = render(<LogoAltan altura={40} />);
    const svg = container.querySelector("svg");
    expect(svg.getAttribute("height")).toBe("40");
    expect(Number(svg.getAttribute("width"))).toBeGreaterThan(150);
  });
});

describe("⚠⚠ o texto da marca SAIU da tela, e a logo ficou no lugar", () => {
  it("no LOGIN", async () => {
    render(<StrictMode><LoginPage /></StrictMode>);
    await act(async () => {});

    expect(screen.getByRole("img", { name: NOME_DA_MARCA })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Portal do Cliente/i);
    // ⚠ O `<h1>` FICA: é a hierarquia do documento, e a página não pode ficar sem cabeçalho.
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    // O subtítulo fica — ele diz o que a ferramenta faz, não repete a marca.
    expect(screen.getByText(/Acompanhe suas notas, guias e impostos/)).toBeInTheDocument();
  });

  it("na BARRA DO TOPO, depois de logado", async () => {
    await abrirCasca();

    expect(screen.getByRole("img", { name: NOME_DA_MARCA })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Portal do Cliente/i);
    // E a marca continua sendo o primeiro item da barra, antes da empresa.
    expect(document.querySelector(".topbar .brand svg")).toBeTruthy();
  });
});

describe("⚠⚠ na barra do topo a marca é SÓ O SOL — e ela volta ao início", () => {
  // Pedido do dono, 23/08/2026: *"tire a 'Altan contabilidade' e deixe apenas o Sol no canto
  // superior, e ao clicar volta ao início"*.

  test("⚠ o letreiro não é RENDERIZADO — não basta escondê-lo", async () => {
    // Um `<text>` invisível continuaria no `textContent` e no cálculo do nome acessível: a marca
    // "sem letras" ainda seria lida como tendo letras.
    await abrirCasca();
    const marca = document.querySelector(".topbar .brand svg");
    expect(marca.querySelectorAll("text")).toHaveLength(0);
    expect(document.querySelector(".topbar").textContent).not.toMatch(/CONTABILIDADE/);
  });

  test("⚠ mas o desenho é o MESMO — sol e horizonte continuam lá", async () => {
    // A variante recorta a janela; ela não redesenha nem duplica a arte.
    await abrirCasca();
    const marca = document.querySelector(".topbar .brand svg");
    expect(marca.querySelector("path")).toBeTruthy();
    expect(marca.querySelector("line")).toBeTruthy();
  });

  test("é um `<a href=\"#/home\">`, e o clique normal é SPA", async () => {
    await abrirCasca();
    const marca = screen.getByRole("link", { name: /ir para o in[ií]cio/i });
    expect(marca.getAttribute("href")).toBe("#/home");
    // `fireEvent.click` devolve `false` quando algum handler chamou `preventDefault`.
    expect(fireEvent.click(marca)).toBe(false);
  });

  test("⚠⚠ clicando nela de OUTRA aba, a tela volta para o Início", async () => {
    await abrirCasca();
    await irPara("Guias");
    expect(document.querySelector("#competencia-home")).toBeNull();

    fireEvent.click(screen.getByRole("link", { name: /ir para o in[ií]cio/i }));
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    // O seletor do Painel só existe na tela de Início.
    expect(document.querySelector("#competencia-home")).toBeTruthy();
  });

  test("⚠ Ctrl/Cmd+clique NÃO é interceptado — é o navegador que assume", async () => {
    // Mesma regra das abas: um `onClick` que sempre cancelasse mataria abrir em nova guia.
    await abrirCasca();
    const marca = screen.getByRole("link", { name: /ir para o in[ií]cio/i });
    expect(fireEvent.click(marca, { ctrlKey: true })).toBe(true);
    expect(fireEvent.click(marca, { metaKey: true })).toBe(true);
  });

  test("⚠ o nome acessível diz a MARCA e o DESTINO — e não repete o rótulo da aba", async () => {
    // Sem isto o nome viria do `<title>` do SVG e seria só "Altan Contabilidade": quem usa leitor
    // de tela ouviria uma marca sem saber que ali há um caminho de volta. E dois links chamados
    // "Início" fariam a navegação por lista de links virar adivinhação.
    await abrirCasca();
    const links = screen.getAllByRole("link").map((a) => a.getAttribute("aria-label") || a.textContent);
    expect(links.filter((n) => n === "Início")).toHaveLength(1);
    expect(links).toContain("Altan Contabilidade — ir para o início");
  });

  test("⚠⚠ e o letreiro continua INTEIRO no login — é lá que a marca se apresenta", async () => {
    // A guarda existe porque "tirar o letreiro" é fácil de aplicar demais: some da topbar E do
    // login, e aí o portal deixa de dizer de quem ele é.
    render(<StrictMode><LoginPage /></StrictMode>);
    await act(async () => {});
    const marca = document.querySelector(".login-marca svg");
    expect([...marca.querySelectorAll("text")].map((t) => t.textContent))
      .toEqual(["ALTAN", "CONTABILIDADE"]);
  });
});
