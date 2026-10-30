import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AcompanhamentoComercial } from '../AcompanhamentoComercial';

test.each(['resolve', 'reject'])('recupera canais da API atual após POST antigo %s sem perder consentimento', async desfecho => {
  const post = pendente(), atualizar = jest.fn();
  const antiga = { comercial: jest.fn((path, body) => {
    if (body) return post.promise;
    return Promise.resolve(path === '/canais-comerciais' ? { canais: [{ id: 'old', chave: 'Antigo' }] } : { versao: 4, conversaId: null });
  }) };
  const atual = apiDeCanais(() => Promise.resolve({ canais: [{ id: 'new', chave: 'Atual' }] }));
  const tela = api => <MemoryRouter><AcompanhamentoComercial api={api} onboarding={{ id: 'f1', versao: 4 }} onAtualizar={atualizar} /></MemoryRouter>;
  const view = render(tela(antiga));
  await abrirFormularioContato();
  await waitFor(() => expect(screen.getByLabelText('Canal')).toHaveValue('old'));
  preencherRascunhoContato();
  fireEvent.click(screen.getByRole('button', { name: 'Salvar vínculo' }));
  view.rerender(tela(atual));
  await waitFor(() => expect(atual.comercial).toHaveBeenCalledWith('/onboardings/f1/acompanhamento'));
  expect(screen.getByRole('button', { name: 'Salvando…' })).toBeDisabled();
  expect(atual.comercial.mock.calls.filter(([path]) => path === '/canais-comerciais')).toHaveLength(0);
  await act(async () => {
    if (desfecho === 'reject') post.reject(new Error('Erro da API anterior'));
    else post.resolve({ conversaId: 'old-conversa', atendimentoId: 'old-lead' });
  });
  await waitFor(() => expect(screen.getByLabelText('Canal')).toHaveValue('new'));
  expect(screen.getByRole('button', { name: 'Salvar vínculo' })).toBeEnabled();
  expect(screen.queryByRole('option', { name: 'Antigo' })).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /Abrir conversa/ })).not.toBeInTheDocument();
  conferirRascunhoContato();
  expect(atualizar).not.toHaveBeenCalled();
  expect(antiga.comercial.mock.calls.filter(([, body]) => body)).toHaveLength(1);
  expect(atual.comercial.mock.calls.filter(([path]) => path === '/canais-comerciais')).toHaveLength(1);
  somenteConsultas(atual);
});

test('recusa do POST na mesma API preserva seleção manual sem consultar canais novamente', async () => {
  const post = pendente(), atualizar = jest.fn();
  const api = { comercial: jest.fn((path, body) => {
    if (body) return post.promise;
    return Promise.resolve(path === '/canais-comerciais'
      ? { canais: [{ id: 'c1', chave: 'Primeiro' }, { id: 'c2', chave: 'Segundo' }] }
      : { versao: 4, conversaId: null });
  }) };
  render(<MemoryRouter><AcompanhamentoComercial api={api} onboarding={{ id: 'f1', versao: 4 }} onAtualizar={atualizar} /></MemoryRouter>);
  await abrirFormularioContato();
  await screen.findByRole('option', { name: 'Segundo' });
  fireEvent.change(screen.getByLabelText('Canal'), { target: { value: 'c2' } });
  preencherRascunhoContato();
  fireEvent.click(screen.getByRole('button', { name: 'Salvar vínculo' }));
  await act(async () => post.reject(new Error('Recusa atual: confira os dados')));
  expect(screen.getByRole('alert')).toHaveTextContent('Recusa atual');
  expect(screen.getByRole('button', { name: 'Salvar vínculo' })).toBeEnabled();
  expect(screen.getByLabelText('Canal')).toHaveValue('c2');
  conferirRascunhoContato();
  expect(api.comercial.mock.calls.filter(([path]) => path === '/canais-comerciais')).toHaveLength(1);
  expect(api.comercial.mock.calls.filter(([, body]) => body)).toHaveLength(1);
  expect(api.comercial).toHaveBeenCalledWith('/onboardings/f1/contato/vincular', expect.objectContaining({ canalId: 'c2', autorizado: true }));
  expect(atualizar).not.toHaveBeenCalled();
});

function montar(comercial) {
  return render(<MemoryRouter><AcompanhamentoComercial api={{ comercial }} onboarding={{ id: 'f1', versao: 4 }} /></MemoryRouter>);
}
test('prepara o contato autorizado e abre a conversa sem enviar mensagem', async () => {
  const comercial = jest.fn(async (path, body) => {
    if (path === '/canais-comerciais') return { canais: [{ id: 'c1', chave: 'Comercial' }] };
    if (body) return { conversaId: 'conv1', atendimentoId: 'lead1' };
    return { versao: 4, retorno: null, conversaId: null };
  });
  montar(comercial);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Vincular contato' })).toBeEnabled());
  fireEvent.click(await screen.findByRole('button', { name: 'Vincular contato' }));
  expect(screen.getByLabelText('Nome')).toHaveFocus();
  await screen.findByRole('option', { name: 'Comercial' });
  fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Contato demonstração' } });
  fireEvent.change(screen.getByLabelText('Telefone com DDI'), { target: { value: '5521999990000' } });
  fireEvent.change(screen.getByLabelText('Origem da autorização'), { target: { value: 'Solicitou pelo formulário de teste' } });
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Salvar vínculo' }));
  expect(await screen.findByRole('link', { name: /Abrir conversa/ })).toHaveAttribute('href', '/comercial/conversas?conversa=conv1');
  expect(screen.getByRole('link', { name: /Abrir conversa/ })).toHaveFocus();
  expect(comercial).toHaveBeenCalledWith('/onboardings/f1/contato/vincular', expect.objectContaining({ autorizado: true, canalId: 'c1' }));
  expect(comercial.mock.calls.filter(([, body]) => body)).toHaveLength(1);
});

test.each(['erro', 'troca de ficha'])('vínculo lento conserva formulário no erro e descarta outra ficha: %s', async caso => {
  const post = pendente(), atualizar = jest.fn();
  const api = { comercial: jest.fn((path, body) => {
    if (path === '/canais-comerciais') return Promise.resolve({ canais: [{ id: 'c1', chave: 'Comercial' }] });
    return body ? post.promise : Promise.resolve({ versao: 4, conversaId: null });
  }) };
  const tela = id => <MemoryRouter><AcompanhamentoComercial api={api} onboarding={{ id, versao: 4 }} onAtualizar={atualizar} /></MemoryRouter>;
  const view = render(tela('f1'));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Vincular contato' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Vincular contato' }));
  await screen.findByRole('option', { name: 'Comercial' });
  fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Pessoa sintética' } });
  fireEvent.change(screen.getByLabelText('Telefone com DDI'), { target: { value: '5521999991234' } });
  fireEvent.change(screen.getByLabelText('Origem da autorização'), { target: { value: 'Autorização sintética' } });
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Salvar vínculo' }));
  expect(screen.getByRole('button', { name: 'Salvando…' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled();
  if (caso === 'troca de ficha') view.rerender(tela('f2'));
  await act(async () => {
    if (caso === 'erro') post.resolve({ ok: false, conversaId: 'invalida', atendimentoId: 'invalido' });
    else post.resolve({ conversaId: 'antiga', atendimentoId: 'antigo' });
  });
  expect(screen.queryByRole('link', { name: /Abrir conversa/ })).not.toBeInTheDocument();
  expect(atualizar).not.toHaveBeenCalled();
  if (caso === 'erro') {
    expect(screen.getByRole('alert')).toHaveTextContent('Contato sem confirmação');
    expect(screen.getByLabelText('Nome')).toHaveValue('Pessoa sintética');
  } else expect(screen.queryByLabelText('Nome')).not.toBeInTheDocument();
  expect(api.comercial.mock.calls.filter(([, body]) => body)).toHaveLength(1);
});

test('oferece localizar contato existente sem preparar vínculo ou enviar mensagem', async () => {
  const comercial = jest.fn(async () => ({ versao: 4, conversaId: null }));
  montar(comercial);
  const link = screen.getByRole('link', { name: 'Localizar contato' });
  expect(link).toHaveAttribute('href', '/comercial/conversas');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Vincular contato' })).toBeEnabled());
  fireEvent.click(link);
  expect(comercial.mock.calls).toEqual([['/onboardings/f1/acompanhamento']]);
});

test('leitura indisponível não autoriza preparar contato como se não houvesse vínculo', async () => {
  const comercial = jest.fn(async () => { throw new Error('Leitura indisponível'); });
  montar(comercial);
  expect(await screen.findByRole('alert')).toHaveTextContent('Leitura indisponível');
  expect(screen.getByRole('button', { name: 'Vincular contato' })).toBeDisabled();
  expect(screen.getByRole('link', { name: 'Localizar contato' })).toHaveAttribute('href', '/comercial/conversas');
  expect(comercial.mock.calls.filter(([, body]) => body)).toHaveLength(0);
});

test('conversa vinculada usa somente a identidade persistida', async () => {
  const comercial = jest.fn(async () => ({ versao: 4, conversaId: 'conv-existente' }));
  montar(comercial);
  expect(await screen.findByRole('link', { name: /Abrir conversa/ })).toHaveAttribute('href', '/comercial/conversas?conversa=conv-existente');
  expect(screen.queryByRole('link', { name: 'Localizar contato' })).not.toBeInTheDocument();
  expect(comercial.mock.calls.filter(([, body]) => body)).toHaveLength(0);
});

test('conflito ao agendar mantém os dados e mostra erro para conferência', async () => {
  const comercial = jest.fn(async (path, body) => {
    if (body) throw new Error('A ficha mudou. Atualize antes de salvar.');
    return { versao: 4 };
  });
  montar(comercial);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Agendar retorno' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Agendar retorno' }));
  fireEvent.change(screen.getByLabelText('Próxima ação'), { target: { value: 'Revisar proposta' } });
  fireEvent.change(screen.getByLabelText('Data e hora'), { target: { value: '2026-10-07T10:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Salvar retorno' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('A ficha mudou');
  expect(screen.getByLabelText('Próxima ação')).toHaveValue('Revisar proposta');
  expect(comercial).toHaveBeenLastCalledWith('/onboardings/f1/retorno', expect.objectContaining({ versao: 4, acao: 'Revisar proposta' }));
});

test('retorno confirmado permanece visível se a recarga falhar, sem pedir novo salvamento', async () => {
  let salvo = false;
  const comercial = jest.fn(async (_, body) => {
    if (body) { salvo = true; return { versao: 5, retorno: { dados: { acao: body.acao, quando: body.quando, responsavelNome: 'Ana' } } }; }
    if (salvo) throw new Error('Leitura indisponível');
    return { versao: 4 };
  });
  montar(comercial);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Agendar retorno' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Agendar retorno' }));
  fireEvent.change(screen.getByLabelText('Próxima ação'), { target: { value: 'Conferir documentação' } });
  fireEvent.change(screen.getByLabelText('Data e hora'), { target: { value: '2026-10-20T10:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Salvar retorno' }));
  expect(await screen.findByText(/Conferir documentação.*Ana/)).toBeVisible();
  expect(await screen.findByRole('alert')).toHaveTextContent('Leitura indisponível');
  expect(screen.queryByLabelText('Próxima ação')).not.toBeInTheDocument();
  expect(comercial.mock.calls.filter(([, body]) => body)).toHaveLength(1);
});

function pendente() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }

function apiDeCanais(consultar) {
  return { comercial: jest.fn(path => {
    if (path === '/canais-comerciais') return consultar();
    if (path === '/onboardings/f1/acompanhamento') return Promise.resolve({ versao: 4, conversaId: null });
    throw new Error(`Efeito inesperado: ${path}`);
  }) };
}
function somenteConsultas(...apis) {
  for (const api of apis) {
    expect(api.comercial.mock.calls.every(args => args.length === 1 && ['/canais-comerciais', '/onboardings/f1/acompanhamento'].includes(args[0]))).toBe(true);
  }
}
async function abrirFormularioContato() {
  await waitFor(() => expect(screen.getByRole('button', { name: 'Vincular contato' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Vincular contato' }));
}
function preencherRascunhoContato() {
  fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Rascunho preservado' } });
  fireEvent.change(screen.getByLabelText('Telefone com DDI'), { target: { value: '5521999990000' } });
  fireEvent.change(screen.getByLabelText('Origem da autorização'), { target: { value: 'Autorização desta ficha' } });
  fireEvent.click(screen.getByRole('checkbox'));
}
function conferirRascunhoContato() {
  expect(screen.getByLabelText('Nome')).toHaveValue('Rascunho preservado');
  expect(screen.getByLabelText('Telefone com DDI')).toHaveValue('5521999990000');
  expect(screen.getByLabelText('Origem da autorização')).toHaveValue('Autorização desta ficha');
  expect(screen.getByRole('checkbox')).toBeChecked();
}

test.each([
  ['retorno', 'canal'], ['rejeição', 'canal'], ['retorno', 'erro'], ['rejeição', 'erro'],
])('troca de API ignora %s tardio e conserva %s atual após efeitos', async (tardio, atual) => {
  const antiga = pendente(), nova = pendente();
  const apiAntiga = apiDeCanais(() => antiga.promise), apiNova = apiDeCanais(() => nova.promise);
  const tela = api => <MemoryRouter><AcompanhamentoComercial api={api} onboarding={{ id: 'f1', versao: 4 }} /></MemoryRouter>;
  const view = render(tela(apiAntiga));
  await abrirFormularioContato();
  preencherRascunhoContato();
  view.rerender(tela(apiNova));
  await waitFor(() => expect(apiNova.comercial).toHaveBeenCalledWith('/canais-comerciais'));
  await act(async () => {
    if (atual === 'canal') nova.resolve({ canais: [{ id: 'atual', chave: 'Canal atual' }] });
    else nova.reject(new Error('Erro do contexto atual'));
  });
  await act(async () => {
    if (tardio === 'retorno') antiga.resolve({ canais: [{ id: 'qa-canal-first', chave: 'Canal anterior' }] });
    else antiga.reject(new Error('Erro da API anterior'));
  });
  await waitFor(() => {
    expect(screen.queryByRole('option', { name: 'Canal anterior' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Canal')).toHaveValue(atual === 'canal' ? 'atual' : '');
    expect(screen.queryByText(/Erro da API anterior/)).not.toBeInTheDocument();
    if (atual === 'erro') expect(screen.getByRole('alert')).toHaveTextContent('Erro do contexto atual');
    else expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  conferirRascunhoContato();
  somenteConsultas(apiAntiga, apiNova);
});

test('canal já carregado não permanece selecionável depois da troca de API', async () => {
  const nova = pendente();
  const apiAntiga = apiDeCanais(async () => ({ canais: [{ id: 'qa-canal-first', chave: 'Canal anterior' }] }));
  const apiNova = apiDeCanais(() => nova.promise);
  const tela = api => <MemoryRouter><AcompanhamentoComercial api={api} onboarding={{ id: 'f1', versao: 4 }} /></MemoryRouter>;
  const view = render(tela(apiAntiga));
  await abrirFormularioContato();
  await waitFor(() => expect(screen.getByLabelText('Canal')).toHaveValue('qa-canal-first'));
  preencherRascunhoContato();
  view.rerender(tela(apiNova));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Vincular contato' })).toBeEnabled());
  expect(screen.getByLabelText('Canal')).toHaveValue('');
  expect(screen.queryByRole('option', { name: 'Canal anterior' })).not.toBeInTheDocument();
  fireEvent.submit(screen.getByLabelText('Canal').closest('form'));
  somenteConsultas(apiAntiga, apiNova);
  await act(async () => nova.resolve({ canais: [{ id: 'novo', chave: 'Canal novo' }] }));
  await waitFor(() => expect(screen.getByLabelText('Canal')).toHaveValue('novo'));
  expect(screen.queryByRole('option', { name: 'Canal anterior' })).not.toBeInTheDocument();
  conferirRascunhoContato();
  somenteConsultas(apiAntiga, apiNova);
});

test.each(['cancelar', 'reabrir', 'outra intenção', 'revisão'])('consulta anterior não vence o ciclo atual: %s', async caso => {
  const antiga = pendente(), nova = pendente();
  const consultar = jest.fn().mockReturnValueOnce(antiga.promise).mockReturnValue(nova.promise);
  const api = apiDeCanais(consultar);
  const tela = revisao => <MemoryRouter><AcompanhamentoComercial api={api} onboarding={{ id: 'f1', versao: 4 }} revisao={revisao} /></MemoryRouter>;
  const view = render(tela(0));
  await abrirFormularioContato();
  preencherRascunhoContato();
  if (caso === 'cancelar' || caso === 'reabrir') {
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    if (caso === 'cancelar') {
      await act(async () => antiga.resolve({ canais: [{ id: 'antigo', chave: 'Canal cancelado' }] }));
      expect(screen.queryByLabelText('Canal')).not.toBeInTheDocument();
    }
    await abrirFormularioContato();
  } else if (caso === 'revisão') view.rerender(tela(1));
  else await abrirFormularioContato();
  await waitFor(() => expect(consultar).toHaveBeenCalledTimes(2));
  await act(async () => nova.resolve({ canais: [{ id: 'novo', chave: 'Canal novo' }] }));
  await act(async () => antiga.resolve({ canais: [{ id: 'antigo', chave: 'Canal cancelado' }] }));
  await waitFor(() => {
    expect(screen.getByLabelText('Canal')).toHaveValue('novo');
    expect(screen.queryByRole('option', { name: 'Canal cancelado' })).not.toBeInTheDocument();
  });
  conferirRascunhoContato();
  somenteConsultas(api);
});

test('rejeição de consulta cancelada não substitui erro da consulta reaberta', async () => {
  const antiga = pendente(), nova = pendente();
  const api = apiDeCanais(jest.fn().mockReturnValueOnce(antiga.promise).mockReturnValue(nova.promise));
  montar(api.comercial);
  await abrirFormularioContato();
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
  await abrirFormularioContato();
  await act(async () => nova.reject(new Error('Erro atual após reabertura')));
  await act(async () => antiga.reject(new Error('Erro cancelado')));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Erro atual após reabertura'));
  expect(screen.queryByText(/Erro cancelado/)).not.toBeInTheDocument();
  expect(screen.getByLabelText('Canal')).toHaveValue('');
  somenteConsultas(api);
});

test.each(['clique', 'ativação de teclado'])('Atualizar recupera canais sem submeter ou perder formulário: %s', async modo => {
  const nova = pendente();
  const api = apiDeCanais(jest.fn().mockRejectedValueOnce(new Error('Canais indisponíveis')).mockReturnValue(nova.promise));
  montar(api.comercial);
  await abrirFormularioContato();
  preencherRascunhoContato();
  expect(await screen.findByRole('alert')).toHaveTextContent('Canais indisponíveis');
  const atualizar = screen.getByRole('button', { name: 'Atualizar' });
  expect(atualizar).toHaveAttribute('type', 'button');
  expect(atualizar).toHaveClass('btn', 'btn-secondary', 'btn-md');
  atualizar.focus();
  expect(atualizar).toHaveFocus();
  if (modo === 'ativação de teclado') {
    fireEvent.keyDown(atualizar, { key: 'Enter', code: 'Enter' });
    fireEvent.keyUp(atualizar, { key: 'Enter', code: 'Enter' });
    // JSDOM não sintetiza o click nativo de Enter; detail 0 representa essa ativação.
    fireEvent.click(atualizar, { detail: 0 });
  } else fireEvent.click(atualizar);
  await waitFor(() => expect(api.comercial.mock.calls.filter(([path]) => path === '/canais-comerciais')).toHaveLength(2));
  await act(async () => nova.resolve({ canais: [{ id: 'recuperado', chave: 'Canal recuperado' }] }));
  await waitFor(() => expect(screen.getByLabelText('Canal')).toHaveValue('recuperado'));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  conferirRascunhoContato();
  somenteConsultas(api);
});

test('Atualizar após erro de vínculo mantém foco e rascunho até nova confirmação explícita', async () => {
  let tentativas = 0;
  const comercial = jest.fn(async (path, body) => {
    if (path === '/canais-comerciais') return { canais: [{ id: 'c1', chave: 'Comercial' }] };
    if (body) {
      if (++tentativas === 1) throw new Error('Vínculo recusado. Confira antes de salvar.');
      return { conversaId: 'conv-recuperada', atendimentoId: 'lead-recuperado' };
    }
    return { versao: 4, conversaId: null };
  });
  montar(comercial);
  await abrirFormularioContato();
  await waitFor(() => expect(screen.getByLabelText('Canal')).toHaveValue('c1'));
  preencherRascunhoContato();
  fireEvent.click(screen.getByRole('button', { name: 'Salvar vínculo' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Vínculo recusado');
  const atualizar = screen.getByRole('button', { name: 'Atualizar' });
  atualizar.focus();
  fireEvent.click(atualizar);
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Salvar vínculo' })).toBeEnabled();
    expect(screen.getByLabelText('Canal')).toHaveValue('c1');
    expect(comercial.mock.calls.filter(([path]) => path === '/canais-comerciais')).toHaveLength(2);
  });
  expect(atualizar).toHaveFocus();
  expect(screen.getByRole('alert')).toHaveTextContent('Vínculo recusado');
  conferirRascunhoContato();
  expect(comercial.mock.calls.filter(([, body]) => body)).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Salvar vínculo' }));
  expect(await screen.findByRole('link', { name: /Abrir conversa/ })).toHaveAttribute('href', '/comercial/conversas?conversa=conv-recuperada');
  expect(comercial.mock.calls.filter(([, body]) => body)).toHaveLength(2);
});

test.each([null, 'conversa-antiga'])('nova versão bloqueia ações e vínculo anterior durante falha e recupera (%s)', async conversaId => {
  const leitura = pendente();
  const api = { comercial: jest.fn().mockResolvedValueOnce({ versao: 4, conversaId }).mockReturnValueOnce(leitura.promise).mockResolvedValue({ versao: 5, conversaId: 'conversa-atual' }) };
  const tela = versao => <MemoryRouter><AcompanhamentoComercial api={api} onboarding={{ id: 'f1', versao }} /></MemoryRouter>;
  const view = render(tela(4));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Agendar retorno' })).toBeEnabled());
  view.rerender(tela(5));
  expect(screen.getByRole('button', { name: 'Agendar retorno' })).toBeDisabled();
  expect(screen.queryByRole('link', { name: /Abrir conversa/ })).not.toBeInTheDocument();
  if (!conversaId) expect(screen.getByRole('button', { name: 'Vincular contato' })).toBeDisabled();
  await act(async () => leitura.reject(new Error('Falha na releitura')));
  expect(screen.getByRole('alert')).toHaveTextContent('Falha na releitura');
  expect(screen.getByRole('button', { name: 'Agendar retorno' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Atualizar acompanhamento' }));
  expect(await screen.findByRole('link', { name: /Abrir conversa/ })).toHaveAttribute('href', '/comercial/conversas?conversa=conversa-atual');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(api.comercial.mock.calls.filter(([, body]) => body)).toHaveLength(0);
});

test('revisão explícita relê contato mesmo sem mudar versão e descarta resposta tardia', async () => {
  const antiga = pendente();
  const api = { comercial: jest.fn().mockResolvedValueOnce({ versao: 4, conversaId: null }).mockReturnValueOnce(antiga.promise).mockResolvedValue({ versao: 4, conversaId: 'persistida' }) };
  const tela = revisao => <MemoryRouter><AcompanhamentoComercial api={api} onboarding={{ id: 'f1', versao: 4 }} revisao={revisao} /></MemoryRouter>;
  const view = render(tela(0));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Vincular contato' })).toBeEnabled());
  view.rerender(tela(1));
  expect(screen.getByRole('button', { name: 'Vincular contato' })).toBeDisabled();
  view.rerender(tela(2));
  expect(await screen.findByRole('link', { name: /Abrir conversa/ })).toHaveAttribute('href', '/comercial/conversas?conversa=persistida');
  await act(async () => antiga.resolve({ versao: 4, conversaId: 'obsoleta' }));
  expect(screen.getByRole('link', { name: /Abrir conversa/ })).toHaveAttribute('href', '/comercial/conversas?conversa=persistida');
  expect(api.comercial.mock.calls.filter(([, body]) => body)).toHaveLength(0);
});


test.each(['sucesso', 'falha', 'troca de ficha'])('POST lento de retorno conserva o desfecho após polling: %s', async caso => {
  const post = pendente();
  const atualizar = jest.fn();
  const api = { comercial: jest.fn((path, body) => body ? post.promise : Promise.resolve({ versao: 4, conversaId: null })) };
  const tela = (id, revisao) => <MemoryRouter><AcompanhamentoComercial api={api} onboarding={{ id, versao: 4 }} revisao={revisao} onAtualizar={atualizar} /></MemoryRouter>;
  const view = render(tela('f1', 0));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Agendar retorno' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Agendar retorno' }));
  fireEvent.change(screen.getByLabelText('Próxima ação'), { target: { value: 'Revisar contrato lento' } });
  fireEvent.change(screen.getByLabelText('Data e hora'), { target: { value: '2026-10-20T10:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Salvar retorno' }));
  view.rerender(tela(caso === 'troca de ficha' ? 'f2' : 'f1', 1));
  await waitFor(() => expect(api.comercial).toHaveBeenCalledTimes(3));
  await act(async () => {
    if (caso === 'falha') post.reject(new Error('Resultado incerto; conferir antes de repetir'));
    else post.resolve({ versao: 5, retorno: { dados: { acao: 'Revisar contrato lento', quando: '2026-10-20T13:00:00Z', responsavelNome: 'QA' } } });
  });
  if (caso === 'sucesso') {
    expect(screen.getByText(/Revisar contrato lento.*QA/)).toBeVisible();
    expect(screen.queryByLabelText('Próxima ação')).not.toBeInTheDocument();
    expect(atualizar).toHaveBeenCalledTimes(1);
  } else if (caso === 'falha') {
    expect(screen.getByRole('alert')).toHaveTextContent('Resultado incerto');
    expect(screen.getByLabelText('Próxima ação')).toHaveValue('Revisar contrato lento');
  } else {
    expect(screen.queryByText(/Revisar contrato lento/)).not.toBeInTheDocument();
    expect(atualizar).not.toHaveBeenCalled();
  }
  expect(api.comercial.mock.calls.filter(([, body]) => body)).toHaveLength(1);
});

test('contato confirmado após polling atualiza vínculo sem nova preparação', async () => {
  const post = pendente(); let vinculado = false;
  const api = { comercial: jest.fn((path, body) => {
    if (path === '/canais-comerciais') return Promise.resolve({ canais: [{ id: 'c1', chave: 'Comercial' }] });
    if (body) return post.promise;
    return Promise.resolve({ versao: 4, conversaId: vinculado ? 'conv-lenta' : null });
  }) };
  const atualizar = jest.fn();
  const tela = revisao => <MemoryRouter><AcompanhamentoComercial api={api} onboarding={{ id: 'f1', versao: 4 }} revisao={revisao} onAtualizar={atualizar} /></MemoryRouter>;
  const view = render(tela(0));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Vincular contato' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Vincular contato' }));
  await screen.findByRole('option', { name: 'Comercial' });
  fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Contato QA' } });
  fireEvent.change(screen.getByLabelText('Telefone com DDI'), { target: { value: '5521999990000' } });
  fireEvent.change(screen.getByLabelText('Origem da autorização'), { target: { value: 'Solicitação fictícia' } });
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Salvar vínculo' }));
  view.rerender(tela(1));
  await waitFor(() => expect(api.comercial).toHaveBeenCalledTimes(4));
  vinculado = true;
  await act(async () => post.resolve({ conversaId: 'conv-lenta', atendimentoId: 'lead-qa' }));
  expect(await screen.findByRole('link', { name: /Abrir conversa/ })).toHaveAttribute('href', '/comercial/conversas?conversa=conv-lenta');
  expect(atualizar).toHaveBeenCalledTimes(1);
  expect(api.comercial.mock.calls.filter(([, body]) => body)).toHaveLength(1);
});
