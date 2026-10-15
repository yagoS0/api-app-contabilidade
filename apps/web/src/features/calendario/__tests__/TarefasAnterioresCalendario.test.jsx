import { render, screen } from '@testing-library/react';
import { adaptarApiTarefasAnteriores, TarefasAnterioresCalendario } from '../components/TarefasAnterioresCalendario';

function apiBase() {
  return {
    listObrigacoes: jest.fn().mockResolvedValue({ ok: true, obrigacoes: [
      { obrigacaoId: 'fiscal', tipo: 'OBRIGACAO', nome: 'Obrigação fiscal' },
      { obrigacaoId: 'auto', tipo: 'TAREFA', nome: 'Automática', verificador: 'GUIAS' },
      { obrigacaoId: 'manual', tipo: 'TAREFA', nome: 'Revisar documento', periodicidade: 'MENSAL', ocorrencias: [] },
    ] }),
    getTarefasAgenda: jest.fn().mockResolvedValue({ ok: true,
      tarefas: [{ id: 'migrada', titulo: 'Já migrada', config: {} }, { id: 'complexa', titulo: 'Série histórica', config: { recorrencia: 'MENSAL', dataInicio: '2026-10-01', dataFim: '2026-10-01' } }],
      itens: [{ tipo: 'tarefa', tarefaId: 'migrada' }, { tipo: 'tarefa', tarefaId: 'complexa' }, { tipo: 'marco', id: 'fiscal' }],
    }),
    listRegrasObrigacao: jest.fn(), getAgendaCarteira: jest.fn(), listMarcosFiscais: jest.fn(), getCalendario: jest.fn(),
    getOcorrenciasExcluidas: jest.fn(), createObrigacao: jest.fn(), converterTarefaEmObrigacao: jest.fn(),
    acaoTarefaAgenda: jest.fn(),
  };
}

test('adapta o histórico sem devolver tarefas migradas, obrigações ou atividades automáticas', async () => {
  const api = apiBase();
  const historico = adaptarApiTarefasAnteriores(api, ['legado:migrada', 'nova']);
  expect((await historico.listObrigacoes({ inicio: '2026-10-01' })).obrigacoes.map(o => o.obrigacaoId)).toEqual(['manual']);
  const tarefas = await historico.getTarefasAgenda('2026-10-01', '2026-10-31');
  expect(tarefas.tarefas.map(t => t.id)).toEqual(['complexa']);
  expect(tarefas.itens.map(t => t.tarefaId)).toEqual(['complexa']);
  expect(api.getTarefasAgenda).toHaveBeenCalledWith('2026-10-01', '2026-10-31');
  expect(historico.acaoTarefaAgenda).toBe(api.acaoTarefaAgenda);
});

test('não consulta fontes fiscais e impede criação de obrigações neste histórico', async () => {
  const api = apiBase();
  const historico = adaptarApiTarefasAnteriores(api);
  expect(await historico.listRegrasObrigacao()).toEqual({ ok: true, regras: [] });
  expect(await historico.getAgendaCarteira()).toEqual({ ok: true, itens: [] });
  expect(await historico.listMarcosFiscais()).toEqual({ ok: true, marcos: [] });
  expect(await historico.getCalendario()).toEqual({ ok: true, dias: [] });
  expect(historico.getOcorrenciasExcluidas).toBeUndefined();
  for (const metodo of ['listRegrasObrigacao', 'getAgendaCarteira', 'listMarcosFiscais', 'getCalendario']) expect(api[metodo]).not.toHaveBeenCalled();
  await expect(historico.createObrigacao()).rejects.toThrow('calendário unificado');
  await expect(historico.converterTarefaEmObrigacao()).rejects.toThrow('calendário unificado');
  expect(api.createObrigacao).not.toHaveBeenCalled();
  expect(api.converterTarefaEmObrigacao).not.toHaveBeenCalled();
});

test('falhas de leitura continuam visíveis em vez de virar lista vazia', async () => {
  const api = apiBase(); api.listObrigacoes.mockResolvedValue({ ok: false, message: 'Sem permissão' });
  expect(await adaptarApiTarefasAnteriores(api).listObrigacoes({})).toEqual({ ok: false, message: 'Sem permissão' });
});

test('lista histórica não oferece modelos, filtros fiscais ou criação de obrigação', async () => {
  const api = apiBase();
  render(<TarefasAnterioresCalendario api={api} idsMigrados={['legado:migrada']} onVoltar={jest.fn()} />);
  expect(await screen.findByText('Série histórica')).toBeInTheDocument();
  expect(screen.getByText('Revisar documento')).toBeInTheDocument();
  expect(screen.queryByText('Já migrada')).not.toBeInTheDocument();
  expect(screen.queryByText('Obrigação fiscal')).not.toBeInTheDocument();
  expect(screen.queryByRole('option', { name: 'Obrigações' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Configurar obrigação' })).not.toBeInTheDocument();
});
