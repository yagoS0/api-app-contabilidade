import { fireEvent, render, screen } from "@testing-library/react";
import { CompanySectionHeader } from "../renderCompanyDetailHeader";
import { CompanyDetailPage, PlanoContasAviso } from "../../pages/renderCompanyDetailPage";
jest.mock("../../../../accounting/hooks/useAvisosContabeis", () => ({ useAvisosContabeis: () => ({ dados: { total: 2 } }) }));
jest.mock("../../../../tasks/TaskCenterPlacement", () => ({ TaskCenterSlot: () => null }));
jest.mock("../../../../accounting/parcelamento/pages/renderParcelamentoTab", () => ({ ParcelamentoTab: () => <p>Contratos preservados</p> }));
jest.mock("../../../../guides/list/components/renderCompanyGuidesTable", () => ({ CompanyGuidesTable: () => <p>Guias preservadas</p> }));
jest.mock("../../../../accounting/entries/components/renderAccountingEntriesTab", () => ({ AccountingEntriesTab: ({ error }) => <p role="alert">{error}</p> }));
jest.mock("../../../../accounting/circular/components/renderCircularTab", () => ({ CircularTab: ({ error }) => <p role="alert">{error}</p> }));

test('slot do plano permanece montado em repouso, carga e recuperação sem esconder erro', () => {
 const { container, rerender } = render(<PlanoContasAviso />);
 const slot = container.querySelector('[data-chart-loading-slot]');
 expect(slot).toHaveStyle({ minHeight: '40px', boxSizing: 'border-box' });
 const reservado = slot.firstElementChild;
 expect(reservado).toHaveStyle({ height: '24px', lineHeight: '24px' });
 rerender(<PlanoContasAviso panel={{ accountsLoading: true }} />);
 expect(screen.getByRole('status')).toHaveTextContent('Atualizando plano de contas');
 expect(slot.firstElementChild).toBe(reservado);
 rerender(<PlanoContasAviso panel={{ accountsError: 'Leitura inválida' }} />);
 expect(screen.getByRole('alert')).toHaveTextContent('Leitura inválida');
 expect(screen.getByRole('button', { name: 'Atualizar plano de contas' })).toBeEnabled();
 rerender(<PlanoContasAviso />);
 expect(container.querySelector('[data-chart-loading-slot]')).toBe(slot);
 expect(slot.firstElementChild).toBe(reservado);
});
test("mesma contagem é visível nas duas abas", () => {
 render(<CompanySectionHeader company={{ companyId: "A", razao: "Empresa" }} activeTab="lancamentos" competencia="2026-09" onBack={() => {}} onTabChange={() => {}} />);
 expect(screen.getByText("Contabilidade · 2 avisos")).toBeInTheDocument(); expect(screen.getByText("Lançamentos · 2 avisos")).toBeInTheDocument();
});

test.each(['planoContas', 'parcelamento', 'guides', 'lancamentos', 'circular'])('falha do plano chega ao consumidor %s e permite releitura', async aba => {
 const retry = jest.fn();
 const props = {
   company: { selectedCompany: { companyId:'c1', razao:'Empresa teste', legacyCompany:{ regimeTributario:'SIMPLES' } }, companyDetailTab:aba, setCompanyDetailTab:jest.fn() },
   accountingPanel: { accounts:[], accountsLoading:false, accountsError:'Plano indisponível', error:'Plano indisponível', onLoadAccounts:retry, parcelamentos:{} },
   circularPanel: { competencia:'2026-09', error:'Plano indisponível' },
   guidesPanel: { guides:[], loading:false }, feedback:{},
 };
 const { rerender } = render(<CompanyDetailPage {...props}/>);
 expect(await screen.findByText('Plano indisponível')).toBeVisible();
 fireEvent.click(screen.getByRole('button', { name:aba === 'planoContas' ? 'Tentar novamente' : 'Atualizar plano de contas' }));
 expect(retry).toHaveBeenCalledTimes(1);
 expect(screen.queryByText(/Nenhuma conta cadastrada/)).not.toBeInTheDocument();
 rerender(<CompanyDetailPage {...props} accountingPanel={{...props.accountingPanel, accountsLoading:true}}/>);
 expect(await screen.findByRole('status')).toHaveTextContent(/plano de contas/);
 expect(screen.getByRole('button', { name:aba === 'planoContas' ? 'Tentar novamente' : 'Atualizar plano de contas' })).toBeDisabled();
});
