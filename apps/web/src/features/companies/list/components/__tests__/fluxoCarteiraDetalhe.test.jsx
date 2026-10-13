import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FluxoCarteiraDetalhe } from '../RotinasCarteira';

const tarefa = (chave, titulo, patch = {}) => ({ chave, titulo, concluida: false, automatica: false, dados: {}, versao: 2, hash: 'base', aguardando: [], ...patch });
const transmitir = () => tarefa('transmitir', 'Transmitir apuração');
function montar({ chave = 'transmitir', tarefas = [tarefa('apurar', 'Apurar e conferir', { concluida: true }), transmitir(), tarefa('contabilizar', 'Contabilizar e fechar o mês', { automatica: true })], lancamentos = [], salvar } = {}) {
  let detalhe = { fluxo: { regime: 'Simples', status: { rotulo: 'Obrigações' }, tarefas }, lancamentos };
  const api = {
    getFluxoCarteira: jest.fn(async () => detalhe),
    salvarFluxoTarefa: jest.fn(salvar || (async (id, key, corpo) => {
      detalhe = { ...detalhe, fluxo: { ...detalhe.fluxo, tarefas: detalhe.fluxo.tarefas.map(t => t.chave === key ? { ...t, versao: t.versao + 1, concluida: corpo.acao === 'concluir', dados: corpo.acao === 'concluir' ? { conclusao: { em: '2026-10-13', origem: 'CONFIRMACAO_MANUAL' } } : {} } : t) } };
      return { ok: true };
    })),
  };
  const onChanged = jest.fn();
  const view = render(<FluxoCarteiraDetalhe company={{ companyId: 'a', razao: 'Empresa Alfa' }} competencia="2026-09" tarefaChave={chave} api={api} onFechar={() => {}} onChanged={onChanged} />);
  return { ...view, api, onChanged };
}
test('tarefa da agenda mostra somente a etapa solicitada e conclui sem formulário', async () => {
  const { api, container, onChanged } = montar();
  const checkbox = await screen.findByRole('checkbox', { name: /Transmitir apuração/ });
  expect(screen.getByRole('dialog')).toHaveAccessibleName('Transmitir apuração · Empresa Alfa · 2026-09');
  expect(screen.queryByText('Apurar e conferir')).not.toBeInTheDocument();
  expect(screen.queryByText('Contabilizar e fechar o mês')).not.toBeInTheDocument();
  expect(screen.queryByText(/Próxima etapa/)).not.toBeInTheDocument();
  expect(container.querySelector('textarea, input:not([type="checkbox"])')).toBeNull();
  fireEvent.click(checkbox);
  await waitFor(() => expect(api.salvarFluxoTarefa).toHaveBeenCalledWith('a', 'transmitir', { acao: 'concluir', competencia: '2026-09', versao: 2, hash: 'base' }));
  await waitFor(() => expect(screen.getByRole('checkbox', { name: /Transmitir apuração/ })).toBeChecked());
  expect(onChanged).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('checkbox'));
  await waitFor(() => expect(api.salvarFluxoTarefa).toHaveBeenLastCalledWith('a', 'transmitir', expect.objectContaining({ acao: 'reabrir', versao: 3 })));
  await waitFor(() => expect(screen.getByRole('checkbox')).not.toBeChecked());
});
test('fluxo completo pertence à empresa, sem editores expansíveis', async () => {
  montar({ chave: null });
  expect(await screen.findAllByRole('checkbox')).toHaveLength(3);
  expect(screen.getByRole('dialog')).toHaveAccessibleName('Fluxo da empresa · Empresa Alfa · 2026-09');
  expect(screen.getByRole('checkbox', { name: /Contabilizar/ })).toBeDisabled();
});
test('etapa ausente nunca mostra o fluxo inteiro como alternativa', async () => {
  montar({ chave: 'inexistente' });
  await screen.findByText('Esta tarefa não se aplica à empresa nesta competência.');
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
});
test('falha mantém pendente e permite tentar novamente', async () => {
  const { api, onChanged } = montar({ salvar: async () => ({ ok: false, message: 'Os dados mudaram.' }) });
  fireEvent.click(await screen.findByRole('checkbox'));
  await screen.findByRole('alert');
  expect(screen.getByRole('checkbox')).not.toBeChecked();
  expect(screen.getByRole('checkbox')).toBeEnabled();
  expect(api.salvarFluxoTarefa).toHaveBeenCalledTimes(1);
  expect(onChanged).not.toHaveBeenCalled();
});
test('bloqueia duplo clique e dependências ainda pendentes', async () => {
  const { api } = montar({ salvar: () => new Promise(() => {}) });
  const checkbox = await screen.findByRole('checkbox');
  fireEvent.click(checkbox); fireEvent.click(checkbox);
  expect(api.salvarFluxoTarefa).toHaveBeenCalledTimes(1);
  expect(checkbox).toBeDisabled();
});
test('transmissão aguarda apuração', async () => {
  montar({ tarefas: [transmitir(), tarefa('apurar', 'Apurar e conferir')].map(t => t.chave === 'transmitir' ? { ...t, aguardando: ['apurar'] } : t) });
  expect(await screen.findByRole('checkbox')).toBeDisabled();
  expect(screen.getByText('Aguardando: Apurar e conferir.')).toBeInTheDocument();
});
test('confirma importação somente dos lançamentos pendentes e exportados', async () => {
  const { api } = montar({ chave: 'importar', tarefas: [tarefa('importar', 'Importar lançamentos no ERP')], lancamentos: [{ id: 'ja', importado: true, importavel: true }, { id: 'novo', importado: false, importavel: true }] });
  fireEvent.click(await screen.findByRole('checkbox'));
  await waitFor(() => expect(api.salvarFluxoTarefa).toHaveBeenCalledWith('a', 'importar', expect.objectContaining({ entryIds: ['novo'] })));
});
test('importação não permite confirmar lançamentos ainda não exportados', async () => {
  montar({ chave: 'importar', tarefas: [tarefa('importar', 'Importar lançamentos no ERP')], lancamentos: [{ id: 'novo', importavel: false }] });
  expect(await screen.findByRole('checkbox')).toBeDisabled();
});
