import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PagamentosProvisionadosModal } from '../PagamentosProvisionadosModal';
jest.mock('../../../baixa/components/renderBaixaModal', () => ({ BaixaModal: p => <button onClick={() => p.onSave({ data: '2026-01-20' })}>Confirmar {p.competenciaPagamento}</button> }));
test('abre provisão de dezembro, usa baixa existente e conclui só após sucesso', async () => {
  const salvar = jest.fn().mockResolvedValue({}), fechar = jest.fn();
  render(<PagamentosProvisionadosModal pendentes={{itens: [{ id: "p", competencia: "2025-12", subtipo: "ISS", saldo: 400, statusPagamento: "PARCIAL" }],loading:false}} competencia="2026-01" accounts={[]} onSave={salvar} onClose={fechar} />);
  expect(await screen.findByText('ISS')).toBeInTheDocument();
  expect(screen.getByLabelText('Competência da provisão')).toHaveTextContent('dezembro de 2025');
  expect(screen.queryByText(/A baixa atualiza/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('Dar baixa'));
  fireEvent.click(screen.getByText('Confirmar 2026-01'));
  await waitFor(() => expect(salvar).toHaveBeenCalledWith('p', { data: '2026-01-20' }));
  expect(fechar).toHaveBeenCalledTimes(1);
});
