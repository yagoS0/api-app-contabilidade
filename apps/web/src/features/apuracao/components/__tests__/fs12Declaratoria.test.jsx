import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FechamentoModal } from '../FechamentoModal';

function resposta(portalClientId = 'p1', competencia = '2026-11', meses = ['2026-10']) {
  return { ok: true, fs12: { portalClientId, competencia,
    politica: { empresaId: `company-${portalClientId}`, competenciaApuracao: competencia, situacao: 'EXIGIDA', janela: { competencias: meses } },
    qualidade: { totalCentavos: null }, autorizaEfeitoFiscal: false, integracao: { permiteNovoCalculo: false } } };
}
function preparar(extra = {}, fatorR = false) {
  const dados = { cadastroCompleto: true, regimeApuracao: 'COMPETENCIA', estado: 'aberta',
    faturamento: { interno: 100, externo: 0, total: 100 }, entregaPgdas: {}, disparidades: [], rbt12: 1200,
    atividades: [{ idAtividade: 1, descricao: 'Atividade exemplo', sujeitoFatorR: fatorR, valorInterno: 100, valorExterno: 0 }], ...extra };
  return { listPendenciasPosFechamento: jest.fn(async () => []), getFechamento: jest.fn(async () => ({ ok: true, dados })),
    listAtividadesPgdasd: jest.fn(async () => ({ atividades: [] })),
    getFs12Fechamento: jest.fn(async (p, c) => resposta(p, c)),
    calcularFechamento: jest.fn(), salvarFechamento: jest.fn(async () => ({ ok: true })), transmitirFechamento: jest.fn(),
  };
}
const props = { portalClientId: 'p1', competencia: '2026-11', razao: 'Empresa exemplo', feedback: {}, onClose: jest.fn(), onChanged: jest.fn() };

test.each([false, true])('mostra FS12 com Fator R=%s; vazio, zero e preenchido são distintos', async fatorR => {
  const api = preparar({}, fatorR); render(<FechamentoModal {...props} api={api} />);
  const campo = await screen.findByLabelText('Folha 10/2026');
  expect(campo).toHaveValue(''); expect(screen.getByText(/Ausente · informe/)).toBeInTheDocument();
  fireEvent.change(campo, { target: { value: '0' } });
  expect(screen.getByText(/Zero explícito · não conferido/)).toBeInTheDocument();
  fireEvent.change(campo, { target: { value: '12,34' } });
  expect(screen.getByText(/Digitado neste rascunho · não conferido/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Calcular \(simulação\)/ })).toBeDisabled();
  expect(api.calcularFechamento).not.toHaveBeenCalled();
  expect(api.transmitirFechamento).not.toHaveBeenCalled();
  expect(screen.queryByRole('checkbox', { name: /confer/i })).not.toBeInTheDocument();
});
test('memória duplicada e divergente é referência; contabilidade não comprova folha', async () => {
  const api = preparar({ folhaMensal12: [{ pa: '2026-09', valor: 3 }, { pa: '2026-10', valor: 0 }, { pa: '2026-10', valor: 0 }],
    folhaDerivada: { disponivel: true, total: 1000 } });
  api.getFs12Fechamento.mockResolvedValue(resposta('p1', '2026-11', ['2026-09', '2026-10']));
  render(<FechamentoModal {...props} api={api} />);
  const campo = await screen.findByLabelText('Folha 09/2026');
  expect(campo).toHaveValue(''); expect(screen.getByText(/Referências duplicadas/)).toBeInTheDocument();
  fireEvent.change(campo, { target: { value: '4' } });
  expect(screen.getByText(/Diverge do rascunho/)).toBeInTheDocument();
  expect(screen.queryByText(/Confere com os lançamentos/)).not.toBeInTheDocument();
});
test('cálculo recuperado preserva formulário exato ao salvar apesar do rascunho', async () => {
  const formulario = { atividades: [{ idAtividade: 1, descricao: 'Atividade recuperada', valorInterno: 100, valorExterno: 0 }],
    folhaMensal12: [{ pa: '2026-10', valor: 42 }], regimeApuracao: 'COMPETENCIA' };
  const api = preparar({ calculoRecuperavel: { calculoId: 'calc-r1', dasValor: 10, formulario } });
  render(<FechamentoModal {...props} api={api} />);
  fireEvent.change(await screen.findByLabelText('Folha 10/2026'), { target: { value: '99' } });
  fireEvent.click(screen.getByRole('button', { name: /Salvar \(fechar\)/ }));
  await waitFor(() => expect(api.salvarFechamento).toHaveBeenCalledWith('p1', '2026-11', { ...formulario, calculoId: 'calc-r1' }));
  expect(api.calcularFechamento).not.toHaveBeenCalled();
});
test('declaração transmitida sem envelope recuperável não ganha ações por digitação', async () => {
  const api = preparar({ estado: 'transmitida', snapshot: { idempotencyKey: 'antiga' } });
  render(<FechamentoModal {...props} api={api} />);
  fireEvent.change(await screen.findByLabelText('Folha 10/2026'), { target: { value: '0' } });
  expect(screen.getByRole('button', { name: /Apurar\/Transmitir/ })).toBeDisabled();
  expect(api.transmitirFechamento).not.toHaveBeenCalled();
});
test('sem movimento não dispensa folha nem libera cálculo', async () => {
  const api = preparar({ atividades: [], semMovimentoDisponivel: true, semFaturamento: true });
  render(<FechamentoModal {...props} api={api} />);
  await screen.findByLabelText('Folha 10/2026');
  expect(screen.getByRole('button', { name: /Calcular sem movimento/ })).toBeDisabled();
});
test('troca de competência descarta rascunho e resposta anterior', async () => {
  let resolver;
  const api = preparar(); api.getFs12Fechamento.mockImplementationOnce(() => new Promise(r => { resolver = r; }));
  const { rerender } = render(<FechamentoModal {...props} api={api} />);
  await waitFor(() => expect(api.getFs12Fechamento).toHaveBeenCalledTimes(1));
  api.getFs12Fechamento.mockResolvedValue(resposta('p1', '2026-12', ['2026-11']));
  rerender(<FechamentoModal {...props} competencia="2026-12" api={api} />);
  const campo = await screen.findByLabelText('Folha 11/2026');
  fireEvent.change(campo, { target: { value: '12' } });
  await act(async () => resolver(resposta()));
  expect(campo).toHaveValue('12'); expect(screen.queryByLabelText('Folha 10/2026')).not.toBeInTheDocument();
  rerender(<FechamentoModal {...props} competencia="2026-12" portalClientId="p2" api={api} />);
  await screen.findByRole('alert'); // resposta p1 recusada para p2
  expect(screen.queryByDisplayValue('12')).not.toBeInTheDocument();
});
test('erro de leitura permite tentar novamente sem operação fiscal', async () => {
  const api = preparar(); api.getFs12Fechamento.mockRejectedValueOnce(Error('offline'));
  render(<FechamentoModal {...props} api={api} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Tentar novamente' }));
  await screen.findByLabelText('Folha 10/2026');
  expect(api.getFs12Fechamento).toHaveBeenCalledTimes(2); expect(api.calcularFechamento).not.toHaveBeenCalled();
});
test('entrada inválida tem erro associado; foco e Escape conservam modal existente', async () => {
  const api = preparar(); const onClose = jest.fn(); render(<FechamentoModal {...props} api={api} onClose={onClose} />);
  const campo = await screen.findByLabelText('Folha 10/2026');
  campo.focus(); expect(campo).toHaveFocus();
  fireEvent.change(campo, { target: { value: '-1' } });
  expect(campo).toHaveAttribute('aria-invalid', 'true');
  expect(campo).toHaveAccessibleDescription('Informe valor não negativo com até 2 casas.');
  fireEvent.keyDown(window, { key: 'Escape' }); expect(onClose).toHaveBeenCalled();
});
