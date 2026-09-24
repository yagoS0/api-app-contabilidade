import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { OfficeNavigation } from "../OfficeNavigation";
import { WorkspaceNavigationProvider, useWorkspaceNavigation } from "../WorkspaceNavigation";

function Context() {
  const location = useLocation();
  const workspace = useWorkspaceNavigation();
  return <>
    <output aria-label="rota">{location.pathname}{location.search}{location.hash}</output>
    <output aria-label="visão">{workspace.modoVisao}</output>
    <button onClick={() => workspace.setModoVisao("tabela")}>Escolher tabela</button>
    <button onClick={() => workspace.goBack()}>Voltar no escritório</button>
  </>;
}

function setup(route = "/companies", resumoWhatsapp = null) {
  return render(<MemoryRouter initialEntries={[route]}>
    <WorkspaceNavigationProvider><OfficeNavigation resumoWhatsapp={resumoWhatsapp} /><Context /></WorkspaceNavigationProvider>
  </MemoryRouter>);
}

test.each([
  ["/companies/123/notas?competencia=2026-09", "Operação", "Empresas e agenda"],
  ["/guides/upload", "Operação", "Guias não identificadas"],
  ["/download-notas", "Operação", "Consultas"],
  ["/onboardings/abc/editar", "Relacionamento", "Entrada de clientes"],
  ["/whatsapp/comunicados", "Relacionamento", "Comunicados"],
  ["/whatsapp/", "Relacionamento", "Atendimento"],
  ["/guides/batch-email", "Relacionamento", "Pendências de e-mail"],
  ["/guides/pending", "Relacionamento", "Pendências de e-mail"],
  ["/firm-settings/guides", "Gestão", "Configurações"],
  ["/configuracoes/atendimento", "Gestão", "Configurações"],
])("reconhece %s sem destacar dois destinos", (route, area, destination) => {
  setup(route);
  expect(screen.getByRole("link", { name: area })).toHaveAttribute("aria-current", "location");
  if (screen.queryByRole("button", { name: "Navegar" })) fireEvent.click(screen.getByRole("button", { name: "Navegar" }));
  const nav = screen.getByRole("navigation", { name: `Navegação de ${area}` });
  expect(within(nav).getByRole("link", { name: destination })).toHaveAttribute("aria-current", "page");
  expect(within(nav).getAllByRole("link").filter((link) => link.hasAttribute("aria-current"))).toHaveLength(1);
});

test("destinos são links reais e a mudança de área mantém o histórico e a visão da carteira", () => {
  setup("/companies/123/notas?competencia=2026-09");
  fireEvent.click(screen.getByText("Escolher tabela"));
  fireEvent.click(screen.getByRole("link", { name: "Relacionamento" }));
  expect(screen.getByLabelText("rota")).toHaveTextContent("/whatsapp");
  fireEvent.click(screen.getByRole("button", { name: "Navegar" }));
  expect(screen.getByRole("link", { name: "Entrada de clientes" })).toHaveAttribute("href", "/onboardings");
  expect(screen.getByRole("link", { name: "Pendências de e-mail" })).toHaveAttribute("href", "/guides/pending");
  fireEvent.click(screen.getByText("Voltar no escritório"));
  expect(screen.getByLabelText("rota")).toHaveTextContent("/companies/123/notas?competencia=2026-09");
  fireEvent.click(screen.getByRole("button", { name: "Navegar" }));
  fireEvent.click(screen.getByRole("link", { name: "Empresas e agenda" }));
  expect(screen.getByLabelText("rota").textContent).toBe("/companies");
  expect(screen.getByLabelText("visão")).toHaveTextContent("tabela");
});

test.each(["/companies", "/whatsapp"])("mensagens não lidas continuam acessíveis em %s sem repetir o contador", (route) => {
  setup(route, { selo: 3, frase: "3 mensagens não lidas · 0 números sem empresa" });
  expect(screen.getAllByLabelText("3 mensagens não lidas no WhatsApp")).toHaveLength(1);
  expect(screen.getByRole("link", { name: /3 mensagens não lidas no WhatsApp/ })).toHaveAttribute("href", "/whatsapp");
});

test("a área atual preserva a empresa, competência e âncora", () => {
  setup("/companies/123/notas?competencia=2026-09#conferencia");
  const currentArea = screen.getByRole("link", { name: "Operação" });
  expect(currentArea).toHaveAttribute("href", "/companies/123/notas?competencia=2026-09#conferencia");
  fireEvent.click(currentArea);
  expect(screen.getByLabelText("rota")).toHaveTextContent("/companies/123/notas?competencia=2026-09#conferencia");
});

test("links modificados não são interceptados pela navegação interna", () => {
  setup();
  fireEvent.click(screen.getByRole("link", { name: "Relacionamento" }), { ctrlKey: true });
  expect(screen.getByLabelText("rota").textContent).toBe("/companies");
});

test("empresa recolhe destinos globais, abre pelo teclado e devolve o foco ao fechar", () => {
  setup("/companies/123/documentos");
  const trigger = screen.getByRole("button", { name: "Navegar" });
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("navigation", { name: "Navegação de Operação" })).not.toBeInTheDocument();
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("link", { name: "Empresas e agenda" })).toHaveFocus();
  fireEvent.keyDown(document.activeElement, { key: "Escape" });
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  expect(trigger).toHaveFocus();
});

test("menu fecha ao clicar ou mover foco para fora e ao navegar para outra área", () => {
  setup("/companies/123/documentos");
  const trigger = screen.getByRole("button", { name: "Navegar" });
  fireEvent.click(trigger);
  fireEvent.pointerDown(document.body);
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(trigger);
  act(() => screen.getByRole("button", { name: "Escolher tabela" }).focus());
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole("link", { name: "Relacionamento" }));
  fireEvent.click(screen.getByRole("button", { name: "Voltar no escritório" }));
  expect(screen.getByRole("button", { name: "Navegar" })).toHaveAttribute("aria-expanded", "false");
});

test("destinos recolhidos continuam sendo links reais e preservam Ctrl+clique", () => {
  setup("/companies/123/documentos");
  fireEvent.click(screen.getByRole("button", { name: "Navegar" }));
  const destination = screen.getByRole("link", { name: "Consultas" });
  expect(destination).toHaveAttribute("href", "/funcoes-serpro");
  fireEvent.click(destination, { ctrlKey: true });
  expect(screen.getByLabelText("rota").textContent).toBe("/companies/123/documentos");
  fireEvent.click(destination);
  expect(screen.getByLabelText("rota").textContent).toBe("/funcoes-serpro");
});

test.each(["/companies", "/companies/new", "/apuracao"])("tela principal recolhe os destinos no menu em %s", (route) => {
  setup(route);
  expect(screen.queryByRole("navigation", { name: "Navegação de Operação" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Navegar" }));
  expect(screen.getByRole("navigation", { name: "Navegação de Operação" })).toBeVisible();
});

test.each(["/login", "/onboarding/publico", "/proposta/publica"])("não cria navegação nas rotas públicas: %s", (route) => {
  setup(route);
  expect(screen.queryByRole("navigation", { name: "Áreas do escritório" })).not.toBeInTheDocument();
});
