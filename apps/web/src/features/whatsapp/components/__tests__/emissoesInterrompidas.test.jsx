import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { EmissoesInterrompidas } from '../EmissoesInterrompidas';

const item = { acaoId: 'a1', versao: 'v1', portalClientId: 'p1', empresa: { razao: 'Empresa fictícia' }, situacao: 'AGUARDANDO_CONFERENCIA', podeConferir: true,
  confirmadaEm: '2026-10-18T15:00:00Z', tentativa: { id: 'n1', status: 'pending' }, historico: [] };
const fixture = (over = {}) => ({ listarEmissoesInterrompidasWhatsapp: jest.fn(async () => ({ itens: [item] })),
  conferirEmissaoInterrompidaWhatsapp: jest.fn(async () => ({ item: { ...item, situacao: 'RECUPERADA', podeConferir: false }, message: 'Resultado recuperado.' })), ...over });
function abrir() { const d = screen.getByText(/^Conferir emissões/).closest('details'); d.open = true; fireEvent(d, new Event('toggle')); }
async function motivo() { fireEvent.change(await screen.findByLabelText('Motivo da conferência'), { target: { value: 'Verificar retorno interrompido' } }); }

test('consulta apenas ao expandir, exige motivo e envia versão sem dados fiscais do navegador', async () => {
  const api = fixture(); render(<EmissoesInterrompidas api={api} conversaId="c1" />);
  expect(api.listarEmissoesInterrompidasWhatsapp).not.toHaveBeenCalled(); abrir();
  expect(await screen.findByText('Empresa fictícia')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Conferir resultado' })).toBeDisabled();
  await motivo(); fireEvent.click(screen.getByRole('button', { name: 'Conferir resultado' }));
  await screen.findByText('Resultado recuperado.');
  expect(api.conferirEmissaoInterrompidaWhatsapp).toHaveBeenCalledWith('c1', 'a1', { versao: 'v1', motivo: 'Verificar retorno interrompido' });
});

test('cliques repetidos não duplicam; resposta perdida permite leitura sem repetir POST', async () => {
  let rejeitar; const api = fixture({ conferirEmissaoInterrompidaWhatsapp: jest.fn(() => new Promise((_, reject) => { rejeitar = reject; })) });
  render(<EmissoesInterrompidas api={api} conversaId="c1" />); abrir(); await motivo();
  const botao = screen.getByRole('button', { name: 'Conferir resultado' }); fireEvent.click(botao); fireEvent.click(botao);
  expect(api.conferirEmissaoInterrompidaWhatsapp).toHaveBeenCalledTimes(1);
  await act(async () => rejeitar(new Error('Tempo de resposta excedido.')));
  expect(screen.getByRole('alert')).toHaveTextContent('Tempo de resposta');
  expect(screen.queryByRole('button', { name: 'Conferir resultado' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Atualizar resultados' }));
  await waitFor(() => expect(api.listarEmissoesInterrompidasWhatsapp).toHaveBeenCalledTimes(2));
  expect(api.conferirEmissaoInterrompidaWhatsapp).toHaveBeenCalledTimes(1);
});

test('resposta tardia não atravessa conversa ou contexto de empresa', async () => {
  let resolver; const api = fixture({ listarEmissoesInterrompidasWhatsapp: jest.fn().mockImplementationOnce(() => new Promise(resolve => { resolver = resolve; })).mockResolvedValue({ itens: [] }) });
  const { rerender } = render(<EmissoesInterrompidas api={api} conversaId="c1" contexto="p1" />); abrir();
  rerender(<EmissoesInterrompidas api={api} conversaId="c1" contexto="p2" />); abrir();
  await screen.findByText('Nenhuma emissão interrompida nesta conversa.');
  await act(async () => resolver({ itens: [item] }));
  expect(screen.queryByText('Empresa fictícia')).not.toBeInTheDocument();
});

test('após resposta perdida só uma versão nova concluída permite outra conferência explícita', async () => {
  const api = fixture({ conferirEmissaoInterrompidaWhatsapp: jest.fn(async () => { throw new Error('Timeout'); }) });
  render(<EmissoesInterrompidas api={api} conversaId="c1" />); abrir(); await motivo();
  fireEvent.click(screen.getByRole('button', { name: 'Conferir resultado' })); await screen.findByRole('alert');
  api.listarEmissoesInterrompidasWhatsapp.mockResolvedValue({ itens: [{ ...item, versao: 'v2', situacao: 'INCONCLUSIVA' }] });
  fireEvent.click(screen.getByRole('button', { name: 'Atualizar resultados' }));
  await screen.findByRole('button', { name: 'Conferir resultado' });
  expect(api.conferirEmissaoInterrompidaWhatsapp).toHaveBeenCalledTimes(1);
});

test('conferência terminada após trocar conversa não altera a nova tela', async () => {
  let resolver; const api = fixture({ conferirEmissaoInterrompidaWhatsapp: jest.fn(() => new Promise(resolve => { resolver = resolve; })) });
  const { rerender } = render(<EmissoesInterrompidas api={api} conversaId="c1" />); abrir(); await motivo();
  fireEvent.click(screen.getByRole('button', { name: 'Conferir resultado' }));
  api.listarEmissoesInterrompidasWhatsapp.mockResolvedValue({ itens: [] });
  rerender(<EmissoesInterrompidas api={api} conversaId="c2" />); abrir(); await screen.findByText('Nenhuma emissão interrompida nesta conversa.');
  await act(async () => resolver({ item, message: 'Resposta da empresa anterior' }));
  expect(screen.queryByText('Resposta da empresa anterior')).not.toBeInTheDocument();
  expect(screen.queryByText('Empresa fictícia')).not.toBeInTheDocument();
});

test.each(['LEGADO_SEM_TENTATIVA', 'PROCESSANDO', 'RECUPERADA'])('estado %s com bloqueio mantém motivo legível sem ação', async situacao => {
  const api = fixture({ listarEmissoesInterrompidasWhatsapp: jest.fn(async () => ({ itens: [{ ...item, tentativa: null, situacao, podeConferir: false, mensagem: 'Acesso ou estado não permite nova consulta.' }] })) });
  render(<EmissoesInterrompidas api={api} conversaId="c1" />); abrir();
  await screen.findByText('Acesso ou estado não permite nova consulta.');
  expect(screen.queryByRole('button', { name: 'Conferir resultado' })).not.toBeInTheDocument();
});

test('falha de leitura mantém resultado e motivo preenchido para recuperação', async () => {
  const api = fixture(); render(<EmissoesInterrompidas api={api} conversaId="c1" />); abrir(); await motivo();
  api.listarEmissoesInterrompidasWhatsapp.mockRejectedValueOnce(new Error('Indisponível'));
  fireEvent.click(screen.getByRole('button', { name: 'Atualizar resultados' }));
  await screen.findByRole('alert'); expect(screen.getByText('Empresa fictícia')).toBeVisible();
  expect(screen.getByLabelText('Motivo da conferência')).toHaveValue('Verificar retorno interrompido');
});

test.each([
  ['MESMA', 'Mesma operação confirmada'],
  ['OUTRA', 'Operação diferente identificada'],
  ['EM_CONFERENCIA', 'Conferência em andamento'],
])('histórico %s mostra o resultado específico sem prometer nova emissão', async (estado, rotulo) => {
  const api = fixture({ listarEmissoesInterrompidasWhatsapp: jest.fn(async () => ({ itens: [{ ...item, podeConferir: false,
    historico: [{ id: 'h1', motivo: 'Análise solicitada pelo contador', iniciadaEm: '2026-10-18T15:00:00Z', estado }] }] })) });
  render(<EmissoesInterrompidas api={api} conversaId="c1" />); abrir();
  const detalhes = await screen.findByText('Detalhes da tentativa');
  fireEvent.click(detalhes);
  expect(screen.getByText(new RegExp(rotulo))).toBeInTheDocument();
  expect(screen.queryByText(/Análise registrada/)).not.toBeInTheDocument();
  expect(screen.queryByText(/reemitir|recusada|tentar novamente/i)).not.toBeInTheDocument();
});
