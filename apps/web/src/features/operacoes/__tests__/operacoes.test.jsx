import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { OperationsPage } from '../OperationsPage';
import { CompanyAutomation } from '../CompanyAutomation';
import { projetarOperacoesEmpresas } from '../operacoes';
import { fluxoDaEmpresa } from '@contabilidade/shared/fluxo-carteira';

const company = { companyId: 'a', razao: 'Empresa exemplo', regimeTributario: 'SIMPLES', apuracao: { competencia: '2026-09', numeroDeclaracaoRfb: 'recibo-oficial' } };

test('aviso mensal de parcelamento entra em guias faltantes com o mesmo detalhe da carteira', () => {
  const itens = [{ id: 'parcela:1', estado: 'OBTER_GUIA', referencia: '2026-10' }];
  const c = { ...company, guideCompliance: { das: { required: false, state: 'na', ok: true },
    guiasParcelamentoMes: [{ tipoParcelamento: 'PARCSN', referencia: '2026-10', itens }] } };
  const r = projetarOperacoesEmpresas([c], '2026-09');
  expect(r.groups.faltantes).toHaveLength(1);
  expect(r.groups.faltantes[0]).toMatchObject({ titulo: 'PARCSN · documento ausente',
    tag: { mensal: true, referencia: '2026-10', itens } });
  expect(r.groups.revisoes).toHaveLength(0);
  expect(r.groups.envios).toHaveLength(0);
  expect(r.groups.pendencias).toEqual(r.groups.faltantes);
});

test('não exigibilidade conhecida não cria pendência; erro de leitura exige revisão', () => {
  const guideCompliance = { das: { required: false, state: 'na', ok: true }, guiasParcelamentoMes: [] };
  expect(projetarOperacoesEmpresas([{ ...company, guideCompliance }], '2026-09').groups.pendencias).toEqual([]);
  const indisponivel = projetarOperacoesEmpresas([{ ...company, guideCompliance: { ...guideCompliance, erro: true } }], '2026-09');
  expect(indisponivel.groups.revisoes).toHaveLength(1);
  expect(indisponivel.groups.revisoes[0].titulo).toBe('Guias · cobertura a conferir');
});
test('reutiliza o status da tabela Empresas, sem duplicar ou misturar competências', () => {
  const result = projetarOperacoesEmpresas([company, company, { ...company, companyId: 'inativa', status: 'INATIVA' }, { ...company, companyId: 'antiga', apuracao: { competencia: '2026-08' } }], '2026-09');
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0].fluxo).toEqual(fluxoDaEmpresa(company));
  expect(result.rows[0].fluxo.apuracao.rotulo).toBe('Apurado');
  expect(result.metrics[1]).toBe(0);
  expect(company.apuracao.estado).toBeUndefined();
});
test('quadros abrem detalhes locais e links preservam empresa e competência', () => {
  const onRefresh = jest.fn(), onChangeCompetencia = jest.fn();
  render(<OperationsPage companies={[company]} competencia="2026-09" onRefresh={onRefresh} onChangeCompetencia={onChangeCompetencia} />);
  fireEvent.click(screen.getByRole('button', { name: /Revisões pendentes/ }));
  fireEvent.click(screen.getByText('Ver detalhes'));
  expect(screen.getByText('Apurado')).toBeInTheDocument();
  expect(screen.getByText('Abrir Guias e corrigir')).toHaveAttribute('href', '/companies/a/guides?competencia=2026-09');
  fireEvent.keyDown(document, { key: 'Escape' });
  fireEvent.click(screen.getByText('Atualizar empresas'));
  expect(onRefresh).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByLabelText('Competência'), { target: { value: '2026-10' } });
  expect(onChangeCompetencia).toHaveBeenCalledWith('2026-10');
});
test('falha da carteira não fabrica zeros nem exibe dados antigos como atuais', () => {
  render(<OperationsPage companies={[company]} competencia="2026-09" error="Leitura indisponível" />);
  expect(screen.getAllByRole('alert').some(e=>e.textContent.includes('Leitura indisponível'))).toBe(true);
  expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(4);
  expect(screen.queryByText(company.razao)).not.toBeInTheDocument();
});
const failed = { ...company, guideCompliance: { das: { required: true, ok: true, state: 'falhou', guideId: 'g1', canalEnvio: 'WHATSAPP', envioStatus: 'falhou', envioErro: 'Destino inválido', envioPodeTentarDeNovo: true } } };
test('erro usa o mesmo estado das guias; abrir não envia e novo envio exige confirmação', async () => {
  const send = jest.fn().mockResolvedValue({ ok: false, message: 'Resultado incerto: confira o histórico' });
  render(<OperationsPage companies={[failed]} competencia="2026-09" acoesGuia={{onEnviarWhatsapp: send}} />);
  fireEvent.click(screen.getByRole('button', { name: /Erros de envio de guias/ }));
  fireEvent.click(screen.getByText('Ver detalhes'));
  expect(screen.getAllByText('Destino inválido')).toHaveLength(2);
  expect(screen.getByText('Apurado')).toBeInTheDocument();
  expect(send).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Conferir novo envio'));
  expect(send).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Confirmar envio'));
  expect(await screen.findByText('Resultado incerto: confira o histórico')).toBeInTheDocument();
  expect(send).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledWith('g1', failed);
  expect(screen.queryByText('Conferir novo envio')).not.toBeInTheDocument();
});
test('recusa de reenvio é respeitada e troca de competência fecha detalhes antigos', () => {
  const blocked = { ...failed, guideCompliance: { das: { ...failed.guideCompliance.das, envioPodeTentarDeNovo: false } } };
  const view = render(<OperationsPage companies={[blocked]} competencia="2026-09" acoesGuia={{onEnviarWhatsapp: jest.fn()}} />);
  fireEvent.click(screen.getByRole('button', { name: /Erros de envio de guias/ }));
  fireEvent.click(screen.getByText('Ver detalhes'));
  expect(screen.getByText('Conferir novo envio')).toBeDisabled();
  view.rerender(<OperationsPage companies={[]} competencia="2026-10" />);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('resultado tardio de envio não contamina o detalhe da competência seguinte', async () => {
  let concluir;
  const send = jest.fn(() => new Promise(resolve => { concluir = resolve; }));
  const view = render(<OperationsPage companies={[failed]} competencia="2026-09" acoesGuia={{onEnviarWhatsapp: send}} />);
  fireEvent.click(screen.getByRole('button', { name: /Erros de envio de guias/ }));
  fireEvent.click(screen.getByText('Ver detalhes'));
  fireEvent.click(screen.getByText('Conferir novo envio'));
  fireEvent.click(screen.getByText('Confirmar envio'));
  view.rerender(<OperationsPage companies={[{...failed, apuracao: {competencia:'2026-10'}}]} competencia="2026-10" acoesGuia={{onEnviarWhatsapp: send}} />);
  fireEvent.click(screen.getByRole('button', { name: /Erros de envio de guias/ }));
  fireEvent.click(screen.getByText('Ver detalhes'));
  await act(async () => concluir({ok:true, message:'Envio confirmado em setembro'}));
  expect(screen.queryByText('Envio confirmado em setembro')).not.toBeInTheDocument();
  expect(send).toHaveBeenCalledTimes(1);
});
test('envio concluído por outro canal não fica como erro nem documento faltante', () => {
  const delivered = { ...failed, guideCompliance: { das: { ...failed.guideCompliance.das, state: 'enviada', emailLastError: 'falha antiga' } } };
  const r = projetarOperacoesEmpresas([delivered], '2026-09');
  expect(r.groups.erros).toHaveLength(0);
  expect(r.groups.pendencias).toHaveLength(0);
  expect(r.groups.apuracoes).toHaveLength(0);
});
test('troca do documento depois da prévia impede enviar outra guia sem conferência', () => {
  const send = jest.fn();
  const view = render(<OperationsPage companies={[failed]} competencia="2026-09" acoesGuia={{onEnviarWhatsapp: send}} />);
  fireEvent.click(screen.getByRole('button', { name: /Erros de envio de guias/ }));
  fireEvent.click(screen.getByText('Ver detalhes'));
  fireEvent.click(screen.getByText('Conferir novo envio'));
  view.rerender(<OperationsPage companies={[{ ...failed, guideCompliance: { das: { ...failed.guideCompliance.das, guideId: 'outra-guia' } } }]} competencia="2026-09" acoesGuia={{onEnviarWhatsapp: send}} />);
  fireEvent.click(screen.getByText('Confirmar envio'));
  expect(send).not.toHaveBeenCalled();
  expect(screen.getByText(/A guia ou o resultado mudou/)).toBeInTheDocument();
});
test('ativação exige prévia e não salva na leitura; resposta perdida reutiliza a chave', async () => {
  Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: () => 'pedido-123' });
  const before = { revision: 'r1', rotinas: [{ key: 'das', label: 'DAS', enabled: false, agenda: null }] };
  const api = { getCompanyAutomation: jest.fn().mockResolvedValue(before), saveCompanyAutomation: jest.fn().mockRejectedValueOnce(new Error('Resposta perdida')).mockResolvedValue({ ...before, revision: 'r2', rotinas: [{ ...before.rotinas[0], enabled: true }] }) };
  render(<CompanyAutomation api={api} companyId="a" canEdit />);
  fireEvent.click(await screen.findByRole('checkbox', { name: /^DAS/ }));
  expect(api.saveCompanyAutomation).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Conferir alterações'));
  fireEvent.click(screen.getByText('Salvar configuração'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Resposta perdida');
  fireEvent.click(screen.getByText('Salvar configuração'));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Configuração salva'));
  expect(api.saveCompanyAutomation.mock.calls[0]).toEqual(api.saveCompanyAutomation.mock.calls[1]);
});

test('DAS disponível mantém a revisão fiscal na mesma projeção da carteira', () => {
 const c = {...company, apuracao:{competencia:'2026-09'}, guideCompliance:{competencia:'2026-09', das:{required:true, ok:true, state:'gerada', guideId:'das'}}};
 const result = projetarOperacoesEmpresas([c], '2026-09');
 expect(result.rows[0].fluxo).toEqual(fluxoDaEmpresa(c));
 expect(result.rows[0].fluxo.status.rotulo).toBe('Conferir apuração');
 expect(result.rows[0].fluxo.apuracao.transmitida).toBe(false);
 expect(result.groups.apuracoes).toHaveLength(1);
});
