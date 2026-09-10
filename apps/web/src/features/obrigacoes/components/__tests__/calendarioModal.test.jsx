import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CalendarioObrigacoesModal } from '../CalendarioObrigacoesModal';
const item = { obrigacaoId: 's1', nome: 'EFD', periodicidade: 'MENSAL', companyId: 'e1', empresa: 'Empresa', ocorrencias: [{ ocorrenciaId: 'o1', dataInicio: '2026-09-10', dataFim: '2026-09-15', dataVencimento: '2026-09-25', situacao: 'PENDENTE' }] };
function setup() {
  const api = { listObrigacoes: jest.fn(async () => ({ ok: true, obrigacoes: [item] })), excluirOcorrencia: jest.fn(async () => ({ ok: true, canceladas: 1 })), updateOcorrencia: jest.fn(async () => ({ ok: true })) };
  render(<CalendarioObrigacoesModal api={api} empresas={[{ companyId: 'e1', razao: 'Empresa' }]} onClose={() => {}} />);
  return api;
}
test('exclusão pergunta alcance no modal e envia escolha explicitamente', async () => {
  const api = setup();
  fireEvent.click(await screen.findByRole('button', { name: 'Excluir' }));
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ESTA_E_PROXIMAS' } });
  expect(api.excluirOcorrencia).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar exclusão' }));
  await waitFor(() => expect(api.excluirOcorrencia).toHaveBeenCalledWith('o1', { alcance: 'ESTA_E_PROXIMAS' }));
});
test('editar futuras envia frequência e vencimento versionados com janela', async () => {
  const api = setup();
  fireEvent.click(await screen.findByRole('button', { name: 'Editar' }));
  fireEvent.change(screen.getByRole('combobox', { name: 'Aplicar alteração' }), { target: { value: 'ESTA_E_PROXIMAS' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Janela de trabalho' }), { target: { value: 'FIXA' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Frequência' }), { target: { value: 'TRIMESTRAL' } });
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Dia do vencimento' }), { target: { value: '25' } });
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Dia de fim' }), { target: { value: '17' } });
  fireEvent.click(screen.getByRole('button', { name: 'Salvar esta e as próximas' }));
  await waitFor(() => expect(api.updateOcorrencia).toHaveBeenCalledWith('o1', { alcance: 'ESTA_E_PROXIMAS', janelaTrabalho: { modo: 'DIAS_DO_CICLO', diaInicio: 10, diaFim: 17, deslocamentoFim: 0 }, regra: { periodicidade: 'TRIMESTRAL', mesReferencia: 1, diaVencimento: 25, ajusteDiaUtil: 'ANTECIPAR', defasagemMeses: 1, diasPreparacao: 0 } }));
});
