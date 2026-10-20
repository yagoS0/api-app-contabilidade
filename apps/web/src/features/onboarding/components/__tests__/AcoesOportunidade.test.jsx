import { act, render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { AcoesOportunidade } from '../AcoesOportunidade';
const item = { id: 'ficticia', status: 'RASCUNHO', responsavelNome: 'Contato fictício' };
const previa = { ok: true, elegibilidade: { id: item.id, versao: 3, podeExcluir: true, podeEncerrar: true, impedimentos: [] } };
function montar(extra = {}) {
  const api = { getElegibilidadeDescarteOnboarding: jest.fn().mockResolvedValue(previa), desistirOnboarding: jest.fn(), descartarOnboarding: jest.fn(), ...extra };
  const onPersistir = jest.fn();
  render(<AcoesOportunidade api={api} item={item} onPersistir={onPersistir} />);
  fireEvent.click(screen.getByLabelText('Ações de Contato fictício'));
  return { api, onPersistir };
}
test('encerramento explicita desistência e preservação; cancela sem escrita', async () => {
  const { api } = montar();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Encerrar oportunidade' }));
  expect(screen.getByRole('dialog')).toHaveTextContent('histórico permanecem consultáveis');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmar desistência' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
  expect(api.desistirOnboarding).not.toHaveBeenCalled();
});
test('grava a versão lida uma vez, mesmo com duplo clique, e só atualiza após confirmação', async () => {
  let concluir;
  const { api, onPersistir } = montar({ desistirOnboarding: jest.fn(() => new Promise(r => { concluir = r; })) });
  fireEvent.click(screen.getByRole('menuitem', { name: 'Encerrar oportunidade' }));
  const confirmar = screen.getByRole('button', { name: 'Confirmar desistência' });
  await waitFor(() => expect(confirmar).toBeEnabled());
  fireEvent.change(screen.getByLabelText('Motivo (opcional)'), { target: { value: 'Sem interesse' } });
  fireEvent.click(confirmar); fireEvent.click(confirmar);
  expect(api.desistirOnboarding).toHaveBeenCalledTimes(1);
  expect(api.desistirOnboarding).toHaveBeenCalledWith(item.id, 'Sem interesse', 3);
  expect(onPersistir).not.toHaveBeenCalled();
  concluir({ ok: true, onboarding: { ...item, status: 'DESISTIU', versao: 4 } });
  await waitFor(() => expect(onPersistir).toHaveBeenCalledTimes(1));
});
test.each([undefined, { ok: false }, { ok: true, onboarding: { id: 'outra', status: 'DESISTIU' } }])('retorno inválido mantém erro e exige releitura %j', async r => {
  const { onPersistir } = montar({ desistirOnboarding: jest.fn().mockResolvedValue(r) });
  fireEvent.click(screen.getByRole('menuitem', { name: 'Encerrar oportunidade' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmar desistência' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar desistência' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Resposta sem confirmação');
  expect(onPersistir).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Confirmar desistência' })).toBeDisabled();
});
test('vínculos impedem exclusão e oferecem encerramento explícito', async () => {
  const { api } = montar({ getElegibilidadeDescarteOnboarding: jest.fn().mockResolvedValue({ ok: true, elegibilidade: { ...previa.elegibilidade, podeExcluir: false, impedimentos: ['Conversa vinculada', 'Documento recebido'] } }) });
  fireEvent.click(screen.getByRole('menuitem', { name: 'Excluir rascunho' }));
  const dialog = screen.getByRole('dialog');
  expect(await within(dialog).findByText('Documento recebido')).toBeVisible();
  expect(within(dialog).getByRole('button', { name: 'Excluir rascunho' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Encerrar como desistência' }));
  expect(screen.getByRole('dialog')).toHaveAccessibleName('Encerrar oportunidade?');
  expect(api.descartarOnboarding).not.toHaveBeenCalled();
});
test('recusa de acesso e recuperação são visíveis sem habilitar escrita', async () => {
  const { api } = montar({ getElegibilidadeDescarteOnboarding: jest.fn().mockRejectedValueOnce(new Error('Sem permissão')).mockResolvedValue(previa) });
  fireEvent.click(screen.getByRole('menuitem', { name: 'Encerrar oportunidade' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Sem permissão');
  fireEvent.click(screen.getByRole('button', { name: 'Conferir novamente' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmar desistência' })).toBeEnabled());
  expect(api.desistirOnboarding).not.toHaveBeenCalled();
});

test('menu oferece navegação por teclado e Escape devolve foco sem abrir confirmação', () => {
  montar();
  const menu = screen.getByRole('menu');
  expect(within(menu).getByRole('menuitem', { name: 'Encerrar oportunidade' })).toHaveFocus();
  fireEvent.keyDown(document.activeElement, { key: 'End' });
  expect(within(menu).getByRole('menuitem', { name: 'Excluir rascunho' })).toHaveFocus();
  fireEvent.keyDown(document.activeElement, { key: 'Escape' });
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Ações de Contato fictício')).toHaveFocus();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('falha de gravação conserva motivo e exige nova prévia antes de repetir', async () => {
  const { api, onPersistir } = montar({ desistirOnboarding: jest.fn().mockRejectedValue(new Error('Versão alterada')) });
  fireEvent.click(screen.getByRole('menuitem', { name: 'Encerrar oportunidade' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmar desistência' })).toBeEnabled());
  fireEvent.change(screen.getByLabelText('Motivo (opcional)'), { target: { value: 'Motivo preservado' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar desistência' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Versão alterada');
  expect(screen.getByLabelText('Motivo (opcional)')).toHaveValue('Motivo preservado');
  expect(onPersistir).not.toHaveBeenCalled();
  api.getElegibilidadeDescarteOnboarding.mockResolvedValue({ ok: true, elegibilidade: { ...previa.elegibilidade, versao: 4 } });
  api.desistirOnboarding.mockResolvedValue({ ok: true, onboarding: { ...item, versao: 5, status: 'DESISTIU' } });
  fireEvent.click(screen.getByRole('button', { name: 'Conferir novamente' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmar desistência' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar desistência' }));
  await waitFor(() => expect(onPersistir).toHaveBeenCalledTimes(1));
  expect(api.desistirOnboarding).toHaveBeenLastCalledWith(item.id, 'Motivo preservado', 4);
});

test.each(['sucesso', 'erro'])('troca de item sem key externa ignora %s antigo e preserva a nova confirmação', async resultado => {
  let resolver, rejeitar;
  const outra = { ...item, id: 'outra-ficticia', responsavelNome: 'Outro contato' };
  const api = {
    getElegibilidadeDescarteOnboarding: jest.fn(id => Promise.resolve({
      ...previa, elegibilidade: { ...previa.elegibilidade, id },
    })),
    desistirOnboarding: jest.fn(() => new Promise((resolve, reject) => { resolver = resolve; rejeitar = reject; })),
  };
  const onPersistir = jest.fn(), aoRestaurarFoco = jest.fn();
  const tela = atual => <AcoesOportunidade api={api} item={atual} onPersistir={onPersistir} aoRestaurarFoco={aoRestaurarFoco} />;
  const { rerender } = render(tela(item));
  fireEvent.click(screen.getByLabelText('Ações de Contato fictício'));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Encerrar oportunidade' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmar desistência' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar desistência' }));
  rerender(tela(outra));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('Ações de Outro contato'));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Encerrar oportunidade' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmar desistência' })).toBeEnabled());
  const motivoAtual = screen.getByLabelText('Motivo (opcional)');
  fireEvent.change(motivoAtual, { target: { value: 'Motivo da nova ficha' } });
  motivoAtual.focus();
  await act(async () => {
    if (resultado === 'sucesso') resolver({ ok: true, onboarding: { ...item, status: 'DESISTIU' } });
    else rejeitar(new Error('Falha da ficha anterior'));
  });
  expect(motivoAtual).toHaveFocus();
  expect(motivoAtual).toHaveValue('Motivo da nova ficha');
  expect(screen.getByRole('dialog')).toHaveTextContent('Outro contato');
  expect(screen.getByRole('button', { name: 'Confirmar desistência' })).toBeEnabled();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(onPersistir).not.toHaveBeenCalled();
  expect(aoRestaurarFoco).not.toHaveBeenCalled();
  expect(api.desistirOnboarding).toHaveBeenCalledTimes(1);
});
