import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CompanyGuidesTable } from "../renderCompanyGuidesTable";
const mockReport = jest.fn();
const mockDueReport = jest.fn();
const mockFechamento = jest.fn();
jest.mock("../../../../../api/client", () => ({ createApiClient: () => ({
  getExpectedGuides: (...args) => mockReport(...args),
  getFechamentoContabil: jest.fn().mockResolvedValue({}),
  getFechamento: (...args) => mockFechamento(...args),
  getCompanyGuideDueReport: (...args) => mockDueReport(...args),
}) }));
jest.mock("../../../capture/components/renderGuideCaptureModal", () => ({ GuideCaptureModal: () => null }));
jest.mock("../GuiaDeParcelamentoModal", () => ({ GuiaDeParcelamentoModal: () => null }));
const guia = (id, competencia, vencimento, extra = {}) => ({
  guideId: id, tipo: id, competencia, vencimento, status: "PROCESSED", paymentStatus: "OPEN", ...extra,
});
const guides = [
  guia("OUTUBRO", "2026-10", "2026-11-20"),
  guia("NOVEMBRO", "2026-11", "2027-02-01"),
  guia("DEZEMBRO", "2026-12", "2027-01-05"),
  guia("SEM-DATA", "2026-10", null),
  guia("SEM-COMPETENCIA", null, "2026-10-20"),
  guia("OUTRA-EMPRESA", "2026-10", "2026-11-20", { companyId: "outra" }),
];
const props = { companyId: "c1", competencia: "2026-10", guides, loadingGuides: false };
beforeEach(() => {
  jest.clearAllMocks();
  mockDueReport.mockResolvedValue({ outros: [] });
  mockReport.mockImplementation(async (_id, competencia) => ({ competencia, compliance: { coberturaParcelamentoMes: [] } }));
  mockFechamento.mockResolvedValue({});
});
test("a competência do documento define a lista e a seleção, inclusive na virada do ano", async () => {
  const { rerender } = render(<CompanyGuidesTable {...props} />);
  expect(screen.getByText("OUTUBRO")).toBeVisible();
  expect(screen.getByText("SEM-DATA")).toBeVisible();
  for (const tipo of ["NOVEMBRO", "DEZEMBRO", "SEM-COMPETENCIA", "OUTRA-EMPRESA"]) expect(screen.queryByText(tipo)).toBeNull();
  fireEvent.click(screen.getByRole("checkbox", { name: "Selecionar todas" }));
  expect(screen.getByText("2 selecionadas")).toBeVisible();
  for (const [competencia, tipo] of [["2026-11", "NOVEMBRO"], ["2026-12", "DEZEMBRO"]]) {
    rerender(<CompanyGuidesTable {...props} competencia={competencia} />);
    expect(screen.getByText(tipo)).toBeVisible();
    expect(screen.queryByText("OUTUBRO")).toBeNull();
    expect(screen.getByRole("checkbox", { name: "Selecionar todas" })).not.toBeChecked();
    await waitFor(() => expect(mockReport).toHaveBeenCalledWith("c1", competencia));
  }
});
test("atalho de parcela não inclui documento de outra competência", async () => {
  render(<CompanyGuidesTable {...props} guiaDeOrigem={{ companyId: "c1", id: "NOVEMBRO" }} />);
  expect(screen.queryByText("NOVEMBRO")).toBeNull();
  expect(screen.queryByRole("checkbox")).toBeNull();
});
test("previsão usa referência contratual e mantém vencimento próprio", async () => {
  const item = { id: "p", parcelaId: "p", portalClientId: "c1", referenciaFiscal: "2026-10", referencia: "2026-10", vencimento: "2027-01-20", formaPagamento: "GUIA_MENSAL" };
  mockReport.mockResolvedValue({ competencia: "2026-10", compliance: { coberturaParcelamentoMes: [
    item, { ...item, id: "fora", referenciaFiscal: "2026-11" }, { ...item, id: "sem", referenciaFiscal: null },
    { ...item, id: "outra", portalClientId: "c2" }, { ...item, id: "emitida", guideId: "g" },
  ] } });
  render(<CompanyGuidesTable {...props} />);
  expect(await screen.findAllByText("Falta guia de parcelamento")).toHaveLength(1);
  expect(screen.getByText("20/01/2027")).toBeVisible();
});
test("histórico permite identificar documento sem competência e impede seleção para o lote", async () => {
  render(<CompanyGuidesTable {...props} onIdentifyGuide={jest.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Histórico completo" }));
  expect(screen.getByText("SEM-COMPETENCIA")).toBeVisible();
  expect(screen.getByRole("checkbox", { name: /Selecionar guia SEM-COMPETENCIA/ })).toBeDisabled();
});
test("falha de conferência é explícita e permite repetir leitura", async () => {
  mockReport.mockRejectedValue(new Error("Consulta indisponível"));
  render(<CompanyGuidesTable {...props} />);
  expect(await screen.findByText("Não foi possível conferir as parcelas previstas")).toBeVisible();
  mockReport.mockResolvedValue({ competencia: props.competencia, compliance: { coberturaParcelamentoMes: [] } });
  fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
  await waitFor(() => expect(screen.queryByText("Não foi possível conferir as parcelas previstas")).toBeNull());
});

test('carregamento sem empresa não seleciona nem consulta uma origem ausente', () => {
  const { rerender } = render(<CompanyGuidesTable guides={guides} loadingGuides guiaDeOrigem={null} />);
  expect(screen.queryByRole('button', { name: 'Mostrar todas as guias' })).toBeNull();
  expect(mockReport).not.toHaveBeenCalled();
  expect(mockDueReport).not.toHaveBeenCalled();
  rerender(<CompanyGuidesTable {...props} guiaDeOrigem={null}/>);
  expect(screen.getByText('OUTUBRO')).toBeVisible();
});

test('atalho válido conserva seleção ao recarregar e permite voltar à lista da empresa', async () => {
  const limpar = jest.fn();
  const local = { ...props, guiaDeOrigem: {companyId:'c1',id:'OUTUBRO'}, onLimparGuiaDeOrigem:limpar };
  const {rerender} = render(<CompanyGuidesTable {...local}/>);
  const selected = () => screen.getByRole('checkbox',{name:/Selecionar guia OUTUBRO/});
  await waitFor(()=>expect(selected()).toBeChecked());
  expect(screen.queryByText('SEM-DATA')).toBeNull();
  rerender(<CompanyGuidesTable {...local} loadingGuides/>);
  rerender(<CompanyGuidesTable {...local} guides={[...guides]}/>);
  await waitFor(()=>expect(selected()).toBeChecked());
  fireEvent.click(screen.getByRole('button',{name:'Mostrar todas as guias'}));
  expect(limpar).toHaveBeenCalledTimes(1);
  rerender(<CompanyGuidesTable {...props}/>);
  expect(screen.getByText('SEM-DATA')).toBeVisible();
});

function abrirVencimentos() {
  fireEvent.click(screen.getByText('Outras consultas'));
  fireEvent.click(screen.getByRole('button', {name:'Por vencimento'}));
}
test('consulta explícita por vencimento preserva documentos do mês, anteriores e sem data',async()=>{
  const docs = [guia('DAS-AGO','2026-08','2026-09-20'),guia('PARC-SET','2026-09','2026-09-01'),
    guia('ANTIGA','2026-07','2026-08-01'),guia('PAGA','2026-07','2026-08-01',{paymentStatus:'PAID'}),
    guia('SEM-DATA','2026-08',null)];
  const local={...props,competencia:'2026-08',guides:docs};
  const {rerender} = render(<CompanyGuidesTable {...local}/>);
  abrirVencimentos();
  expect(await screen.findByRole('heading',{name:'Vencimentos de Setembro 2026'})).toBeVisible();
  for(const id of ['DAS-AGO','PARC-SET']) expect(screen.getByText(id)).toBeVisible();
  for(const id of ['PAGA','ANTIGA','SEM-DATA']) expect(screen.queryByText(id)).toBeNull();
  expect(screen.queryByLabelText('Mês de vencimento')).toBeNull();
  expect(screen.queryByRole('combobox',{name:'Exibir'})).toBeNull();
  fireEvent.click(screen.getByRole('checkbox',{name:/Selecionar guia DAS-AGO/}));
  expect(screen.getByRole('checkbox',{name:/Selecionar guia DAS-AGO/})).toBeChecked();
  rerender(<CompanyGuidesTable {...local} competencia="2026-07"/>);
  expect(screen.queryByText('DAS-AGO')).toBeNull();
  expect(screen.getByText('PAGA')).toBeVisible();
  rerender(<CompanyGuidesTable {...local}/>);
  abrirVencimentos();
  expect(screen.getByRole('checkbox',{name:/Selecionar guia DAS-AGO/})).not.toBeChecked();
  fireEvent.click(screen.getByRole('button',{name:'Pendências anteriores (1)'}));
  expect(screen.getByText('ANTIGA')).toBeVisible();
  expect(screen.queryByText('PAGA')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Voltar às guias do mês'}));
  abrirVencimentos();
  fireEvent.click(screen.getByRole('button',{name:/Conferir vencimento/}));
  expect(screen.getByText('SEM-DATA')).toBeVisible();
  expect(screen.queryByText('DAS-AGO')).toBeNull();
  await waitFor(()=>expect(mockDueReport).toHaveBeenCalledWith('c1','2026-09'));
});

test('mês sem documento pode ter previsão no relatório de vencimento, e a falha permite nova leitura',async()=>{
  mockDueReport.mockRejectedValueOnce(Error('Indisponível')).mockResolvedValue({
    outros:[{portalClientId:'c1',faltantes:[{portalClientId:'c1',parcelaId:'p1',acordo:'123',numeroParcela:9,vencimento:'2027-01-20'}]}],
  });
  render(<CompanyGuidesTable {...props} competencia="2026-12" guides={[]}/>);
  await waitFor(()=>expect(mockFechamento).toHaveBeenCalledWith('c1','2026-12'));
  mockFechamento.mockClear();
  abrirVencimentos();
  expect(await screen.findByRole('heading',{name:'Vencimentos de Janeiro 2027'})).toBeVisible();
  expect(await screen.findByText('Não foi possível conferir as parcelas previstas')).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'Tentar novamente'}));
  expect(await screen.findByText('Falta guia de parcelamento')).toBeVisible();
  expect(screen.getByRole('button',{name:'Subir parcela'})).toBeInTheDocument();
  expect(mockDueReport).toHaveBeenLastCalledWith('c1','2027-01');
  expect(screen.queryByText(/Confira essas parcelas na aba Parcelamentos/)).toBeNull();
  expect(mockFechamento).not.toHaveBeenCalled();
});

test.each(['?competencia=2026-10&competencia=2026-11','?competencia=0000-10'])(
  'detalhe real de Guias recusa URL ambígua ou ano inválido antes de carregar documentos: %s',async(search)=>{
    const {CompanyDetailPage} = require('../../../../companies/detail/pages/renderCompanyDetailPage');
    const {WorkspaceNavigation} = require('../../../../../app/navigation/WorkspaceNavigation.shared');
    const onChange=jest.fn();
    render(<WorkspaceNavigation.Provider value={{location:{pathname:'/companies/c1/guides',search},navigate:jest.fn()}}>
      <CompanyDetailPage company={{selectedCompany:{companyId:'c1',razao:'Empresa Fictícia',legacyCompany:{regimeTributario:'SIMPLES'}},
        companyDetailTab:'guides',setCompanyDetailTab:jest.fn()}}
        accountingPanel={{accounts:[],parcelamentos:{},onLoadAccounts:jest.fn()}}
        circularPanel={{competencia:'2026-09',onCompetenciaChange:onChange}}
        guidesPanel={{guides,loading:false}} feedback={{}}/>
    </WorkspaceNavigation.Provider>);
    expect(await screen.findByText(/Competência inválida/)).toBeVisible();
    expect(onChange).not.toHaveBeenCalled();
    expect(mockReport).not.toHaveBeenCalled();
    expect(mockDueReport).not.toHaveBeenCalled();
    expect(screen.queryByText('OUTUBRO')).toBeNull();
  }
);