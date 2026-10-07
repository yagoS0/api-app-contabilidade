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


test('mostra a procedência e consulta a guia sem lançar baixa automaticamente', async () => {
  const buscar=jest.fn().mockResolvedValue({encontrado:true}), salvar=jest.fn(), reload=jest.fn();
  render(<PagamentosProvisionadosModal pendentes={{itens:[{id:'p',competencia:'2026-09',subtipo:'PIS',saldo:500,sourceGuide:{id:'g',paymentStatus:'PAID',paymentStatusSource:'CLIENTE'},comprovante:{dataArrecadacao:'2026-10-02',total:500}}],reload}} competencia="2026-10" onBuscarPagamento={buscar} onSave={salvar} onClose={()=>{}} />);
  expect(screen.getByText('o cliente confirmou')).toBeInTheDocument();
  expect(screen.getByText(/Afirmação do cliente, não comprovante/)).toBeInTheDocument();
  fireEvent.click(screen.getByText('Buscar pagamento'));
  await waitFor(()=>expect(reload).toHaveBeenCalledTimes(1));
  expect(buscar).toHaveBeenCalledWith('g');
  expect(salvar).not.toHaveBeenCalled();
  expect(screen.getByRole('status')).toHaveTextContent('Use Dar baixa');
});

test('sem guia não oferece consulta e falha na consulta mantém a baixa disponível', async () => {
  const {rerender}=render(<PagamentosProvisionadosModal pendentes={{itens:[{id:'p',competencia:'2026-09',subtipo:'ISS',saldo:500}]}} onClose={()=>{}} onBuscarPagamento={jest.fn()} />);
  expect(screen.getByText('Sem guia vinculada')).toBeInTheDocument();
  expect(screen.queryByText('Buscar pagamento')).not.toBeInTheDocument();
  rerender(<PagamentosProvisionadosModal pendentes={{itens:[{id:'p',competencia:'2026-09',subtipo:'PIS',saldo:500,sourceGuide:{id:'g'}}]}} onClose={()=>{}} onBuscarPagamento={jest.fn().mockRejectedValue(new Error('Consulta indisponível'))} />);
  fireEvent.click(screen.getByText('Buscar pagamento'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Consulta indisponível');
  expect(screen.getByText('Dar baixa')).toBeEnabled();
});
