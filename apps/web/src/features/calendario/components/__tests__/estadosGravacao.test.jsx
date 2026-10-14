import { act, fireEvent, render, screen } from '@testing-library/react';
import { ModalAtividade } from '../ModalAtividade';
import { ModalObrigacao } from '../../../obrigacoes/components/ModalObrigacao';

test('atividade bloqueia campos durante gravação e recupera rascunho após recusa', async () => {
  let rejeitar;
  const fechar = jest.fn();
  render(<ModalAtividade inicial={{titulo:'Conferir arquivos',dataInicio:'2026-10-14',dataFim:'2026-10-14'}} empresas={[]} api={{salvarTarefaAgenda:()=>new Promise((_,reject)=>{rejeitar=reject;})}} onFechar={fechar} onSalvo={jest.fn()} />);
  fireEvent.click(screen.getByRole('button',{name:'Salvar',exact:true}));
  expect(screen.getByLabelText('Título')).toBeDisabled();
  expect(screen.getByLabelText('Descrição')).toBeDisabled();
  fireEvent.keyDown(document,{key:'Escape'});
  expect(fechar).not.toHaveBeenCalled();
  await act(async()=>rejeitar(new Error('Você não tem acesso a esta atividade.')));
  expect(screen.getByRole('alert')).toHaveTextContent('Você não tem acesso');
  expect(screen.getByLabelText('Título')).toBeEnabled();
  expect(screen.getByLabelText('Título')).toHaveValue('Conferir arquivos');
});

test('obrigação bloqueia os campos nos alcances individual e futuras durante gravação', () => {
  const props={empresas:[{companyId:'e1',razao:'Empresa de exemplo'}],inicial:{obrigacaoId:'o1',ocorrenciaId:'oc1',nome:'Entrega mensal',periodicidade:'MENSAL',companyId:'e1',dataInicio:'2026-10-14',dataFim:'2026-10-15',dataVencimento:'2026-10-20'},onFechar:jest.fn(),onSalvar:jest.fn()};
  const {rerender}=render(<ModalObrigacao {...props} salvando />);
  expect(screen.getByLabelText('Aplicar alteração')).toBeDisabled();
  rerender(<ModalObrigacao {...props} salvando={false} />);
  fireEvent.change(screen.getByLabelText('Aplicar alteração'),{target:{value:'ESTA_E_PROXIMAS'}});
  rerender(<ModalObrigacao {...props} salvando />);
  expect(screen.getByLabelText('Frequência')).toBeDisabled();
  expect(screen.getByLabelText('Dia do vencimento')).toBeDisabled();
  rerender(<ModalObrigacao {...props} salvando={false} />);
  fireEvent.click(screen.getByRole('button',{name:'Salvar esta e as próximas'}));
  expect(props.onSalvar).toHaveBeenCalledWith(expect.objectContaining({alcance:'ESTA_E_PROXIMAS'}));
});
