import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { FioDaConversa } from '../FioDaConversa';

jest.mock('../CompositorConversa', () => ({ CompositorConversa: () => <div>Compositor de mensagens</div> }));
const origem = { id: 'mensagem-1', direcao: 'in', tipo: 'text', corpo: 'Preciso conferir minha guia.', registradaEm: '2026-09-21T12:00:00Z', canal: { chave: 'Comercial' } };
const escopos = [
  { id: 'EMPRESA:a', rotulo: 'Empresa A', escopo: 'EMPRESA', portalClientId: 'a' },
  { id: 'CASO:x', rotulo: 'Solicitação atual', escopo: 'CASO', atendimentoLeadId: 'x' },
];
const conversa = { id: 'conversa-a', interlocutorId: 'pessoa-a', nomePerfilProvedor: 'Pessoa de teste',
  janela: { situacao: 'EXPIRADA' }, capacidades: { notaInterna: true, escoposNotas: escopos } };
const montar = (c = conversa, extras = {}) => {
  const hook = { api: { criarNotaInternaWhatsapp: jest.fn() }, salvarNota: jest.fn(async () => ({ ok: true })), responder: jest.fn() };
  const fio = { conversa: c, mensagens: [origem] };
  const ui = render(<FioDaConversa fio={fio} hook={hook} {...extras} />);
  return { hook, ui, fio };
};
function abrir() {
  fireEvent.click(screen.getByTestId('balao-mensagem-1'));
  fireEvent.click(screen.getByRole('button', { name: 'Criar nota interna' }));
}
function escrever(escopo, texto) {
  fireEvent.change(screen.getByLabelText('Escopo da nota interna'), { target: { value: escopo } });
  fireEvent.change(screen.getByLabelText('Texto da nota interna'), { target: { value: texto } });
}

test('mensagem abre nota com fonte e escopo autorizado, mesmo com janela expirada, sem transporte', async () => {
  const { hook } = montar(); abrir();
  const dialogo = screen.getByRole('dialog', { name: 'Criar nota interna' });
  expect(within(dialogo).getByText(origem.corpo)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Salvar nota interna' })).toBeDisabled();
  escrever('CASO:x', 'Conferir com a equipe fiscal.');
  fireEvent.click(screen.getByRole('button', { name: 'Salvar nota interna' }));
  await waitFor(() => expect(hook.salvarNota).toHaveBeenCalledWith('conversa-a', expect.objectContaining({
    texto: expect.stringContaining(origem.corpo), escopo: 'CASO', atendimentoLeadId: 'x', chaveIdempotencia: expect.any(String),
  })));
  expect(hook.salvarNota.mock.calls[0][1].texto).toContain('Conferir com a equipe fiscal.');
  expect(hook.responder).not.toHaveBeenCalled();
  expect(hook.api.criarNotaInternaWhatsapp).not.toHaveBeenCalled();
});

test('trocar escopo conserva rascunhos separados e nunca copia texto da empresa para o caso', () => {
  montar(); abrir(); escrever('EMPRESA:a', 'Dados da empresa.');
  fireEvent.change(screen.getByLabelText('Escopo da nota interna'), { target: { value: 'CASO:x' } });
  expect(screen.getByLabelText('Texto da nota interna')).toHaveValue('');
  fireEvent.change(screen.getByLabelText('Escopo da nota interna'), { target: { value: 'EMPRESA:a' } });
  expect(screen.getByLabelText('Texto da nota interna')).toHaveValue('Dados da empresa.');
});

test('falha mantém texto e chave de idempotência; clique duplo não duplica a nota', async () => {
  const { hook } = montar(); hook.salvarNota.mockResolvedValueOnce({ ok: false, erro: new Error('Gravação não confirmada') });
  abrir(); escrever('EMPRESA:a', 'Não perder a nota.');
  const salvar = screen.getByRole('button', { name: 'Salvar nota interna' });
  fireEvent.click(salvar);
  fireEvent.click(salvar);
  await screen.findByText('Gravação não confirmada');
  expect(hook.salvarNota).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText('Texto da nota interna')).toHaveValue('Não perder a nota.');
  fireEvent.click(screen.getByRole('button', { name: 'Salvar nota interna' }));
  await waitFor(() => expect(hook.salvarNota).toHaveBeenCalledTimes(2));
  expect(hook.salvarNota.mock.calls[0][1].chaveIdempotencia).toBe(hook.salvarNota.mock.calls[1][1].chaveIdempotencia);
});

test('capacidade revogada não permite salvar nota preparada e trocar conversa fecha a fonte anterior', () => {
  const { hook, ui, fio } = montar(); abrir(); escrever('EMPRESA:a', 'Rascunho privado.');
  ui.rerender(<FioDaConversa fio={{ ...fio, conversa: { ...conversa, capacidades: { escoposNotas: [] } } }} hook={hook} />);
  expect(screen.queryByRole('button', { name: 'Salvar nota interna' })).not.toBeInTheDocument();
  ui.rerender(<FioDaConversa fio={{ ...fio, conversa: { ...conversa, id: 'conversa-b', interlocutorId: 'pessoa-b' } }} hook={hook} />);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(hook.salvarNota).not.toHaveBeenCalled();
});

test.each([{ capacidades: {} }, { excluidaEm: '2026-09-21T10:00:00Z' }])('não oferece notas sem autorização ou na lixeira: %j', ajuste => {
  montar({ ...conversa, ...ajuste });
  fireEvent.click(screen.getByTestId('balao-mensagem-1'));
  expect(screen.queryByRole('button', { name: 'Criar nota interna' })).not.toBeInTheDocument();
});

test('legado com destino de anotação conserva ação contextual como rascunho, sem gravar ou enviar', () => {
  const onVirarAnotacao = jest.fn();
  const { hook } = montar({ ...conversa, interlocutorId: null, capacidades: {} }, { onVirarAnotacao });
  abrir();
  expect(onVirarAnotacao).toHaveBeenCalledWith(expect.stringContaining(origem.corpo));
  expect(hook.salvarNota).not.toHaveBeenCalled();
  expect(hook.responder).not.toHaveBeenCalled();
});
