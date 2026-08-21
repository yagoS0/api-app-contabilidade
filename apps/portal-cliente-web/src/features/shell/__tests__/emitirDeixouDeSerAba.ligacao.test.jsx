// ⚠⚠ "EMITIR" DEIXOU DE SER ABA E VIROU BOTÃO DENTRO DE NOTAS (dono, 19/08/2026).
//
// A remoção tinha de ser INTEIRA — menu, destino de roteamento e estado. Meia remoção é o "filtro
// fantasma": tirar do menu e deixar a rota de pé faria um link antigo para `#/emitir` cair numa
// tela sem nenhuma saída visível, porque a aba que servia de saída não existe mais.
//
// Esta suíte mede as três metades da remoção e as duas entradas que sobraram:
//   1. a aba sumiu do menu;
//   2. `#/emitir` não é mais destino — cai no padrão, como qualquer hash desconhecido;
//   3. o botão "Emitir nota" da lista abre o formulário, e ele tem volta;
//   4. ⚠ "Usar como modelo" continua funcionando — a navegação dele mudou de natureza;
//   5. ⚠ quem NÃO pode emitir também alcança a tela, e também consegue sair dela.
//
// ⚠⚠ NADA É EMITIDO: `api.emitirNfse` explode se for chamado.

import { StrictMode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { api } from "../../../api";
import { AppShell } from "../AppShell";

const CNPJ = "11222333000181";

function empresa(patch = {}) {
  return {
    companyId: "pc-001",
    razao: "ACME SERVICOS LTDA",
    cnpj: CNPJ,
    myRole: "OWNER",
    emissaoNfseLiberada: true,
    legacyCompany: {
      regimeTributario: "SIMPLES_NACIONAL",
      inscricaoMunicipal: "1234567",
      codigoServicoNacional: "010101",
      codigoServicoMunicipal: "1.01",
      rpsSerie: "1",
    },
    ...patch,
  };
}

function nota(patch = {}) {
  return {
    invoiceId: "inv-1001",
    type: "NFSE",
    numero: "13000",
    competencia: "2026-06",
    issueDate: "2026-06-10T00:00:00.000Z",
    status: "EMITIDA",
    total: 2300,
    emitente: { nome: "ACME SERVICOS LTDA", cnpj: CNPJ },
    tomador: { nome: "TOMADOR EXEMPLO LTDA", cnpjCpf: "44555666000177" },
    updatedAt: "2026-06-11T00:00:00.000Z",
    hasXml: true,
    hasPdf: false,
    confirmadaPeloAdn: true,
    ...patch,
  };
}

let fetchOriginal;

beforeEach(() => {
  window.localStorage.clear();
  window.location.hash = "";
  fetchOriginal = global.fetch;
  global.fetch = jest.fn(() => {
    throw new Error("nenhum teste desta suíte pode tocar a rede");
  });
  jest.spyOn(api, "getCompanies").mockResolvedValue([empresa()]);
  jest.spyOn(api, "getInvoices").mockResolvedValue({
    data: [nota()],
    page: 1,
    limit: 25,
    total: 1,
    summary: { totalInvoices: 1, totalAmount: 2300, pageAmount: 2300 },
  });
  jest.spyOn(api, "getAliquotas").mockResolvedValue([]);
  jest.spyOn(api, "consultarCnpj").mockResolvedValue({
    ok: false,
    motivo: "nao_encontrado",
    mensagem: "CNPJ não encontrado na base da Receita.",
  });
  jest.spyOn(api, "emitirNfse").mockImplementation(() => {
    throw new Error("⚠ NENHUM TESTE PODE EMITIR NFS-e");
  });
});

afterEach(() => {
  expect(api.emitirNfse).not.toHaveBeenCalled();
  global.fetch = fetchOriginal;
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

async function abrirNotas() {
  await abrirApp();
  fireEvent.click(screen.getByRole("link", { name: "Notas" }));
  // ⚠ O flush precisa passar por uma TAREFA, não só por microtarefas: as abas são `<a href>` e o
  // `useRota` escuta `hashchange`, que o jsdom entrega numa tarefa. Sem isto o `findByText` abaixo
  // fica dependendo do polling de 1s para a rota trocar — e é daí que vinham os timeouts de 5s
  // desta suíte quando a máquina está ocupada.
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  await screen.findByText("Notas emitidas");
}

const abas = () =>
  // ⚠ `a`, não `button`: as abas viraram links de verdade em 20/08/2026 (Ctrl+clique abre em
  // nova guia). O que se mede aqui continua sendo o mesmo — QUAIS abas existem no menu.
  [...document.querySelectorAll('nav[aria-label="Seções"] a')].map((b) => b.textContent);

describe("⚠ 1. a aba sumiu do menu — inteira", () => {
  test("o menu tem Início, Notas e Guias, e NADA de Emitir", async () => {
    await abrirApp();
    expect(abas()).toEqual(["Início", "Notas", "Guias"]);
  });

  test("⚠ a barra é SÓ ÍCONE: o rótulo existe para o leitor de tela, não em tela", async () => {
    // Decisão do dono (21/08/2026). Sem esta guarda, "só ícones" some no primeiro que achar que a
    // barra ficou pobre — e o `.sr-only` é o que impede o oposto: um link sem nome acessível, que
    // o leitor de tela anunciaria como "link" e que derrubaria `getByRole("link", { name })` em
    // seis suítes.
    await abrirApp();
    const links = [...document.querySelectorAll('nav[aria-label="Seções"] a')];
    expect(links).toHaveLength(3);
    for (const a of links) {
      // Todo rótulo está dentro de `.sr-only` — nenhum texto solto no link.
      expect(a.querySelector(".sr-only")?.textContent).toBeTruthy();
      expect(a.querySelector("svg")).toBeTruthy();
      expect(a.querySelector("svg").getAttribute("aria-hidden")).toBe("true");
      // ⚠ E o ícone NÃO é a única marca: o nome acessível vem do rótulo escondido.
      expect(a.getAttribute("title")).toBe(a.querySelector(".sr-only").textContent);
    }
  });

  test("não existe botão de navegação chamado Emitir", async () => {
    await abrirApp();
    expect(screen.queryByRole("button", { name: "Emitir" })).not.toBeInTheDocument();
  });
});

describe("⚠⚠ 2. `#/emitir` não é mais destino de rota — o filtro fantasma não existe", () => {
  test("abrir o app direto em `#/emitir` cai no padrão (Início), não numa tela órfã", async () => {
    window.location.hash = "#/emitir";
    await abrirApp();
    expect(screen.queryByRole("heading", { name: "Emitir nota" })).not.toBeInTheDocument();
    expect(screen.queryByText("Notas emitidas")).not.toBeInTheDocument();
  });

  test("⚠ e o hash não fica preso: navegar depois continua funcionando", async () => {
    window.location.hash = "#/emitir";
    await abrirApp();
    fireEvent.click(screen.getByRole("link", { name: "Notas" }));
    await act(async () => {});
    await screen.findByText("Notas emitidas");
    expect(window.location.hash).toBe("#/notas");
  });
});

describe("⚠ 3. o botão dentro de Notas é a entrada nova, e ela tem volta", () => {
  test("Emitir nota abre o formulário SEM sair da rota `#/notas`", async () => {
    await abrirNotas();
    fireEvent.click(screen.getByRole("button", { name: "Emitir nota" }));
    await act(async () => {});
    await screen.findByRole("heading", { name: "Emitir nota" });
    // ⚠ A rota NÃO mudou: emitir é um modo da tela de Notas, não um destino.
    expect(window.location.hash).toBe("#/notas");
  });

  test("Voltar para as notas devolve a lista", async () => {
    await abrirNotas();
    fireEvent.click(screen.getByRole("button", { name: "Emitir nota" }));
    await act(async () => {});
    await screen.findByRole("heading", { name: "Emitir nota" });

    fireEvent.click(screen.getByRole("button", { name: "Voltar para as notas" }));
    await act(async () => {});
    await screen.findByText("Notas emitidas");
    expect(screen.queryByRole("heading", { name: "Emitir nota" })).not.toBeInTheDocument();
  });

  test("⚠ sair para outra aba fecha a emissão — é o que a rota já fazia ao desmontar a tela", async () => {
    await abrirNotas();
    fireEvent.click(screen.getByRole("button", { name: "Emitir nota" }));
    await act(async () => {});
    await screen.findByRole("heading", { name: "Emitir nota" });

    fireEvent.click(screen.getByRole("link", { name: "Guias" }));
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    fireEvent.click(screen.getByRole("link", { name: "Notas" }));
    await act(async () => {});
    // Volta na LISTA, que é o que o rótulo da aba promete.
    await screen.findByText("Notas emitidas");
  });
});

describe("⚠ 4. Usar como modelo continua funcionando — a navegação mudou de natureza", () => {
  test("da lista para o formulário pré-preenchido, sem trocar de rota", async () => {
    await abrirNotas();
    fireEvent.click(screen.getByRole("button", { name: "Usar como modelo" }));
    await act(async () => {});
    await screen.findByRole("heading", { name: "Emitir nota" });
    expect(document.getElementById("emitir-nome").value).toBe("TOMADOR EXEMPLO LTDA");
    expect(window.location.hash).toBe("#/notas");
  });

  test("⚠ e o caminho de volta existe também a partir do modelo", async () => {
    await abrirNotas();
    fireEvent.click(screen.getByRole("button", { name: "Usar como modelo" }));
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Voltar para as notas" }));
    await act(async () => {});
    await screen.findByText("Notas emitidas");
  });
});

describe("⚠⚠ 5. quem NÃO pode emitir alcança a tela — e consegue sair dela", () => {
  beforeEach(() => {
    api.getCompanies.mockResolvedValue([empresa({ emissaoNfseLiberada: false })]);
  });

  test("o botão aparece mesmo assim: escondê-lo esconderia que a emissão existe", async () => {
    await abrirNotas();
    expect(screen.getByRole("button", { name: "Emitir nota" })).toBeEnabled();
  });

  test("⚠ o portão fechado NÃO é uma armadilha: tem Voltar para as notas", async () => {
    await abrirNotas();
    fireEvent.click(screen.getByRole("button", { name: "Emitir nota" }));
    await act(async () => {});
    await screen.findByRole("heading", { name: "Emitir nota" });
    // Sem a aba "Emitir", ESTE botão é a única saída — e é o ramo em que quem entrou não pode
    // fazer mais nada ali.
    fireEvent.click(screen.getByRole("button", { name: "Voltar para as notas" }));
    await act(async () => {});
    await screen.findByText("Notas emitidas");
  });
});
