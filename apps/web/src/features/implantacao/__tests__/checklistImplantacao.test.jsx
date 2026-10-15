import { act, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { ChecklistImplantacao } from '../ChecklistImplantacao';
import { ProtecaoEdicao } from '../../configuracoes/ProtecaoEdicao';
const tarefa = { chave: 'certificado_a1', titulo: 'Configurar certificado A1', descricao: 'Confira validade', destino: 'certificado', status: 'A_FAZER', responsavel: null, prazo: null, pendencia: 'Cliente vai enviar', versao: 0, origem: { titulo: 'A1', observacao: 'Cliente vai enviar' }, historico: [] };
const lista = t => ({ tarefas: [t], resumo: { pendentes: t.status === 'CONCLUIDO' ? 0 : 1, atrasadas: 0, semResponsavel: t.responsavel ? 0 : 1, concluidas: t.status === 'CONCLUIDO' ? 1 : 0 } });
function preparar(api) { return render(<ProtecaoEdicao><ChecklistImplantacao api={api} companyId="p1" /></ProtecaoEdicao>); }
test('edita responsável e prazo após conversão, salva na empresa e mantém origem', async () => {
  const api = { getImplantacao: jest.fn(async () => ({ implantacao: lista(tarefa) })), salvarImplantacao: jest.fn(async (_, __, c) => ({ implantacao: lista({ ...tarefa, ...c, versao: 1 }) })) };
  preparar(api);
  fireEvent.click(await screen.findByRole('button', { name: /Atualizar tarefa/ }));
  fireEvent.change(screen.getByLabelText('Situação'), { target: { value: 'AGENDADO' } });
  fireEvent.change(screen.getByLabelText('Responsável'), { target: { value: 'Equipe fiscal' } });
  fireEvent.change(screen.getByLabelText('Prazo'), { target: { value: '2026-10-20' } });
  expect(screen.getByRole('button', { name: 'Atualizar checklist' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Salvar tarefa' }));
  await waitFor(() => expect(screen.queryByLabelText('Responsável')).not.toBeInTheDocument());
  expect(api.salvarImplantacao).toHaveBeenCalledWith('p1', 'certificado_a1', expect.objectContaining({ responsavel: 'Equipe fiscal', prazo: '2026-10-20', status: 'AGENDADO', versao: 0 }));
  fireEvent.click(screen.getByRole('button', { name: /Atualizar tarefa/ }));
  expect(screen.getByText('Registro aproveitado do onboarding')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Abrir configuração' })).toHaveAttribute('href', '/companies/p1/certificado');
});
test('conflito preserva edição e só adota versão atual após escolha explícita', async () => {
  const api = { getImplantacao: jest.fn(async () => ({ implantacao: lista(tarefa) })), salvarImplantacao: jest.fn(async () => { throw new Error('Esta tarefa foi alterada.'); }) };
  preparar(api);
  fireEvent.click(await screen.findByRole('button', { name: /Atualizar tarefa/ }));
  fireEvent.change(screen.getByLabelText('Responsável'), { target: { value: 'Ana' } });
  fireEvent.click(screen.getByRole('button', { name: 'Salvar tarefa' }));
  await screen.findByRole('alert');
  expect(screen.getByLabelText('Responsável')).toHaveValue('Ana');
  api.getImplantacao.mockResolvedValue({ implantacao: lista({ ...tarefa, responsavel: 'Bruno', versao: 2 }) });
  fireEvent.click(screen.getByRole('button', { name: 'Conferir versão salva' }));
  await screen.findByText('Versão atualmente salva');
  expect(screen.getByRole('button', { name: 'Salvar tarefa' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Usar os dados salvos' }));
  expect(screen.getByLabelText('Responsável')).toHaveValue('Bruno');
  expect(api.salvarImplantacao).toHaveBeenCalledTimes(1);
});
test('falha de leitura não apresenta conclusão ou checklist vazia; oferece recarga', async () => {
  const api = { getImplantacao: jest.fn(async () => { throw new Error('Indisponível'); }) };
  preparar(api);
  expect(await screen.findByRole('alert')).toHaveTextContent('Indisponível');
  expect(screen.queryByText('Nenhuma tarefa neste filtro.')).not.toBeInTheDocument();
  api.getImplantacao.mockResolvedValue({ implantacao: lista(tarefa) });
  fireEvent.click(screen.getByRole('button', { name: 'Atualizar checklist' }));
  expect(await screen.findByText('Configurar certificado')).toBeInTheDocument();
});
test('leitor não recebe editor e conclusões herdadas aparecem no filtro Todas', async () => {
  preparar({ getImplantacao: async () => ({ implantacao: { ...lista({ ...tarefa, status: 'CONCLUIDO' }), podeEditar: false } }) });
  await screen.findByText('Nenhuma tarefa neste filtro.');
  fireEvent.change(screen.getByLabelText('Mostrar'), { target: { value: 'todas' } });
  expect(screen.getByText('Configurar certificado')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Atualizar tarefa/ })).not.toBeInTheDocument();
});
test('resposta de outra empresa não substitui a empresa atual', async () => {
  let resolver;
  const api = { getImplantacao: jest.fn(id => id === 'p1' ? new Promise(r => { resolver = r; }) : Promise.resolve({ implantacao: lista({ ...tarefa, titulo: 'Empresa atual' }) })) };
  const { rerender } = render(<ChecklistImplantacao api={api} companyId="p1" />);
  rerender(<ChecklistImplantacao api={api} companyId="p2" />);
  await screen.findByText('Empresa atual');
  await act(async () => resolver({ implantacao: lista(tarefa) }));
  expect(screen.queryByText('Configurar certificado')).not.toBeInTheDocument();
});

test('leitura sem edição mostra situação responsável prazo e pendência por tarefa', async () => {
 const t={...tarefa,status:'AGENDADO',responsavel:'Ana',prazo:'2026-10-20'};const api={getImplantacao:jest.fn(async()=>({implantacao:{...lista(t),podeEditar:false}}))};
 render(<ChecklistImplantacao api={api} companyId="p1"/>);
 expect(await screen.findByText('Agendado')).toBeVisible();expect(screen.getByText('Ana')).toBeVisible();expect(screen.getByText('20/10/2026')).toBeVisible();expect(screen.getByText('Cliente vai enviar')).toBeVisible();expect(screen.queryByRole('button',{name:/Atualizar tarefa/})).not.toBeInTheDocument();expect(screen.getByRole('link',{name:'Abrir configuração'})).toHaveClass('btn-secondary');
});
test('foco entra no editor e retorna ao gatilho ao cancelar', async()=>{
 const api={getImplantacao:jest.fn(async()=>({implantacao:lista(tarefa)}))};preparar(api);fireEvent.click(await screen.findByRole('button',{name:/Atualizar tarefa/}));expect(screen.getByLabelText('Situação')).toHaveFocus();fireEvent.click(screen.getByRole('button',{name:'Cancelar edição'}));expect(screen.getByRole('button',{name:/Atualizar tarefa/})).toHaveFocus();
});
test('salvar devolve foco ao filtro quando conclusão remove a linha pendente', async()=>{
 const api={getImplantacao:jest.fn(async()=>({implantacao:lista(tarefa)})),salvarImplantacao:jest.fn(async()=>({implantacao:lista({...tarefa,status:'CONCLUIDO'})}))};preparar(api);fireEvent.click(await screen.findByRole('button',{name:/Atualizar tarefa/}));fireEvent.change(screen.getByLabelText('Situação'),{target:{value:'CONCLUIDO'}});fireEvent.click(screen.getByRole('button',{name:'Salvar tarefa'}));await waitFor(()=>expect(screen.getByLabelText('Mostrar')).toHaveFocus());expect(screen.queryByRole('button',{name:/Atualizar tarefa/})).not.toBeInTheDocument();
});
