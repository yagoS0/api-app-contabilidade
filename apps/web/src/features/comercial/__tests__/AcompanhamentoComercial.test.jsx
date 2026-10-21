import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AcompanhamentoComercial } from '../AcompanhamentoComercial';

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
  await waitFor(() => expect(screen.getByRole('button', { name: 'Iniciar contato' })).toBeEnabled());
  fireEvent.click(await screen.findByRole('button', { name: 'Iniciar contato' }));
  await screen.findByRole('option', { name: 'Comercial' });
  fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Contato demonstração' } });
  fireEvent.change(screen.getByLabelText('Telefone com DDI'), { target: { value: '5521999990000' } });
  fireEvent.change(screen.getByLabelText('Origem da autorização'), { target: { value: 'Solicitou pelo formulário de teste' } });
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Preparar conversa' }));
  expect(await screen.findByRole('link', { name: /Abrir conversa/ })).toHaveAttribute('href', '/comercial/conversas?conversa=conv1');
  expect(comercial).toHaveBeenCalledWith('/onboardings/f1/contato', expect.objectContaining({ autorizado: true, canalId: 'c1' }));
  expect(comercial.mock.calls.filter(([, body]) => body)).toHaveLength(1);
});

test('oferece localizar contato existente sem preparar vínculo ou enviar mensagem', async () => {
  const comercial = jest.fn(async () => ({ versao: 4, conversaId: null }));
  montar(comercial);
  const link = screen.getByRole('link', { name: 'Localizar contato' });
  expect(link).toHaveAttribute('href', '/comercial/conversas');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Iniciar contato' })).toBeEnabled());
  fireEvent.click(link);
  expect(comercial.mock.calls).toEqual([['/onboardings/f1/acompanhamento']]);
});

test('leitura indisponível não autoriza preparar contato como se não houvesse vínculo', async () => {
  const comercial = jest.fn(async () => { throw new Error('Leitura indisponível'); });
  montar(comercial);
  expect(await screen.findByRole('alert')).toHaveTextContent('Leitura indisponível');
  expect(screen.getByRole('button', { name: 'Iniciar contato' })).toBeDisabled();
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

test.each([null, 'conversa-antiga'])('nova versão bloqueia ações e vínculo anterior durante falha e recupera (%s)', async conversaId => {
  const leitura = pendente();
  const api = { comercial: jest.fn().mockResolvedValueOnce({ versao: 4, conversaId }).mockReturnValueOnce(leitura.promise).mockResolvedValue({ versao: 5, conversaId: 'conversa-atual' }) };
  const tela = versao => <MemoryRouter><AcompanhamentoComercial api={api} onboarding={{ id: 'f1', versao }} /></MemoryRouter>;
  const view = render(tela(4));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Agendar retorno' })).toBeEnabled());
  view.rerender(tela(5));
  expect(screen.getByRole('button', { name: 'Agendar retorno' })).toBeDisabled();
  expect(screen.queryByRole('link', { name: /Abrir conversa/ })).not.toBeInTheDocument();
  if (!conversaId) expect(screen.getByRole('button', { name: 'Iniciar contato' })).toBeDisabled();
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
  await waitFor(() => expect(screen.getByRole('button', { name: 'Iniciar contato' })).toBeEnabled());
  view.rerender(tela(1));
  expect(screen.getByRole('button', { name: 'Iniciar contato' })).toBeDisabled();
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
  await waitFor(() => expect(screen.getByRole('button', { name: 'Iniciar contato' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Iniciar contato' }));
  await screen.findByRole('option', { name: 'Comercial' });
  fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Contato QA' } });
  fireEvent.change(screen.getByLabelText('Telefone com DDI'), { target: { value: '5521999990000' } });
  fireEvent.change(screen.getByLabelText('Origem da autorização'), { target: { value: 'Solicitação fictícia' } });
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Preparar conversa' }));
  view.rerender(tela(1));
  await waitFor(() => expect(api.comercial).toHaveBeenCalledTimes(4));
  vinculado = true;
  await act(async () => post.resolve({ conversaId: 'conv-lenta', atendimentoId: 'lead-qa' }));
  expect(await screen.findByRole('link', { name: /Abrir conversa/ })).toHaveAttribute('href', '/comercial/conversas?conversa=conv-lenta');
  expect(atualizar).toHaveBeenCalledTimes(1);
  expect(api.comercial.mock.calls.filter(([, body]) => body)).toHaveLength(1);
});
