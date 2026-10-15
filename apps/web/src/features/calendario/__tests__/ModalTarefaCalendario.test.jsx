import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ModalTarefaCalendario } from '../components/ModalTarefaCalendario';
import { CalendarioPeriodoTarefa } from '../components/CalendarioPeriodoTarefa';

const inicial = { dataInicio: '2026-10-15', dataFim: '2026-10-15' };
const empresas = [{ id: 'a', razao: 'Alfa', regime: 'LUCRO_PRESUMIDO' }, { id: 'b', razao: 'Beta', regime: 'SIMPLES_NACIONAL' }];
function montar(extra = {}) {
  const api = { criarTarefaCalendario: jest.fn().mockResolvedValue({ ok: true }), acaoTarefaCalendario: jest.fn().mockResolvedValue({ ok: true }) };
  const props = { inicial, empresas, api, onFechar: jest.fn(), onSalvo: jest.fn(), ...extra };
  render(<ModalTarefaCalendario {...props} />);
  return props;
}
test('primeiro clique define um dia, segundo intervalo invertido e terceiro reinicia', () => {
  const onChange = jest.fn();
  render(<CalendarioPeriodoTarefa inicio="2026-10-15" fim="2026-10-15" onChange={onChange} />);
  fireEvent.click(screen.getByRole('button', { name: '20 de outubro de 2026' }));
  expect(onChange).toHaveBeenLastCalledWith('2026-10-20', '2026-10-20');
  fireEvent.click(screen.getByRole('button', { name: '10 de outubro de 2026' }));
  expect(onChange).toHaveBeenLastCalledWith('2026-10-10', '2026-10-20');
  fireEvent.click(screen.getByRole('button', { name: '25 de outubro de 2026' }));
  expect(onChange).toHaveBeenLastCalledWith('2026-10-25', '2026-10-25');
});
test('intervalo atravessa meses e teclado permite navegar ao próximo mês', async () => {
  const onChange = jest.fn();
  render(<CalendarioPeriodoTarefa inicio="2026-10-15" fim="2026-10-15" onChange={onChange} />);
  fireEvent.click(screen.getByRole('button', { name: '31 de outubro de 2026' }));
  fireEvent.keyDown(screen.getByRole('button', { name: '31 de outubro de 2026' }), { key: 'ArrowRight' });
  await waitFor(() => expect(screen.getByRole('button', { name: '1 de novembro de 2026' })).toHaveFocus());
  fireEvent.click(screen.getByRole('button', { name: '1 de novembro de 2026' }));
  expect(onChange).toHaveBeenLastCalledWith('2026-10-31', '2026-11-01');
});
test('salva dia 31 nominal, limite de horário, seleção por regime e subtarefas', async () => {
  const { api, onSalvo } = montar();
  fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Apuração' } });
  fireEvent.click(screen.getByRole('button', { name: 'Data e repetição' }));
  fireEvent.change(screen.getByLabelText('Horário'), { target: { value: 'ATE' } });
  fireEvent.change(screen.getByLabelText('Hora'), { target: { value: '18:00' } });
  fireEvent.change(screen.getByLabelText('Repetição'), { target: { value: 'MENSAL' } });
  fireEvent.change(screen.getByLabelText('Vencimento mensal'), { target: { value: '31' } });
  expect(screen.getByText(/28 ou 29 de fevereiro/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Empresas 0' }));
  fireEvent.change(screen.getByLabelText('Regime tributário'), { target: { value: 'LUCRO_PRESUMIDO' } });
  fireEvent.click(screen.getByRole('button', { name: 'Todas do filtro (1)' }));
  fireEvent.click(screen.getByRole('button', { name: 'Subtarefas 0' }));
  fireEvent.click(screen.getByRole('button', { name: '+ Adicionar subtarefa' }));
  fireEvent.change(screen.getByLabelText('Subtarefa 1'), { target: { value: 'MIT' } });
  fireEvent.click(screen.getByRole('button', { name: 'Criar tarefa' }));
  await waitFor(() => expect(onSalvo).toHaveBeenCalled());
  expect(api.criarTarefaCalendario).toHaveBeenCalledWith(expect.objectContaining({ titulo: 'Apuração', empresasIds: ['a'], config: expect.objectContaining({ diaVencimento: 31, horarioModo: 'ATE', horaLimite: '18:00', horaInicio: null }), subtarefas: [expect.objectContaining({ titulo: 'MIT', id: expect.any(String) })] }));
});
test('edição usa alcance explícito e conserva ID da subtarefa', async () => {
  const { api } = montar({ inicial: { ...inicial, unificada: true, titulo: 'Fechar mês', tarefaId: 't1', cicloChave: '2026-10', recorrencia: 'MENSAL', subtarefas: [{ id: 'mit', titulo: 'MIT' }] } });
  fireEvent.change(screen.getByLabelText('Aplicar alterações'), { target: { value: 'ESTA_E_PROXIMAS' } });
  fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
  await waitFor(() => expect(api.acaoTarefaCalendario).toHaveBeenCalledWith('t1', expect.objectContaining({ acao: 'EDITAR_SERIE', cicloChave: '2026-10', alteracoes: expect.objectContaining({ subtarefas: [{ id: 'mit', titulo: 'MIT' }] }) })));
});
test('recusa preserva formulário e permite tentar novamente', async () => {
  const api = { criarTarefaCalendario: jest.fn().mockRejectedValue(new Error('Sem permissão.')) };
  montar({ api });
  fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Tarefa mantida' } });
  fireEvent.click(screen.getByRole('button', { name: 'Criar tarefa' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Sem permissão.');
  expect(screen.getByLabelText('Título')).toHaveValue('Tarefa mantida');
  expect(screen.getByRole('button', { name: 'Criar tarefa' })).toBeEnabled();
});
test('fechar com alterações pede descarte dentro do mesmo diálogo', () => {
  const { onFechar } = montar();
  fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Rascunho' } });
  fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
  expect(onFechar).not.toHaveBeenCalled();
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Continuar editando' }));
  expect(screen.getByLabelText('Título')).toHaveValue('Rascunho');
  fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
  fireEvent.click(screen.getByRole('button', { name: 'Descartar' }));
  expect(onFechar).toHaveBeenCalledTimes(1);
});
test('não aceita encerramento anterior ao início e conserva a configuração', async () => {
  const { api } = montar();
  fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Mensal' } });
  fireEvent.click(screen.getByRole('button', { name: 'Data e repetição' }));
  fireEvent.change(screen.getByLabelText('Repetição'), { target: { value: 'MENSAL' } });
  fireEvent.change(screen.getByLabelText('Termina'), { target: { value: 'DATA' } });
  fireEvent.change(screen.getByLabelText('Última data de repetição'), { target: { value: '2026-09-01' } });
  fireEvent.submit(screen.getByRole('button', { name: 'Criar tarefa' }).closest('form'));
  expect(await screen.findByRole('alert')).toHaveTextContent('igual ou posterior ao início');
  expect(api.criarTarefaCalendario).not.toHaveBeenCalled();
});
test('avulsa convertida em mensal aplica à série e exibe o alcance', async () => {
  const { api } = montar({ inicial: { ...inicial, titulo: 'Revisar', tarefaId: 't1', cicloChave: '2026-10-15' } });
  fireEvent.click(screen.getByRole('button', { name: 'Data e repetição' }));
  fireEvent.change(screen.getByLabelText('Repetição'), { target: { value: 'MENSAL' } });
  expect(screen.getByLabelText('Aplicar alterações')).toHaveValue('ESTA_E_PROXIMAS');
  fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
  await waitFor(() => expect(api.acaoTarefaCalendario).toHaveBeenCalledWith('t1', expect.objectContaining({ acao: 'EDITAR_SERIE', alteracoes: expect.objectContaining({ config: expect.objectContaining({ recorrencia: 'MENSAL' }) }) })));
});
test('Escape fecha a configuração antes do editor e filtro aceita regime da carteira', () => {
  const { onFechar } = montar({ empresas: [{ id: 'a', razao: 'Empresa', legacyCompany: { regimeTributario: 'LUCRO_PRESUMIDO' } }] });
  fireEvent.click(screen.getByRole('button', { name: 'Empresas 0' }));
  expect(screen.getByRole('option', { name: 'LUCRO PRESUMIDO' })).toBeInTheDocument();
  fireEvent.keyDown(screen.getByLabelText('Buscar empresas'), { key: 'Escape' });
  expect(screen.queryByLabelText('Buscar empresas')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Título')).toBeInTheDocument();
  expect(onFechar).not.toHaveBeenCalled();
});
