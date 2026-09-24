import { render, screen, fireEvent } from '@testing-library/react';
import { AtendimentoComercial } from '../AtendimentoComercial';
import { criarMockComercial } from '../../../../api/mock/comercialMock';
jest.mock('../../../onboarding/components/FluxoComercial', () => ({ FluxoComercial: () => <p>Ferramentas internas do contador</p> }));

const pre = { intencao: 'PLANEJAMENTO', estado: 'ENCAMINHADO', nome: 'Ana', atividade: 'Comércio', necessidade: 'Avaliar tributação', palavraEntrada: 'IMPOSTO', ultimoRelato: 'Tenho uma loja' };
test('resumo sem ficha permite continuar pelo chat, sem impor uma transferência', async () => {
  const onEstado = jest.fn();
  const api = { comercial: jest.fn().mockResolvedValue({ atendimento: { id: 'a', triagem: { preatendimento: pre } } }) };
  render(<AtendimentoComercial api={api} conversa={{ id: 'c' }} onEstado={onEstado} slotEmpresa={<p>Vincular empresa operacional</p>} />);
  expect(await screen.findByRole('heading', { name: 'Planejamento tributário' })).toBeVisible();
  expect(screen.getByText('Com a equipe')).toBeVisible(); expect(screen.getByText('Ana')).toBeVisible();
  expect(screen.queryByLabelText('Motivo do atendimento')).not.toBeInTheDocument();
  expect(screen.queryByText('Vincular empresa operacional')).not.toBeInTheDocument();
  expect(screen.queryByText('Origem informada')).not.toBeInTheDocument(); expect(onEstado).toHaveBeenCalledWith(true);
  fireEvent.click(screen.getByRole('button', { name: 'Nova solicitação' }));
  expect(screen.getByLabelText('Tipo da nova solicitação')).toBeVisible();
  expect(api.comercial).toHaveBeenCalledTimes(1);
});
test('resumo de abertura mantém ficha e ferramentas humanas disponíveis', async () => {
  const api = { comercial: jest.fn().mockResolvedValue({ atendimento: { id: 'a', onboardingId: 'o', triagem: { preatendimento: { ...pre, intencao: 'ABERTURA' } } } }) };
  render(<AtendimentoComercial api={api} conversa={{ id: 'c' }} />);
  expect(await screen.findByRole('heading', { name: 'Abrir empresa' })).toBeVisible();
  expect(screen.getByRole('link', { name: 'Abrir ficha do cliente em nova aba' })).toHaveAttribute('href', '/onboardings/o');
  expect(screen.getByText('Ferramentas internas do contador')).toBeVisible();
  const ficha = screen.getByRole('link', { name: 'Abrir ficha do cliente em nova aba' });
  expect(ficha.compareDocumentPosition(screen.getByRole('heading', { name: 'Abrir empresa' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
test('mock devolve resumo inicial sem criar ficha para planejamento', async () => {
  const api = criarMockComercial({ onboardings: new Map(), persistir: jest.fn(), atendimentosIniciais: [{ id: 'a', conversaId: 'c', triagem: { preatendimento: pre } }] });
  const r = await api.comercial('/conversas/c');
  expect(r.atendimento.triagem.preatendimento).toEqual(pre); expect(r.atendimento.onboarding).toBeNull();
});

test('resumo anterior permanece acessível depois de abrir outra solicitação', async () => {
  const api = { comercial: jest.fn().mockResolvedValue({ atendimento: { id: 'novo', onboardingId: 'o' }, anteriores: [{ id: 'antigo', encerradoEm: '2026-09-24T12:00:00Z', triagem: { preatendimento: pre } }] }) };
  render(<AtendimentoComercial api={api} conversa={{ id: 'c' }} />);
  fireEvent.click(await screen.findByText('Solicitações anteriores (1)'));
  expect(screen.getByRole('heading', { name: 'Planejamento tributário' })).toBeVisible();
  expect(screen.getByText('Solicitação anterior')).toBeVisible(); expect(screen.getByText('Ana')).toBeVisible();
});

test('CNPJ informado aparece em dígitos e usa a cópia padrão do projeto', async () => {
  const copiar = jest.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copiar } });
  const api = { comercial: jest.fn().mockResolvedValue({ atendimento: { id: 'a', triagem: { preatendimento: { ...pre, dadosInformados: { cnpj: '11.222.333/0001-81' } } } } }) };
  render(<AtendimentoComercial api={api} conversa={{ id: 'c' }} />);
  const botao = await screen.findByRole('button', { name: 'Copiar o CNPJ de empresa informada sem máscara' });
  expect(botao).toHaveTextContent('11222333000181');
  fireEvent.click(botao); expect(copiar).toHaveBeenCalledWith('11222333000181');
  expect(await screen.findByText('✓')).toBeVisible();
});
