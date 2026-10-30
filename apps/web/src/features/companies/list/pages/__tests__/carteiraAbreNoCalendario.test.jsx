import { Request } from 'node-fetch/lib/index.js';
// A carteira abre no calendário unificado, com visão mensal e tarefas por empresa.
import { cleanup, render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom';
import { WorkspaceNavigationProvider } from '../../../../../app/navigation/WorkspaceNavigation';
import { CompaniesHomePage } from "../renderCompaniesHomePage.jsx";

const CARTEIRA = [
  { companyId: "c1", razao: "ALFA SIMPLES LTDA", cnpj: "11111111000111", legacyCompany: { regimeTributario: "SIMPLES" } },
  { companyId: "c2", razao: "BETA PRESUMIDO SA", cnpj: "22222222000122", legacyCompany: { regimeTributario: "LUCRO_PRESUMIDO" } },
];

test('entrada e recarga do deep link restauram competência e modal; seleção seguinte remove filtro antigo', async () => {
 const mockApi=api();
 function Harness() {
  const [competencia,setCompetencia]=useState('2026-09');
  const location=useLocation();
  return <><output data-testid="url-atual">{location.pathname}{location.search}</output>
   <CompaniesHomePage user={{name:'Contador'}} companies={CARTEIRA} api={mockApi} loadingCompanies={false}
    dashboardCompetencia={competencia} onChangeCompetencia={setCompetencia}/></>;
 }
 const mount=url=>mountRouter(<WorkspaceNavigationProvider><Harness/></WorkspaceNavigationProvider>, [url]);
 const url='/companies?visao=operacoes&operacoesEtapa=calculado&operacoesLista=missing&operacoesCompetencia=2026-08';
 let view=mount(url);
 expect(await screen.findByRole('dialog')).toHaveTextContent('Competência 2026-08');
 const saved=screen.getByTestId('url-atual').textContent;
 view.unmount();view=mount(saved);
 expect(await screen.findByRole('dialog')).toHaveTextContent('Competência 2026-08');
 fireEvent.keyDown(document,{key:'Escape'});
 fireEvent.click(screen.getByRole('button',{name:'Mês anterior'}));
 await waitFor(()=>expect(screen.getByTestId('url-atual')).toHaveTextContent('competencia=2026-07'));
 expect(screen.getByTestId('url-atual')).not.toHaveTextContent('operacoesEtapa');
 expect(screen.getByText('Julho de 2026')).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:/^Calculado /}));
 expect(screen.getByRole('dialog')).toHaveTextContent('Competência 2026-07');
 expect(screen.getByTestId('url-atual')).toHaveTextContent('operacoesCompetencia=2026-07');
});

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
    getOperationEvidence: async competencia => ({items:[],total:0,competencia}),
    getOperationConsultas: async competencia => ({items:[],total:0,competencia}),
    getOperationRoutines: async () => ({items:[],routines:[]}),
    getOperationManualInss: async () => ({items:[]}),
    getOperationAlerts: async () => ({items:[],total:0}),
    listarTarefasCalendario: jest.fn(async()=>({ok:true,tarefas:[],itens:[]})),
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
  test("não há botão `Cards`; Operações fica ao lado do Calendario", () => {
    montar();
    expect(visoes()).toEqual(["Operações", "Calendario", "Empresas"]);
  });

  test("calendário abre no mês e oferece semana, dia e lista", () => {
    montar();
    fireEvent.click(within(barraDeVisoes()).getByRole('button',{name:'Calendario'}));
    const seletor=screen.getByLabelText('Visualização');
    expect(seletor).toHaveValue('mes');
    expect(within(seletor).getAllByRole('option').map(o=>o.textContent)).toEqual(['Mês','Semana','Dia','Lista']);
    expect(within(seletor).getByRole('option',{name:'Lista'})).toBeInTheDocument();
    expect(screen.queryByText('Filtros e legenda')).not.toBeInTheDocument();
  });
});

describe("⚠⚠ a carteira abre em Operações, e a escolha NÃO é lembrada", () => {
  test("ao montar, a visão acesa é Operações", () => {
    montar();
    expect(visaoAtiva()).toEqual(["Operações"]);
  });

  test("Tabela é selecionável", () => {
    montar();
    fireEvent.click(screen.getByRole("button", { name: /^Empresas$/ }));
    expect(visaoAtiva()).toEqual(["Empresas"]);
    expect(screen.getByText(/ALFA SIMPLES LTDA/)).toBeInTheDocument();
  });

  test("⚠⚠ escolher Tabela NÃO grava nada — remontar volta a Operações", () => {
    const { unmount } = montar();
    fireEvent.click(screen.getByRole("button", { name: /^Empresas$/ }));
    expect(visaoAtiva()).toEqual(["Empresas"]);
    // ⚠ A chave inteira tem de continuar ausente: gravar e ignorar na leitura seria pior que não
    // gravar — deixaria um valor que o próximo leitor acharia que manda em alguma coisa.
    expect(localStorage.getItem("dashboard:modoVisao")).toBeNull();

    unmount();
    montar();
    expect(visaoAtiva()).toEqual(["Operações"]);
  });

  test("⚠⚠ com `cards` GRAVADO no navegador, a tela abre em Operações — e com a aba ACESA", () => {
    // Este é o caso que a remoção criaria se a persistência tivesse ficado: o leitor antigo não
    // validava nada (`if (salvo) return salvo`) e a cadeia de render terminava no Cards. Removida a
    // visão, quem tivesse essa string ficaria com o conteúdo de uma visão e NENHUMA aba marcada — o
    // `Tabs` compara `item.key === active`. E não é hipotético: a heurística de largura GRAVAVA
    // `"cards"` sozinha em qualquer tela menor que 1024px, sem ninguém escolher nada.
    localStorage.setItem("dashboard:modoVisao", "cards");
    montar();
    expect(visaoAtiva()).toEqual(["Operações"]);
    expect(visaoAtiva()).toHaveLength(1); // ⚠ exatamente uma, nunca zero
  });
});

describe("ferramentas acompanham o contexto da tela inicial", () => {
  test("agenda usa seu próprio período e ações de empresa aparecem só na lista", () => {
    const onChangeCompetencia = jest.fn();
    const onRefreshCompanies = jest.fn();
    montar({ onChangeCompetencia, onRefreshCompanies });
    fireEvent.click(within(barraDeVisoes()).getByRole('button',{name:'Calendario'}));
    expect(screen.getByRole("heading", { level: 1, name: "Calendario" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "+ Adicionar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Imprimir" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Competência da carteira" })).not.toBeInTheDocument();

    fireEvent.click(within(barraDeVisoes()).getByRole("button", { name: "Empresas" }));
    expect(screen.getByRole("heading", { level: 1, name: "Empresas" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ Adicionar" })).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: /Adicionar/ }));
    expect(onCreateCompany).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveFocus();
  });
});


const mountedRouters = [];
function mountRouter(element, initialEntries) {
  const router = createMemoryRouter([{ path: '*', element }], { initialEntries });
  mountedRouters.push(router);
  const view = render(<RouterProvider router={router} />);
  return { ...view, unmount: () => { view.unmount(); router.dispose(); } };
}
afterEach(() => { cleanup(); mountedRouters.splice(0).forEach(router => router.dispose()); });

// Same installed Request implementation as bootstrapDataRouter; no router mock or fetch replacement.
const requestDescriptorBeforeSuite = Object.getOwnPropertyDescriptor(globalThis, 'Request');
beforeEach(() => { Object.defineProperty(globalThis, 'Request', { configurable: true, writable: true, value: Request }); });
afterEach(() => {
  if (requestDescriptorBeforeSuite) Object.defineProperty(globalThis, 'Request', requestDescriptorBeforeSuite);
  else delete globalThis.Request;
});