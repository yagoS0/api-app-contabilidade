import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { GuruConferenciaPanel } from '../GuruConferenciaPanel';

const item = { id: 'id-sintetico', hash: 'hash-original', versao: 1, estado: 'PREPARADA', origem: 'GURU_API',
  dados: { transacaoId: 'venda-sintetica', statusOriginal: 'approved', financeiro: { total: 1200, moeda: 'BRL', parcelas: { quantidade: 12 } },
    produto: { nome: 'Produto sintético', idInterno: 'produto-local' }, fatura: { ciclo: 1, inicio: '2026-10-01', fim: '2027-09-30' } },
  historico: [{ evento: 'IMPORTADA', instante: '2026-10-22T12:00:00Z', atorId: 'contador-sintetico' }] };
const lista = items => ({ items, total: items.length, pagina: 1, tamanhoPagina: 20, conexao: 'CONFIGURADA_NAO_VERIFICADA', ocupada: false });
function fixture() {
  return { listarGuruConferencia: jest.fn(async () => lista([item])), obterGuruConferencia: jest.fn(async () => ({ item })),
    conferirGuruConferencia: jest.fn(async () => ({ item: { ...item, estado: 'CONFERIDA', versao: 2 } })),
    importarGuruConferencia: jest.fn(async () => ({ estado: 'CONCLUIDA', criadas: 1, repetidas: 0, conflitos: 0, lidas: 1 })),
    emitirNfse: jest.fn() };
}

test('piloto desabilitado orienta habilitação no servidor sem expor erro bruto ou sugerir desenvolvimento', async () => {
  const api = fixture();
  api.listarGuruConferencia.mockRejectedValue(Object.assign(Error('segredo-sintetico'), { code: 'guru_piloto_desabilitado' }));
  render(<GuruConferenciaPanel api={api} companyId="a" />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Solicite ao administrador a configuração e habilitação do piloto no servidor.');
  expect(screen.queryByText(/servidor de desenvolvimento|segredo-sintetico/)).not.toBeInTheDocument();
  expect(api.importarGuruConferencia).not.toHaveBeenCalled();
  expect(api.emitirNfse).not.toHaveBeenCalled();
});

test('busca nota por tomador, expõe identidade antes da confirmação e preserva falha de DANFSe', async () => {
  const api = fixture();
  const nota = { id: 'portal:nota', hash: 'hash-nota', numero: '42', valor: '100.00', moeda: 'BRL',
    origem: 'PortalInvoice', estado: 'autorizada', vinculavel: true, prestador: '11111111000191',
    tomador: '12345678909', tomadorNome: 'Tomador sintético', competencia: '2026-10-01', ambiente: 'PRODUCAO', identidadeFiscal: '1'.repeat(50),
    documentos: { xml: true, danfse: true } };
  api.buscarNotasGuru = jest.fn(async () => ({ items: [nota], total: 1, pagina: 1 }));
  api.obterNotaGuru = jest.fn(async () => ({ nota }));
  api.vincularNotaGuru = jest.fn(async () => ({ item: { ...item, notas: [{ ...nota, conferencia: 'CONFERIDA', conferidaEm: '2026-10-22' }] } }));
  api.baixarNotaGuru = jest.fn(async () => { throw Object.assign(Error(), { code: 'danfse_sem_qrcode' }); });
  render(<GuruConferenciaPanel api={api} companyId="a" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Conferir transação venda-sintetica' }));
  fireEvent.change(await screen.findByLabelText('Número ou tomador da nota'), { target: { value: 'Tomador' } });
  fireEvent.click(screen.getByRole('button', { name: 'Buscar notas salvas' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Conferir nota 42' }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText('Prestador no XML')).toBeInTheDocument();
  expect(within(dialog).getByText('11111111000191')).toBeInTheDocument();
  expect(within(dialog).getByText('2026-10-01')).toBeInTheDocument();
  expect(within(dialog).getByText('PRODUCAO')).toBeInTheDocument();
  expect(within(dialog).getByText(/Nota capturada/)).toBeInTheDocument();
  expect(within(dialog).queryByText(/PortalInvoice/)).not.toBeInTheDocument();
  expect(api.vincularNotaGuru).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar vínculo fiscal' }));
  await screen.findByText(/Vínculo conferido e persistido/);
  expect(api.buscarNotasGuru).toHaveBeenCalledWith('a', 'Tomador', 1);
  expect(api.vincularNotaGuru).toHaveBeenCalledWith('a', item.id, { versao: 1, hash: item.hash, notaId: nota.id, notaHash: nota.hash, confirmada: true });
  fireEvent.click(screen.getByRole('button', { name: 'DANFSe' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('QR Code obrigatório');
  expect(screen.getByRole('button', { name: 'XML' })).toBeInTheDocument();
  expect(api.emitirNfse).not.toHaveBeenCalled(); expect(api.importarGuruConferencia).not.toHaveBeenCalled();
});

test('resumo legível mantém dados técnicos recolhidos e evidência completa disponível', async () => {
  const api = fixture();
  api.obterGuruConferencia.mockResolvedValue({ item: { ...item, dados: { ...item.dados, datas: { confirmed_at: 1792670400 } } } });
  render(<GuruConferenciaPanel api={api} companyId="a" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Conferir transação venda-sintetica' }));
  const resumo = await screen.findByText('Dados técnicos da origem');
  const disclosure = resumo.closest('details');
  expect(disclosure).not.toHaveAttribute('open');
  expect(within(disclosure).getByText('produto-local')).toBeInTheDocument();
  expect(within(disclosure).getByText('1792670400')).toBeInTheDocument();
  expect(screen.getByText('Aprovação na origem (UTC)').nextElementSibling).toHaveTextContent('22/10/2026');
  fireEvent.click(resumo);
  expect(disclosure).toHaveAttribute('open');
  expect(api.conferirGuruConferencia).not.toHaveBeenCalled();
  expect(api.importarGuruConferencia).not.toHaveBeenCalled();
});

test('filtro ignora resposta antiga e totais representam o conjunto completo, não a página', async () => {
  const api = fixture(); let antiga;
  api.listarGuruConferencia.mockImplementationOnce(() => new Promise(r => { antiga = r; }));
  const resumo = { vendas: 54, notasVinculadas: 2, vendasSemVinculo: 52, moedas: [{ moeda: 'BRL', total: '0.3', informados: 53, ausentes: 1 }], valoresAusentes: 1, moedasAusentes: 0 };
  api.listarGuruConferencia.mockResolvedValue({ ...lista([item]), total: 54, resumo });
  render(<GuruConferenciaPanel api={api} companyId="a" />);
  fireEvent.submit(screen.getByRole('form', { name: 'Filtrar vendas salvas' }));
  await screen.findByText('54 registros salvos');
  await act(async () => antiga(lista([])));
  expect(screen.getByText('54 registros salvos')).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: 'Totais do conjunto filtrado' })).getByText('54')).toBeInTheDocument();
  api.listarGuruConferencia.mockRejectedValueOnce(Error('offline'));
  fireEvent.click(screen.getByRole('button', { name: 'Reler dados salvos' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('última leitura confirmada');
  expect(screen.getByText('54 registros salvos')).toBeInTheDocument();
});

test.each([
  ['17072.44', '17.072,44'],
  ['17072', '17.072'],
  ['0', '0'],
  ['0.00', '0,00'],
  ['-17072.44', '-17.072,44'],
  ['+17072.4400', '+17.072,4400'],
  ['-0', '-0'],
  ['9007199254740993.12345678901234567890123456789', '9.007.199.254.740.993,12345678901234567890123456789'],
  ['0.000000000000000000000000001', '0,000000000000000000000000001'],
  ['1.234567890123456789e+21', '1.234.567.890.123.456.789.000'],
  ['1.234567890123456789e-7', '0,0000001234567890123456789'],
  ['-1.707244E+4', '-17.072,44'],
  ['12.3400e0', '12,3400'],
  ['1e+10001', '1 × 10^+10001'],
  ['1.234e-10001', '1,234 × 10^-10001'],
  [17072.44, '17.072,44'],
  [0, '0'],
  [null, 'Não informado'],
  [undefined, 'Não informado'],
  ['', 'Valor inválido'],
  [' ', 'Valor inválido'],
  ['17.072,44', 'Valor inválido'],
  ['12oops', 'Valor inválido'],
  ['1e', 'Valor inválido'],
  ['NaN', 'Valor inválido'],
  ['Infinity', 'Valor inválido'],
  [NaN, 'Valor inválido'],
  [Infinity, 'Valor inválido'],
  [9007199254740992, 'Valor inválido'],
  [false, 'Valor inválido'],
  [{}, 'Valor inválido'],
])('total do resumo preserva precisão e moeda: %s → %s', async (total, esperado) => {
  const api = fixture();
  const resumo = { vendas: 54, notasVinculadas: 2, vendasSemVinculo: 52,
    moedas: [{ moeda: 'BRL', total, informados: 53, ausentes: 1 }, { moeda: 'USD', total: '12.34', informados: 1, ausentes: 0 }],
    valoresAusentes: 1, moedasAusentes: 0 };
  api.listarGuruConferencia.mockResolvedValue({ ...lista([item]), total: 54, resumo });
  render(<GuruConferenciaPanel api={api} companyId="a" />);
  const regiao = within(await screen.findByRole('region', { name: 'Totais do conjunto filtrado' }));
  expect(regiao.getByText(`BRL: ${esperado} · 53 valores informados · 1 ausentes`)).toBeInTheDocument();
  expect(regiao.getByText('USD: 12,34 · 1 valores informados')).toBeInTheDocument();
  expect(regiao.getByText(/Totais parciais/)).toBeInTheDocument();
  expect(regiao.getByText('54')).toBeInTheDocument();
  expect(api.importarGuruConferencia).not.toHaveBeenCalled();
  expect(api.conferirGuruConferencia).not.toHaveBeenCalled();
  expect(api.emitirNfse).not.toHaveBeenCalled();
});

test('StrictMode libera a carga atual e releitura sem aceitar resposta do efeito descartado', async () => {
  const api = fixture(); let antiga;
  api.listarGuruConferencia.mockImplementationOnce(() => new Promise(r => { antiga = r; }))
    .mockResolvedValue({ ...lista([]), conexao: 'DESCONECTADA', demonstracao: true });
  render(<StrictMode><GuruConferenciaPanel api={api} companyId="a" /></StrictMode>);
  await screen.findByText(/Nenhum registro salvo/);
  expect(screen.queryByText('Processando…')).not.toBeInTheDocument();
  expect(screen.getByText(/eNotas não é alterado/)).toBeInTheDocument();
  expect(screen.getByText(/Demonstração/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Reler dados salvos' })).toBeEnabled();
  await act(async () => antiga(lista([item])));
  expect(screen.queryByText('Produto sintético')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Reler dados salvos' }));
  await waitFor(() => expect(api.listarGuruConferencia).toHaveBeenCalledTimes(3));
  await waitFor(() => expect(screen.queryByText('Processando…')).not.toBeInTheDocument());
  expect(api.importarGuruConferencia).not.toHaveBeenCalled();
});

test('troca de API mantém trava da carga nova mesmo quando a anterior termina; desmontagem isola retorno', async () => {
  const api = fixture(), nova = fixture(); let antiga, atual;
  api.listarGuruConferencia.mockImplementation(() => new Promise(r => { antiga = r; }));
  nova.listarGuruConferencia.mockImplementationOnce(() => new Promise(r => { atual = r; }));
  const { rerender, unmount } = render(<GuruConferenciaPanel api={api} companyId="a" />);
  rerender(<GuruConferenciaPanel api={nova} companyId="a" />);
  await act(async () => antiga(lista([item])));
  expect(screen.getByRole('button', { name: 'Reler dados salvos' })).toBeDisabled();
  expect(screen.queryByText('Produto sintético')).not.toBeInTheDocument();
  await act(async () => atual(lista([])));
  expect(screen.getByRole('button', { name: 'Reler dados salvos' })).toBeEnabled();
  nova.listarGuruConferencia.mockImplementationOnce(() => new Promise(r => { atual = r; }));
  fireEvent.click(screen.getByRole('button', { name: 'Reler dados salvos' }));
  unmount();
  render(<GuruConferenciaPanel api={fixture()} companyId="b" />);
  await screen.findByText('Produto sintético');
  await act(async () => atual(lista([])));
  expect(screen.getByText('Produto sintético')).toBeInTheDocument();
});
test('abrir somente lê; conferência explícita usa versão/hash e mantém bloqueios', async () => {
  const api = fixture(); render(<GuruConferenciaPanel api={api} companyId="empresa-a" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Conferir transação venda-sintetica' }));
  await screen.findByText('Valor financeiro (não base fiscal)');
  expect(api.conferirGuruConferencia).not.toHaveBeenCalled(); expect(api.importarGuruConferencia).not.toHaveBeenCalled();
  expect(screen.getByText(/NÃO VERIFICADA/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar conferência interna' }));
  await screen.findByText(/Conferência interna persistida/);
  expect(api.conferirGuruConferencia).toHaveBeenCalledWith('empresa-a', item.id, { versao: 1, hash: item.hash, confirmada: true });
  expect(api.emitirNfse).not.toHaveBeenCalled();
});
test('vazio legítimo e desconectado são distintos de erro de leitura', async () => {
  const api = fixture(); api.listarGuruConferencia.mockResolvedValue({ ...lista([]), conexao: 'DESCONECTADA' });
  render(<GuruConferenciaPanel api={api} companyId="a" />);
  await screen.findByText(/Nenhum registro salvo/);
  expect(screen.getByText(/Conexão pendente/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Importar para conferência', hidden: true })).toBeDisabled();
  api.listarGuruConferencia.mockRejectedValue(Error('offline'));
  fireEvent.click(screen.getByRole('button', { name: 'Reler dados salvos' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível concluir');
});
test('resposta inicial inválida não inventa zero', async () => {
  const api = fixture(); api.listarGuruConferencia.mockResolvedValue({});
  render(<GuruConferenciaPanel api={api} companyId="a" />);
  await screen.findByRole('alert'); expect(screen.queryByText(/Nenhum registro salvo/)).not.toBeInTheDocument();
});
test('importação explícita, ocupada, erro e releitura sem nova importação', async () => {
  const api = fixture(); let reject;
  api.importarGuruConferencia.mockImplementation(() => new Promise((_, r) => { reject = r; }));
  render(<GuruConferenciaPanel api={api} companyId="a" />);
  await screen.findByText('1 registros salvos');
  expect(screen.getByText('Importar vendas da origem').closest('details')).not.toHaveAttribute('open');
  fireEvent.click(screen.getByText('Importar vendas da origem'));
  fireEvent.change(screen.getByLabelText('Início'), { target: { value: '2026-10-01' } });
  fireEvent.change(screen.getByLabelText('Fim'), { target: { value: '2026-10-22' } });
  fireEvent.click(screen.getByRole('button', { name: 'Importar para conferência' }));
  expect(screen.getByRole('button', { name: 'Importar para conferência', hidden: true })).toBeDisabled();
  expect(screen.getByLabelText('Início')).toBeDisabled();
  await act(async () => reject(Object.assign(Error(), { code: 'guru_importacao_ocupada' })));
  expect(screen.getByRole('alert')).toHaveTextContent('Outra importação');
  fireEvent.click(screen.getByRole('button', { name: 'Reler dados salvos' }));
  await waitFor(() => expect(api.listarGuruConferencia).toHaveBeenCalledTimes(2));
  expect(api.importarGuruConferencia).toHaveBeenCalledTimes(1);
  expect(api.importarGuruConferencia).toHaveBeenCalledWith('a', { campo: 'confirmed_at', inicio: '2026-10-01', fim: '2026-10-22' });
});
test('troca de empresa descarta resposta atrasada da empresa anterior', async () => {
  const api = fixture(); let resolve;
  api.listarGuruConferencia.mockImplementationOnce(() => new Promise(r => { resolve = r; })).mockResolvedValue(lista([]));
  const { rerender } = render(<GuruConferenciaPanel api={api} companyId="a" />);
  rerender(<GuruConferenciaPanel api={api} companyId="b" />);
  await screen.findByText(/Nenhum registro salvo/);
  await act(async () => resolve(lista([item])));
  expect(screen.queryByText('Produto sintético')).not.toBeInTheDocument();
});
test('conflito mostra ambas evidências e confirma somente a nova revisão', async () => {
  const api = fixture();
  api.obterGuruConferencia.mockResolvedValue({ item: { ...item, estado: 'CONFLITO', versao: 3,
    conflito: { hash: 'hash-novo', dados: { ...item.dados, statusOriginal: 'refunded' } } } });
  render(<GuruConferenciaPanel api={api} companyId="a" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Conferir transação venda-sintetica' }));
  await screen.findByText('Nova evidência da origem');
  expect(screen.getByText('approved')).toBeInTheDocument(); expect(screen.getByText('Novo: refunded')).toBeInTheDocument();
  api.conferirGuruConferencia.mockRejectedValue(Object.assign(Error(), { code: 'guru_revisao_desatualizada' }));
  fireEvent.click(screen.getByRole('button', { name: 'Conferir e aceitar nova revisão' }));
  await screen.findByRole('alert');
  expect(api.conferirGuruConferencia).toHaveBeenCalledWith('a', item.id, { versao: 3, hash: 'hash-novo', confirmada: true });
  expect(screen.queryByText(/Conferência interna persistida/)).not.toBeInTheDocument();
});

test.each([
  ['financeiro.bruto', 'Valor bruto', 1200, 1300],
  ['financeiro.liquido', 'Valor líquido', 1100, 1100.000000001],
  ['financeiro.parcelas.valor', 'Valor da parcela', 100, 110],
  ['financeiro.parcelas.juros', 'Juros das parcelas', null, 0],
  ['financeiro.parcelas.quantidade', 'Parcelas financeiras', 12, 10],
  ['financeiro.total', 'Total financeiro', 1200, 1300],
  ['financeiro.moeda', 'Moeda', 'BRL', 'USD'],
  ['produto.ofertaId', 'Identidade da oferta', 'oferta-a', 'oferta-b'],
  ['produto.idInterno', 'Identidade interna do produto', 'produto-a', 'produto-b'],
  ['produto.nome', 'Produto', 'Produto anterior', 'Produto novo'],
  ['fatura.id', 'Identidade da fatura', 'fatura-a', 'fatura-b'],
  ['fatura.statusOriginal', 'Estado original da fatura', 'paid', 'pending'],
  ['fatura.valor', 'Valor da fatura', 1200, null],
  ['fatura.ciclo', 'Ciclo da fatura', 1, 2],
  ['fatura.inicio', 'Início da fatura na origem', '2026-10-01', '2026-10-02'],
  ['fatura.fim', 'Fim da fatura na origem', '2027-09-30', '2027-10-01'],
  ['assinatura.id', 'Identidade da assinatura', 'assinatura-a', 'assinatura-b'],
  ['assinatura.idInterno', 'Identidade interna da assinatura', null, 'assinatura-local'],
  ['datas.confirmed_at', 'Aprovação na origem (Unix, segundos)', 1791000000, 1791000001],
  ['datas.updated_at', 'Atualização na origem (Unix, segundos)', 1791000000, 1791000001],
  ['datas.ordered_at', 'Venda na origem (Unix, segundos)', 1791000000, 1791000001],
  ['datas.cancelled_at', 'Cancelamento na origem (Unix, segundos)', null, 1791000001],
])('conflito exclusivo em %s apresenta anterior/novo antes de aceitar', async (caminho, rotulo, anterior, novo) => {
  const alterar = (dados, valor) => {
    const copia = JSON.parse(JSON.stringify(dados));
    const partes = caminho.split('.');
    const chave = partes.pop();
    const destino = partes.reduce((v, p) => (v[p] ||= {}), copia);
    destino[chave] = valor;
    return copia;
  };
  const dados = alterar(item.dados, anterior);
  const api = fixture();
  api.obterGuruConferencia.mockResolvedValue({ item: { ...item, dados, estado: 'CONFLITO', versao: 3,
    conflito: { hash: 'hash-alterado', dados: alterar(dados, novo) } } });
  render(<GuruConferenciaPanel api={api} companyId="a" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Conferir transação venda-sintetica' }));
  const diferencas = within(await screen.findByRole('region', { name: 'Campos alterados na origem' }));
  expect(diferencas.getByText(/1 campo alterado/)).toBeInTheDocument();
  expect(diferencas.getByText(rotulo)).toBeInTheDocument();
  expect(diferencas.getByText(`Anterior: ${anterior ?? 'Não informado'}`)).toBeInTheDocument();
  expect(diferencas.getByText(`Novo: ${novo ?? 'Não informado'}`)).toBeInTheDocument();
  expect(diferencas.getByText(/Valores financeiros não são base fiscal/)).toBeInTheDocument();
  expect(api.conferirGuruConferencia).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Conferir e aceitar nova revisão' }));
  await screen.findByText(/Conferência interna persistida/);
  expect(api.conferirGuruConferencia).toHaveBeenCalledWith('a', item.id, { versao: 3, hash: 'hash-alterado', confirmada: true });
  expect(api.emitirNfse).not.toHaveBeenCalled();
  expect(api.importarGuruConferencia).not.toHaveBeenCalled();
});
