import { Request } from 'node-fetch/lib/index.js';
// jsdom lacks Request; installed WHATWG implementation, no navigation mock or network fetch.
const requestBeforeSuite = globalThis.Request;
beforeAll(() => { globalThis.Request = Request; });
afterAll(() => { globalThis.Request = requestBeforeSuite; });
import { useEdicaoPendente } from '../../../features/configuracoes/ProtecaoEdicao.shared';
import { act, waitFor, fireEvent, cleanup, render, screen } from "@testing-library/react";
import { StrictMode, useEffect, useRef, useState } from "react";
import { createMemoryRouter, RouterProvider, useLocation, useNavigate } from "react-router-dom";
import { WorkspaceNavigationProvider, WorkspaceHomeLink } from "../WorkspaceNavigation";
import { useWorkspaceEditor, useWorkspaceNavigation } from "../WorkspaceNavigation.shared";

function Screen() {
  const nav = useWorkspaceNavigation();
  const navigate = useNavigate();
  const location = useLocation();
  return <>
    {location.pathname.startsWith('/companies/123/') && <WorkspaceHomeLink />}
    <output aria-label="rota">{location.pathname}{location.search}</output>
    <output aria-label="visão">{nav.modoVisao}</output>
    <button onClick={() => nav.setModoVisao("tabela")}>Tabela</button>
    <button onClick={() => navigate("/companies/123/notas?competencia=2026-09")}>Notas</button>
    <button onClick={() => navigate("/planejamento")}>Planejamento</button>
    <button onClick={() => nav.goBack()}>Voltar</button>
    <button onClick={() => { nav.resetSession(); navigate("/companies", { replace: true }); }}>Novo login</button>
  </>;
}
function setup(route = "/companies") {
  return mountRouter(<WorkspaceNavigationProvider><Screen /></WorkspaceNavigationProvider>, [route]);
}

test('link direto de Operações mantém a visão sem desmontar a navegação', () => {
  setup('/companies?visao=operacoes');
  expect(screen.getByLabelText('visão')).toHaveTextContent('operacoes');
  fireEvent.click(screen.getByText('Notas'));
  fireEvent.click(screen.getByText('Voltar'));
  expect(screen.getByLabelText('visão')).toHaveTextContent('operacoes');
});

test('entrar e sair de empresas conserva a sessão montada e o trabalho em memória', () => {
  const montar = jest.fn(), desmontar = jest.fn();
  function Sessao() {
    const [valor, setValor] = useState('');
    useEffect(() => { montar(); return desmontar; }, []);
    return <><Screen/><input aria-label="Trabalho em andamento" value={valor} onChange={e => setValor(e.target.value)}/></>;
  }
  mountRouter(<WorkspaceNavigationProvider><Sessao/></WorkspaceNavigationProvider>, ['/companies']);
  fireEvent.change(screen.getByLabelText('Trabalho em andamento'), { target: { value: 'preservar' } });
  for (const nome of ['Notas', 'Planejamento', 'Voltar', 'Voltar', 'Notas']) {
    fireEvent.click(screen.getByText(nome));
    expect(screen.getByLabelText('Trabalho em andamento')).toHaveValue('preservar');
  }
  expect(montar).toHaveBeenCalledTimes(1);
  expect(desmontar).not.toHaveBeenCalled();
});
test("voltar restaura a rota interna anterior, incluindo competência", () => {
  setup();
  fireEvent.click(screen.getByText("Notas"));
  fireEvent.click(screen.getByText("Planejamento"));
  fireEvent.click(screen.getByText("Voltar"));
  expect(screen.getByLabelText("rota")).toHaveTextContent("/companies/123/notas?competencia=2026-09");
  fireEvent.click(screen.getByText("Voltar"));
  expect(screen.getByLabelText("rota").textContent).toBe("/companies");
});
test("acesso direto usa página principal como fallback", () => {
  setup("/planejamento");
  fireEvent.click(screen.getByText("Voltar"));
  expect(screen.getByLabelText("rota").textContent).toBe("/companies");
});
test("logo preserva Tabela; novo login restaura Calendário e limite de histórico", () => {
  setup();
  fireEvent.click(screen.getByText("Tabela"));
  fireEvent.click(screen.getByText("Notas"));
  fireEvent.click(screen.getByRole("link", { name: "Altan — página principal" }));
  expect(screen.getByLabelText("visão")).toHaveTextContent("tabela");
  fireEvent.click(screen.getByText("Novo login"));
  expect(screen.getByLabelText("visão")).toHaveTextContent("operacoes");
  fireEvent.click(screen.getByText("Voltar"));
  expect(screen.getByLabelText("rota").textContent).toBe("/companies");
});

const mountedRouters = [];
function mountRouter(element, initialEntries) {
  const router = createMemoryRouter([{ path: '*', element }], { initialEntries });
  mountedRouters.push(router);
  const view = render(<RouterProvider router={router} />);
  return { ...view, unmount: () => { view.unmount(); router.dispose(); } };
}
afterEach(() => { cleanup(); mountedRouters.splice(0).forEach(router => router.dispose()); });

function PendingEditor({ name = 'a', saveResult, removed = false }) {
  const state = useRef({ dirty: true });
  useWorkspaceEditor({ context: state.current, get dirty() { return !removed && state.current.dirty; },
    save: async () => {
      const result = await saveResult?.();
      if (result !== true) return result;
      state.current.dirty = false;
      return { ok: true, context: state.current, revision: 1 };
    },
    discard: async () => { state.current.dirty = false; return { ok: true, context: state.current, revision: 1 }; },
  });
  return <input aria-label={name} defaultValue="rascunho"/>;
}
function guardMount(editor, entries = ['/antes', '/origem', '/depois'], index = 1, strict = false) {
  const element = <WorkspaceNavigationProvider><Screen/>{editor}</WorkspaceNavigationProvider>;
  const router = createMemoryRouter([{ path: '*', element: strict ? <StrictMode>{element}</StrictMode> : element }],
    { initialEntries: entries, initialIndex: index });
  mountedRouters.push(router); render(<RouterProvider router={router}/>); return router;
}
test.each([
  ['PUSH', '/destino', {}], ['REPLACE', '/destino', { replace: true }], ['POP anterior', -1, {}], ['POP seguinte', 1, {}],
])('%s só prossegue depois da escolha; cancelar conserva origem', async (_, to, options) => {
  const save = jest.fn(async () => true);
  const router = guardMount(<PendingEditor saveResult={save}/>);
  await act(async () => { await router.navigate(to, options); });
  expect(router.state.location.pathname).toBe('/origem');
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
  expect(screen.getByLabelText('a')).toHaveValue('rascunho');
  await act(async () => { await router.navigate(to, options); });
  fireEvent.click(screen.getByRole('button', { name: 'Guardar e sair' }));
  await waitFor(() => expect(router.state.location.pathname).toBe(typeof to === 'string' ? to : to < 0 ? '/antes' : '/depois'));
  expect(save).toHaveBeenCalledTimes(1);
});
test('dois editores em StrictMode mantêm leases independentes; falha não inventa transação global', async () => {
  const first = jest.fn(async () => true), second = jest.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  const router = guardMount(<><PendingEditor name="a" saveResult={first}/><PendingEditor name="b" saveResult={second}/></>, undefined, undefined, true);
  await act(async () => { await router.navigate('/destino'); });
  fireEvent.click(screen.getByRole('button', { name: 'Guardar e sair' }));
  await screen.findByRole('alert');
  expect(router.state.location.pathname).toBe('/origem');
  fireEvent.click(screen.getByRole('button', { name: 'Guardar e sair' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/destino'));
  expect(second).toHaveBeenCalledTimes(2);
  expect(first).toHaveBeenCalledTimes(1);
});

test('StrictMode do provider mantém um listener e cleanup de um editor preserva o outro', async () => {
  const listeners = new Set();
  const add = window.addEventListener.bind(window), remove = window.removeEventListener.bind(window);
  const addSpy = jest.spyOn(window, 'addEventListener').mockImplementation((type, listener, options) => {
    if (type === 'beforeunload') listeners.add(listener);
    return add(type, listener, options);
  });
  const removeSpy = jest.spyOn(window, 'removeEventListener').mockImplementation((type, listener, options) => {
    if (type === 'beforeunload') listeners.delete(listener);
    return remove(type, listener, options);
  });
  const save = jest.fn(async () => true);
  function Editors() {
    const [first, setFirst] = useState(true);
    return <>{first && <PendingEditor name="a"/>}<PendingEditor name="b" saveResult={save}/>
      <button onClick={() => setFirst(false)}>Remover primeiro</button></>;
  }
  try {
    const router = guardMount(<Editors/>, undefined, undefined, true);
    expect(listeners.size).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Remover primeiro' }));
    await act(async () => { await router.navigate('/destino'); });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar e sair' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/destino'));
    expect(save).toHaveBeenCalledTimes(1);
    cleanup();
    expect(listeners.size).toBe(0);
  } finally { addSpy.mockRestore(); removeSpy.mockRestore(); }
});
test('destino concorrente não recebe proceed antigo nem duplica gravação em andamento', async () => {
  let resolve;
  const save = jest.fn(() => new Promise(done => { resolve = done; }));
  const router = guardMount(<PendingEditor saveResult={save}/>);
  await act(async () => { await router.navigate('/primeiro'); });
  fireEvent.click(screen.getByRole('button', { name: 'Guardar e sair' }));
  await act(async () => { await router.navigate('/segundo'); });
  expect(screen.getByRole('button', { name: 'Guardar e sair' })).toBeDisabled();
  await act(async () => { resolve(true); });
  expect(router.state.location.pathname).toBe('/origem');
  expect(save).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Descartar e sair' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/segundo'));
});

function PersistentLegacyProbe() {
  useEdicaoPendente(true);
  return <Screen/>;
}
test('legado confirma uma transição sem zerar dirty; próxima saída e beforeunload continuam protegidos', async () => {
  mountRouter(<WorkspaceNavigationProvider><PersistentLegacyProbe/></WorkspaceNavigationProvider>, ['/companies']);
  fireEvent.click(screen.getByText('Planejamento'));
  fireEvent.click(await screen.findByRole('button', { name: 'Sair sem confirmação' }));
  await waitFor(() => expect(screen.getByLabelText('rota')).toHaveTextContent('/planejamento'));
  const unload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
  fireEvent.click(screen.getByText('Notas'));
  expect(await screen.findByRole('dialog')).toBeInTheDocument();
  expect(screen.getByLabelText('rota')).toHaveTextContent('/planejamento');
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
  expect(screen.getByLabelText('rota')).toHaveTextContent('/planejamento');
});

test('confirmação legada não libera editor explícito com descarte recusado', async () => {
  const discard = jest.fn().mockRejectedValue(Object.assign(new Error('Não conciliado'), { status: 409 }));
  const save = jest.fn();
  function Mixed() {
    useEdicaoPendente(true);
    const context = useRef({}).current;
    useWorkspaceEditor({ context, dirty: true, discard, save });
    return <Screen/>;
  }
  mountRouter(<WorkspaceNavigationProvider><Mixed/></WorkspaceNavigationProvider>, ['/companies']);
  fireEvent.click(screen.getByText('Planejamento'));
  expect(screen.queryByRole('button', { name: 'Guardar e sair' })).toBeNull();
  fireEvent.click(await screen.findByRole('button', { name: 'Sair sem confirmação' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Não conciliado');
  expect(screen.getByLabelText('rota')).toHaveTextContent('/companies');
  expect(discard).toHaveBeenCalledTimes(1); expect(save).not.toHaveBeenCalled();
});

test('misto valida descarte real e não inventa confirmação para legado', async () => {
  const discard = jest.fn();
  function Mixed() {
    useEdicaoPendente(true);
    const context = useRef({ dirty: true }).current;
    discard.mockImplementation(async () => { context.dirty = false; return { ok: true, context, revision: 8 }; });
    useWorkspaceEditor({ context, get dirty() { return context.dirty; }, discard });
    return <Screen/>;
  }
  mountRouter(<WorkspaceNavigationProvider><Mixed/></WorkspaceNavigationProvider>, ['/companies']);
  fireEvent.click(screen.getByText('Planejamento'));
  fireEvent.click(await screen.findByRole('button', { name: 'Sair sem confirmação' }));
  await waitFor(() => expect(screen.getByLabelText('rota')).toHaveTextContent('/planejamento'));
  expect(discard).toHaveBeenCalledTimes(1);
  const unload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
});
// Platform branches are simulated unit fixtures; native Mac coverage is separate.
async function withWorkspacePlatformFixture(platform, run) {
 const descriptor=Object.getOwnPropertyDescriptor(navigator,'userAgentData');
 Object.defineProperty(navigator,'userAgentData',{configurable:true,value:{platform}});
 try { await run(); } finally {
  cleanup();
  if(descriptor)Object.defineProperty(navigator,'userAgentData',descriptor);
  else delete navigator.userAgentData;
 }
}
test.each(['Windows','Linux','Unknown'].flatMap(platform=>['internal','home'].map(link=>[platform,link])))('Meta on %s protects %s, cancel preserves the draft and save advances once',async(platform,kind)=>{
 await withWorkspacePlatformFixture(platform,async()=>{
  const save=jest.fn(async()=>true);
  const router=guardMount(<><PendingEditor saveResult={save}/><a href="/destino?x=1#parte">Destino interno</a><WorkspaceHomeLink/></>,['/origem'],0);
  const link=screen.getByRole('link',{name:kind==='home'?'Altan — página principal':'Destino interno'});
  const field=screen.getByLabelText('a');fireEvent.change(field,{target:{value:'edição Meta preservada'}});
  fireEvent.click(link,{metaKey:true});
  expect(await screen.findByRole('dialog',{name:'Alterações não salvas'})).toBeInTheDocument();
  expect(router.state.location.pathname).toBe('/origem');expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Cancelar'}));
  expect(field).toHaveValue('edição Meta preservada');expect(router.state.location.pathname).toBe('/origem');expect(save).not.toHaveBeenCalled();
  fireEvent.click(link,{metaKey:true});fireEvent.click(await screen.findByRole('button',{name:'Guardar e sair'}));
  await waitFor(()=>expect(router.state.location.pathname).toBe(kind==='home'?'/companies':'/destino'));
  if(kind==='internal'){expect(router.state.location.search).toBe('?x=1');expect(router.state.location.hash).toBe('#parte');}
  expect(save).toHaveBeenCalledTimes(1);
 });
});
test.each([
 ['macOS',{metaKey:true},{}],['Windows',{ctrlKey:true},{}],['Windows',{shiftKey:true},{}],['Windows',{altKey:true},{}],['Windows',{metaKey:true,ctrlKey:true},{}],['Windows',{button:1},{}],['Windows',{}, {target:'_blank'}],['Windows',{}, {download:'qa.txt'}],
])('preserves native link delegation on %s for %j %j',async(platform,event,attributes)=>{
 await withWorkspacePlatformFixture(platform,async()=>{
  const save=jest.fn(async()=>true),observed=[];
  const router=guardMount(<><PendingEditor saveResult={save}/><a href="/destino" {...attributes}>Nativo local</a></>,['/origem'],0);
  // Stop only jsdom's unsupported browser default at document, AFTER product handlers.
  const suppressJsdomDefault=e=>{observed.push(e.defaultPrevented);e.preventDefault();};
  document.addEventListener('click',suppressJsdomDefault);
  try{fireEvent.click(screen.getByRole('link',{name:'Nativo local'}),event);}finally{document.removeEventListener('click',suppressJsdomDefault);}
  expect(observed).toEqual([false]);expect(screen.queryByRole('dialog')).toBeNull();
  expect(router.state.location.pathname).toBe('/origem');expect(screen.getByLabelText('a')).toHaveValue('rascunho');expect(save).not.toHaveBeenCalled();
 });
});