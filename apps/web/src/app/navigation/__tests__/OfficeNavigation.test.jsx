import { Request } from 'node-fetch/lib/index.js';
import { act, fireEvent, cleanup, render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router-dom";
import { OfficeNavigation } from "../OfficeNavigation";
import { WorkspaceNavigationProvider } from "../WorkspaceNavigation";
import { useWorkspaceNavigation } from "../WorkspaceNavigation.shared";

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
  return mountRouter(
    <WorkspaceNavigationProvider><OfficeNavigation resumoWhatsapp={resumoWhatsapp} /><Context /></WorkspaceNavigationProvider>
  , [route]);
}

test('Solicitações pertence a Suporte sem quinta área e conserva filtro no destino ativo', () => {
  setup('/solicitacoes?prioridade=null');
  const areas = screen.getByRole('navigation', { name: 'Áreas do escritório' });
  expect(within(areas).getAllByRole('link')).toHaveLength(4);
  expect(within(areas).getByRole('link', { name: 'Suporte' })).toHaveAttribute('aria-current', 'location');
  fireEvent.click(screen.getByRole('button', { name: 'Navegar' }));
  const destinos = screen.getByRole('navigation', { name: 'Navegação de Suporte' });
  expect(within(destinos).getByRole('link', { name: 'Solicitações' })).toHaveAttribute('aria-current', 'page');
  expect(within(destinos).getByRole('link', { name: 'Solicitações' })).toHaveAttribute('href', '/solicitacoes');
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.getByRole('button', { name: 'Navegar' })).toHaveFocus();
});

test('suporte mantém aviso humano mesmo sem mensagens não lidas', () => {
  setup('/suporte', { selo: null, pendenciasSuporte: 2 });
  expect(screen.getAllByLabelText('2 atendimentos precisam da equipe').length).toBeGreaterThan(0);
  expect(screen.queryByLabelText(/mensagens não lidas no WhatsApp/)).toBeNull();
});

test.each([
  ["/download-notas", "Operação", "Consultas"],
  ["/onboardings/abc/editar", "Comercial", "Onboarding"],
  ["/whatsapp/comunicados", "Suporte", "Comunicados"],
  ["/whatsapp/", "Suporte", "Atendimento"],
  ["/guides/batch-email", "Suporte", "Pendências de e-mail"],
  ["/guides/pending", "Suporte", "Pendências de e-mail"],
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
  setup("/companies");
  fireEvent.click(screen.getByText("Escolher tabela"));
  fireEvent.click(screen.getByRole("link", { name: "Suporte" }));
  expect(screen.getByLabelText("rota")).toHaveTextContent("/suporte");
  fireEvent.click(screen.getByRole("button", { name: "Navegar" }));
  expect(screen.queryByRole("link", { name: "Onboarding" })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Pendências de e-mail" })).toHaveAttribute("href", "/guides/pending");
  fireEvent.click(screen.getByText("Voltar no escritório"));
  expect(screen.getByLabelText("rota")).toHaveTextContent("/companies");
  fireEvent.click(screen.getByRole("button", { name: "Navegar" }));
  fireEvent.click(screen.getByRole("link", { name: "Empresas" }));
  expect(screen.getByLabelText("rota").textContent).toBe("/companies");
  expect(screen.getByLabelText("visão")).toHaveTextContent("tabela");
});

test.each(["/companies", "/whatsapp"])("mensagens não lidas continuam acessíveis em %s sem repetir o contador", (route) => {
  setup(route, { selo: 3, frase: "3 mensagens não lidas · 0 números sem empresa" });
  expect(screen.getAllByLabelText("3 mensagens não lidas no WhatsApp")).toHaveLength(1);
  expect(screen.getByRole("link", { name: /3 mensagens não lidas no WhatsApp/ })).toHaveAttribute("href", route === '/whatsapp' ? '/whatsapp' : '/suporte');
});

test("a área atual preserva a empresa, competência e âncora", () => {
  setup("/companies#conferencia");
  const currentArea = screen.getByRole("link", { name: "Operação" });
  expect(currentArea).toHaveAttribute("href", "/companies#conferencia");
  fireEvent.click(currentArea);
  expect(screen.getByLabelText("rota")).toHaveTextContent("/companies#conferencia");
});

test("links modificados não são interceptados pela navegação interna", () => {
  setup();
  fireEvent.click(screen.getByRole("link", { name: "Suporte" }), { ctrlKey: true });
  expect(screen.getByLabelText("rota").textContent).toBe("/companies");
});

test("página principal recolhe destinos globais, abre pelo teclado e devolve o foco ao fechar", () => {
  setup("/companies");
  const trigger = screen.getByRole("button", { name: "Navegar" });
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("navigation", { name: "Navegação de Operação" })).not.toBeInTheDocument();
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("link", { name: "Empresas" })).toHaveFocus();
  fireEvent.keyDown(document.activeElement, { key: "Escape" });
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  expect(trigger).toHaveFocus();
});

test("menu fecha ao clicar ou mover foco para fora e ao navegar para outra área", () => {
  setup("/companies");
  const trigger = screen.getByRole("button", { name: "Navegar" });
  fireEvent.click(trigger);
  fireEvent.pointerDown(document.body);
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(trigger);
  act(() => screen.getByRole("button", { name: "Escolher tabela" }).focus());
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole("link", { name: "Suporte" }));
  fireEvent.click(screen.getByRole("button", { name: "Voltar no escritório" }));
  expect(screen.getByRole("button", { name: "Navegar" })).toHaveAttribute("aria-expanded", "false");
});

test("destinos recolhidos continuam sendo links reais e preservam Ctrl+clique", () => {
  setup("/companies");
  fireEvent.click(screen.getByRole("button", { name: "Navegar" }));
  const destination = screen.getByRole("link", { name: "Consultas" });
  expect(destination).toHaveAttribute("href", "/funcoes-serpro");
  fireEvent.click(destination, { ctrlKey: true });
  expect(screen.getByLabelText("rota").textContent).toBe("/companies");
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

 test("Operação não oferece Guias não identificadas", () => {
  setup();
  if (screen.queryByRole("button", { name: "Navegar" })) fireEvent.click(screen.getByRole("button", { name: "Navegar" }));
  expect(screen.queryByRole("link", { name: "Guias não identificadas" })).not.toBeInTheDocument();
  expect(document.querySelector('a[href="/guides/upload"]')).toBeNull();
});

 test.each(["/companies/123", "/companies/123/lancamentos", "/companies/123/circular", "/companies/123/ajustes"])("empresa não exibe faixa global: %s", (route) => {
  setup(route);
  expect(screen.queryByRole("link", { name: "Altan — página principal" })).not.toBeInTheDocument();
  expect(screen.queryByRole("navigation", { name: "Áreas do escritório" })).not.toBeInTheDocument();
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
function LegacyMetaLocation(){const location=useLocation();return <><output aria-label="rota legado Meta">{location.pathname}</output><input aria-label="rascunho legado Meta" defaultValue="preservar"/></>;}
async function withOfficePlatformFixture(platform,run){
 const descriptor=Object.getOwnPropertyDescriptor(navigator,'userAgentData');
 Object.defineProperty(navigator,'userAgentData',{configurable:true,value:{platform}});
 try{await run();}finally{cleanup();if(descriptor)Object.defineProperty(navigator,'userAgentData',descriptor);else delete navigator.userAgentData;}
}
test.each(['Windows','Linux','Unknown'].flatMap(platform=>[true,false].map(success=>[platform,success])))('legacy OfficeNavigation protects Meta on %s until save success=%s',async(platform,success)=>{
 await withOfficePlatformFixture(platform,async()=>{
  let resolve,reject;const save=jest.fn(()=>new Promise((done,fail)=>{resolve=done;reject=fail;}));
  const pending=event=>event.detail.push(save);window.addEventListener('altan:onboarding-antes-de-navegar',pending);
  try{
   mountRouter(<><OfficeNavigation/><LegacyMetaLocation/></>,['/onboardings/qa/editar']);
   fireEvent.click(screen.getByRole('link',{name:'Suporte'}),{metaKey:true});
   expect(save).toHaveBeenCalledTimes(1);expect(screen.getByLabelText('rota legado Meta')).toHaveTextContent('/onboardings/qa/editar');
   expect(screen.getByLabelText('rascunho legado Meta')).toHaveValue('preservar');
   await act(async()=>{if(success)resolve();else reject(new Error('Não confirmado'));});
   expect(screen.getByLabelText('rota legado Meta').textContent).toBe(success?'/suporte':'/onboardings/qa/editar');
   expect(save).toHaveBeenCalledTimes(1);expect(screen.getByLabelText('rascunho legado Meta')).toHaveValue('preservar');
  }finally{window.removeEventListener('altan:onboarding-antes-de-navegar',pending);}
 });
});
test.each([['macOS',{metaKey:true}],['Windows',{ctrlKey:true}],['Windows',{metaKey:true,shiftKey:true}]])('legacy OfficeNavigation leaves native modifiers to %s',async(platform,event)=>{
 await withOfficePlatformFixture(platform,async()=>{
  const pending=jest.fn(),observed=[];window.addEventListener('altan:onboarding-antes-de-navegar',pending);
  const suppressJsdomDefault=e=>{observed.push(e.defaultPrevented);e.preventDefault();};document.addEventListener('click',suppressJsdomDefault);
  try{mountRouter(<><OfficeNavigation/><LegacyMetaLocation/></>,['/onboardings/qa/editar']);fireEvent.click(screen.getByRole('link',{name:'Suporte'}),event);expect(observed).toEqual([false]);expect(pending).not.toHaveBeenCalled();expect(screen.getByLabelText('rota legado Meta')).toHaveTextContent('/onboardings/qa/editar');}
  finally{window.removeEventListener('altan:onboarding-antes-de-navegar',pending);document.removeEventListener('click',suppressJsdomDefault);}
 });
});