// A carteira continua abrindo no calendário; a nova agenda abre na semana.
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
    listObrigacoes: jest.fn(async()=>({ok:true,obrigacoes:[]})),
    listRegrasObrigacao: jest.fn(async()=>({ok:true,regras:[]})),
    getTarefasAgenda: jest.fn(async()=>({ok:true,tarefas:[],itens:[],ocultos:[]})),
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
    expect(visoes()).toEqual(["Agenda", "Empresas"]);
  });

  test("calendário abre na semana e oferece dia, mês e lista", () => {
    montar();
    const seletor=screen.getByLabelText('Visualização do calendário');
    expect(seletor).toHaveValue('semana');
    expect(within(seletor).getAllByRole('option').map(o=>o.textContent)).toEqual(['Semana','Dia','Mês']);
    expect(screen.getByRole('button',{name:'Lista'})).toBeInTheDocument();
    expect(screen.queryByText('Filtros e legenda')).not.toBeInTheDocument();
  });
});

describe("⚠⚠ a carteira abre no Calendário, e a escolha NÃO é lembrada", () => {
  test("ao montar, a visão acesa é o Calendário", () => {
    montar();
    expect(visaoAtiva()).toEqual(["Agenda"]);
  });

  test("Tabela é selecionável", () => {
    montar();
    fireEvent.click(screen.getByRole("button", { name: /^Empresas$/ }));
    expect(visaoAtiva()).toEqual(["Empresas"]);
    expect(screen.getByText(/ALFA SIMPLES LTDA/)).toBeInTheDocument();
  });

  test("⚠⚠ escolher Tabela NÃO grava nada — remontar volta ao Calendário", () => {
    const { unmount } = montar();
    fireEvent.click(screen.getByRole("button", { name: /^Empresas$/ }));
    expect(visaoAtiva()).toEqual(["Empresas"]);
    // ⚠ A chave inteira tem de continuar ausente: gravar e ignorar na leitura seria pior que não
    // gravar — deixaria um valor que o próximo leitor acharia que manda em alguma coisa.
    expect(localStorage.getItem("dashboard:modoVisao")).toBeNull();

    unmount();
    montar();
    expect(visaoAtiva()).toEqual(["Agenda"]);
  });

  test("⚠⚠ com `cards` GRAVADO no navegador, a tela abre no Calendário — e com a aba ACESA", () => {
    // Este é o caso que a remoção criaria se a persistência tivesse ficado: o leitor antigo não
    // validava nada (`if (salvo) return salvo`) e a cadeia de render terminava no Cards. Removida a
    // visão, quem tivesse essa string ficaria com o conteúdo de uma visão e NENHUMA aba marcada — o
    // `Tabs` compara `item.key === active`. E não é hipotético: a heurística de largura GRAVAVA
    // `"cards"` sozinha em qualquer tela menor que 1024px, sem ninguém escolher nada.
    localStorage.setItem("dashboard:modoVisao", "cards");
    montar();
    expect(visaoAtiva()).toEqual(["Agenda"]);
    expect(visaoAtiva()).toHaveLength(1); // ⚠ exatamente uma, nunca zero
  });
});

describe("ferramentas acompanham o contexto da tela inicial", () => {
  test("agenda usa seu próprio período e ações de empresa aparecem só na lista", () => {
    const onChangeCompetencia = jest.fn();
    const onRefreshCompanies = jest.fn();
    montar({ onChangeCompetencia, onRefreshCompanies });
    expect(screen.getByRole("heading", { level: 1, name: "Agenda" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Nova empresa" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Imprimir" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Competência da carteira" })).not.toBeInTheDocument();

    fireEvent.click(within(barraDeVisoes()).getByRole("button", { name: "Empresas" }));
    expect(screen.getByRole("heading", { level: 1, name: "Empresas" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nova empresa" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Imprimir" })).toBeInTheDocument();
    const competencia = screen.getByRole("group", { name: "Competência da carteira" });
    fireEvent.click(within(competencia).getByRole("button", { name: "Próximo mês" }));
    expect(onChangeCompetencia).toHaveBeenCalledWith("2026-08");
    fireEvent.click(within(competencia).getByRole("button", { name: /Recarregar a lista/ }));
    expect(onRefreshCompanies).toHaveBeenCalledTimes(1);
  });

  test("cadastro continua protegido pelo plano de contas global", () => {
    const onCreateCompany = jest.fn();
    montar({ onCreateCompany, globalChartStatus: { isConfigured: false, tiposFaltantes: ["ATIVO"] } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.click(within(barraDeVisoes()).getByRole("button", { name: "Empresas" }));
    fireEvent.click(screen.getByRole("button", { name: /Nova empresa/ }));
    expect(onCreateCompany).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveFocus();
  });
});
