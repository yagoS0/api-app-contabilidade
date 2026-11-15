import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { OperationsAlerts } from '../OperationsAlerts';
test('avisa sobre setembro independentemente do mês atual e permite revisar sem consulta fiscal', async () => {
  const api = { getOperationAlerts: jest.fn(async () => ({ total: 1, items: [{ id: 'p', portalClientId: 'a', competencia: '2026-09', portalClient: { razao: 'CDA' }, observacoes: 'Nota emitida em 03/10 para setembro' }] })) };
  render(<OperationsAlerts api={api} />);
  await waitFor(() => expect(screen.getByRole('button', { name: /Notas para revisão/ })).toHaveTextContent('1'));
  fireEvent.click(screen.getByRole('button', { name: /Notas para revisão/ }));
  expect(screen.getByRole('link', { name: 'Revisar competência 2026-09 de CDA' })).toHaveAttribute('href', '/companies/a/auditoria?competencia=2026-09');
  expect(api.getOperationAlerts).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('link', {name:'Abrir apuração de CDA, competência 2026-09'})).toHaveAttribute('href','/companies/a/cadastro-fiscal?competencia=2026-09');
  api.getOperationAlerts.mockResolvedValue({ total: 0, items: [] });
  fireEvent(window, new Event('focus'));
  await waitFor(() => expect(screen.getByRole('button', { name: /Notas para revisão/ })).toHaveTextContent('0'));
});

test('resposta antiga não substitui a leitura mais recente e remover API limpa contagem', async () => {
  let resolveOld;
  const api = { getOperationAlerts: jest.fn()
    .mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }))
    .mockResolvedValue({ total: 0, items: [] }) };
  const { rerender } = render(<OperationsAlerts api={api} />);
  fireEvent(window, new Event('focus'));
  await waitFor(() => expect(screen.getByRole('button', { name: /Notas para revisão/ })).toHaveTextContent('0'));
  await act(async () => resolveOld({ total: 12, items: [] }));
  expect(screen.getByRole('button', { name: /Notas para revisão/ })).toHaveTextContent('0');
  rerender(<OperationsAlerts api={{}} />);
  expect(screen.getByRole('button', { name: /Notas para revisão/ })).toHaveTextContent('Indisponível');
  expect(screen.getByRole('button', { name: /Notas para revisão/ })).not.toHaveTextContent('0');
});

test('resposta inválida não é apresentada como contagem confiável', async () => {
  render(<OperationsAlerts api={{ getOperationAlerts: async () => ({ total: -1, items: [] }) }} />);
  await waitFor(() => expect(screen.getByRole('button', { name: /Notas para revisão/ })).toHaveTextContent('Leitura indisponível'));
});
test('falha de atualização não aparece como ausência de pendência', async () => {
  render(<OperationsAlerts api={{ getOperationAlerts: async () => { throw Error('offline'); } }} />);
  fireEvent.click(screen.getByRole('button', { name: /Notas para revisão/ }));
  await screen.findByRole('alert'); expect(screen.queryByText(/Nenhum aviso/)).not.toBeInTheDocument();
});

test('aviso de outra competência permanece acessível além da primeira página',async()=>{
 const api={getOperationAlerts:jest.fn(async(offset=0)=>({total:201,offset,items:[{id:String(offset),portalClientId:'a',competencia:offset?'2026-08':'2026-09',portalClient:{razao:offset?'Página seguinte':'Primeira página'}}]}))};
 render(<OperationsAlerts api={api} compact/>);fireEvent.click(screen.getByRole('button',{name:/Avisos de apuração/}));await screen.findByText('Primeira página');fireEvent.click(screen.getByRole('button',{name:'Próxima'}));await screen.findByText('Página seguinte');expect(api.getOperationAlerts).toHaveBeenLastCalledWith(200);expect(screen.getByRole('link',{name:'Revisar competência 2026-08 de Página seguinte'})).toHaveAttribute('href','/companies/a/auditoria?competencia=2026-08');
});

test('aviso compacto oculta somente zero confirmado e preserva falha de atualização',async()=>{
 const api={getOperationAlerts:jest.fn().mockResolvedValue({total:0,items:[]})};
 render(<OperationsAlerts api={api} compact/>);
 await waitFor(()=>expect(screen.queryByRole('button',{name:/Avisos de apuração/})).not.toBeInTheDocument());
 api.getOperationAlerts.mockRejectedValueOnce(Error('offline'));fireEvent(window,new Event('focus'));
 await screen.findByRole('button',{name:/Avisos de apuração indisponíveis/});
 expect(screen.getByText('Leitura indisponível')).toBeInTheDocument();
});

test.each([
  ['TRANSMITIDA', 'Declaração transmitida', 'Conferir o impacto na declaração antes de decidir sobre retificação.'],
  ['APURADA', 'Apuração calculada ou simulada', 'Conferir o impacto no cálculo salvo. Cálculo não comprova transmissão.'],
  ['FECHADA', 'Período fechado', 'Conferir o impacto no fechamento. Fechamento não comprova transmissão.'],
  ['COMPROVACAO_PENDENTE', 'Comprovação da apuração pendente', 'Conferir as evidências do período antes de concluir a revisão.'],
  [undefined, 'Situação do período a verificar', 'Conferir a situação e as evidências na auditoria da empresa.'],
  ['ESTADO_FUTURO', 'Situação do período a verificar', 'Conferir a situação e as evidências na auditoria da empresa.'],
])('apresenta somente a situação registrada %s sem inferir causa ou ato fiscal', async (situacaoPeriodo, label, consequence) => {
  const api = { getOperationAlerts: jest.fn(async () => ({ total: 1, items: [{ id: 'p', portalClientId: 'a', competencia: '2026-09', portalClient: { razao: 'Empresa Alfa' }, situacaoPeriodo }] })) };
  render(<OperationsAlerts api={api} compact />);
  const trigger = await screen.findByRole('button', { name: 'Avisos de apuração 1 pendente · todas as competências' });
  trigger.focus();
  fireEvent.click(trigger);
  const dialog = screen.getByRole('dialog', { name: 'Notas para revisão' });
  expect(within(dialog).getByText(label)).toBeInTheDocument();
  expect(within(dialog).getByText(consequence)).toBeInTheDocument();
  expect(within(dialog).getByText('Causa não informada; conferir auditoria.')).toBeInTheDocument();
  expect(within(dialog).getByRole('link', { name: 'Revisar competência 2026-09 de Empresa Alfa' })).toHaveAttribute('href', '/companies/a/auditoria?competencia=2026-09');
  expect(api.getOperationAlerts).toHaveBeenCalledTimes(1);
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  fireEvent.keyDown(document.activeElement, { key: 'Escape' });
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
});

test('carregamento, indisponibilidade e zero registrado têm mensagens distintas', async () => {
  let finish;
  const api = { getOperationAlerts: jest.fn(() => new Promise(resolve => { finish = resolve; })) };
  render(<OperationsAlerts api={api} />);
  fireEvent.click(screen.getByRole('button', { name: /Notas para revisão/ }));
  expect(screen.getByRole('status')).toHaveTextContent('Carregando avisos');
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  await act(async () => finish({ total: 0, items: [] }));
  expect(screen.getByRole('status')).toHaveTextContent('Nenhuma pendência de revisão registrada');
  expect(screen.getByRole('status')).toHaveTextContent('não comprova ausência de notas ou de obrigações');
  api.getOperationAlerts.mockRejectedValue(Error('offline'));
  fireEvent(window, new Event('focus'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível atualizar');
  expect(screen.queryByText(/Nenhuma pendência/)).not.toBeInTheDocument();
});

test('observação recebida permanece literal, inclusive causa desconhecida e documento recebido', async () => {
  const observacoes = 'Documento recebido. Causa ainda não identificada; conferir despesas e retenções.';
  const api = { getOperationAlerts: jest.fn(async () => ({ total: 1, items: [{ id: 'p', portalClientId: 'a', competencia: '2026-09', portalClient: { razao: 'Empresa Alfa' }, observacoes }] })) };
  render(<OperationsAlerts api={api} />);
  fireEvent.click(screen.getByRole('button', { name: /Notas para revisão/ }));
  expect(await screen.findByText(observacoes)).toBeInTheDocument();
  expect(screen.queryByText('Declaração transmitida')).not.toBeInTheDocument();
  expect(api.getOperationAlerts).toHaveBeenCalledTimes(1);
});
