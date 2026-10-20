import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { OfficeNavigation } from "../../../../app/navigation/OfficeNavigation";
jest.mock("../../../tasks/TaskCenterPlacement", () => ({ TaskCenterSlot: () => null }));
jest.mock("../../../../app/navigation/WorkspaceNavigation", () => ({ WorkspaceHomeLink: () => null }));
function Local() { return <output data-testid="rota">{useLocation().pathname}</output>; }
test("Comercial aponta para raiz, aguarda salvar e fica na ficha se salvar falha", async () => {
  const salvar = jest.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({});
  const proteger = e => e.detail.push(salvar);
  window.addEventListener("altan:onboarding-antes-de-navegar", proteger);
  try {
    render(<MemoryRouter initialEntries={["/onboardings/o"]}><OfficeNavigation /><Local /></MemoryRouter>);
    const link = screen.getByRole("link", { name: /^Comercial/ });
    expect(link).toHaveAttribute("href", "/comercial");
    fireEvent.click(link);
    await waitFor(() => expect(salvar).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("rota")).toHaveTextContent("/onboardings/o");
    fireEvent.click(link);
    await waitFor(() => expect(screen.getByTestId("rota")).toHaveTextContent("/comercial"));
  } finally { window.removeEventListener("altan:onboarding-antes-de-navegar", proteger); }
});
