import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { SolicitacoesPage } from '../SolicitacoesPage';
import { lerFiltros } from '../hooks/useSolicitacoes';

const usuario = { id: 'operador-a' };
const item = (id = 's1', extra = {}) => ({ id, titulo: `Pedido ${id}`, resumo: 'Documento recebido', portalClientId: 'empresa-a', triagem: false,
  responsavelId: null, prioridade: null, prazoCivil: null, situacao: 'NOVA', versao: 'v1',
  apresentacao: { empresa: { id: 'empresa-a', nome: 'Empresa exemplo' }, responsavel: null, criador: null }, ...extra });
const resposta = (itens = [item()], extra = {}) => ({ ok: true, itens, total: itens.length, hoje: '2026-10-27', proximoCursor: null, resumo: {}, porEmpresa: {}, porPrioridade: {}, ...extra });
const diferida = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
let navegar;
function Caminho() { navegar = useNavigate(); const location = useLocation(); return <output aria-label="URL">{location.pathname}{location.search}</output>; }
function montar(api, url = '/solicitacoes', user = usuario) {
  const tree = (nextApi, nextUser) => <MemoryRouter initialEntries={[url]}><Caminho /><SolicitacoesPage api={nextApi} usuario={nextUser} onBack={jest.fn()} /></MemoryRouter>;
  const result = render(tree(api, user));
  return { ...result, trocar: (nextApi, nextUser = user) => result.rerender(tree(nextApi, nextUser)) };
}

test('total agregado de 151, página de 100 e cursor opaco; filtros reiniciam posição', async () => {
  const api = { listarSolicitacoes: jest.fn().mockResolvedValueOnce(resposta(Array.from({ length: 100 }, (_, n) => item(`s${n}`)), { total: 151, proximoCursor: 'cursor:opaco/+=' })).mockResolvedValue(resposta([item('segunda')], { total: 151 })) };
  montar(api);
  await screen.findByText('151 solicitações no recorte selecionado · 100 nesta página');
  expect(screen.getAllByRole('columnheader')).toHaveLength(6);
  fireEvent.click(screen.getByRole('button', { name: 'Próxima página' }));
  await screen.findByText('Pedido segunda');
  expect(screen.getByRole('status', { name: 'Estado da consulta de solicitações' })).toHaveFocus();
  expect(api.listarSolicitacoes).toHaveBeenLastCalledWith({ situacao: 'ABERTAS', limite: 100, cursor: 'cursor:opaco/+=' });
  fireEvent.change(screen.getByLabelText('Prioridade'), { target: { value: 'null' } });
  await waitFor(() => expect(api.listarSolicitacoes).toHaveBeenLastCalledWith({ situacao: 'ABERTAS', limite: 100, prioridade: null }));
  expect(screen.getByLabelText('URL').textContent).not.toContain('cursor');
});

test('nomes mínimos, homônimos, triagem, legado, prazo civil e tarefa sem ações futuras', async () => {
  const itens = [item('a'), item('b', { portalClientId: 'empresa-b', apresentacao: { empresa: { id: 'empresa-b', nome: 'Empresa exemplo' } }, situacao: 'ENCERRADA_LEGADO', prioridade: 'BAIXA' }),
    item('triagem', { portalClientId: null, triagem: true, apresentacao: { empresa: null }, situacao: 'A_VERIFICAR' }),
    item('oculto', { responsavelId: 'pessoa-x', apresentacao: { empresa: null, responsavel: null }, prazoCivil: '2026-10-26', tarefa: { id: 't1', podeAbrir: true, estado: 'ATIVA' } })];
  const original = JSON.stringify(itens);
  const api = { listarSolicitacoes: jest.fn().mockResolvedValue(resposta(itens)) };
  montar(api);
  await screen.findByText('Pedido oculto');
  expect(screen.getByText('Referência: empresa-a')).toBeInTheDocument();
  expect(screen.getByText('Referência: empresa-b')).toBeInTheDocument();
  const row = screen.getByText('Pedido oculto').closest('tr');
  expect(within(row).getAllByText('Nome indisponível')).toHaveLength(2);
  expect(within(row).queryByText('Sem responsável')).toBeNull();
  expect(screen.getByText('26/10/2026')).toBeInTheDocument();
  expect(screen.getByText('Atrasada')).toBeInTheDocument();
  expect(within(screen.getByRole('table')).getByText('Encerrada no legado')).toBeInTheDocument();
  expect(within(screen.getByRole('table')).getByText('Em triagem')).toBeInTheDocument();
  expect(within(screen.getByRole('table')).queryAllByRole('link')).toHaveLength(0);
  expect(within(screen.getByRole('table')).queryAllByRole('button')).toHaveLength(0);
  expect(JSON.stringify(itens)).toBe(original);
  expect(Object.keys(api)).toEqual(['listarSolicitacoes']);
});

test('busca aplicada no servidor e null distinto de ausente sobrevivem ao histórico', async () => {
  const api = { listarSolicitacoes: jest.fn().mockResolvedValue(resposta()) };
  montar(api, '/solicitacoes?responsavelId=null&prioridade=null');
  await screen.findByText('Pedido s1');
  expect(api.listarSolicitacoes).toHaveBeenLastCalledWith({ limite: 100, situacao: 'ABERTAS', responsavelId: null, prioridade: null });
  fireEvent.change(screen.getByLabelText('Buscar empresa ou assunto'), { target: { value: 'Ação & revisão' } });
  expect(api.listarSolicitacoes).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Buscar', exact: true }));
  await waitFor(() => expect(api.listarSolicitacoes).toHaveBeenLastCalledWith(expect.objectContaining({ busca: 'Ação & revisão' })));
  fireEvent.change(screen.getByLabelText('Responsável'), { target: { value: '' } });
  await waitFor(() => expect(api.listarSolicitacoes.mock.calls.at(-1)[0]).not.toHaveProperty('responsavelId'));
  await act(async () => navegar(-1));
  expect(screen.getByLabelText('Responsável')).toHaveValue('null');
  expect(screen.getByLabelText('Buscar empresa ou assunto')).toHaveValue('Ação & revisão');
  await act(async () => navegar(1));
  expect(screen.getByLabelText('Responsável')).toHaveValue('');
});

test.each([false, true])('remover empresa preserva responsável e foco durante carga e resposta tardia (foco movido: %s)', async moverFoco => {
  const pendente = diferida();
  const api = { listarSolicitacoes: jest.fn().mockResolvedValueOnce(resposta()).mockReturnValue(pendente.promise) };
  montar(api, '/solicitacoes?responsavelId=pessoa-x&portalClientId=empresa-a');
  await screen.findByText('Pedido s1');
  expect(screen.getByLabelText('Responsável')).toHaveValue('pessoa-x');
  expect(screen.getByRole('option', { name: /nome indisponível/ })).toBeInTheDocument();
  const remover = screen.getByRole('button', { name: /Remover filtro de empresa/ });
  remover.focus();
  expect(remover).toHaveFocus();
  fireEvent.click(remover, { detail: 0 });
  expect(remover).not.toBeInTheDocument();
  const busca = screen.getByLabelText('Buscar empresa ou assunto');
  expect(busca).toHaveFocus();
  expect(screen.getByRole('status', { name: 'Estado da consulta de solicitações' })).toHaveTextContent('Carregando solicitações');
  await waitFor(() => expect(api.listarSolicitacoes.mock.calls.at(-1)[0]).not.toHaveProperty('portalClientId'));
  expect(api.listarSolicitacoes).toHaveBeenLastCalledWith({ limite: 100, situacao: 'ABERTAS', responsavelId: 'pessoa-x' });
  const destino = moverFoco ? screen.getByLabelText('Prioridade') : busca;
  if (moverFoco) destino.focus();
  await act(async () => pendente.resolve(resposta()));
  await screen.findByText('Pedido s1');
  expect(destino).toHaveFocus();
  expect(screen.getByLabelText('URL')).toHaveTextContent('/solicitacoes?responsavelId=pessoa-x');
});

test.each(['busca', 'portalClientId', 'responsavelId', 'cursor'])('rejeita todos os controles U+0000–U+001F em %s sem rejeitar texto válido', campo => {
  for (let codigo = 0; codigo < 32; codigo++) {
    const query = new URLSearchParams({ [campo]: `antes${String.fromCharCode(codigo)}depois` });
    expect(lerFiltros(`?${query}`).invalidos).toEqual([campo]);
    expect(lerFiltros(`?${query}`).filtros).not.toHaveProperty(campo);
  }
  const valor = 'Ação revisão:opaco/+=';
  const query = new URLSearchParams({ [campo]: valor });
  expect(lerFiltros(`?${query}`).invalidos).toEqual([]);
  expect(lerFiltros(`?${query}`).filtros[campo]).toBe(valor);
});

test.each(['prioridade=URGENTE', 'situacao=INVALIDA', 'triagem=talvez', 'surpresa=1', 'busca=a&busca=b', 'triagem=true&portalClientId=a'])('filtro inválido %s não é aplicado silenciosamente', async query => {
  const api = { listarSolicitacoes: jest.fn() };
  montar(api, `/solicitacoes?${query}`);
  expect(screen.getByRole('alert')).toHaveTextContent('Filtro inválido');
  expect(api.listarSolicitacoes).not.toHaveBeenCalled();
});

test('todos omite situação da API sem confundir com padrão em aberto', () => {
  expect(lerFiltros('?situacao=TODAS').filtros).not.toHaveProperty('situacao');
  expect(lerFiltros('').filtros.situacao).toBe('ABERTAS');
});

test('resposta atrasada não cruza filtros, API, ator ou desmontagem', async () => {
  const antiga = diferida(), nova = diferida();
  const api = { listarSolicitacoes: jest.fn().mockReturnValueOnce(antiga.promise).mockReturnValue(nova.promise) };
  const view = montar(api);
  fireEvent.change(screen.getByLabelText('Prioridade'), { target: { value: 'ALTA' } });
  await act(async () => nova.resolve(resposta([item('nova')])));
  await screen.findByText('Pedido nova');
  await act(async () => antiga.resolve(resposta([item('antiga')])));
  expect(screen.queryByText('Pedido antiga')).toBeNull();
  const proxima = diferida();
  const apiB = { listarSolicitacoes: jest.fn().mockReturnValue(proxima.promise) };
  view.trocar(apiB, { id: 'operador-b' });
  expect(screen.queryByText('Pedido nova')).toBeNull();
  view.unmount();
  await act(async () => proxima.resolve(resposta([item('outro-ator')])));
  expect(screen.queryByText('Pedido outro-ator')).toBeNull();
});

test('foco preserva lista, URL, scroll e atualiza nome sem mudar versão; falha mantém dados identificados', async () => {
  const refresh = diferida();
  const api = { listarSolicitacoes: jest.fn().mockResolvedValueOnce(resposta()).mockReturnValueOnce(refresh.promise).mockRejectedValue(new Error('offline')) };
  montar(api, '/solicitacoes?prioridade=null');
  await screen.findByText('Pedido s1');
  const lista = screen.getByRole('region', { name: 'Lista de solicitações' });
  lista.scrollTop = 120; lista.scrollLeft = 42; fireEvent.scroll(lista);
  const busca = screen.getByLabelText('Buscar empresa ou assunto');
  busca.focus();
  fireEvent(window, new Event('focus'));
  expect(busca).toHaveFocus();
  expect(screen.getByText('Atualizando…')).toBeInTheDocument();
  expect(screen.getByText('Pedido s1')).toBeInTheDocument();
  await act(async () => refresh.resolve(resposta([item('s1', { apresentacao: { empresa: { id: 'empresa-a', nome: 'Nome atualizado' } } })])));
  expect(screen.getByText('Nome atualizado')).toBeInTheDocument();
  expect(lista.scrollTop).toBe(120); expect(lista.scrollLeft).toBe(42);
  expect(busca).toHaveFocus();
  fireEvent(window, new Event('focus'));
  await screen.findByRole('alert');
  expect(screen.getByRole('alert')).toHaveTextContent('desatualizados');
  expect(screen.getByText('Nome atualizado')).toBeInTheDocument();
  expect(screen.getByLabelText('URL')).toHaveTextContent('prioridade=null');
  expect(busca).toHaveFocus();
});

test.each([
  ['falha', '/solicitacoes?prioridade=null', 'Tentar novamente', 'Enter'],
  ['cursor', '/solicitacoes?prioridade=null&cursor=opaco', 'Recomeçar pela primeira página', ' '],
  ['filtro', '/solicitacoes?prioridade=INVALIDA', 'Recomeçar consulta', 'Enter'],
])('recuperação explícita de %s mantém destino de foco durante carga e resultado', async (tipo, url, rotulo, tecla) => {
  const pendente = diferida();
  const listarSolicitacoes = jest.fn();
  if (tipo !== 'filtro') listarSolicitacoes.mockRejectedValueOnce(
    tipo === 'cursor' ? Object.assign(new Error('cursor_invalido'), { code: 'cursor_invalido', status: 400 }) : new Error('offline'));
  listarSolicitacoes.mockReturnValue(pendente.promise);
  montar({ listarSolicitacoes }, url);
  const botao = await screen.findByRole('button', { name: rotulo });
  botao.focus();
  expect(botao).toHaveFocus();
  // JSDOM não gera o click nativo de Enter/Space; a ativação sem ponteiro
  // completa a sequência. A interação nativa fica para o QA de navegador.
  fireEvent.keyDown(botao, { key: tecla });
  fireEvent.keyUp(botao, { key: tecla });
  fireEvent.click(botao, { detail: 0 });
  const status = screen.getByRole('status', { name: 'Estado da consulta de solicitações' });
  expect(status).toHaveFocus();
  expect(status).toHaveTextContent('Carregando solicitações');
  expect(botao).not.toBeInTheDocument();
  expect(listarSolicitacoes).toHaveBeenLastCalledWith({ limite: 100, situacao: 'ABERTAS', ...(tipo === 'filtro' ? {} : { prioridade: null }) });
  await act(async () => pendente.resolve(resposta()));
  await screen.findByText('Pedido s1');
  expect(status).toHaveFocus();
  expect(screen.getByLabelText('URL').textContent).toBe(tipo === 'filtro' ? '/solicitacoes' : '/solicitacoes?prioridade=null');
});

test('resposta após retry não recupera foco que o usuário já moveu', async () => {
  const pendente = diferida();
  montar({ listarSolicitacoes: jest.fn().mockRejectedValueOnce(new Error('offline')).mockReturnValue(pendente.promise) });
  fireEvent.click(await screen.findByRole('button', { name: 'Tentar novamente' }));
  const busca = screen.getByLabelText('Buscar empresa ou assunto');
  busca.focus();
  await act(async () => pendente.resolve(resposta()));
  await screen.findByText('Pedido s1');
  expect(busca).toHaveFocus();
});

test.each([401, 403])('HTTP %s retira resultado protegido e permite tentativa explícita', async status => {
  const api = { listarSolicitacoes: jest.fn().mockResolvedValueOnce(resposta()).mockRejectedValue(Object.assign(new Error('recusado'), { status })) };
  montar(api);
  await screen.findByText('Pedido s1');
  fireEvent(window, new Event('focus'));
  await screen.findByRole('alert');
  expect(screen.queryByText('Pedido s1')).toBeNull();
  expect(screen.queryByText(/0 solicitações/)).toBeNull();
  expect(screen.getByRole('alert')).toHaveTextContent(status === 401 ? 'Sessão expirada' : 'Acesso negado');
});

test.each(['dia', 'ACL', 'expiração'])('cursor inválido por %s exige reinício explícito sem loop', async () => {
  const api = { listarSolicitacoes: jest.fn().mockRejectedValueOnce(Object.assign(new Error('cursor_invalido'), { code: 'cursor_invalido', status: 400 })).mockResolvedValue(resposta()) };
  montar(api, '/solicitacoes?cursor=opaco&busca=Documento');
  await screen.findByRole('alert');
  expect(api.listarSolicitacoes).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Recomeçar pela primeira página' }));
  await screen.findByText('Pedido s1');
  expect(api.listarSolicitacoes).toHaveBeenLastCalledWith({ limite: 100, situacao: 'ABERTAS', busca: 'Documento' });
});

test.each([null, {}, { ok: false }, { itens: [], total: 0 }])('resposta incompleta %j não equivale a vazio', async retorno => {
  montar({ listarSolicitacoes: jest.fn().mockResolvedValue(retorno) });
  await screen.findByRole('alert');
  expect(screen.queryByText('Nenhuma solicitação neste recorte.')).toBeNull();
});

test('método ausente tem erro recuperável; zero confirmado tem vazio legítimo', async () => {
  const view = montar({});
  await screen.findByRole('alert');
  view.trocar({ listarSolicitacoes: jest.fn().mockResolvedValue(resposta([])) });
  await screen.findByText('Nenhuma solicitação neste recorte.');
  expect(screen.queryByRole('alert')).toBeNull();
});
