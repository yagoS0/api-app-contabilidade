import { render, screen, fireEvent } from '@testing-library/react';
import { api } from '../../../api';
import { EsqueciSenhaPage } from '../EsqueciSenhaPage';
import { RedefinirSenhaPage } from '../RedefinirSenhaPage';
import { EmailCodeLogin } from '../EmailCodeLogin';

afterEach(() => jest.restoreAllMocks());

test('pedido de recuperação encaminha foco ao resultado sem afirmar existência da conta', async () => {
  jest.spyOn(api, 'solicitarRedefinicao').mockResolvedValue({ ok: true });
  render(<EsqueciSenhaPage aoVoltar={() => {}} />);
  fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'cliente@example.test' } });
  fireEvent.click(screen.getByRole('button', { name: 'Enviar instruções' }));
  expect(await screen.findByRole('heading', { name: 'Verifique seu e-mail' })).toHaveFocus();
  expect(screen.getByRole('status')).toHaveTextContent('Se houver uma conta');
});

test('redefinição encaminha foco à confirmação e conserva aviso de encerramento das sessões', async () => {
  jest.spyOn(api, 'redefinirSenha').mockResolvedValue({ ok: true });
  render(<RedefinirSenhaPage token="mock" aoConcluir={() => {}} />);
  fireEvent.change(screen.getByLabelText('Nova senha'), { target: { value: 'Senha123!' } });
  fireEvent.change(screen.getByLabelText('Repita a nova senha'), { target: { value: 'Senha123!' } });
  fireEvent.click(screen.getByRole('button', { name: 'Salvar nova senha' }));
  expect(await screen.findByRole('heading', { name: 'Senha alterada' })).toHaveFocus();
  expect(screen.getByRole('status')).toHaveTextContent('todos os dispositivos');
});

test('alterar e-mail devolve foco ao campo sem confirmar código ou autenticar', async () => {
  jest.spyOn(api, 'solicitarCodigoAcesso').mockResolvedValue({ challengeId: 'mock', resendAfter: 60 });
  const confirmar = jest.spyOn(api, 'confirmarCodigoAcesso');
  render(<EmailCodeLogin voltar={() => {}} />);
  fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'cliente@example.test' } });
  fireEvent.click(screen.getByRole('button', { name: 'Receber código' }));
  expect(await screen.findByLabelText('Código de 8 dígitos')).toHaveFocus();
  fireEvent.click(screen.getByRole('button', { name: 'Alterar e-mail' }));
  expect(screen.getByLabelText('E-mail')).toHaveFocus();
  expect(confirmar).not.toHaveBeenCalled();
});
