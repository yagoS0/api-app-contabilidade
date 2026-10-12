import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MensalConsumo } from '../MensalConsumo';
import { criarApuracaoConsumoMock } from '../../../api/mock/apuracaoConsumoMock';
import { valorParaCentavos, moedaCentavos } from '../leituraMensalConsumo';
const ctx = { tributo: 'CBS', ambiente: 'HOMOLOGACAO', competencia: '2026-10' };
const evidencia = { referencia: 'Documento teste', sha256: 'a'.repeat(64), descricao: 'Conferência documental' };
const adiar = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const dto = (patch = {}) => ({ ok: true, ...ctx, contextoHash: 'b'.repeat(64), versao: 0, estado: 'EM_CONFERENCIA', capacidades: { editar: true, conferirLocal: true }, podeConferir: false, estabelecimentos: [{ id: 'empresa', razao: 'Empresa teste' }], pendenciasCalculadas: [{ codigo: 'COBERTURA_INCOMPLETA', mensagem: 'Declare a cobertura de todo o mês.' }], dados: { valoresDeclarados: null, cobertura: null, pendencias: [], conferencia: null, guias: [], pagamentos: [], alocacoes: [] }, ...patch });
const apiTeste = (estado = dto()) => ({ getMensalConsumo: jest.fn(async (id, c) => ({ ...estado, ...c })), registrarAcaoMensalConsumo: jest.fn(), getHistoricoMensalConsumo: jest.fn(async (id, c) => ({ ok: true, ...c, historico: [], truncado: false })) });
const abrir = nome => { const d = screen.getAllByText(nome, { exact: true }).find(e => e.tagName === 'SUMMARY').closest('details'); d.open = true; fireEvent(d, new Event('toggle')); };
const preencher = (nome, value) => fireEvent.change(screen.getByLabelText(nome), { target: { value } });
const prova = p => { preencher(`Referência documental · ${p}`, evidencia.referencia); preencher(`SHA-256 do documento · ${p}`, evidencia.sha256); preencher(`Descrição da evidência · ${p}`, evidencia.descricao); };
async function tela(api) { const v = render(<MensalConsumo api={api} companyId="empresa" {...ctx} />); abrir('Conferência e pagamentos da competência'); await screen.findByText(/Versão 0/); return v; }
function pagamento() { abrir('Pagamentos e extinções declarados (0)'); preencher('Referência do pagamento', 'Documento P'); preencher('Valor do pagamento (R$)', '25,01'); preencher('Data do pagamento ou extinção', '2026-10-12'); prova('pagamento'); }

test.each([['1.234,56', '123456'], ['1234.56', '123456'], ['0', '0'], ['0,01', '1'], ['9999999999999999,99', '999999999999999999'], ['', null], ['1,234', null], ['1.23,45', null], ['1e4', null], ['-1', null], ['10000000000000000', null]])('centavos exatos para %s', (entrada, esperado) => expect(valorParaCentavos(entrada)).toBe(esperado));
test('formatação conserva centavos grandes e diferencia ausência de zero', () => { expect(moedaCentavos('999999999999999999')).toBe('R$ 9.999.999.999.999.999,99'); expect(moedaCentavos(null)).toBe('Não informado'); expect(moedaCentavos('0')).toBe('R$ 0,00'); });
test('leitura preguiçosa contextual sem atos oficiais nem valores fictícios', async () => {
  const api = apiTeste(); render(<MensalConsumo api={api} companyId="empresa" {...ctx} />); expect(api.getMensalConsumo).not.toHaveBeenCalled(); abrir('Conferência e pagamentos da competência'); await screen.findByText(/Versão 0/);
  expect(api.getMensalConsumo).toHaveBeenCalledWith('empresa', ctx); expect(screen.getByText(/Valores oficiais: não disponíveis/)).toBeInTheDocument(); expect(screen.queryByText('R$ 0,00')).not.toBeInTheDocument(); expect(api.registrarAcaoMensalConsumo).not.toHaveBeenCalled();
});
test('cobertura incompleta mantém conferência bloqueada mesmo preenchida', async () => {
  const api = apiTeste(); await tela(api); abrir('Conferência do escritório'); preencher('Motivo · conferência', 'Conferi'); prova('conferência'); fireEvent.click(screen.getByLabelText(/Conferi os documentos/)); expect(screen.getByRole('button', { name: 'Conferir localmente' })).toBeDisabled(); expect(api.registrarAcaoMensalConsumo).not.toHaveBeenCalled();
});
test('base preserva valores exatos e remove metadados de evidência reenviada', async () => {
  const anterior = dto(); anterior.dados.cobertura = { inicio: '2026-10-01', fim: '2026-10-31', estabelecimentoIds: ['empresa'], recursos: ['DEBITOS', 'CREDITOS'], evidencia: { ...evidencia, natureza: 'REFERENCIA_DECLARADA' } };
  const api = apiTeste(anterior); api.registrarAcaoMensalConsumo.mockResolvedValue(dto({ versao: 1 })); await tela(api); abrir('Base declarada e cobertura documental'); preencher('Débitos declarados (R$)', '1.234,56'); preencher('Créditos declarados (R$)', '0'); preencher('Tratamento declarado', 'REGULAR_PADRAO'); fireEvent.click(screen.getByRole('button', { name: 'Salvar base declarada' })); await screen.findByText(/Versão 1/);
  expect(api.registrarAcaoMensalConsumo.mock.calls[0][1]).toMatchObject({ ...ctx, versao: 0, contextoHash: 'b'.repeat(64), acao: 'REGISTRAR_BASE', dados: { valoresDeclarados: { debitosCentavos: '123456', creditosCentavos: '0' }, tratamento: { tipo: 'REGULAR_PADRAO', evidencia }, cobertura: { evidencia } } }); expect(api.registrarAcaoMensalConsumo.mock.calls[0][1].dados.cobertura.evidencia).toEqual(evidencia);
});
test('conferência válida segue local e não habilita emissão', async () => {
  const api = apiTeste(dto({ podeConferir: true, pendenciasCalculadas: [] })); api.registrarAcaoMensalConsumo.mockResolvedValue(dto({ versao: 1, estado: 'CONFERIDA_LOCAL' })); await tela(api); abrir('Conferência do escritório'); preencher('Motivo · conferência', 'Documentos conferidos'); prova('conferência'); fireEvent.click(screen.getByLabelText(/Conferi os documentos/)); fireEvent.click(screen.getByRole('button', { name: 'Conferir localmente' })); await screen.findByText(/Conferida pelo escritório/); expect(api.registrarAcaoMensalConsumo.mock.calls[0][1]).toMatchObject({ acao: 'CONFERIR_LOCAL', dados: { documentosConferidos: true, evidencia } }); expect(screen.queryByRole('button', { name: /emitir/i })).not.toBeInTheDocument();
});
test('timeout mantém UUID e rascunho; duplo clique não duplica', async () => {
  const api = apiTeste(), envio = adiar(); api.registrarAcaoMensalConsumo.mockReturnValueOnce(envio.promise).mockRejectedValue(new Error('Ainda incerto')); await tela(api); pagamento(); const b = screen.getByRole('button', { name: 'Registrar pagamento ou extinção' }); fireEvent.click(b); fireEvent.click(b); expect(api.registrarAcaoMensalConsumo).toHaveBeenCalledTimes(1); await act(async () => envio.reject(new Error('Timeout'))); await screen.findByText('Timeout'); fireEvent.click(b); await screen.findByText('Ainda incerto'); expect(api.registrarAcaoMensalConsumo.mock.calls[1]).toEqual(api.registrarAcaoMensalConsumo.mock.calls[0]); expect(screen.getByLabelText('Valor do pagamento (R$)')).toHaveValue('25,01');
});
test('troca tributo/empresa descarta gravação antiga e rascunho', async () => {
  const api = apiTeste(), antiga = adiar(); api.registrarAcaoMensalConsumo.mockReturnValue(antiga.promise); const v = await tela(api); pagamento(); fireEvent.click(screen.getByRole('button', { name: 'Registrar pagamento ou extinção' })); v.rerender(<MensalConsumo api={api} companyId="outra" {...ctx} tributo="IBS" />); abrir('Conferência e pagamentos da competência'); await screen.findByText(/IBS · 2026-10/); await act(async () => antiga.resolve(dto({ versao: 90 }))); expect(screen.queryByText(/Versão 90/)).not.toBeInTheDocument(); expect(screen.queryByText(/Registro local salvo/)).not.toBeInTheDocument();
});
test('refresh falho preserva última leitura e bloqueia gravação', async () => {
  const api = apiTeste(); await tela(api); api.getMensalConsumo.mockRejectedValueOnce(new Error('Sem acesso')); fireEvent.click(screen.getByRole('button', { name: 'Atualizar histórico mensal local' })); await screen.findByText('Sem acesso'); expect(screen.getByText(/Exibindo a última leitura/)).toBeInTheDocument(); abrir('Pagamentos e extinções declarados (0)'); expect(screen.getByLabelText('Referência do pagamento')).toBeDisabled();
});
test('alocação parcial respeita saldo disponível de ambos os documentos', async () => {
  const base = dto(); base.dados.guias = [{ id: 'g', referencia: 'Guia A', valorCentavos: '10000', saldoCentavos: '10000', alocadoCentavos: '0' }]; base.dados.pagamentos = [{ id: 'p', referencia: 'Pagamento A', valorCentavos: '5000', saldoCentavos: '5000', alocadoCentavos: '0' }]; const api = apiTeste(base); api.registrarAcaoMensalConsumo.mockResolvedValue({ ...base, versao: 1 }); await tela(api); abrir('Alocação local de pagamentos'); preencher('Guia a vincular', 'g'); preencher('Pagamento a vincular', 'p'); preencher('Valor a alocar (R$)', '50,01'); expect(screen.getByRole('button', { name: 'Registrar alocação local' })).toBeDisabled(); preencher('Valor a alocar (R$)', '25,01'); fireEvent.click(screen.getByRole('button', { name: 'Registrar alocação local' })); await screen.findByText(/Versão 1/); expect(api.registrarAcaoMensalConsumo.mock.calls[0][1]).toMatchObject({ ...ctx, acao: 'ALOCAR', dados: { guiaId: 'g', pagamentoId: 'p', valorCentavos: '2501' } });
});
test('histórico sob demanda e mock sem gravações', async () => {
  const api = apiTeste(); await tela(api); expect(api.getHistoricoMensalConsumo).not.toHaveBeenCalled(); abrir('Histórico auditável da competência'); await screen.findByText('Nenhuma revisão local registrada.'); expect(api.getHistoricoMensalConsumo).toHaveBeenCalledWith('empresa', ctx); await expect(criarApuracaoConsumoMock().registrarAcaoMensalConsumo()).rejects.toThrow('Nenhum registro foi salvo');
});

test.each([
  ['RESOLVER_PENDENCIA', 'Pendências (1 abertas)', null, 'pendência Documento ausente', 'Registrar resolução', { pendenciaId: 'pend', resolucao: 'Ajuste documentado', evidencia }],
  ['CANCELAR_GUIA', 'Guias registradas manualmente (1)', 'Cancelar registro da guia', 'cancelamento da guia Guia A', 'Cancelar registro da guia', { guiaId: 'g', motivo: 'Ajuste documentado', evidencia }],
  ['CANCELAR_PAGAMENTO', 'Pagamentos e extinções declarados (1)', 'Cancelar registro do pagamento', 'cancelamento do pagamento Pagamento A', 'Cancelar registro do pagamento', { pagamentoId: 'p', motivo: 'Ajuste documentado', evidencia }],
  ['ESTORNAR_ALOCACAO', 'Alocação local de pagamentos', 'Estornar alocação', 'estorno da alocação', 'Estornar alocação local', { alocacaoId: 'a', motivo: 'Ajuste documentado', evidencia }],
])('%s exige justificativa e evidência', async (acao, secao, detalhe, prefixo, botao, esperado) => {
  const base = dto(); base.dados.guias = [{ id: 'g', referencia: 'Guia A', valorCentavos: '10000', saldoCentavos: '10000', alocadoCentavos: '0' }]; base.dados.pagamentos = [{ id: 'p', referencia: 'Pagamento A', valorCentavos: '5000', saldoCentavos: '5000', alocadoCentavos: '0' }]; base.dados.alocacoes = [{ id: 'a', guiaId: 'g', pagamentoId: 'p', valorCentavos: '100' }]; base.dados.pendencias = [{ id: 'pend', descricao: 'Documento ausente', resolvida: false }];
  const api = apiTeste(base); api.registrarAcaoMensalConsumo.mockResolvedValue({ ...base, versao: 1 }); await tela(api); abrir(secao); if (detalhe) abrir(detalhe); expect(screen.getByRole('button', { name: botao })).toBeDisabled(); preencher(`${acao === 'RESOLVER_PENDENCIA' ? 'Resolução' : 'Motivo'} · ${prefixo}`, 'Ajuste documentado'); prova(prefixo); fireEvent.click(screen.getByRole('button', { name: botao })); await screen.findByText(/Versão 1/); expect(api.registrarAcaoMensalConsumo.mock.calls[0][1]).toMatchObject({ acao, dados: esperado });
});
test('guia declarada guarda vencimento, valor e referência documental', async () => {
  const api = apiTeste(); api.registrarAcaoMensalConsumo.mockResolvedValue(dto({ versao: 1 })); await tela(api); abrir('Guias registradas manualmente (0)'); preencher('Referência da guia', 'Guia externa'); preencher('Valor da guia (R$)', '123,45'); preencher('Vencimento da guia', '2026-10-30'); prova('guia'); fireEvent.click(screen.getByRole('button', { name: 'Registrar guia declarada' })); await screen.findByText(/Versão 1/); expect(api.registrarAcaoMensalConsumo.mock.calls[0][1]).toMatchObject({ acao: 'REGISTRAR_GUIA', dados: { referencia: 'Guia externa', valorCentavos: '12345', vencimento: '2026-10-30', evidencia } });
});
test('hash é calculado somente no navegador, sem envio e sem sobrescrever descrição editada', async () => {
  const api = apiTeste(), digest = adiar(); Object.defineProperty(crypto, 'subtle', { configurable: true, value: { digest: jest.fn(() => digest.promise) } }); await tela(api); abrir('Guias registradas manualmente (0)'); prova('guia');
  fireEvent.change(screen.getByLabelText('Calcular hash de arquivo local · guia'), { target: { files: [{ size: 3, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }] } });
  await screen.findByText('Calculando hash local…'); expect(screen.getByLabelText('SHA-256 do documento · guia')).toHaveValue(''); preencher('Descrição da evidência · guia', 'Edição preservada'); await act(async () => digest.resolve(new Uint8Array(32).fill(1).buffer)); expect(screen.getByLabelText('SHA-256 do documento · guia')).toHaveValue('01'.repeat(32)); expect(screen.getByLabelText('Descrição da evidência · guia')).toHaveValue('Edição preservada'); expect(api.registrarAcaoMensalConsumo).not.toHaveBeenCalled();
});


test('resposta de leitura atrasada não atravessa competência e erro não se torna mês vazio', async () => {
  const api = apiTeste(), antiga = adiar(); api.getMensalConsumo.mockReturnValueOnce(antiga.promise).mockRejectedValueOnce(new Error('Competência indisponível')); const v = render(<MensalConsumo api={api} companyId="empresa" {...ctx} />); abrir('Conferência e pagamentos da competência'); await waitFor(() => expect(api.getMensalConsumo).toHaveBeenCalledTimes(1)); v.rerender(<MensalConsumo api={api} companyId="empresa" {...ctx} competencia="2026-11" />); abrir('Conferência e pagamentos da competência'); await screen.findByText('Competência indisponível'); await act(async () => antiga.resolve(dto({ versao: 80 }))); expect(screen.queryByText(/Versão 80/)).not.toBeInTheDocument(); expect(screen.queryByText(/Versão 0/)).not.toBeInTheDocument();
});

test('novo hash de contexto na releitura descarta formulário anterior mesmo sem mudar versão mensal', async () => {
  const api = apiTeste(); await tela(api); abrir('Base declarada e cobertura documental'); preencher('Débitos declarados (R$)', '999,99');
  api.getMensalConsumo.mockResolvedValueOnce(dto({ contextoHash: 'c'.repeat(64) })); fireEvent.click(screen.getByRole('button', { name: 'Atualizar histórico mensal local' })); await waitFor(() => expect(api.getMensalConsumo).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.getByLabelText('Débitos declarados (R$)')).toHaveValue('')); expect(api.registrarAcaoMensalConsumo).not.toHaveBeenCalled();
});
