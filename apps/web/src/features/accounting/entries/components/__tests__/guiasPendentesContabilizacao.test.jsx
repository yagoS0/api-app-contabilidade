import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
jest.mock("../../../../../api/client", () => ({ createApiClient: () => ({}) }));
import { GuiasPendentesContabilizacao } from "../GuiasPendentesContabilizacao";
let mockContabilizar;
jest.mock('../../../../../components/ui/Button', () => {
  const { Button: Original } = jest.requireActual('../../../../../components/ui/Button');
  return { Button: props => { if (props.children === 'Contabilizar guia') mockContabilizar = props.onClick; return <Original {...props} />; } };
});
const guia = { id: "g1", tipo: "DARF", valor: 217.58, updatedAt: "2026-10-15T18:00:00Z" };
let api;
beforeEach(() => { api = { getGuiasPendentesContabilizacao: jest.fn(async () => ({ itens: [guia] })), contabilizarGuiaPendente: jest.fn(async () => ({ ok: true })) }; });
function montar(props = {}) { return render(<GuiasPendentesContabilizacao myRole="ACCOUNTANT" companyId="c1" competencia="2026-09" fechado apiClient={api} {...props} />); }
test("pendência permanece visível no mês fechado sem oferecer contabilização", async () => {
  montar();
  expect(await screen.findByText(/Guia pendente de contabilização/)).toBeInTheDocument();
  expect(screen.getByText(/Reabra o mês/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Contabilizar guia" })).not.toBeInTheDocument();
});
test("mês reaberto permite contabilizar uma vez e atualizar os lançamentos", async () => {
  const aoContabilizar = jest.fn(); montar({ fechado: false, aoContabilizar });
  fireEvent.click(await screen.findByRole("button", { name: "Contabilizar guia" }));
  await waitFor(() => expect(aoContabilizar).toHaveBeenCalledTimes(1));
  expect(api.contabilizarGuiaPendente).toHaveBeenCalledWith("c1", "g1", guia.updatedAt);
  expect(screen.queryByText(/Guia pendente de contabilização/)).not.toBeInTheDocument();
});
test("recusa mantém guia e motivo visíveis", async () => {
  api.contabilizarGuiaPendente.mockRejectedValue(new Error("Reabra o mês antes de contabilizar esta guia."));
  montar({ fechado: false });
  fireEvent.click(await screen.findByRole("button", { name: "Contabilizar guia" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Reabra o mês");
  expect(screen.getByText(/Guia pendente de contabilização/)).toBeInTheDocument();
});
test("resposta atrasada de outra empresa não aparece na empresa atual", async () => {
  let resolver;
  api.getGuiasPendentesContabilizacao.mockImplementation(id => id === "c1" ? new Promise(r => { resolver = r; }) : Promise.resolve({ itens: [] }));
  const view = montar();
  view.rerender(<GuiasPendentesContabilizacao companyId="c2" competencia="2026-09" fechado apiClient={api} />);
  resolver({ itens: [guia] });
  await waitFor(() => expect(api.getGuiasPendentesContabilizacao).toHaveBeenCalledWith("c2", "2026-09"));
  expect(screen.queryByText(/Guia pendente de contabilização/)).not.toBeInTheDocument();
});

test("carga é anunciada e releitura recupera erro sem contabilizar", async () => {
 api.getGuiasPendentesContabilizacao.mockRejectedValueOnce(Error('offline'));
 montar();expect(screen.getByRole('status')).toHaveTextContent('Carregando');await screen.findByRole('alert');fireEvent.click(screen.getByRole('button',{name:'Atualizar guias pendentes'}));await screen.findByText(/Guia pendente de contabilização/);expect(api.getGuiasPendentesContabilizacao).toHaveBeenCalledTimes(2);expect(api.contabilizarGuiaPendente).not.toHaveBeenCalled();
});
test("sucesso anuncia e recebe foco sem sumir a confirmação",async()=>{
 montar({fechado:false});const botao=await screen.findByRole('button',{name:'Contabilizar guia'});botao.focus();fireEvent.click(botao);await waitFor(()=>expect(screen.getByRole('status')).toHaveFocus());expect(screen.getByRole('status')).toHaveTextContent('Guia contabilizada.');
});
test("conflito permite reler versão e conserva payload da guia atual",async()=>{
 api.contabilizarGuiaPendente.mockRejectedValueOnce(Error('Guia alterada. Atualize a lista.'));montar({fechado:false});fireEvent.click(await screen.findByRole('button',{name:'Contabilizar guia'}));await screen.findByRole('alert');api.getGuiasPendentesContabilizacao.mockResolvedValue({itens:[{...guia,updatedAt:'nova-versao'}]});fireEvent.click(screen.getByRole('button',{name:'Atualizar guias pendentes'}));fireEvent.click(await screen.findByRole('button',{name:'Contabilizar guia'}));await waitFor(()=>expect(api.contabilizarGuiaPendente).toHaveBeenLastCalledWith('c1','g1','nova-versao'));
});

 test("sucesso não permanece após troca de contexto",async()=>{
 const view=montar({fechado:false});fireEvent.click(await screen.findByRole('button',{name:'Contabilizar guia'}));await screen.findByText('Guia contabilizada.');view.rerender(<GuiasPendentesContabilizacao companyId="c2" competencia="2026-10" fechado apiClient={api}/>);expect(screen.queryByText('Guia contabilizada.')).not.toBeInTheDocument();await waitFor(()=>expect(api.getGuiasPendentesContabilizacao).toHaveBeenCalledWith('c2','2026-10'));
 });

 test.each(['STAFF',undefined])("papel %s mantém leitura sem oferecer contabilização",async myRole=>{
 montar({fechado:false,myRole});await screen.findByText(/Guia pendente de contabilização/);expect(screen.queryByRole('button',{name:'Contabilizar guia'})).not.toBeInTheDocument();expect(screen.getByText(/apenas consultar/)).toBeVisible();expect(api.contabilizarGuiaPendente).not.toHaveBeenCalled();
 });
 test.each(['ACCOUNTANT','FIRM_ADMIN'])("papel %s contabiliza com o mesmo payload",async myRole=>{
 montar({fechado:false,myRole});fireEvent.click(await screen.findByRole('button',{name:'Contabilizar guia'}));await waitFor(()=>expect(api.contabilizarGuiaPendente).toHaveBeenCalledWith('c1','g1',guia.updatedAt));
 });
 test("revogação durante leitura não oferece ação ao receber guias",async()=>{
 let resolver;api.getGuiasPendentesContabilizacao.mockImplementation(()=>new Promise(r=>{resolver=r}));const view=montar({fechado:false});view.rerender(<GuiasPendentesContabilizacao companyId="c1" competencia="2026-09" fechado={false} myRole="STAFF" apiClient={api}/>);resolver({itens:[guia]});await screen.findByText(/Guia pendente de contabilização/);expect(screen.queryByRole('button',{name:'Contabilizar guia'})).not.toBeInTheDocument();expect(api.contabilizarGuiaPendente).not.toHaveBeenCalled();
 });

 test("handler preparado antes da revogação não escreve após perder permissão",async()=>{
 const view=montar({fechado:false});await screen.findByRole('button',{name:'Contabilizar guia'});const acaoAntiga=mockContabilizar;view.rerender(<GuiasPendentesContabilizacao companyId="c1" competencia="2026-09" fechado={false} myRole="STAFF" apiClient={api}/>);await act(async()=>acaoAntiga());expect(api.contabilizarGuiaPendente).not.toHaveBeenCalled();
 });
