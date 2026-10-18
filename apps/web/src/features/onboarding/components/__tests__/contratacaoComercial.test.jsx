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
