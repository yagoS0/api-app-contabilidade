import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ConversaoModal } from '../ConversaoModal';
import { etapaDaOportunidade } from '../../../comercial/comercialModel';

const ficha = { id: 'o', versao: 3, origem: 'TRANSFERENCIA', status: 'EM_TRILHA', dados: {}, conversao: { contratoConferido: false, excecaoAplicavel: true, motivo: 'Contratação necessária.' } };
test('T31/T35: modal bloqueado, exceção explícita e campos acessíveis somente quando aplicáveis', () => {
  const converter = jest.fn();
  const { rerender } = render(<ConversaoModal onboarding={ficha} onConverter={converter} onFechar={() => {}} />);
  expect(screen.getByRole('button', { name: 'Criar empresa' })).toBeDisabled();
  expect(screen.queryByLabelText(/Justificativa da exceção/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox', { name: /Registrar contratação externa/ }));
  expect(screen.getByLabelText(/Justificativa da exceção/)).toBeVisible();
  expect(screen.getByLabelText(/Evidência ou referência/)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Criar empresa' })).toBeDisabled();
  expect(converter).not.toHaveBeenCalled();
  rerender(<ConversaoModal onboarding={{ ...ficha, conversao: { contratoConferido: false, excecaoAplicavel: false } }} onConverter={converter} onFechar={() => {}} />);
  expect(screen.queryByRole('checkbox', { name: /Registrar contratação externa/ })).not.toBeInTheDocument();
});
test('T32/T38: ganha é independente da carteira e da fase manual', () => {
  expect(etapaDaOportunidade({ ...ficha, faseComercial: 'CONTRATADO' })).toBe('INDISPONIVEL');
  expect(etapaDaOportunidade({ ...ficha, comercial: { atual: 'pagamento', contratacao: { ganha: true, carteiraPermitida: false } } })).toBe('GANHA');
  expect(etapaDaOportunidade({ ...ficha, status: 'CONVERTIDO', comercial: { contratacao: { ganha: true } } })).toBe('CONCLUIDO');
});

test('T35/T37: atualização da versão preserva textos e exige nova confirmação também na recuperação', async () => {
  const vincular = jest.fn();
  const erro = { code: 'cnpj_ja_na_carteira', payload: { portalClientId: 'empresa' } };
  const { rerender } = render(<ConversaoModal onboarding={ficha} erro={erro} onVincular={vincular} onFechar={() => {}} />);
  fireEvent.click(screen.getByRole('checkbox', { name: /Registrar contratação externa/ }));
  fireEvent.change(screen.getByLabelText(/Justificativa da exceção/), { target: { value: 'Cliente contratado fora da Altan' } });
  fireEvent.change(screen.getByLabelText(/Evidência ou referência/), { target: { value: 'Contrato externo sintético número 001' } });
  expect(screen.getByRole('button', { name: 'Vincular ao existente' })).toBeEnabled();
  rerender(<ConversaoModal onboarding={{ ...ficha, versao: 4 }} erro={erro} onVincular={vincular} onFechar={() => {}} />);
  expect(screen.getByRole('checkbox', { name: /Registrar contratação externa/ })).not.toBeChecked();
  expect(screen.getByLabelText(/Justificativa da exceção/)).toHaveValue('Cliente contratado fora da Altan');
  expect(screen.getByRole('button', { name: 'Vincular ao existente' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Criar empresa' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Vincular ao existente' }));
  expect(vincular).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('checkbox', { name: /Registrar contratação externa/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Vincular ao existente' }));
  await waitFor(() => expect(vincular).toHaveBeenCalledWith('empresa', '', expect.objectContaining({ contratacaoExterna: expect.objectContaining({ versao: 4, confirmada: true }) })));
});

test('C1: carteira antecipada continua sem Ganha; recebimento posterior muda só projeção comercial', () => {
  const item = { ...ficha, status: 'CONVERTIDO', comercial: { contratacao: { politica: 'COMERCIAL_2026_10_V1', ganha: false } } };
  expect(etapaDaOportunidade(item)).toBe('CONTRATADO');
  item.comercial.contratacao.ganha = true;
  expect(etapaDaOportunidade(item)).toBe('GANHA');
});


import { OnboardingDetailPage } from '../../pages/renderOnboardingDetailPage';
import { projetarContratacao, resumirContratacao } from '../../../../../../../packages/shared/src/onboarding/contratacaoComercial.js';

test.each([false, true])('detalhe distingue assinatura histórica de recebimento confirmado (%s)', async pago => {
  const proposta = { id: 'p', versao: 1, status: 'ACEITA', opcaoAceita: 'mensal', snapshot: {} };
  const contrato = { id: 'c', propostaId: 'p', status: 'ASSINADO_CONFERIDO', dados: { opcao: { chave: 'mensal', recorrente: true } } };
  const { contextoContrato } = await import('../../../../../../../packages/shared/src/onboarding/contratacaoComercial.js');
  const o = { ...ficha, politicaComercial: pago ? 'COMERCIAL_2026_10_V1' : null, etapas: [] };
  const marcos = pago ? [{ tipo: 'PAGAMENTO_HONORARIOS_CONFERIDO', atorId: 'contador', dados: { politica: 'R35', contratoId: 'c', confirmadoEm: '2026-10-25', contextoContrato: contextoContrato(proposta, contrato) } }] : [];
  const contratacao = resumirContratacao(projetarContratacao({ onboarding: o, propostas: [proposta], contratos: [contrato], marcos }));
  expect(contratacao).toMatchObject({ ganha: true, pagamentoConferido: pago });
  const api = { getOnboarding: jest.fn().mockResolvedValue({ onboarding: { ...o, comercial: { contratacao } } }) };
  render(<OnboardingDetailPage api={api} onboardingId="o" onVoltar={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Implantação', exact: true }));
  if (pago) {
    expect(screen.getByText(/^Recebimento confirmado\./)).toBeVisible();
    expect(screen.queryByText(/Contratação confirmada por assinatura na política histórica/)).not.toBeInTheDocument();
  } else {
    expect(screen.getByText(/Contratação confirmada por assinatura na política histórica; recebimento não confirmado/)).toBeVisible();
    expect(screen.queryByText(/^Recebimento confirmado\./)).not.toBeInTheDocument();
  }
});
