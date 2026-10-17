import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PendenciasSuporte, ConsumoIaDetalhado } from '../PendenciasSuporte';

test('fila indisponível oferece recuperação explícita sem criar ou enviar demanda', async () => {
  const api = { getPendenciasSuporte: jest.fn().mockRejectedValueOnce(new Error('Offline')).mockResolvedValue({ ok: true, total: 0, itens: [] }) };
  render(<PendenciasSuporte api={api} companyId="pc1" onAbrir={jest.fn()} />);
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
  expect(await screen.findByText('Nenhum atendimento pendente.')).toBeVisible();
  expect(api.getPendenciasSuporte).toHaveBeenCalledTimes(2);
});
test('pendência lida permanece até ação explícita, assumindo antes de resolver', async () => {
  const item = { id: 'p1', conversaId: 'cv1', estado: 'AGUARDANDO', empresa: 'Empresa teste', motivo: 'Ajuda', resumo: 'Emitir para Gusmed' };
  const api = { getPendenciasSuporte: jest.fn(async () => ({ ok: true, total: 1, itens: [item] })),
    assumirConversaWhatsapp: jest.fn(async () => { item.estado = 'EM_ATENDIMENTO'; }), resolverSuporte: jest.fn(async () => {}) };
  const onAbrir = jest.fn(); render(<PendenciasSuporte api={api} onAbrir={onAbrir} />);
  fireEvent.click(await screen.findByText('Equipe · 1'));
  fireEvent.click(screen.getByText('Empresa teste')); expect(onAbrir).toHaveBeenCalledWith('cv1');
  expect(screen.getByText('Equipe · 1')).toBeTruthy();
  fireEvent.click(screen.getByText('Aceitar')); await waitFor(() => expect(screen.getByText('Resolver')).not.toBeDisabled());
  fireEvent.click(screen.getByText('Resolver')); await waitFor(() => expect(api.resolverSuporte).toHaveBeenCalledWith('cv1'));
});
test('erro de ação aparece e preserva pendência', async () => {
  const api = { getPendenciasSuporte: async () => ({ ok: true, total: 1, itens: [{ id: 'p', conversaId: 'c', estado: 'AGUARDANDO' }] }), assumirConversaWhatsapp: async () => { throw Error('Outro atendente assumiu'); } };
  render(<PendenciasSuporte api={api} onAbrir={() => {}} />); fireEvent.click(await screen.findByText('Equipe · 1'));
  fireEvent.click(screen.getByText('Aceitar')); expect(await screen.findByRole('alert')).toHaveTextContent('Outro atendente assumiu');
});
test('custos detalhados distinguem consumo de reserva', async () => {
  const api = { getConsumoIaDetalhado: async () => ({ ok: true, consumo: { custoUsd: .0045, reservaUsd: .2, itens: [{ area: 'Suporte', custoUsd: .0045, chamadas: 1 }] } }) };
  render(<ConsumoIaDetalhado api={api} />); fireEvent.click(screen.getByText('Custos por área'));
  expect(await screen.findByText(/Suporte:.*0,0045/)).toBeTruthy(); expect(screen.getByText(/Reservado:/)).toBeTruthy();
});

test('anotações consultam a empresa selecionada e mostram o pedido ao contador', async()=>{
 const api={getPendenciasSuporte:jest.fn(async()=>({ok:true,total:1,itens:[{id:'p',conversaId:'cv',motivo:'Atualizar guia DAS',estado:'AGUARDANDO'}]}))};
 render(<PendenciasSuporte api={api} companyId="pc1" onAbrir={()=>{}}/>);
 expect(await screen.findByText('Pedidos ao contador · 1')).toBeInTheDocument();
 expect(api.getPendenciasSuporte).toHaveBeenCalledWith('pc1');expect(screen.getByText('Atualizar guia DAS')).toBeVisible();
});

function filaExclusao(excluirDemandaSuporte = jest.fn(async () => ({ ok: true }))) {
  const item = { id: 'demanda-1', conversaId: 'cv1', estado: 'AGUARDANDO', empresa: 'Empresa teste', motivo: 'Revisar documento' };
  const api = { getPendenciasSuporte: jest.fn(async () => ({ ok: true, total: 1, itens: [item] })), excluirDemandaSuporte, assumirConversaWhatsapp: jest.fn(), devolverConversaWhatsapp: jest.fn(), excluirConversaWhatsapp: jest.fn(), resolverSuporte: jest.fn() };
  return { item, api };
}
test('excluir demanda confirma o pedido e preserva conversa, pausa e outras ações', async () => {
  const { api } = filaExclusao(); const onAbrir = jest.fn();
  render(<PendenciasSuporte api={api} onAbrir={onAbrir} companyId="pc1" />);
  fireEvent.click(await screen.findByText('Excluir demanda'));
  expect(screen.getByRole('dialog')).toHaveTextContent('Revisar documento');
  expect(screen.getByRole('dialog')).toHaveTextContent('a IA não será reativada');
  expect(api.excluirDemandaSuporte).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Cancelar'));
  expect(api.excluirDemandaSuporte).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Excluir demanda'));
  api.getPendenciasSuporte.mockResolvedValue({ ok: true, total: 0, itens: [] });
  fireEvent.click(screen.getByText('Confirmar exclusão'));
  await screen.findByText('Nenhum atendimento pendente.');
  expect(api.excluirDemandaSuporte).toHaveBeenCalledWith('cv1', 'demanda-1');
  expect(api.assumirConversaWhatsapp).not.toHaveBeenCalled(); expect(api.devolverConversaWhatsapp).not.toHaveBeenCalled();
  expect(api.excluirConversaWhatsapp).not.toHaveBeenCalled(); expect(api.resolverSuporte).not.toHaveBeenCalled(); expect(onAbrir).not.toHaveBeenCalled();
});
test('falha na exclusão mantém confirmação e demanda para conferência', async () => {
  const { api } = filaExclusao(jest.fn(async () => { throw Error('Outro atendente assumiu'); }));
  render(<PendenciasSuporte api={api} onAbrir={jest.fn()} companyId="pc1" />);
  fireEvent.click(await screen.findByText('Excluir demanda')); fireEvent.click(screen.getByText('Confirmar exclusão'));
  await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent('Outro atendente assumiu'));
  expect(screen.getByText('Pedidos ao contador · 1')).toBeInTheDocument();
});
test('resposta tardia de exclusão não altera outra empresa nem navega', async () => {
  let concluir; const { api } = filaExclusao(jest.fn(() => new Promise(resolve => { concluir = resolve; })));
  const onAbrir = jest.fn(); const view = render(<PendenciasSuporte api={api} onAbrir={onAbrir} companyId="pc1" />);
  fireEvent.click(await screen.findByText('Excluir demanda')); fireEvent.click(screen.getByText('Confirmar exclusão'));
  api.getPendenciasSuporte.mockResolvedValue({ ok: true, total: 0, itens: [] });
  view.rerender(<PendenciasSuporte api={api} onAbrir={onAbrir} companyId="pc2" />);
  await screen.findByText('Nenhum atendimento pendente.'); concluir({ ok: true });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.queryByText('Demanda excluída da fila. A conversa foi preservada.')).not.toBeInTheDocument(); expect(onAbrir).not.toHaveBeenCalled();
});
