import { render, screen } from "@testing-library/react";
import { CompanySectionHeader } from "../renderCompanyDetailHeader";
jest.mock("../../../../accounting/hooks/useAvisosContabeis", () => ({ useAvisosContabeis: () => ({ dados: { total: 2 } }) }));
jest.mock("../../../../tasks/TaskCenterPlacement", () => ({ TaskCenterSlot: () => null }));
test("mesma contagem é visível nas duas abas", () => {
 render(<CompanySectionHeader company={{ companyId: "A", razao: "Empresa" }} activeTab="lancamentos" competencia="2026-09" onBack={() => {}} onTabChange={() => {}} />);
 expect(screen.getByText("Contabilidade · 2 avisos")).toBeInTheDocument(); expect(screen.getByText("Lançamentos · 2 avisos")).toBeInTheDocument();
});
