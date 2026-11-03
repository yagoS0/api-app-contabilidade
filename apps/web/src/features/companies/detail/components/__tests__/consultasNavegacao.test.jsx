import { useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CompanyDetailPage } from "../../pages/renderCompanyDetailPage";
import { CompanySectionHeader } from "../renderCompanyDetailHeader";
import { companyTabPath, SEGMENT_TO_TAB } from "../../lib/rotasDaEmpresa";
import { useManageAccountingWorkspace } from "../../../../../app/hooks/useManageAccountingWorkspace";
jest.mock("../../../../accounting/hooks/useAvisosContabeis", () => ({ useAvisosContabeis: () => ({ dados: { total: 0 } }) }));
jest.mock("../../../../tasks/TaskCenterPlacement", () => ({ TaskCenterSlot: () => null }));
jest.mock("../../../../accounting/entries/components/renderAccountingEntriesTab", () => ({ AccountingEntriesTab: () => <p>Lista contabil</p> }));
jest.mock("../../../../accounting/circular/components/renderCircularTab", () => ({ CircularTab: () => <p>Matriz circular</p> }));
test("empresa nao oferece menu nem rota de Consultas", () => {
 render(<CompanySectionHeader company={{companyId:"c"}} activeTab="anotacoes" onTabChange={jest.fn()}/>);
 expect(screen.queryByRole("link",{name:"Consultas"})).not.toBeInTheDocument();
 expect(companyTabPath("c","consultas")).toBe("");
 expect(SEGMENT_TO_TAB.consultas).toBeUndefined();
});

test("pagina real preserva feedback e recarrega Circular e Lancamentos ao retornar", async () => {
 const api={getChartOfAccounts:jest.fn(async()=>[]),getAccountingEntries:jest.fn(async()=>({data:[],total:0})),getCircular:jest.fn(async()=>({provisoes:[],receitas:{},extrato:{}})),getCircularAccountingEntries:jest.fn(async()=>({entries:[]}))};
 function Tela(){
  const [aba,setAba]=useState("lancamentos");
  const a=useManageAccountingWorkspace({api,page:"companyDetail",selectedCompanyId:"c",companyDetailTab:aba});
  return <CompanyDetailPage company={{selectedCompany:{companyId:"c",razao:"Empresa",legacyCompany:{regimeTributario:"SIMPLES"}},companyDetailTab:aba,setCompanyDetailTab:setAba}} accountingPanel={{accounts:[],onLoadAccounts:()=>a.loadChartOfAccounts("c"),onLoadEntries:()=>a.loadAccountingEntries("c")}} circularPanel={{competencia:a.circularCompetencia}} feedback={{error:"Pendencia global preservada"}}/>;
 }
 render(<Tela/>);
 expect(await screen.findByText("Lista contabil")).toBeVisible();
 expect(screen.getByText("Pendencia global preservada")).toBeVisible();
 await waitFor(()=>expect(api.getAccountingEntries).toHaveBeenCalled());
 fireEvent.click(screen.getByRole("link",{name:"Circular"}));
 expect(await screen.findByText("Matriz circular")).toBeVisible();
 await waitFor(()=>expect(api.getCircular).toHaveBeenCalledTimes(1));
 const chamadas=api.getAccountingEntries.mock.calls.length;
 fireEvent.click(screen.getByRole("link",{name:"Lançamentos"}));
 await waitFor(()=>expect(api.getAccountingEntries.mock.calls.length).toBeGreaterThan(chamadas));
 fireEvent.click(screen.getByRole("link",{name:"Circular"}));
 await waitFor(()=>expect(api.getCircular).toHaveBeenCalledTimes(2));
});
