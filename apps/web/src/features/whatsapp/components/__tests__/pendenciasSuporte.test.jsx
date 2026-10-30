import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PendenciasSuporte, ConsumoIaDetalhado } from '../PendenciasSuporte';
import { criarSolicitacoesMock } from '../../../../api/mock/solicitacoesMock';
import { createRealApi } from '../../../../api/real/realApi';

test('fila indisponível oferece recuperação explícita sem criar ou enviar demanda', async () => {
  const api = { getPendenciasSuporte: jest.fn().mockRejectedValueOnce(new Error('Offline')).mockResolvedValue({ ok: true, total: 0, itens: [] }) };
  render(<PendenciasSuporte api={api} companyId="pc1" onAbrir={jest.fn()} />);
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
  expect(await screen.findByText('Nenhum atendimento pendente.')).toBeVisible();
  expect(api.getPendenciasSuporte).toHaveBeenCalledTimes(2);
});
test('atribuição e conclusão usam ID/versão sem assumir conversa nem abrir chat', async () => {
  const item = { id:'p1',conversaId:'cv1',contratoVersao:1,versao:'a'.repeat(64),estado:'AGUARDANDO',empresa:'Empresa teste',motivo:'Ajuda' };
  const api = { getPendenciasSuporte: jest.fn(async()=>({ok:true,total:1,itens:[item]})),
    assumirSolicitacao:jest.fn(async()=>({ok:true,item})),concluirSolicitacao:jest.fn(async()=>({ok:true,item})),assumirConversaWhatsapp:jest.fn(),resolverSuporte:jest.fn() };
  const onAbrir=jest.fn();render(<PendenciasSuporte api={api} companyId="pc1" onAbrir={onAbrir}/>);
  fireEvent.click(await screen.findByText('Atribuir a mim e iniciar'));
  await waitFor(()=>expect(screen.getByText('Concluir solicitação')).not.toBeDisabled());
  expect(api.assumirSolicitacao).toHaveBeenCalledWith('p1',{chave:expect.any(String),versao:item.versao});
  fireEvent.click(screen.getByText('Concluir solicitação'));
  await waitFor(()=>expect(api.concluirSolicitacao).toHaveBeenCalledWith('p1',{chave:expect.any(String),versao:item.versao}));
  expect(api.assumirConversaWhatsapp).not.toHaveBeenCalled();expect(api.resolverSuporte).not.toHaveBeenCalled();expect(onAbrir).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Ver conversa'));expect(onAbrir).toHaveBeenCalledWith('cv1');
});

test('erro de ação preserva pendência e retry conserva chave da mesma intenção', async () => {
  const item={id:'p',contratoVersao:1,versao:'a'.repeat(64),estado:'AGUARDANDO'};
  const api={getPendenciasSuporte:async()=>({ok:true,total:1,itens:[item]}),assumirSolicitacao:jest.fn().mockRejectedValueOnce(Error('Conferir resposta')).mockResolvedValue({ok:true,item})};
  render(<PendenciasSuporte api={api} companyId="pc1" onAbrir={jest.fn()}/>);
  fireEvent.click(await screen.findByText('Atribuir a mim e iniciar'));expect(await screen.findByRole('alert')).toHaveTextContent('Conferir resposta');
  fireEvent.click(screen.getByText('Atribuir a mim e iniciar'));
  await waitFor(()=>expect(api.assumirSolicitacao).toHaveBeenCalledTimes(2));
  expect(api.assumirSolicitacao.mock.calls[1]).toEqual(api.assumirSolicitacao.mock.calls[0]);
  expect(screen.queryByText('Ver conversa')).not.toBeInTheDocument();
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

test('duplo clique e resposta tardia não concluem outro item ou empresa', async()=>{
 let resolver;const item={id:'a',contratoVersao:1,versao:'a'.repeat(64),estado:'AGUARDANDO'};
 const api={getPendenciasSuporte:jest.fn(async()=>({ok:true,total:1,itens:[item]})),concluirSolicitacao:jest.fn(()=>new Promise(r=>{resolver=r;}))};
 const abrir=jest.fn();const view=render(<PendenciasSuporte api={api} companyId="pc1" onAbrir={abrir}/>);
 const botao=await screen.findByText('Concluir solicitação');fireEvent.click(botao);fireEvent.click(botao);expect(api.concluirSolicitacao).toHaveBeenCalledTimes(1);
 api.getPendenciasSuporte.mockResolvedValue({ok:true,total:0,itens:[]});view.rerender(<PendenciasSuporte api={api} companyId="pc2" onAbrir={abrir}/>);
 await screen.findByText('Nenhum atendimento pendente.');resolver({ok:true,item});await waitFor(()=>expect(abrir).not.toHaveBeenCalled());
 expect(screen.getByText('Nenhum atendimento pendente.')).toBeVisible();
});

test('mock mantém DTO, paginação e agregados completos do contrato individual', async () => {
  const api = criarSolicitacoesMock([{ id: 'pc1', razao: 'Empresa sintética' }]);
  for (let n = 0; n < 150; n++) await api.criarSolicitacao({ chave: `criar-${n}`, dados: { portalClientId: 'pc1', titulo: `Pedido ${n}`, resumo: 'Demonstração' } });
  const first = await api.getPendenciasSuporte('pc1');
  expect(first.total).toBe(151); expect(first.porEmpresa).toEqual({ pc1: 151 }); expect(first.itens).toHaveLength(100);
  const next = await api.getPendenciasSuporte('pc1', { cursor: first.proximoCursor });
  expect(next.itens).toHaveLength(51); expect(next.total).toBe(151);
  const item = first.itens[0];
  expect(item).toMatchObject({ estado: 'AGUARDANDO', estadoLegado: 'AGUARDANDO', situacao: 'NOVA', triagem: false });
  const body = { chave: 'concluir', versao: item.versao };
  const done = await api.concluirSolicitacao(item.id, body);
  expect(await api.concluirSolicitacao(item.id, body)).toEqual(done);
  expect((await api.getPendenciasSuporte('pc1')).total).toBe(150);
  const closed = await api.listarSolicitacoes({ situacao: 'CONCLUIDA' });
  expect(closed.total).toBe(1); expect(closed.resumo.novas).toBe(0); expect(closed.itens[0].concluidoPorId).toBe('mock-contador');
});

test('componente navega páginas, recupera falha no mesmo cursor e volta ao início', async () => {
  const first = { ok: true, total: 151, itens: [{ id: 'a', titulo: 'Primeiro pedido', contratoVersao: 1 }], proximoCursor: 'pagina-2' };
  const next = { ok: true, total: 151, itens: [{ id: 'b', titulo: 'Pedido da segunda página', contratoVersao: 1 }], proximoCursor: null };
  const api = { getPendenciasSuporte: jest.fn().mockResolvedValueOnce(first).mockRejectedValueOnce(Error('offline')).mockResolvedValueOnce(next).mockResolvedValue(first) };
  render(<PendenciasSuporte api={api} companyId="pc1" onAbrir={jest.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Próximas solicitações' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Fila de suporte indisponível');
  fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
  expect(await screen.findByText('Pedido da segunda página')).toBeVisible();
  expect(api.getPendenciasSuporte.mock.calls.slice(1, 3)).toEqual([['pc1', { cursor: 'pagina-2' }], ['pc1', { cursor: 'pagina-2' }]]);
  expect(screen.getByText('Pedidos ao contador · 151')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Voltar ao início' }));
  expect(await screen.findByText('Primeiro pedido')).toBeVisible();
  expect(api.getPendenciasSuporte).toHaveBeenLastCalledWith('pc1');
});

test('troca de empresa descarta página tardia e reinicia cursor', async () => {
  let resolvePage;
  const api = { getPendenciasSuporte: jest.fn().mockResolvedValueOnce({ ok: true, total: 2, itens: [], proximoCursor: 'pc1-next' })
    .mockImplementationOnce(() => new Promise(resolve => { resolvePage = resolve; }))
    .mockResolvedValue({ ok: true, total: 1, itens: [{ id: 'pc2', titulo: 'Pedido da empresa atual', contratoVersao: 1 }] }) };
  const view = render(<PendenciasSuporte api={api} companyId="pc1" onAbrir={jest.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Próximas solicitações' }));
  await waitFor(() => expect(resolvePage).toEqual(expect.any(Function)));
  view.rerender(<PendenciasSuporte api={api} companyId="pc2" onAbrir={jest.fn()} />);
  await screen.findByText('Pedido da empresa atual');
  await act(async () => resolvePage({ ok: true, total: 9, itens: [{ id: 'velha', titulo: 'Página antiga' }] }));
  expect(screen.queryByText('Página antiga')).not.toBeInTheDocument();
  expect(api.getPendenciasSuporte).toHaveBeenLastCalledWith('pc2');
  expect(screen.queryByRole('button', { name: 'Voltar ao início' })).not.toBeInTheDocument();
});

test('adoção individual traduz recusa, conserva intenção no retry e não controla conversa', async () => {
  const item = { id: 'legado', conversaId: 'cv', titulo: 'Demanda antiga', contratoVersao: null, versao: 'a'.repeat(64) };
  const adopted = { ...item, contratoVersao: 1, versao: 'b'.repeat(64) };
  const error = Object.assign(Error('origem_legada_nao_comprovada'), { code: 'origem_legada_nao_comprovada', status: 409 });
  const api = { getPendenciasSuporte: jest.fn().mockResolvedValueOnce({ ok: true, total: 1, itens: [item] }).mockResolvedValue({ ok: true, total: 1, itens: [adopted] }),
    adotarSolicitacao: jest.fn().mockRejectedValueOnce(error).mockResolvedValue({ ok: true, item: adopted }), assumirConversaWhatsapp: jest.fn() };
  const abrir = jest.fn();
  render(<PendenciasSuporte api={api} companyId="pc1" onAbrir={abrir} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Adotar solicitação' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Confira a conversa e o vínculo da empresa');
  expect(screen.getByRole('alert')).not.toHaveTextContent('origem_legada_nao_comprovada');
  fireEvent.click(screen.getByRole('button', { name: 'Adotar solicitação' }));
  await screen.findByRole('button', { name: 'Concluir solicitação' });
  expect(api.adotarSolicitacao.mock.calls[0]).toEqual(['legado', { chave: expect.any(String), versao: item.versao }]);
  expect(api.adotarSolicitacao.mock.calls[1]).toEqual(api.adotarSolicitacao.mock.calls[0]);
  expect(error).toMatchObject({ code: 'origem_legada_nao_comprovada', status: 409 });
  expect(api.assumirConversaWhatsapp).not.toHaveBeenCalled(); expect(abrir).not.toHaveBeenCalled();
});

test('conflito usa recusa HTTP preservada e adoção tardia não altera outra empresa', async () => {
  let resolveAdoption;
  const item = { id: 'legado', titulo: 'Pedido antigo', contratoVersao: null, versao: 'a'.repeat(64) };
  const api = { getPendenciasSuporte: jest.fn(async () => ({ ok: true, total: 1, itens: [item] })),
    adotarSolicitacao: jest.fn().mockRejectedValueOnce(Object.assign(Error('versao_conflitante'), { code: 'versao_conflitante', status: 409 }))
      .mockImplementationOnce(() => new Promise(resolve => { resolveAdoption = resolve; })) };
  const abrir = jest.fn(); const view = render(<PendenciasSuporte api={api} companyId="pc1" onAbrir={abrir} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Adotar solicitação' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('alterada por outra pessoa');
  fireEvent.click(screen.getByRole('button', { name: 'Adotar solicitação' }));
  api.getPendenciasSuporte.mockResolvedValue({ ok: true, total: 0, itens: [] });
  view.rerender(<PendenciasSuporte api={api} companyId="pc2" onAbrir={abrir} />);
  await screen.findByText('Nenhum atendimento pendente.');
  await act(async () => resolveAdoption({ ok: true, item: { ...item, contratoVersao: 1 } }));
  expect(screen.queryByText('Pedido antigo')).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument(); expect(abrir).not.toHaveBeenCalled();
});

test.each([
  ['versao_conflitante', 'alterada por outra pessoa'],
  ['origem_legada_nao_comprovada', 'Confira a conversa e o vínculo da empresa'],
])('recusa %s atravessa realApi e chega legível ao componente, sem perder code/status', async (code, texto) => {
  const fetchAnterior = global.fetch;
  const payload = { ok: false, code, error: code, motivo: code };
  global.fetch = jest.fn(async () => ({ ok: false, status: 409, json: async () => payload }));
  const real = createRealApi();
  let capturado;
  const item = { id: 'legado', contratoVersao: null, versao: 'a'.repeat(64) };
  const api = { getPendenciasSuporte: async () => ({ ok: true, total: 1, itens: [item] }),
    adotarSolicitacao: async (...args) => { try { return await real.adotarSolicitacao(...args); } catch (e) { capturado = e; throw e; } } };
  const view = render(<PendenciasSuporte api={api} companyId="pc1" onAbrir={jest.fn()} />);
  try {
    fireEvent.click(await screen.findByRole('button', { name: 'Adotar solicitação' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(texto);
    expect(screen.getByRole('alert')).not.toHaveTextContent(code);
    expect(capturado).toMatchObject({ code, status: 409, payload });
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/firm/solicitacoes/legado/adotar'),
      expect.objectContaining({ method: 'POST', body: expect.stringContaining(item.versao) }));
  } finally { view.unmount(); global.fetch = fetchAnterior; }
});

// Continuidade de foco: ações explícitas usam summary estável, não respostas assíncronas.
test('paginar, recuperar erro e voltar conservam foco no resumo estável da fila', async () => {
  let resolverPagina;
  const first = { ok: true, total: 2, itens: [{ id: 'a', titulo: 'Primeira demanda', contratoVersao: 1 }], proximoCursor: 'next' };
  const api = { getPendenciasSuporte: jest.fn().mockResolvedValueOnce(first)
    .mockImplementationOnce(() => new Promise((resolve, reject) => { resolverPagina = reject; }))
    .mockResolvedValueOnce({ ok: true, total: 2, itens: [{ id: 'b', titulo: 'Segunda demanda', contratoVersao: 1 }] }).mockResolvedValue(first) };
  render(<PendenciasSuporte api={api} companyId="pc1" onAbrir={jest.fn()} />);
  const proxima = await screen.findByRole('button', { name: 'Próximas solicitações' });
  const resumo = screen.getByText('Pedidos ao contador · 2');
  proxima.focus(); expect(proxima).toHaveFocus(); fireEvent.click(proxima);
  await waitFor(() => expect(resolverPagina).toEqual(expect.any(Function)));
  expect(resumo).toHaveFocus(); expect(screen.queryByRole('button', { name: 'Próximas solicitações' })).not.toBeInTheDocument();
  await act(async () => resolverPagina(Error('Offline')));
  const retry = await screen.findByRole('button', { name: 'Tentar novamente' });
  retry.focus(); fireEvent.click(retry);
  await screen.findByText('Segunda demanda'); expect(resumo).toHaveFocus();
  const voltar = screen.getByRole('button', { name: 'Voltar ao início' }); voltar.focus(); fireEvent.click(voltar);
  await screen.findByText('Primeira demanda'); expect(resumo).toHaveFocus();
  expect(api.getPendenciasSuporte.mock.calls).toEqual([['pc1'], ['pc1', { cursor: 'next' }], ['pc1', { cursor: 'next' }], ['pc1']]);
});

test.each([false, true])('conclusão remove acionador sem perder foco e não rouba foco externo: %s', async externo => {
  let concluir;
  const item = { id: 'a', titulo: 'Demanda final', contratoVersao: 1, versao: 'a'.repeat(64) };
  const api = { getPendenciasSuporte: jest.fn().mockResolvedValueOnce({ ok: true, total: 1, itens: [item] }).mockResolvedValue({ ok: true, total: 0, itens: [] }),
    concluirSolicitacao: jest.fn(() => new Promise(resolve => { concluir = resolve; })), devolverConversaWhatsapp: jest.fn() };
  const abrir = jest.fn();
  render(<><button type="button">Fora da fila</button><PendenciasSuporte api={api} companyId="pc1" onAbrir={abrir} /></>);
  const botao = await screen.findByRole('button', { name: 'Concluir solicitação' });
  const resumo = screen.getByText('Pedidos ao contador · 1'); botao.focus(); fireEvent.click(botao);
  expect(resumo).toHaveFocus(); expect(botao).toBeDisabled();
  const fora = screen.getByRole('button', { name: 'Fora da fila' }); if (externo) fora.focus();
  await act(async () => concluir({ ok: true, item }));
  await screen.findByText('Nenhum atendimento pendente.');
  expect(externo ? fora : resumo).toHaveFocus();
  expect(screen.queryByRole('button', { name: 'Concluir solicitação' })).not.toBeInTheDocument();
  expect(api.concluirSolicitacao).toHaveBeenCalledTimes(1); expect(api.devolverConversaWhatsapp).not.toHaveBeenCalled(); expect(abrir).not.toHaveBeenCalled();
});

test('resposta de conclusão da empresa anterior não move foco na empresa atual', async () => {
  let concluir;
  const item = { id: 'a', titulo: 'Demanda antiga', contratoVersao: 1, versao: 'a'.repeat(64) };
  const api = { getPendenciasSuporte: jest.fn(async company => ({ ok: true, total: company === 'pc1' ? 1 : 0, itens: company === 'pc1' ? [item] : [] })),
    concluirSolicitacao: jest.fn(() => new Promise(resolve => { concluir = resolve; })) };
  const tela = company => <><button type="button">Controle atual</button><PendenciasSuporte api={api} companyId={company} onAbrir={jest.fn()} /></>;
  const view = render(tela('pc1')); const botao = await screen.findByRole('button', { name: 'Concluir solicitação' }); botao.focus(); fireEvent.click(botao);
  view.rerender(tela('pc2')); await screen.findByText('Nenhum atendimento pendente.');
  const atual = screen.getByRole('button', { name: 'Controle atual' }); atual.focus();
  await act(async () => concluir({ ok: true, item })); expect(atual).toHaveFocus(); expect(screen.queryByText('Demanda antiga')).not.toBeInTheDocument();
});
