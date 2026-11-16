import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Fs12DeclaratoriaPanel } from '../Fs12DeclaratoriaPanel';
import { FechamentoModal } from '../FechamentoModal';

const contexto = 'a'.repeat(64);
const props = { portalClientId: 'p1', competencia: '2026-11', razao: 'Empresa exemplo', temFatorR: false };
function confirmacao(revisao = 1, valorCentavos = 1234, portalClientId = 'p1', competencia = '2026-11') {
  return { id: `r${revisao}`, portalClientId, companyId: `company-${portalClientId}`, competencia, revisao,
    serie: [{ mes: '2026-10', valorCentavos }], totalCentavos: valorCentavos, contextoRevisao: contexto,
    autorId: 'contador-autenticado', confirmadoEm: '2026-11-16T18:00:00.000Z', origem: 'MANUAL_APURACAO' };
}
function resposta(historico = [], p = 'p1', c = '2026-11', meses = ['2026-10']) {
  return { ok: true, fs12: { portalClientId: p, competencia: c,
    politica: { empresaId: `company-${p}`, competenciaApuracao: c, situacao: 'EXIGIDA', janela: { competencias: meses } },
    qualidade: { totalCentavos: null }, autorizaEfeitoFiscal: false, integracao: { permiteNovoCalculo: false },
    contextoRevisao: contexto, confirmacao: historico[0] || null, revisaoVigente: historico[0]?.revisao || 0, historico } };
}
function preparar(historico = []) {
  let salvas = [...historico];
  return { getFs12Confirmacoes: jest.fn(async (p, c) => resposta(salvas, p, c)),
    confirmarFs12Fechamento: jest.fn(async (p, c, payload) => {
      const r = { ...confirmacao(payload.revisaoEsperada + 1, payload.serie[0].valorCentavos, p, c),
        serie: payload.serie, motivo: payload.motivo };
      salvas = [r, ...salvas];
      return { ok: true, confirmacao: r, replay: false, autorizaEfeitoFiscal: false };
    }) };
}
async function abrirConferencia(valor = '12,34') {
  fireEvent.change(await screen.findByLabelText('Folha 10/2026'), { target: { value: valor } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar valores da folha', exact: true }));
  expect(screen.getByRole('heading', { name: /Conferir folha de Empresa exemplo/ })).toHaveFocus();
}
function confirmar() {
  fireEvent.click(screen.getByRole('checkbox', { name: 'Conferi os meses e valores desta apuração.' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar declaração manual', exact: true }));
}
beforeEach(() => {
  let numero = 0;
  Object.defineProperty(global.crypto, 'randomUUID', { configurable: true, value: jest.fn(() => `fixture-chave-${++numero}-12345678`) });
});

test('vazio e série parcial não têm total; zero explícito completo requer confirmação', async () => {
  const api = preparar(); api.getFs12Confirmacoes.mockResolvedValue(resposta([], 'p1', '2026-11', ['2026-09', '2026-10']));
  render(<Fs12DeclaratoriaPanel {...props} api={api} />);
  const campo = await screen.findByLabelText('Folha 09/2026');
  expect(screen.getByText('Não informada')).toBeInTheDocument();
  expect(screen.queryByText(/Total informado/)).not.toBeInTheDocument();
  fireEvent.change(campo, { target: { value: '0' } });
  expect(screen.getByText('Em preenchimento')).toBeInTheDocument();
  expect(screen.queryByText(/Total informado/)).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Folha 10/2026'), { target: { value: '0' } });
  expect(screen.getByText('Pronta para confirmar')).toBeInTheDocument();
  expect(screen.getByText(/Total informado/).parentElement).toHaveTextContent('R$ 0,00');
  expect(api.confirmarFs12Fechamento).not.toHaveBeenCalled();
});

test('confirmação explícita, retorno do foco e reabertura recuperam revisão do servidor', async () => {
  const api = preparar(); const { unmount } = render(<Fs12DeclaratoriaPanel {...props} api={api} />);
  await abrirConferencia();
  expect(screen.getByRole('button', { name: 'Confirmar declaração manual' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Voltar aos valores' }));
  expect(screen.getByRole('button', { name: 'Confirmar valores da folha' })).toHaveFocus();
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar valores da folha' }));
  confirmar(); await screen.findByText('Confirmada');
  expect(screen.getByRole('status')).toHaveFocus();
  expect(api.confirmarFs12Fechamento).toHaveBeenCalledTimes(1);
  expect(api.confirmarFs12Fechamento.mock.calls[0][2]).toEqual({ serie: [{ mes: '2026-10', valorCentavos: 1234 }],
    revisaoEsperada: 0, contextoRevisao: contexto, motivo: null, chaveIdempotencia: expect.any(String) });
  unmount(); render(<Fs12DeclaratoriaPanel {...props} api={api} />);
  await screen.findByText('Confirmada'); expect(screen.getByLabelText('Folha 10/2026')).toHaveValue('12,34');
  expect(screen.getByText(/Última confirmação/)).toHaveTextContent('contador-autenticado');
});

test('soma excedida não apresenta total nem permite confirmar', async () => {
  const api = preparar(); api.getFs12Confirmacoes.mockResolvedValue(resposta([], 'p1', '2026-11', ['2026-09', '2026-10']));
  render(<Fs12DeclaratoriaPanel {...props} api={api} />);
  fireEvent.change(await screen.findByLabelText('Folha 09/2026'), { target: { value: '90071992547409,91' } });
  fireEvent.change(screen.getByLabelText('Folha 10/2026'), { target: { value: '0,01' } });
  expect(screen.getByRole('alert')).toHaveTextContent('O total ultrapassa o limite permitido');
  expect(screen.queryByText(/Total informado/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Confirmar valores da folha' })).toBeDisabled();
});

test('confirmação em andamento bloqueia edição e duplo clique', async () => {
  let resolver; const api = preparar(); api.confirmarFs12Fechamento.mockImplementationOnce(() => new Promise(r => { resolver = r; }));
  render(<Fs12DeclaratoriaPanel {...props} api={api} />); await abrirConferencia(); confirmar();
  expect(screen.getByLabelText('Folha 10/2026')).toBeDisabled();
  const botao = screen.getByRole('button', { name: 'Gravando confirmação…' });
  expect(botao).toBeDisabled(); fireEvent.click(botao);
  expect(api.confirmarFs12Fechamento).toHaveBeenCalledTimes(1);
  await act(async () => resolver({ ok: true, confirmacao: confirmacao(), autorizaEfeitoFiscal: false }));
  await screen.findByText('Confirmada');
});

test('nova revisão exige motivo e mantém anterior no histórico', async () => {
  const api = preparar([confirmacao()]); render(<Fs12DeclaratoriaPanel {...props} api={api} />);
  await abrirConferencia('15,00');
  expect(screen.getByText('Alterada')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox', { name: /Conferi os meses/ }));
  expect(screen.getByRole('button', { name: 'Confirmar declaração manual' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Motivo da substituição'), { target: { value: 'Correção conferida' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar declaração manual' }));
  await screen.findByText('Confirmada');
  expect(api.confirmarFs12Fechamento.mock.calls[0][2]).toMatchObject({ revisaoEsperada: 1, motivo: 'Correção conferida' });
  fireEvent.click(screen.getByText('Histórico de confirmações (2)'));
  fireEvent.click(screen.getByText('Revisão anterior · 1'));
  expect(screen.getByText('10/2026: R$ 12,34')).toBeInTheDocument();
  expect(screen.getByText('Substituída pela revisão 2.')).toBeInTheDocument();
});

test('falha ou resposta perdida preserva rascunho e chave no replay explícito', async () => {
  const api = preparar(); api.confirmarFs12Fechamento.mockRejectedValueOnce(Error('resposta perdida'));
  render(<Fs12DeclaratoriaPanel {...props} api={api} />); await abrirConferencia(); confirmar();
  await screen.findByRole('alert'); expect(screen.queryByText('Confirmada')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Folha 10/2026')).toHaveValue('12,34');
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar declaração manual' }));
  await screen.findByText('Confirmada');
  expect(api.confirmarFs12Fechamento.mock.calls[0][2]).toEqual(api.confirmarFs12Fechamento.mock.calls[1][2]);
});

test('falha persistida não anuncia confirmação; recarregar histórico é ação explícita', async () => {
  const api = preparar(); api.confirmarFs12Fechamento.mockRejectedValue(Error('409'));
  render(<Fs12DeclaratoriaPanel {...props} api={api} />); await abrirConferencia(); confirmar();
  await screen.findByRole('alert');
  expect(api.getFs12Confirmacoes).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Recarregar histórico e descartar rascunho' }));
  await screen.findByText('Não informada');
  expect(screen.getByLabelText('Folha 10/2026')).toHaveValue('');
});

test.each(['empresa', 'competencia'])('resposta tardia de leitura após trocar %s não contamina a tela', async tipo => {
  let resolver; const api = preparar(); api.getFs12Confirmacoes.mockImplementationOnce(() => new Promise(r => { resolver = r; }));
  const { rerender } = render(<Fs12DeclaratoriaPanel {...props} api={api} />);
  await waitFor(() => expect(api.getFs12Confirmacoes).toHaveBeenCalledTimes(1));
  const next = tipo === 'empresa' ? { ...props, portalClientId: 'p2' } : { ...props, competencia: '2026-12' };
  rerender(<Fs12DeclaratoriaPanel {...next} api={api} />);
  fireEvent.change(await screen.findByLabelText('Folha 10/2026'), { target: { value: '88' } });
  await act(async () => resolver(resposta([confirmacao()])));
  expect(screen.getByLabelText('Folha 10/2026')).toHaveValue('88');
  expect(screen.queryByText(/Última confirmação/)).not.toBeInTheDocument();
});

test('POST tardio após troca de empresa não aparece como confirmação da nova empresa', async () => {
  let resolver; const api = preparar(); api.confirmarFs12Fechamento.mockImplementationOnce(() => new Promise(r => { resolver = r; }));
  const { rerender } = render(<Fs12DeclaratoriaPanel {...props} api={api} />);
  await abrirConferencia(); confirmar();
  rerender(<Fs12DeclaratoriaPanel {...props} portalClientId="p2" api={api} />);
  await screen.findByText('Não informada');
  await act(async () => resolver({ ok: true, confirmacao: confirmacao(), autorizaEfeitoFiscal: false }));
  expect(screen.queryByText('Confirmada')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Folha 10/2026')).toHaveValue('');
});

test('histórico de Company divergente é indisponível, sem expor valores', async () => {
  const api = preparar([{ ...confirmacao(), companyId: 'outra-company' }]);
  render(<Fs12DeclaratoriaPanel {...props} api={api} />);
  await screen.findByRole('alert');
  expect(screen.queryByDisplayValue('12,34')).not.toBeInTheDocument();
});

test('total e histórico mantêm último centavo exato no limite inteiro seguro', async () => {
  const api = preparar([confirmacao(1, Number.MAX_SAFE_INTEGER)]);
  render(<Fs12DeclaratoriaPanel {...props} api={api} />);
  await screen.findByText('Confirmada');
  expect(screen.getByLabelText('Folha 10/2026')).toHaveValue('90071992547409,91');
  expect(screen.getByText('Total confirmado:').parentElement).toHaveTextContent('R$ 90.071.992.547.409,91');
});

test('confirmação manual não libera cálculo nem altera formulário recuperado do modal', async () => {
  const formulario = { atividades: [{ idAtividade: 1, descricao: 'Atividade', valorInterno: 100, valorExterno: 0 }],
    folhaMensal12: [{ pa: '2026-10', valor: 42 }], regimeApuracao: 'COMPETENCIA' };
  const api = { ...preparar(), listPendenciasPosFechamento: jest.fn(async () => []),
    listAtividadesPgdasd: jest.fn(async () => ({ atividades: [] })),
    getFechamento: jest.fn(async () => ({ ok: true, dados: { cadastroCompleto: true, regimeApuracao: 'COMPETENCIA',
      faturamento: { interno: 100, externo: 0, total: 100 }, entregaPgdas: {}, disparidades: [], rbt12: 1200,
      atividades: formulario.atividades, calculoRecuperavel: { calculoId: 'calc-antigo', dasValor: 10, formulario } } })),
    calcularFechamento: jest.fn(), transmitirFechamento: jest.fn(), salvarFechamento: jest.fn(async () => ({ ok: true })) };
  render(<FechamentoModal {...props} api={api} feedback={{}} onClose={jest.fn()} onChanged={jest.fn()} />);
  await abrirConferencia('99'); confirmar(); await screen.findByText('Confirmada');
  expect(screen.getByRole('button', { name: /Calcular \(simulação\)/ })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: /Salvar \(fechar\)/ }));
  await waitFor(() => expect(api.salvarFechamento).toHaveBeenCalledWith('p1', '2026-11', { ...formulario, calculoId: 'calc-antigo' }));
  expect(api.calcularFechamento).not.toHaveBeenCalled(); expect(api.transmitirFechamento).not.toHaveBeenCalled();
});
