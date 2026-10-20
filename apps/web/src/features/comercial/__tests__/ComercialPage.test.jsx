import { act, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ComercialPage } from '../ComercialPage';
import { etapaDaOportunidade } from '../comercialModel';
jest.mock('../../whatsapp/pages/renderWhatsappPage', () => ({ WhatsappPage: ({ area }) => <p>Área {area}</p> }));
test('oportunidades preservam conclusão avulsa e contratação pendente', () => {
  expect(etapaDaOportunidade({ status: 'CONCLUIDO_AVULSO', faseComercial: 'LEAD' })).toBe('CONCLUIDO');
  expect(etapaDaOportunidade({ status: 'EM_TRILHA', faseComercial: 'CONTRATADO' })).toBe('INDISPONIVEL');
});
test('busca encontra oportunidade e abre a ficha existente', async () => {
  const api = { listarOnboardings: jest.fn(async () => ({ itens: [{ id: 'f1', razaoSocial: 'Clínica teste', origem: 'ABERTURA', faseComercial: 'ANALISE' }, { id: 'f2', responsavelNome: 'Outro contato', status: 'DESISTIU' }] })) };
  render(<MemoryRouter initialEntries={['/comercial/oportunidades']}><ComercialPage api={api} /></MemoryRouter>);
  expect(await screen.findByRole('link', { name: /Clínica teste/ })).toHaveAttribute('href', '/onboardings/f1');
  fireEvent.change(screen.getByLabelText('Buscar oportunidade'), { target: { value: 'clinica' } });
  expect(screen.queryByRole('link', { name: /Outro contato/ })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Etapa comercial'), { target: { value: 'PROPOSTA' } });
  expect(screen.getByText('Nenhuma oportunidade encontrada')).toBeVisible();
});
test('falha da API é visível e pode ser recuperada', async () => {
  const api = { listarOnboardings: jest.fn().mockRejectedValueOnce(new Error('Falha de conexão')).mockResolvedValue({ itens: [] }) };
  render(<MemoryRouter><ComercialPage api={api} /></MemoryRouter>);
  expect(await screen.findByRole('alert')).toHaveTextContent('Falha de conexão');
  fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
  expect(await screen.findByText('Seu próximo cliente começa aqui')).toBeVisible();
});

test('subabas mostram retornos, oportunidades, mensagens e onboardings pendentes sem contar encerrados', async () => {
  const ontem = new Date(Date.now() - 86400000).toISOString();
  const api = {
    listarOnboardings: jest.fn(async () => ({ itens: [
      { id: 'lead', faseComercial: 'LEAD', retornoComercial: { dados: { quando: ontem, acao: 'Ligar' } } },
      { id: 'implantacao', status: 'EM_TRILHA', faseComercial: 'CONTRATADO', progresso: { total: 5, concluidas: 2 } },
      { id: 'concluido', status: 'CONVERTIDO', progresso: { total: 5, concluidas: 2 }, retornoComercial: { dados: { quando: ontem } } },
      { id: 'perdido', status: 'DESISTIU' },
    ] })),
    getResumoWhatsapp: jest.fn(async () => ({ ok: true, resumo: { conversas: 3, naoVinculadas: 1, conversasNaoLidas: 2, mensagensNaoLidas: 125 } })),
  };
  render(<MemoryRouter><ComercialPage api={api} /></MemoryRouter>);
  const abas = within(screen.getByRole('navigation', { name: 'Comercial' }));
  expect(await abas.findByLabelText('1 retornos para hoje ou atrasados')).toBeVisible();
  expect(abas.getByLabelText('2 oportunidades em andamento')).toBeVisible();
  expect(abas.getByLabelText('1 onboardings com etapas pendentes')).toBeVisible();
  expect(await abas.findByLabelText('125 mensagens comerciais não lidas')).toHaveTextContent('99+');
  expect(api.getResumoWhatsapp).toHaveBeenCalledWith({ area: 'comercial' });
});

test('subabas não apresentam badges vazios ou totais inventados quando resumo falha', async () => {
  const api = { listarOnboardings: jest.fn(async () => ({ itens: [] })), getResumoWhatsapp: jest.fn(async () => { throw new Error('Offline'); }) };
  render(<MemoryRouter><ComercialPage api={api} /></MemoryRouter>);
  await screen.findByText('Seu próximo cliente começa aqui');
  const nav = screen.getByRole('navigation', { name: 'Comercial' });
  expect(nav.querySelectorAll('.commercial-tab-badge')).toHaveLength(0);
});

test('fila padrão corresponde ao selo e permite consultar desistências sem notificação ativa', async () => {
  const api = { listarOnboardings: jest.fn().mockResolvedValue({ itens: [
    { id: 'ativa', responsavelNome: 'Ativa', status: 'RECEBIDO' },
    { id: 'perdida', responsavelNome: 'Perdida', status: 'DESISTIU' },
    { id: 'encerrada', responsavelNome: 'Encerrada', status: 'CONVERTIDO' },
  ] }) };
  render(<MemoryRouter initialEntries={['/comercial/oportunidades']}><ComercialPage api={api} /></MemoryRouter>);
  await screen.findByLabelText('1 oportunidades em andamento');
  expect(screen.getByRole('link', { name: /Ativa/ })).toBeVisible();
  expect(screen.queryByRole('link', { name: /Perdida|Encerrada/ })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Etapa comercial'), { target: { value: 'DESISTIU' } });
  expect(screen.getByRole('link', { name: /Perdida/ })).toHaveAttribute('href', '/onboardings/perdida');
  expect(screen.queryByRole('link', { name: /Ativa/ })).not.toBeInTheDocument();
  expect(screen.getByLabelText('1 oportunidades em andamento')).toBeVisible();
  fireEvent.change(screen.getByLabelText('Etapa comercial'), { target: { value: 'TODAS' } });
  expect(screen.getByRole('link', { name: /Encerrada/ })).toBeVisible();
});

test('releitura após desistência retira oportunidade da fila e do selo', async () => {
  const api = { listarOnboardings: jest.fn().mockResolvedValueOnce({ itens: [{ id: 'f', responsavelNome: 'Contato', status: 'RECEBIDO' }] })
    .mockResolvedValue({ itens: [{ id: 'f', responsavelNome: 'Contato', status: 'DESISTIU' }] }) };
  render(<MemoryRouter><ComercialPage api={api} /></MemoryRouter>);
  await screen.findByLabelText('1 oportunidades em andamento');
  await act(async () => { window.dispatchEvent(new Event('focus')); });
  await waitFor(() => expect(screen.queryByLabelText('1 oportunidades em andamento')).not.toBeInTheDocument());
  expect(screen.queryByRole('link', { name: /Contato/ })).not.toBeInTheDocument();
});

test('clicar novamente em Oportunidades limpa busca e histórico e retorna à fila ativa', async () => {
  const api = { listarOnboardings: jest.fn().mockResolvedValue({ itens: [
    { id: 'ativa', responsavelNome: 'Ativa', status: 'RECEBIDO' },
    { id: 'perdida', responsavelNome: 'Perdida', status: 'DESISTIU' },
  ] }) };
  render(<MemoryRouter initialEntries={['/comercial/oportunidades']}><ComercialPage api={api} /></MemoryRouter>);
  await screen.findByLabelText('1 oportunidades em andamento');
  fireEvent.change(screen.getByLabelText('Etapa comercial'), { target: { value: 'DESISTIU' } });
  fireEvent.change(screen.getByLabelText('Buscar oportunidade'), { target: { value: 'Perdida' } });
  fireEvent.click(within(screen.getByRole('navigation', { name: 'Comercial' })).getByRole('link', { name: /Oportunidades/ }));
  expect(screen.getByLabelText('Buscar oportunidade')).toHaveValue('');
  expect(screen.getByLabelText('Etapa comercial')).toHaveValue('');
  expect(screen.getByRole('link', { name: /Ativa/ })).toBeVisible();
  expect(screen.queryByRole('link', { name: /Perdida/ })).not.toBeInTheDocument();
});

test('releitura sem rascunho descartado remove sua linha e preserva as demais', async () => {
  const ativa = { id: 'ativa', responsavelNome: 'Ativa', status: 'RECEBIDO' };
  const api = { listarOnboardings: jest.fn().mockResolvedValueOnce({ itens: [
    ativa, { id: 'rascunho', responsavelNome: 'Rascunho descartável', status: 'RASCUNHO' },
  ] }).mockResolvedValue({ itens: [ativa] }) };
  render(<MemoryRouter initialEntries={['/comercial/oportunidades']}><ComercialPage api={api} /></MemoryRouter>);
  await screen.findByLabelText('2 oportunidades em andamento');
  // Simula somente a releitura após o descarte na ficha; não testa o endpoint de exclusão.
  await act(async () => { window.dispatchEvent(new Event('focus')); });
  await screen.findByLabelText('1 oportunidades em andamento');
  expect(screen.queryByRole('link', { name: /Rascunho descartável/ })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Ativa/ })).toBeVisible();
});

test('resposta antiga não restaura oportunidade desistida nem altera mensagens não lidas', async () => {
  let resolverAntiga;
  const api = {
    listarOnboardings: jest.fn().mockImplementationOnce(() => new Promise(resolve => { resolverAntiga = resolve; }))
      .mockResolvedValue({ itens: [{ id: 'f', responsavelNome: 'Contato', status: 'DESISTIU' }] }),
    getResumoWhatsapp: jest.fn().mockResolvedValue({ ok: true, resumo: { conversas: 1, naoVinculadas: 0, conversasNaoLidas: 1, mensagensNaoLidas: 4 } }),
  };
  render(<MemoryRouter initialEntries={['/comercial/oportunidades']}><ComercialPage api={api} /></MemoryRouter>);
  await screen.findByLabelText('4 mensagens comerciais não lidas');
  await act(async () => { window.dispatchEvent(new Event('focus')); });
  await screen.findByText('Seu próximo cliente começa aqui');
  await act(async () => { resolverAntiga({ itens: [{ id: 'f', responsavelNome: 'Contato', status: 'RECEBIDO' }] }); });
  expect(screen.queryByLabelText('1 oportunidades em andamento')).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /Contato/ })).not.toBeInTheDocument();
  expect(screen.getByLabelText('4 mensagens comerciais não lidas')).toBeVisible();
  fireEvent.change(screen.getByLabelText('Etapa comercial'), { target: { value: 'DESISTIU' } });
  expect(screen.getByRole('link', { name: /Contato/ })).toBeVisible();
});
