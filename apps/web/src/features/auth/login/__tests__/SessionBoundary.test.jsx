import { StrictMode, useEffect } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { SessionBoundary } from "../SessionBoundary";

const key = "portal_firm_access_token";
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function PrivateWorkspace({ session, load }) {
  useEffect(() => { load(); }, [load]);
  return <><p>Calendário privado</p><button onClick={session.clearSession}>Sair</button></>;
}
function Navigation() {
  const location = useLocation();
  const navigate = useNavigate();
  return <><span aria-label="rota">{location.pathname}</span><button onClick={() => navigate("/companies")}>Link privado</button></>;
}
function setup({ path = "/", stored = "", me = jest.fn(), strict = false } = {}) {
  if (stored) localStorage.setItem(key, stored);
  const api = { mode: "real", me, setAccessToken: jest.fn(), clearSession: jest.fn(), login: jest.fn(), getAccessToken: jest.fn(), getResumoWhatsapp: jest.fn().mockResolvedValue({ ok: false }) };
  const load = jest.fn();
  const children = jest.fn(session => <PrivateWorkspace session={session} load={load} />);
  const app = <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Navigation /><SessionBoundary api={api} tokenStorageKey={key}>{children}</SessionBoundary></MemoryRouter>;
  const view = render(strict ? <StrictMode>{app}</StrictMode> : app);
  return { api, load, children, ...view };
}
beforeEach(() => localStorage.clear());

test.each(["/", "/login", "/companies", "/companies/empresa/anotacoes"])("sem sessão, %s nunca monta área privada", path => {
  const { api, children, load } = setup({ path });
  expect(screen.getByRole("button", { name: "Entrar" })).toBeVisible();
  expect(children).not.toHaveBeenCalled();
  expect(load).not.toHaveBeenCalled();
  expect(api.me).not.toHaveBeenCalled();
  expect(api.getResumoWhatsapp).not.toHaveBeenCalled();
  expect(screen.queryByRole("navigation", { name: "Áreas do escritório" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Link privado" }));
  expect(children).not.toHaveBeenCalled();
});

test("token salvo só libera a área após validação; logout desmonta e bloqueia retorno", async () => {
  const request = deferred();
  const { children, load, api } = setup({ stored: "token", me: jest.fn(() => request.promise) });
  expect(screen.getByRole("status")).toHaveTextContent("Verificando sessão");
  expect(children).not.toHaveBeenCalled();
  expect(load).not.toHaveBeenCalled();
  expect(api.getResumoWhatsapp).not.toHaveBeenCalled();
  expect(screen.queryByRole("navigation", { name: "Áreas do escritório" })).not.toBeInTheDocument();
  await act(async () => request.resolve({ id: "contador", accountType: "FIRM" }));
  expect(screen.getByText("Calendário privado")).toBeVisible();
  expect(load).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("navigation", { name: "Áreas do escritório" })).toBeVisible();
  expect(api.getResumoWhatsapp).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Sair" }));
  fireEvent.click(screen.getByRole("button", { name: "Link privado" }));
  expect(screen.queryByText("Calendário privado")).not.toBeInTheDocument();
  expect(load).toHaveBeenCalledTimes(1);
  expect(localStorage.getItem(key)).toBeNull();
  expect(screen.queryByRole("navigation", { name: "Áreas do escritório" })).not.toBeInTheDocument();
});

test("sessão expirada vai ao login sem montar nem consultar o calendário", async () => {
  const request = deferred();
  const { children, api } = setup({ stored: "expired", path: "/companies", me: jest.fn(() => request.promise) });
  await act(async () => request.reject(new Error("401")));
  expect(screen.getByRole("button", { name: "Entrar" })).toBeVisible();
  expect(children).not.toHaveBeenCalled();
  expect(api.clearSession).toHaveBeenCalled();
  expect(localStorage.getItem(key)).toBeNull();
});

test("sessão válida preserva link profundo", async () => {
  setup({ stored: "token", path: "/companies/empresa/anotacoes", me: jest.fn().mockResolvedValue({ id: "contador" }) });
  await screen.findByText("Calendário privado");
  expect(screen.getByLabelText("rota")).toHaveTextContent("/companies/empresa/anotacoes");
});

test("StrictMode ignora validação antiga que falha depois da sessão atual", async () => {
  const old = deferred(), current = deferred();
  setup({ stored: "token", strict: true, me: jest.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise) });
  await act(async () => current.resolve({ id: "contador" }));
  await screen.findByText("Calendário privado");
  await act(async () => old.reject(new Error("validação antiga")));
  expect(screen.getByText("Calendário privado")).toBeVisible();
  expect(localStorage.getItem(key)).toBe("token");
});

test("login só monta área privada após confirmar o usuário", async () => {
  const request = deferred();
  const { api, children } = setup({ path: "/login", me: jest.fn(() => request.promise) });
  api.login.mockResolvedValue({ accessToken: "new-token" });
  fireEvent.change(screen.getByLabelText("E-mail ou usuário"), { target: { value: "contador" } });
  fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "senha-teste" } });
  fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
  await waitFor(() => expect(api.me).toHaveBeenCalled());
  expect(children).not.toHaveBeenCalled();
  await act(async () => request.resolve({ id: "contador" }));
  expect(screen.getByText("Calendário privado")).toBeVisible();
});
