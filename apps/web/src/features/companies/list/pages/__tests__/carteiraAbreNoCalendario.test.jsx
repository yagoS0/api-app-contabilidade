// ⚠⚠ A REDE QUE NÃO EXISTIA. Até 01/09/2026 as visões da carteira não tinham UM teste: não havia
// `__tests__` para `renderCompanyCard.jsx`, nem para `renderAnnualGrid.jsx`, nem para a feature
// `calendario/` inteira. Medido antes de mexer: **apagar o `AnnualGrid` não produzia um vermelho**.
// Uma entrega que remove uma visão e move outra, sem rede, é uma entrega que ninguém consegue
// revisar — então ela veio primeiro.
//
// > Dono, 01/09/2026: *"retirar totalmente a visualização em Cards, colocar a visualização de Ano
// > dentro do Calendário, e sempre que abrir abre no Calendário, sendo o modo Tabela selecionável."*
//
// O que este arquivo trava, na ordem da frase dele:
//   1. Cards não existe mais — nem como botão, nem como `else` de render;
//   2. a carteira ABRE no Calendário, sempre;
//   3. Tabela é selecionável — e NÃO é lembrada;
//   4. ⚠⚠ quem tem `"cards"` gravado no navegador abre no Calendário, COM a aba acesa;
//   5. Ano vive dentro do Calendário, com a grade anual e o seletor de empresa desabilitado.

import { render, screen, fireEvent, within, act } from "@testing-library/react";
import { CompaniesHomePage } from "../renderCompaniesHomePage.jsx";

const CARTEIRA = [
  { companyId: "c1", razao: "ALFA SIMPLES LTDA", cnpj: "11111111000111", legacyCompany: { regimeTributario: "SIMPLES" } },
  { companyId: "c2", razao: "BETA PRESUMIDO SA", cnpj: "22222222000122", legacyCompany: { regimeTributario: "LUCRO_PRESUMIDO" } },
];

/** A resposta da grade anual — a forma é a que `renderAnnualGrid` lê, não uma inventada aqui. */
function anual(ano = 2026) {
  return {
    empresas: [{
      companyId: "c1",
      razao: "ALFA SIMPLES LTDA",
      cnpj: "11.111.111/0001-11",
      meses: Array.from({ length: 12 }, (_, i) => ({
        competencia: `${ano}-${String(i + 1).padStart(2, "0")}`,
        // Fevereiro fechado E apurado: é o ESTADO BOM, que a grade de dias esconde de propósito
        // (`piorEstadoDoDia` ignora `resolvida`) e que esta grade existe para mostrar.
        fechado: i === 1,
        apurada: i === 1,
        estadoApuracao: i === 1 ? "transmitida" : null,
      })),
    }],
  };
}

function api(extra = {}) {
  return {
    getCalendario: jest.fn(async () => ({ dias: [], pendenciasDoMes: [] })),
    getCompaniesAnnual: jest.fn(async () => anual()),
    ...extra,
  };
}

function montar(props = {}) {
  return render(
    <CompaniesHomePage
      user={{ name: "Contador" }}
      companies={CARTEIRA}
      loadingCompanies={false}
      onCreateCompany={jest.fn()}
      onRefreshCompanies={jest.fn()}
      onOpenCompany={jest.fn()}
      onLogout={jest.fn()}
      dashboardCompetencia="2026-07"
      onChangeCompetencia={jest.fn()}
      api={api()}
      {...props}
    />,
  );
}

const barraDeVisoes = () => screen.getByRole("group", { name: "Visão da carteira" });
const visoes = () => within(barraDeVisoes()).getAllByRole("button").map((b) => b.textContent.trim());
const visaoAtiva = () =>
  within(barraDeVisoes()).getAllByRole("button")
    .filter((b) => b.getAttribute("aria-pressed") === "true")
    .map((b) => b.textContent.trim());

beforeEach(() => {
  try { localStorage.clear(); } catch { /* jsdom sempre tem; o app não conta com isso */ }
});

describe("⚠⚠ a visão em Cards saiu do produto", () => {
  test("não há botão `Cards` na barra de visões — sobraram DUAS", () => {
    montar();
    expect(visoes()).toEqual(["Calendário", "Tabela"]);
  });

  test("⚠ e `Ano` também saiu DAQUI — ele não sumiu, mudou de casa", () => {
    montar();
    expect(visoes()).not.toContain("Ano");
    // A prova de que ele não morreu: continua clicável, uma barra ao lado.
    const granularidade = screen.getByRole("group", { name: "Granularidade do calendário" });
    expect(within(granularidade).getByRole("button", { name: "Ano" })).toBeInTheDocument();
  });
});

describe("⚠⚠ a carteira abre no Calendário, e a escolha NÃO é lembrada", () => {
  test("ao montar, a visão acesa é o Calendário", () => {
    montar();
    expect(visaoAtiva()).toEqual(["Calendário"]);
  });

  test("Tabela é selecionável", () => {
    montar();
    fireEvent.click(screen.getByRole("button", { name: /^Tabela$/ }));
    expect(visaoAtiva()).toEqual(["Tabela"]);
    expect(screen.getByText(/ALFA SIMPLES LTDA/)).toBeInTheDocument();
  });

  test("⚠⚠ escolher Tabela NÃO grava nada — remontar volta ao Calendário", () => {
    const { unmount } = montar();
    fireEvent.click(screen.getByRole("button", { name: /^Tabela$/ }));
    expect(visaoAtiva()).toEqual(["Tabela"]);
    // ⚠ A chave inteira tem de continuar ausente: gravar e ignorar na leitura seria pior que não
    // gravar — deixaria um valor que o próximo leitor acharia que manda em alguma coisa.
    expect(localStorage.getItem("dashboard:modoVisao")).toBeNull();

    unmount();
    montar();
    expect(visaoAtiva()).toEqual(["Calendário"]);
  });

  test("⚠⚠ com `cards` GRAVADO no navegador, a tela abre no Calendário — e com a aba ACESA", () => {
    // Este é o caso que a remoção criaria se a persistência tivesse ficado: o leitor antigo não
    // validava nada (`if (salvo) return salvo`) e a cadeia de render terminava no Cards. Removida a
    // visão, quem tivesse essa string ficaria com o conteúdo de uma visão e NENHUMA aba marcada — o
    // `Tabs` compara `item.key === active`. E não é hipotético: a heurística de largura GRAVAVA
    // `"cards"` sozinha em qualquer tela menor que 1024px, sem ninguém escolher nada.
    localStorage.setItem("dashboard:modoVisao", "cards");
    montar();
    expect(visaoAtiva()).toEqual(["Calendário"]);
    expect(visaoAtiva()).toHaveLength(1); // ⚠ exatamente uma, nunca zero
  });
});

describe("⚠⚠ o Ano virou granularidade DENTRO do Calendário", () => {
  const granularidade = () => screen.getByRole("group", { name: "Granularidade do calendário" });
  const irParaOAno = () => fireEvent.click(within(granularidade()).getByRole("button", { name: "Ano" }));

  test("ele é a granularidade mais larga, antes de Mês", () => {
    montar();
    expect(within(granularidade()).getAllByRole("button").map((b) => b.textContent.trim()))
      .toEqual(["Ano", "Mês", "Semana", "Dia", "Agenda"]);
  });

  test("no Ano a grade é `empresa × 12 meses`, com o estado BOM visível", async () => {
    montar();
    await act(async () => { irParaOAno(); });

    expect(await screen.findByRole("region", { name: "Visão anual" })).toBeInTheDocument();
    // Os doze meses são as COLUNAS e a empresa é a LINHA — a grade de dias é `semana × dia`, e a
    // empresa lá nem é eixo, é rótulo dentro do chip. Não é a mesma grade com zoom.
    for (const m of ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"]) {
      expect(screen.getByRole("columnheader", { name: m })).toBeInTheDocument();
    }
    expect(screen.getByRole("columnheader", { name: "Empresa" })).toBeInTheDocument();
    // Fevereiro carrega os DOIS marcadores, e eles são coisas diferentes que podem divergir.
    const fev = screen.getByRole("button", { name: /ALFA SIMPLES LTDA · 2026-02/ });
    expect(fev).toHaveAccessibleName(/Fechamento contábil: FECHADO/);
    expect(fev).toHaveAccessibleName(/Apuração: transmitida/);
  });

  test("⚠ o clique numa célula abre a empresa NAQUELA competência", async () => {
    const onOpenCompany = jest.fn();
    montar({ onOpenCompany });
    await act(async () => { irParaOAno(); });

    fireEvent.click(await screen.findByRole("button", { name: /ALFA SIMPLES LTDA · 2026-05/ }));
    expect(onOpenCompany).toHaveBeenCalledWith("c1", "2026-05");
  });

  test("⚠⚠ o seletor de empresa fica DESABILITADO no Ano, com o motivo — nunca escondido", async () => {
    montar();
    const seletor = screen.getByRole("combobox");
    expect(seletor).not.toBeDisabled();

    await act(async () => { irParaOAno(); });
    // `GET /firm/companies/annual` não aceita `companyId`: ela devolve a carteira inteira, sempre.
    // Ativo, seria um controle que não comanda o que promete. Escondido, ninguém saberia que a
    // filtragem existe nas outras granularidades.
    expect(seletor).toBeDisabled();
    expect(seletor).toHaveAttribute("title", expect.stringMatching(/não filtra por empresa/i));
  });

  test("⚠ a legenda `cor = estado` some no Ano — lá a escala é outra", async () => {
    montar();
    expect(screen.getByText(/cor = estado/i)).toBeInTheDocument();
    await act(async () => { irParaOAno(); });
    // Ler a grade anual com a chave da grade de dias é o defeito: ali teal é "fechado" e verde é
    // "apurado", e a grade anual traz a legenda própria dela.
    expect(screen.queryByText(/cor = estado/i)).toBeNull();
    expect(screen.getByText(/fechamento contábil/i)).toBeInTheDocument();
  });

  test("⚠⚠ as `Pendências do mês` somem no Ano — elas eram ESTADO VELHO ali", async () => {
    // Achado no NAVEGADOR, com a suíte verde. Como `carregar()` não roda no modo Ano, `pendencias`
    // guardava o que o último mês visitado trouxe: a tela mostrava as pendências de AGOSTO sob a
    // grade de 2026 inteiro, com o título dizendo "do mês". E a grade anual JÁ é o `pendenciasDoMes`
    // ×12 — manter a lista embaixo dela é o mesmo fato afirmado duas vezes.
    const cliente = api({
      getCalendario: jest.fn(async () => ({
        dias: [],
        pendenciasDoMes: [
          { tipo: "apuracao", companyId: "c1", competencia: "2026-07", titulo: "Apuracao nao transmitida" },
        ],
      })),
    });
    montar({ api: cliente });
    expect(await screen.findByText(/Pendências do mês/)).toBeInTheDocument();

    await act(async () => { irParaOAno(); });
    expect(screen.queryByText(/Pendências do mês/)).toBeNull();
    expect(screen.queryByText(/Pendências do período/)).toBeNull();
  });

  test("⚠ o Ano NÃO chama `getCalendario` — ele tem porta própria", async () => {
    const cliente = api();
    montar({ api: cliente });
    await act(async () => {});
    cliente.getCalendario.mockClear();

    await act(async () => { irParaOAno(); });
    // A rota do calendário valida `^\d{4}-\d{2}$` e responderia 400 para um ano; buscar o mês
    // corrente para desenhar doze seria uma requisição que nenhuma célula da tela está mostrando.
    expect(cliente.getCalendario).not.toHaveBeenCalled();
    expect(cliente.getCompaniesAnnual).toHaveBeenCalledWith(2026);
  });
});
