// Empresas abre diretamente na lista, sem calendário.
import { render, screen, fireEvent, within } from "@testing-library/react";
import { CompaniesHomePage } from "../renderCompaniesHomePage.jsx";

const CARTEIRA = [
  { companyId: "c1", razao: "ALFA SIMPLES LTDA", cnpj: "11111111000111", legacyCompany: { regimeTributario: "SIMPLES" } },
  { companyId: "c2", razao: "BETA PRESUMIDO SA", cnpj: "22222222000122", legacyCompany: { regimeTributario: "LUCRO_PRESUMIDO" } },
];

function api() {
  return { getCalendario: jest.fn(), getTarefasAgenda: jest.fn() };
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

describe("ferramentas acompanham o contexto da tela inicial", () => {
  test("lista abre com ações de empresa e competência", () => {
    const onChangeCompetencia = jest.fn();
    const onRefreshCompanies = jest.fn();
    const clienteApi = api();
    montar({ onChangeCompetencia, onRefreshCompanies, api: clienteApi });
    expect(clienteApi.getCalendario).not.toHaveBeenCalled();
    expect(clienteApi.getTarefasAgenda).not.toHaveBeenCalled();
    expect(screen.queryByRole("group", { name: "Visão da carteira" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Visualização do calendário")).not.toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: /Nova empresa/ }));
    expect(onCreateCompany).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveFocus();
  });
});
