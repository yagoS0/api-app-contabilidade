import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AppShell } from "../AppShell";
import { api } from "../../../api";

jest.mock("../../notas/NotasPage", () => ({ NotasPage: ({ aoEmitir }) => <button onClick={aoEmitir}>Abrir emissão teste</button> }));
jest.mock("../../emitir/EmitirNotaPage", () => ({ EmitirNotaPage: ({ empresa, aoMudarEnvio, aoVoltarParaNotas }) => {
  const [resultado, setResultado] = require("react").useState(false);
  return <section><p>Emissor {empresa.companyId}</p><button onClick={() => aoMudarEnvio(true)}>Enviar teste</button><button onClick={() => { setResultado(true); aoMudarEnvio(false); }}>Concluir teste</button><button onClick={aoVoltarParaNotas}>Voltar teste</button>{resultado && <p>Desfecho preservado</p>}</section>;
} }));

beforeEach(() => {
  window.localStorage.clear(); window.location.hash = "#/notas";
  jest.spyOn(api, "getCompanies").mockResolvedValue([{ companyId: "A", razao: "Empresa A" }, { companyId: "B", razao: "Empresa B" }]);
});
afterEach(() => { jest.restoreAllMocks(); window.location.hash = ""; });

test("menu, empresa e voltar do navegador preservam o emissor até seu resultado", async () => {
  render(<AppShell user={{ defaultClientId: "A" }} />);
  fireEvent.click(await screen.findByRole("button", { name: "Abrir emissão teste" }));
  fireEvent.click(screen.getByRole("button", { name: "Enviar teste" }));
  expect(screen.getByRole("button", { name: "Trocar empresa" })).toBeDisabled();
  fireEvent.click(screen.getByRole("link", { name: "Guias" }));
  fireEvent.click(screen.getByRole("button", { name: "Voltar teste" }));
  expect(screen.getByText("Emissor A")).toBeInTheDocument();
  await act(async () => { window.location.hash = "#/home"; window.dispatchEvent(new HashChangeEvent("hashchange")); });
  await waitFor(() => expect(window.location.hash).toBe("#/notas"));
  expect(screen.getByText("Emissor A")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Concluir teste" }));
  expect(screen.getByText("Desfecho preservado")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Trocar empresa" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Voltar teste" }));
  expect(screen.getByRole("button", { name: "Abrir emissão teste" })).toBeInTheDocument();
});
