import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { OperationsCalculationBatch } from '../OperationsCalculationBatch';
import { Fs12DeclaratoriaPanel } from '../../apuracao/components/Fs12DeclaratoriaPanel';

const competencia = '2026-11', contexto = 'a'.repeat(64);
const items = [{ companyId: 'p1', name: 'Empresa A' }, { companyId: 'p2', name: 'Empresa B' }];
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function confirmation(p = 'p1', c = competencia) {
  return { id: `r-${p}`, portalClientId: p, companyId: `company-${p}`, competencia: c, revisao: 1,
    serie: [{ mes: '2026-10', valorCentavos: 0 }], totalCentavos: 0, contextoRevisao: contexto,
    autorId: 'contador', confirmadoEm: '2026-11-25T12:00:00Z', origem: 'MANUAL_APURACAO' };
}
function response(p, c, saved = null) {
  return { ok: true, fs12: { portalClientId: p, competencia: c,
    politica: { empresaId: `company-${p}`, competenciaApuracao: c, situacao: 'EXIGIDA', janela: { competencias: ['2026-10'] } },
    qualidade: { totalCentavos: null }, autorizaEfeitoFiscal: false, integracao: { permiteNovoCalculo: false },
    contextoRevisao: contexto, confirmacao: saved, revisaoVigente: saved?.revisao || 0, historico: saved ? [saved] : [] } };
}
function apiFixture() {
  const saved = new Map();
  return {
    previewOperationsCalculation: jest.fn(async (p, c) => ({ companyId: p, competencia: c, regime: 'SIMPLES', revision: contexto,
      canCalculate: false, blockers: ['Integração fiscal ainda indisponível.'] })),
    getFs12Confirmacoes: jest.fn(async (p, c) => response(p, c, saved.get(`${p}:${c}`))),
    confirmarFs12Fechamento: jest.fn(async (p, c) => { const r = confirmation(p, c); saved.set(`${p}:${c}`, r); return { ok: true, confirmacao: r, autorizaEfeitoFiscal: false }; }),
    executeOperationsCalculation: jest.fn(),
  };
}
async function fillAndConfirm() {
  fireEvent.change(await screen.findByLabelText('Folha 10/2026'), { target: { value: '0' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar valores da folha' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Conferi os meses e valores desta apuração.' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar declaração manual' }));
}
beforeEach(() => Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: jest.fn(() => 'fixture-fs12-12345678') }));

test.each([{ selected: items.slice(0, 1) }, { selected: items }])('Operações prepara folha individual/lote, relê prévia e preserva bloqueio fiscal', async ({ selected }) => {
  const api = apiFixture(), onChanged = jest.fn(), onClose = jest.fn();
  render(<OperationsCalculationBatch api={api} items={selected} competencia={competencia} onChanged={onChanged} onClose={onClose} />);
  const open = await screen.findByRole('button', { name: 'Preparar folha de Empresa A' });
  await waitFor(() => expect(open).toBeEnabled()); fireEvent.click(open);
  expect(screen.getByRole('region', { name: 'Preparar folha em Operações' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Empresa A · 2026-11' })).toHaveFocus();
  await fillAndConfirm();
  await screen.findByText('Confirmada');
  await waitFor(() => expect(api.previewOperationsCalculation).toHaveBeenCalledTimes(selected.length + 1));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Voltar às empresas selecionadas' })).toBeEnabled());
  expect(api.executeOperationsCalculation).not.toHaveBeenCalled();
  expect(onChanged).not.toHaveBeenCalled(); // Resultado permanece montado até voltar.
  fireEvent.click(screen.getByRole('button', { name: 'Voltar às empresas selecionadas' }));
  expect(screen.getByRole('button', { name: 'Confirmar cálculo (0)' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Preparar folha de Empresa A' }));
  await screen.findByText('Confirmada');
  expect(screen.getByLabelText('Folha 10/2026')).toHaveValue('0,00');
  expect(api.confirmarFs12Fechamento).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Voltar às empresas selecionadas' }));
  fireEvent.click(screen.getByRole('button', { name: 'Voltar', exact: true }));
  expect(onChanged).toHaveBeenCalledTimes(1); expect(onClose).toHaveBeenCalledTimes(1);
});

test('gravação bloqueia saída; leitura da prévia falha sem reusar autorização anterior', async () => {
  const api = apiFixture(), pending = deferred();
  api.confirmarFs12Fechamento.mockReturnValue(pending.promise);
  render(<OperationsCalculationBatch api={api} items={items.slice(0, 1)} competencia={competencia} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Preparar folha de Empresa A' }));
  await fillAndConfirm();
  expect(screen.getByRole('button', { name: 'Voltar às empresas selecionadas' })).toBeDisabled();
  api.previewOperationsCalculation.mockRejectedValue(new Error('Leitura da prévia indisponível'));
  await act(async () => pending.resolve({ ok: true, confirmacao: confirmation(), autorizaEfeitoFiscal: false }));
  await screen.findByText('Leitura da prévia indisponível');
  expect(screen.getByText('Confirmada')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Voltar às empresas selecionadas' }));
  expect(screen.getByRole('button', { name: 'Confirmar cálculo (0)' })).toBeDisabled();
  expect(api.executeOperationsCalculation).not.toHaveBeenCalled();
});

test('callback somente após confirmação persistida válida e não novamente na recarga', async () => {
  const api = apiFixture(), onConfirmed = jest.fn();
  const view = render(<Fs12DeclaratoriaPanel api={api} portalClientId="p1" competencia={competencia} onConfirmed={onConfirmed} />);
  await fillAndConfirm(); await waitFor(() => expect(onConfirmed).toHaveBeenCalledWith(confirmation()));
  view.unmount();
  render(<Fs12DeclaratoriaPanel api={api} portalClientId="p1" competencia={competencia} onConfirmed={onConfirmed} />);
  await screen.findByText('Confirmada'); expect(onConfirmed).toHaveBeenCalledTimes(1);
});

test('confirmação inválida não chama callback', async () => {
  const api = apiFixture(), onConfirmed = jest.fn();
  api.confirmarFs12Fechamento.mockResolvedValue({ ok: true, confirmacao: confirmation('outra'), autorizaEfeitoFiscal: false });
  render(<Fs12DeclaratoriaPanel api={api} portalClientId="p1" competencia={competencia} onConfirmed={onConfirmed} />);
  await fillAndConfirm(); await screen.findByRole('alert');
  expect(onConfirmed).not.toHaveBeenCalled(); expect(screen.queryByText('Confirmada')).not.toBeInTheDocument();
});

test('resposta de gravação tardia de outra empresa não notifica nova preparação', async () => {
  const api = apiFixture(), pending = deferred(), onConfirmed = jest.fn();
  api.confirmarFs12Fechamento.mockReturnValue(pending.promise);
  const view = render(<Fs12DeclaratoriaPanel api={api} portalClientId="p1" competencia={competencia} onConfirmed={onConfirmed} />);
  await fillAndConfirm();
  view.rerender(<Fs12DeclaratoriaPanel api={api} portalClientId="p2" competencia="2026-12" onConfirmed={onConfirmed} />);
  await screen.findByText('Não informada');
  await act(async () => pending.resolve({ ok: true, confirmacao: confirmation(), autorizaEfeitoFiscal: false }));
  expect(onConfirmed).not.toHaveBeenCalled(); expect(screen.getByText('Não informada')).toBeInTheDocument();
});

test('troca da seleção/PA descarta leitura antiga da folha em Operações', async () => {
  const api = apiFixture(), pending = deferred(); api.getFs12Confirmacoes.mockReturnValueOnce(pending.promise);
  const view = render(<OperationsCalculationBatch api={api} items={items.slice(0, 1)} competencia={competencia} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Preparar folha de Empresa A' }));
  await screen.findByText('Consultando competências da folha…');
  view.rerender(<OperationsCalculationBatch api={api} items={items.slice(1)} competencia="2026-12" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Preparar folha de Empresa B' }));
  await screen.findByText('Não informada');
  await act(async () => pending.resolve(response('p1', competencia, confirmation())));
  expect(screen.getByRole('heading', { name: 'Empresa B · 2026-12' })).toBeInTheDocument();
  expect(screen.queryByText('Confirmada')).not.toBeInTheDocument();
  expect(api.confirmarFs12Fechamento).not.toHaveBeenCalled();
});
import { OperationsApproval } from '../OperationsApproval';
test.each([['PENDING',null],['INVALIDATED',null],['PENDING','revision'],['PENDING','identity'],['PENDING','audit']])('causal historical presentation %s preserves real error %s',async(status,invalid)=>{
 const pa='2026-12',commandId='transmission-command';
 const history={portalClientId:'a',competencia:pa,comandoId:commandId,calculoId:'exact-calculation',dasValor:0,somenteLeitura:true,autorizaEfeitoFiscal:false};
 const operation={companyId:'a',competencia:pa,revision:'r1',regime:'SIMPLES',status,pending:[],blocked:'Resposta causal preservada.',blockingForNewActionOnly:true,calculation:history,aptidaoFiscal:{fiscal:{estado:'CONFIRMADA',comandoId:commandId},capacidades:{transmitir:false},pendencias:['Documentos pendentes']}};
 const api={getOperationEvidence:jest.fn(async()=>({competencia:pa,total:1,items:[operation]})),getCompanyOperation:jest.fn(async()=>operation),getApuracaoSnapshot:jest.fn(async()=>({snapshot:{portalClientId:'a',competencia:pa,estado:'transmitida',idempotencyKey:history.calculoId,dasSimuladoSerpro:0,simulacaoSerpro:{_portalTransmissao:{comandoId:commandId}}}})),getAuditoriaNotas:jest.fn(async()=>({auditoria:{competencia:pa,totalAchados:0,perguntas:[]}})),getPgdasHistorico:jest.fn(async()=>({competencia:pa,versoes:[]})),saveCompanyOperation:jest.fn(),executeCompanyOperation:jest.fn()};
 if(invalid==='audit')api.getAuditoriaNotas.mockRejectedValue(Error('Auditoria indisponível'));
 if(['revision','identity'].includes(invalid)){
  const read=api.getApuracaoSnapshot.getMockImplementation();
  api.getApuracaoSnapshot.mockImplementation(async()=>{const result=await read(); if(invalid==='revision')result.snapshot.idempotencyKey='other';else result.snapshot.portalClientId='other';return result;});
 }
 render(<OperationsApproval api={api} rows={[{company:{companyId:'a',razao:'Histórico causal',myRole:'ACCOUNTANT'}}]} competencia={pa}/>);
 await waitFor(()=>expect(screen.getByRole('button',{name:'Conferir',exact:true})).toBeEnabled());
 fireEvent.click(screen.getByRole('button',{name:'Conferir',exact:true}));
 await screen.findByRole('dialog',{name:'Conferir Histórico causal'});
 if(!invalid)expect(screen.queryByText(/Revisão do cálculo não corresponde/)).not.toBeInTheDocument();
 else expect(screen.getAllByText(invalid==='revision'?/Revisão do cálculo não corresponde/:invalid==='identity'?/Identidade ou período incompatível/:/Auditoria indisponível/).length).toBeGreaterThan(0);
 expect(screen.getByRole('button',{name:'Confirmar apuração'})).toBeDisabled();
 expect(api.saveCompanyOperation).not.toHaveBeenCalled();expect(api.executeCompanyOperation).not.toHaveBeenCalled();
});