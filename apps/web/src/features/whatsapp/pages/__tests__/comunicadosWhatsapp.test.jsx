import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { ComunicadosWhatsappPage } from '../ComunicadosWhatsappPage';
const destinatario = { id: 'd1', telefone: '5521999998800', nome: 'Liz sintética', status: 'PENDENTE', elegivel: true, empresas: [{ razao: 'Klaus' }, { razao: 'Lente' }, { razao: 'Alessandro' }] };
const aviso = status => ({ id: 'aviso', titulo: 'Horário do escritório', corpo: 'Nosso expediente muda amanhã.', categoria: 'MARKETING', status, previaHash: 'hash-revisado', destinatarios: [destinatario] });
function setup(status) {
  let atual = status ? aviso(status) : null;
  const api = { comunicadosWhatsapp: jest.fn(async (path = '', body) => {
    if (path === '/previa') return { empresasIds: ['e1', 'e2', 'e3'], destinatarios: [destinatario], excluidos: [], empresasSemContato: 0 };
    if (!path && !body) return { itens: atual ? [{ ...atual, _count: { destinatarios: 1 } }] : [], proximoCursor: null };
    if (!path && body) { atual = { ...aviso('RASCUNHO'), ...body }; return atual; }
    if (path.endsWith('/submeter')) atual = aviso('EM_ANALISE');
    if (path.endsWith('/consultar-aprovacao')) atual = aviso('APROVADO');
    if (path.endsWith('/enviar')) atual = aviso('ENVIANDO');
    return atual;
  }) };
  render(<ComunicadosWhatsappPage api={api} companies={[{ id: 'e1', razao: 'Klaus' }]} />);
  return api;
}
beforeAll(() => { if (!crypto.randomUUID) Object.defineProperty(crypto, 'randomUUID', { value: () => '11111111-1111-4111-8111-111111111111' }); });
test('salvar a prévia não submete à Meta nem envia; Liz aparece uma vez com três empresas', async () => {
  const api = setup(); await screen.findByText('Nenhum comunicado criado.');
  fireEvent.click(screen.getByRole('button', { name: 'Novo comunicado' }));
  fireEvent.change(screen.getByLabelText('Título interno'), { target: { value: 'Horário do escritório' } });
  fireEvent.change(screen.getByLabelText('Mensagem para os clientes'), { target: { value: 'Nosso expediente muda amanhã.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Conferir destinatários' }));
  expect(await screen.findByText('1 contato selecionado')).toBeInTheDocument();
  expect(screen.getAllByText('Liz sintética')).toHaveLength(1);
  expect(screen.getByText('Klaus · Lente · Alessandro')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Salvar prévia' }));
  await screen.findByText('Rascunho');
  expect(api.comunicadosWhatsapp.mock.calls.find(([p, b]) => p === '' && b)[1].telefones).toEqual(['5521999998800']);
  expect(api.comunicadosWhatsapp.mock.calls.some(([p]) => /submeter|enviar/.test(p))).toBe(false);
  expect(screen.queryByRole('button', { name: 'Revisar e enviar' })).not.toBeInTheDocument();
});
test('desmarcar destinatário bloqueia salvar lista vazia', async () => {
  setup(); await screen.findByText('Nenhum comunicado criado.');
  fireEvent.click(screen.getByRole('button', { name: 'Novo comunicado' }));
  fireEvent.click(screen.getByRole('button', { name: 'Conferir destinatários' }));
  fireEvent.click(await screen.findByRole('checkbox', { name: /Liz sintética/ }));
  expect(screen.getByRole('button', { name: 'Salvar prévia' })).toBeDisabled();
});
test('aguarda aprovação e exige confirmação final com o hash exibido', async () => {
  const api = setup('EM_ANALISE');
  fireEvent.click(await screen.findByRole('button', { name: /Horário do escritório/ }));
  await screen.findByRole('button', { name: 'Consultar aprovação' });
  expect(screen.queryByRole('button', { name: 'Revisar e enviar' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Consultar aprovação' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Revisar e enviar' }));
  expect(api.comunicadosWhatsapp.mock.calls.some(([p]) => p.endsWith('/enviar'))).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar envio para 1 contato' }));
  await waitFor(() => expect(api.comunicadosWhatsapp).toHaveBeenCalledWith('/aviso/enviar', { previaHash: 'hash-revisado' }));
  await screen.findByText('Enviando');
});
test('falha de envio consulta resultado sem repetir o POST', async () => {
  const api = setup('APROVADO');
  fireEvent.click(await screen.findByRole('button', { name: /Horário do escritório/ }));
  fireEvent.click(await screen.findByRole('button', { name: 'Revisar e enviar' }));
  api.comunicadosWhatsapp.mockImplementationOnce(async () => { throw new Error('Conexão interrompida'); });
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar envio para 1 contato' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Conexão interrompida');
  await waitFor(() => expect(api.comunicadosWhatsapp.mock.calls.at(-1)).toEqual(['/aviso']));
  expect(api.comunicadosWhatsapp.mock.calls.filter(([p]) => p === '/aviso/enviar')).toHaveLength(1);
});
test('atualização automática é somente leitura', async () => {
  jest.useFakeTimers();
  try {
    const api = setup('ENVIANDO');
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: /Horário do escritório/ }));
    await act(async () => {});
    await act(async () => { jest.advanceTimersByTime(15000); });
    expect(api.comunicadosWhatsapp.mock.calls.every(([, body]) => body === undefined)).toBe(true);
    expect(api.comunicadosWhatsapp.mock.calls.filter(([p]) => p === '/aviso').length).toBeGreaterThan(1);
  } finally { jest.useRealTimers(); }
});
test('demonstração não oferece envio', () => {
  render(<ComunicadosWhatsappPage api={{}} />);
  expect(screen.getByRole('button', { name: 'Novo comunicado' })).toBeDisabled();
  expect(screen.getByText(/A demonstração não envia/)).toBeInTheDocument();
});
