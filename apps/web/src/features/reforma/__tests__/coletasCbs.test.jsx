import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ColetasCbs } from '../ColetasCbs';
import { BaseApuracaoConsumo } from '../BaseApuracaoConsumo';
import { criarApuracaoConsumoMock } from '../../../api/mock/apuracaoConsumoMock';
const adiar = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const coleta = (patch = {}) => ({ id: 'coleta-a', recurso: 'DEBITOS', ambiente: 'HOMOLOGACAO', estado: 'PENDENTE', ticket: 'TESTE-LOCAL', createdAt: '2026-10-11T12:00:00Z', updatedAt: '2026-10-11T12:01:00Z', arquivos: [], tentativas: [], ...patch });
// Fixture habilitada somente neste teste. O mock do produto continua indisponível.
const criarApi = () => ({ getColetasCbs: jest.fn(async (id, { ambiente }) => ({ ok: true, ambiente, capacidades: { abrir: true, consultar: true, baixar: true }, bloqueios: [], coletas: [], limite: 100, truncada: false })), abrirColetaCbs: jest.fn(), consultarColetaCbs: jest.fn(), baixarArquivoColetaCbs: jest.fn() });
function abrir(nome = 'Coleta CBS · Homologação') { const d = screen.getByText(nome).closest('details'); d.open = true; fireEvent(d, new Event('toggle')); }
const tela = api => render(<ColetasCbs api={api} companyId="a" ambiente="HOMOLOGACAO" />);

test('abre somente leitura local por ambiente, sem competência ou chamadas automáticas', async () => {
  const api = criarApi(); tela(api); expect(api.getColetasCbs).not.toHaveBeenCalled(); abrir();
  await screen.findByText(/Nenhuma solicitação CBS registrada/);
  expect(api.getColetasCbs).toHaveBeenCalledWith('a', { ambiente: 'HOMOLOGACAO' });
  expect(screen.getByText(/podem incluir várias competências/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Atualizar acompanhamento local' }));
  await waitFor(() => expect(api.getColetasCbs).toHaveBeenCalledTimes(2));
  expect(api.abrirColetaCbs).not.toHaveBeenCalled(); expect(api.consultarColetaCbs).not.toHaveBeenCalled(); expect(api.baixarArquivoColetaCbs).not.toHaveBeenCalled();
});

test('produção bloqueada pelo servidor mantém motivos visíveis e ações desabilitadas', async () => {
  const api = criarApi(); api.getColetasCbs.mockResolvedValue({ ok: true, ambiente: 'PRODUCAO', capacidades: { abrir: false, consultar: false, baixar: false }, bloqueios: [{ codigo: 'CONTRATO', mensagem: 'Contrato ainda não homologado.' }], coletas: [coleta({ ambiente: 'PRODUCAO', estado: 'DISPONIVEL' })] });
  render(<ColetasCbs api={api} companyId="a" ambiente="PRODUCAO" />); abrir('Coleta CBS · Produção');
  await screen.findByText('Contrato ainda não homologado.');
  for (const nome of ['Solicitar coleta de débitos', 'Consultar situação na Receita', 'Armazenar arquivo retornado']) expect(screen.getByRole('button', { name: nome })).toBeDisabled();
});

test('todos os estados têm leitura distinta sem inventar saldo, ausência de movimento ou conferência', async () => {
  const api = criarApi(), estados = ['RESERVADA', 'INCERTA', 'PENDENTE', 'EM_PROCESSAMENTO', 'DISPONIVEL', 'ARQUIVADA', 'ERRO', 'EXPIRADA'];
  api.getColetasCbs.mockResolvedValue({ ok: true, ambiente: 'HOMOLOGACAO', capacidades: {}, bloqueios: [], coletas: estados.map((estado, i) => coleta({ id: String(i), estado, recurso: i % 2 ? 'CREDITOS' : 'DEBITOS', arquivoExpiraEm: '2026-10-13T12:00:00Z', arquivos: estado === 'ARQUIVADA' ? [{ id: 'arquivo', sha256: 'hash-de-teste', tamanhoBytes: 100, contentType: 'application/json', createdAt: '2026-10-11T13:00:00Z' }] : [] })) });
  tela(api); abrir(); await screen.findByRole('heading', { name: 'Débitos · Solicitação reservada' });
  for (const texto of ['Resultado incerto', 'Aguardando processamento', 'Em processamento', 'Arquivo disponível para coleta', 'Arquivo armazenado localmente', 'Falha na solicitação', 'Arquivo expirado']) expect(screen.getByRole('heading', { name: new RegExp(texto) })).toBeInTheDocument();
  expect(screen.getByText(/O armazenamento não equivale à conferência/)).toBeInTheDocument();
  expect(screen.getByText(/Este acompanhamento não informa saldo/)).toBeInTheDocument();
  expect(screen.queryByText('R$ 0,00')).not.toBeInTheDocument();
});

test('falha não vira lista vazia e resposta de ambiente anterior não atravessa navegação', async () => {
  const api = criarApi(), antigo = adiar(); api.getColetasCbs.mockReturnValueOnce(antigo.promise).mockRejectedValueOnce(new Error('Sem acesso à produção'));
  const { rerender } = tela(api); abrir(); await waitFor(() => expect(api.getColetasCbs).toHaveBeenCalledTimes(1));
  rerender(<ColetasCbs api={api} companyId="b" ambiente="PRODUCAO" />); abrir('Coleta CBS · Produção');
  await screen.findByText('Sem acesso à produção');
  await act(async () => antigo.resolve({ ok: true, ambiente: 'HOMOLOGACAO', coletas: [coleta()] }));
  expect(screen.queryByText('Tíquete: TESTE-LOCAL')).not.toBeInTheDocument();
  expect(screen.queryByText(/Nenhuma solicitação CBS registrada/)).not.toBeInTheDocument();
});

test('erro ao recarregar preserva última leitura mas bloqueia ações externas', async () => {
  const api = criarApi(); tela(api); abrir(); await screen.findByText(/Nenhuma solicitação CBS registrada/);
  api.getColetasCbs.mockRejectedValueOnce(new Error('Falha local'));
  fireEvent.click(screen.getByRole('button', { name: 'Atualizar acompanhamento local' }));
  await screen.findByText(/Falha local.*Exibindo a última leitura/);
  expect(screen.getByRole('button', { name: 'Solicitar coleta de débitos' })).toBeDisabled();
});

test('abertura manual usa apenas recurso/ambiente/UUID; duplo clique não duplica e timeout conserva intenção', async () => {
  const api = criarApi(), envio = adiar(); api.abrirColetaCbs.mockReturnValueOnce(envio.promise).mockRejectedValueOnce(new Error('Ainda incerto'));
  tela(api); abrir(); await screen.findByText(/Nenhuma solicitação CBS registrada/);
  fireEvent.change(screen.getByLabelText('Dados a solicitar'), { target: { value: 'CREDITOS' } });
  const botao = screen.getByRole('button', { name: 'Solicitar coleta de créditos' });
  fireEvent.click(botao); fireEvent.click(botao); expect(api.abrirColetaCbs).toHaveBeenCalledTimes(1);
  const args = api.abrirColetaCbs.mock.calls[0];
  expect(args[1]).toEqual({ ambiente: 'HOMOLOGACAO', recurso: 'CREDITOS', id: expect.any(String) });
  await act(async () => envio.reject(new Error('Timeout'))); await screen.findByText('Timeout');
  fireEvent.click(botao); await screen.findByText('Ainda incerto');
  expect(api.abrirColetaCbs.mock.calls[1]).toEqual(args);
});

test('situação e arquivo são atos separados, cada um seguido somente de leitura local', async () => {
  const api = criarApi(); let atual = coleta();
  api.getColetasCbs.mockImplementation(async () => ({ ok: true, ambiente: 'HOMOLOGACAO', capacidades: { abrir: true, consultar: true, baixar: true }, coletas: [atual] }));
  api.consultarColetaCbs.mockImplementation(async () => { atual = { ...atual, estado: 'DISPONIVEL' }; return { ok: true, coleta: atual }; });
  api.baixarArquivoColetaCbs.mockImplementation(async () => { atual = { ...atual, estado: 'ARQUIVADA', arquivos: [{ id: 'arquivo' }] }; return { ok: true, coleta: atual }; });
  tela(api); abrir(); await screen.findByText('Tíquete: TESTE-LOCAL');
  expect(screen.getByRole('button', { name: 'Armazenar arquivo retornado' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Consultar situação na Receita' }));
  await screen.findByRole('heading', { name: /Arquivo disponível para coleta/ });
  expect(api.baixarArquivoColetaCbs).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Armazenar arquivo retornado' }));
  await screen.findByRole('heading', { name: /Arquivo armazenado localmente/ });
  expect(api.consultarColetaCbs).toHaveBeenCalledWith('a', 'coleta-a', { id: expect.any(String), ambiente: 'HOMOLOGACAO' });
  expect(api.baixarArquivoColetaCbs).toHaveBeenCalledWith('a', 'coleta-a', { id: expect.any(String), ambiente: 'HOMOLOGACAO' });
  expect(api.getColetasCbs).toHaveBeenCalledTimes(3);
});

test('incerta sem tíquete impede nova abertura; arquivo expirado não oferece busca', async () => {
  const api = criarApi(); api.getColetasCbs.mockResolvedValue({ ok: true, ambiente: 'HOMOLOGACAO', capacidades: { abrir: true, consultar: true, baixar: true }, coletas: [coleta({ estado: 'INCERTA', ticket: null }), coleta({ id: 'expirada', estado: 'EXPIRADA' })] });
  tela(api); abrir(); await screen.findByText(/Há uma solicitação de débitos com resultado incerto e sem tíquete/);
  expect(screen.getByRole('button', { name: 'Solicitar coleta de débitos' })).toBeDisabled();
  const incerta = screen.getByRole('article', { name: 'Coleta Débitos coleta-a' });
  expect(within(incerta).getByRole('button', { name: 'Consultar situação na Receita' })).toBeDisabled();
  const expirada = screen.getByRole('article', { name: 'Coleta Débitos expirada' });
  expect(within(expirada).getByRole('button', { name: 'Armazenar arquivo retornado' })).toBeDisabled();
});

test('mock informa indisponibilidade e não fabrica solicitação', async () => {
  const api = criarApuracaoConsumoMock(); tela(api); abrir();
  await screen.findByText('Demonstração local: nenhuma consulta ou arquivo oficial.');
  expect(screen.getByRole('button', { name: 'Solicitar coleta de débitos' })).toBeDisabled();
  await expect(api.abrirColetaCbs()).rejects.toThrow('Nenhum registro foi salvo');
});

test('integração na preparação aparece apenas CBS e troca de competência não filtra a coleta', async () => {
  const api = criarApi(); api.getBaseApuracaoConsumo = jest.fn(async (id, ctx) => ({ ok: true, ...ctx, podeEditar: false, capacidades: {}, contribuinte: null }));
  render(<BaseApuracaoConsumo api={api} companyId="a" />); abrir('Preparação da apuração IBS/CBS'); abrir();
  await screen.findByText(/Nenhuma solicitação CBS registrada/);
  fireEvent.change(screen.getByLabelText('Competência da preparação'), { target: { value: '2027-02' } });
  expect(api.getColetasCbs).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByLabelText('Tributo'), { target: { value: 'IBS' } });
  expect(screen.queryByText('Coleta CBS · Homologação')).not.toBeInTheDocument();
});

test.each(['RESERVADA', 'INCERTA', 'PENDENTE', 'EM_PROCESSAMENTO', 'DISPONIVEL'])('bloqueia nova abertura de recurso em %s sem bloquear outro recurso', async estado => {
  const api = criarApi(); api.getColetasCbs.mockResolvedValue({ ok: true, ambiente: 'HOMOLOGACAO', capacidades: { abrir: true }, coletas: [coleta({ estado })] });
  tela(api); abrir(); await screen.findByText('Tíquete: TESTE-LOCAL');
  expect(screen.getByRole('button', { name: 'Solicitar coleta de débitos' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Dados a solicitar'), { target: { value: 'CREDITOS' } });
  expect(screen.getByRole('button', { name: 'Solicitar coleta de créditos' })).toBeEnabled();
});

test.each([{ estado: 'ARQUIVADA' }, { estado: 'ERRO' }, { estado: 'EXPIRADA' }, { estado: 'DISPONIVEL', operacaoEmCurso: true }])('bloqueia ações incompatíveis com %j', async patch => {
  const api = criarApi(); api.getColetasCbs.mockResolvedValue({ ok: true, ambiente: 'HOMOLOGACAO', capacidades: { consultar: true, baixar: true }, coletas: [coleta(patch)] });
  tela(api); abrir(); await screen.findByText('Tíquete: TESTE-LOCAL');
  expect(screen.getByRole('button', { name: 'Consultar situação na Receita' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Armazenar arquivo retornado' })).toBeDisabled();
});

test('confirmação sem refetch mantém UUID até leitura local recuperada', async () => {
  const api = criarApi(); api.abrirColetaCbs.mockResolvedValue({ ok: true, coleta: coleta() });
  tela(api); abrir(); await screen.findByText(/Nenhuma solicitação CBS registrada/);
  api.getColetasCbs.mockRejectedValueOnce(new Error('Leitura indisponível'));
  fireEvent.click(screen.getByRole('button', { name: 'Solicitar coleta de débitos' }));
  await screen.findByText(/Leitura indisponível/);
  expect(screen.getByRole('button', { name: 'Solicitar coleta de débitos' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Atualizar acompanhamento local' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Solicitar coleta de débitos' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Solicitar coleta de débitos' }));
  await waitFor(() => expect(api.abrirColetaCbs).toHaveBeenCalledTimes(2));
  expect(api.abrirColetaCbs.mock.calls[1]).toEqual(api.abrirColetaCbs.mock.calls[0]);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Solicitar coleta de débitos' })).toBeEnabled());
});

test('inspeção de arquivo arquivado é local e não inventa cobertura ou totais', async () => {
  const api = criarApi(); api.getColetasCbs.mockResolvedValue({ ok: true, ambiente: 'HOMOLOGACAO', capacidades: { reprocessar: true }, coletas: [coleta({ estado: 'ARQUIVADA', arquivos: [{ id: 'arquivo' }] })] });
  api.reprocessarArquivoColetaCbs = jest.fn(async () => ({ ok: true, inspecao: { quantidadeItens: 3, valoresInvalidos: 1, periodos: [{ competencia: '2026-09', quantidade: 3 }], sha256: 'a'.repeat(64), versaoParser: 1, cobertura: 'NAO_VALIDADA', totaisOficiais: null } }));
  tela(api); abrir(); fireEvent.click(await screen.findByRole('button', { name: 'Inspecionar arquivo local' })); await screen.findByText(/3 itens identificados · 1 valores inválidos/);
  expect(api.reprocessarArquivoColetaCbs).toHaveBeenCalledWith('a', 'coleta-a', { ambiente: 'HOMOLOGACAO' }); expect(api.consultarColetaCbs).not.toHaveBeenCalled(); expect(api.baixarArquivoColetaCbs).not.toHaveBeenCalled(); expect(screen.getByText(/não comprova cobertura ou total oficial/)).toBeInTheDocument();
});
