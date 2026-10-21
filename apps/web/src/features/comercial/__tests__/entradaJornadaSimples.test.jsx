import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { ComercialPage } from '../ComercialPage';
jest.mock('../../whatsapp/pages/renderWhatsappPage', () => ({ WhatsappPage: () => null }));
function Localizacao() { return <output aria-label="Rota atual">{useLocation().pathname}</output>; }

test.each([
  ['Está trocando de contador', 'TRANSFERENCIA', '/onboardings/nova'],
  ['Empresa parada', 'INATIVA', '/onboardings/nova'],
  ['Vai abrir a empresa', 'ABERTURA', '/onboardings/nova/editar'],
  ['Pessoa física', 'PESSOA_FISICA', '/onboardings/nova/editar'],
])('entrada interna %s abre o caminho adequado sem criar outra ficha', async (rotulo, origem, rota) => {
  const api = { listarOnboardings: jest.fn().mockResolvedValue({ itens: [] }), criarOnboarding: jest.fn().mockResolvedValue({ onboarding: { id: 'nova' } }) };
  render(<MemoryRouter><ComercialPage api={api} /><Localizacao /></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: '+ Nova oportunidade' }));
  fireEvent.click(screen.getByRole('radio', { name: rotulo }));
  fireEvent.click(screen.getByRole('radio', { name: /Escritório, durante o atendimento/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Iniciar preenchimento interno' }));
  await screen.findByText(rota);
  expect(api.criarOnboarding).toHaveBeenCalledTimes(1);
  expect(api.criarOnboarding).toHaveBeenCalledWith(origem);
});
