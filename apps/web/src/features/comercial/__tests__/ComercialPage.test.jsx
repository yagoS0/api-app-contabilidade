import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ComercialPage } from '../ComercialPage';
import { etapaDaOportunidade } from '../comercialModel';
jest.mock('../../whatsapp/pages/renderWhatsappPage', () => ({ WhatsappPage: ({ area }) => <p>Área {area}</p> }));
test('oportunidades preservam conclusão avulsa e contratação pendente', () => {
  expect(etapaDaOportunidade({ status: 'CONCLUIDO_AVULSO', faseComercial: 'LEAD' })).toBe('CONCLUIDO');
  expect(etapaDaOportunidade({ status: 'EM_TRILHA', faseComercial: 'CONTRATADO' })).toBe('ONBOARDING');
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
  expect(abas.getByLabelText('1 oportunidades em andamento')).toBeVisible();
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
