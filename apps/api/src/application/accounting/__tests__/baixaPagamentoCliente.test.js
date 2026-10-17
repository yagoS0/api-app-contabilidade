jest.mock('../InssPagamentoService.js', () => ({ gerarPagamentoInssFromGuideTx: jest.fn() }));
jest.mock('../parcelamento/ParcelamentoV2Service.js', () => ({ gerarPagamentoParcelaFromGuideTx: jest.fn() }));
jest.mock('../AccountingEntryGeneratorService.js', () => ({ lookupAccountsFromHistorico: jest.fn(async () => ({ debitAccountCode: 'passivo', creditAccountCode: 'banco' })), resolveRule: jest.fn(async () => null) }));
jest.mock('../GuideToProvisionService.js', () => ({ CODIGO_RECEITA_TO_EVENT: { '8109': 'DARF_PIS', '2172': 'DARF_COFINS' } }));
jest.mock('../BaixaProvisaoService.js', () => ({ executarBaixaProvisaoTx: jest.fn(async (_tx, args) => ({ entryIds: [`baixa-${args.entryId}`] })) }));
import { executarBaixaClienteTx, composicaoConfirmada } from '../BaixaPagamentoClienteService.js';
import { executarBaixaProvisaoTx } from '../BaixaProvisaoService.js';
import { lookupAccountsFromHistorico } from '../AccountingEntryGeneratorService.js';
import { gerarPagamentoInssFromGuideTx } from '../InssPagamentoService.js';
import { gerarPagamentoParcelaFromGuideTx } from '../parcelamento/ParcelamentoV2Service.js';

const lote = () => [{ id:'b',tipoLinha:'PRINCIPAL',lines:[{conta:'passivo',tipo:'D',valor:100},{conta:'banco',tipo:'C',valor:100}] },{ id:'j',tipoLinha:'JUROS',lines:[{conta:'501',tipo:'D',valor:10},{conta:'banco',tipo:'C',valor:10}] },{ id:'m',tipoLinha:'MULTA',lines:[{conta:'506',tipo:'D',valor:5},{conta:'banco',tipo:'C',valor:5}] }];
const parcela = { principal: 100, juros: 10, multa: 5, total: 115 };
const provisao = (id, valor, eventType = 'DAS_SIMPLES') => ({ id, portalClientId: 'c', eventType, tipo: 'PROVISAO', competencia: '2026-08',
  lines: [{ tipo: 'D', conta: 'despesa', valor }, { tipo: 'C', conta: 'passivo', valor }], baixas: [] });
function fixture() {
  const guide = { id: 'g', portalClientId: 'c', tipo: 'SIMPLES', competencia: '2026-08', paymentStatus: 'PAID', valor: 115,
    extracted: { composicao: [{ ...parcela }] } };
  const tx = { appSetting: { findUnique: jest.fn(async () => null) }, companyMonthlyCircular: { findUnique: jest.fn(async () => null) },
    accountingEntry: { findMany: jest.fn(async ({ where }) => where.tipo === 'PROVISAO' ? [provisao('p', 100)] : []) },
    chartOfAccount: { findMany: jest.fn(async ({ where }) => where.codigo.in.map(codigo => ({ codigo, analitica: true, portalClientId: 'c' }))) },
    guide: { updateMany: jest.fn(async () => ({ count: 1 })) } };
  const args = { guide, confirmacao: { companyId: 'c', pagoEm: '2026-09-20T00:00:00.000Z' }, userId: 'u' };
  return { guide, tx, args, run: () => executarBaixaClienteTx(tx, args) };
}
beforeEach(() => jest.clearAllMocks());

test('DAS vincula baixa real à guia e separa principal, juros e multa', async () => {
  const f = fixture(), r = await f.run();
  expect(r).toMatchObject({ entryIds: ['baixa-p'], principal: 100, juros: 10, multa: 5, total: 115 });
  expect(executarBaixaProvisaoTx).toHaveBeenCalledWith(f.tx, expect.objectContaining({ sourceGuideId: 'g', portalClientId: 'c',
    dataPagamento: new Date('2026-09-20'), lines: expect.arrayContaining([
      expect.objectContaining({ tipo: 'D', papel: 'PRINCIPAL', valor: 100 }),
      expect.objectContaining({ tipo: 'D', papel: 'JUROS', valor: 10 }),
      expect.objectContaining({ tipo: 'D', papel: 'MULTA', valor: 5 }),
      expect.objectContaining({ tipo: 'C', conta: 'banco', valor: 115 }),
    ]) }));
});

test('DARF consolidado baixa cada provisão pelo seu tributo sem duplicar total', async () => {
  const f = fixture(); f.guide.tipo = 'OUTRA'; f.guide.valor = 345;
  f.guide.extracted.composicao = [{ ...parcela, codigo: '8109' }, { codigo: '2172', principal: 200, juros: 20, multa: 10, total: 230 }];
  f.tx.accountingEntry.findMany.mockImplementation(async ({ where }) => where.tipo === 'PROVISAO'
    ? [provisao('pis', 100, 'DARF_PIS'), provisao('cofins', 200, 'DARF_COFINS')] : []);
  expect((await f.run()).entryIds).toEqual(['baixa-pis', 'baixa-cofins']);
  expect(executarBaixaProvisaoTx.mock.calls.map(c => c[1].lines.find(l => l.tipo === 'C').valor)).toEqual([115, 230]);
});

test.each(['semComposicao', 'mesFechado', 'semProvisao', 'contaSintetica', 'saldoParcial'])('não fabrica baixa quando %s', async caso => {
  const f = fixture();
  if (caso === 'semComposicao') delete f.guide.extracted.composicao[0].juros;
  if (caso === 'mesFechado') f.tx.companyMonthlyCircular.findUnique.mockResolvedValue({ fechadoContabilEm: new Date() });
  if (caso === 'semProvisao') f.tx.accountingEntry.findMany.mockResolvedValue([]);
  if (caso === 'contaSintetica') f.tx.chartOfAccount.findMany.mockResolvedValue([{ codigo: 'passivo', analitica: false }]);
  if (caso === 'saldoParcial') f.tx.accountingEntry.findMany.mockImplementation(async ({ where }) => where.tipo === 'PROVISAO' ? [provisao('p', 80)] : []);
  await expect(f.run()).rejects.toThrow(); expect(executarBaixaProvisaoTx).not.toHaveBeenCalled(); expect(f.tx.guide.updateMany).not.toHaveBeenCalled();
});

test('conta ausente não é substituída por caixa presumido', async () => {
  const f = fixture(); lookupAccountsFromHistorico.mockResolvedValueOnce({});
  await expect(f.run()).rejects.toMatchObject({ pendencia: 'CONTAS_AUSENTES' });
});

test.each(['INSS', 'PARCELA'])('%s usa adaptador transacional e mantém encargos', async tipo => {
  const f = fixture(); if (tipo === 'INSS') f.guide.tipo = 'INSS'; else f.guide.parcelamentoId = 'parcelamento';
  const adapter = tipo === 'INSS' ? gerarPagamentoInssFromGuideTx : gerarPagamentoParcelaFromGuideTx;
  adapter.mockResolvedValue({ ok: true });
  let gerada = false; adapter.mockImplementation(async () => { gerada = true; return { ok: true }; });
  f.tx.accountingEntry.findMany.mockImplementation(async ({ where }) => where.tipo === 'BAIXA' && gerada ? lote() : []);
  expect((await f.run()).entryIds).toEqual(['b','j','m']); expect(adapter).toHaveBeenCalledWith(f.tx, expect.objectContaining({ guideId: 'g', portalClientId: 'c' }));
});

test('composição alternativa fields é validada e ausência não vira zero', () => {
  expect(composicaoConfirmada({ valor: 115, extracted: { fields: { composicao: [{ ...parcela }] } } })).toMatchObject({ principal: 10000, total: 11500 });
  expect(() => composicaoConfirmada({ valor: 100, extracted: { fields: { principal: 100, total: 100 } } })).toThrow();
});

// Adaptadores de escrita simulados; serviço R26 real exercitado na transação compartilhada.
test.each(['INSS','PARCELA'])('%s invalida conferência parcial e audita antes/depois atomicamente',async tipo=>{
 const f=fixture();if(tipo==='INSS')f.guide.tipo='INSS';else f.guide.parcelamentoId='parcelamento';
 const { CHECKLIST_FECHAMENTO }=await import('../fechamentoBlockers.js');
 const campos=Object.values(CHECKLIST_FECHAMENTO).map(c=>c.campo);
 let state={entries:[],circular:Object.fromEntries(campos.map(c=>[c,true])),rows:{'contabil:correcao:v1:c:2026-09':{revision:1,active:{id:'correcao'},history:[]}}};
 f.tx.companyMonthlyCircular.findUnique.mockImplementation(async()=>({...state.circular}));
 f.tx.companyMonthlyCircular.updateMany=jest.fn(async({data})=>{Object.assign(state.circular,data);return{count:1};});
 f.tx.accountingEntry.findMany.mockImplementation(async()=>structuredClone(state.entries));
 f.tx.appSetting={findUnique:jest.fn(async({where})=>state.rows[where.key]?{value:structuredClone(state.rows[where.key])}:null),
  updateMany:jest.fn(async({where,data})=>{state.rows[where.key]=structuredClone(data.value);return{count:1};}),
  create:jest.fn(async({data})=>{state.rows[data.key]=structuredClone(data.value);})};
 const adapter=tipo==='INSS'?gerarPagamentoInssFromGuideTx:gerarPagamentoParcelaFromGuideTx;
 adapter.mockImplementation(async tx=>{expect(tx).toBe(f.tx);state.entries.push(...lote());return{ok:true};});
 const transaction=async()=>{const before=structuredClone(state);try{return await f.run();}catch(e){state=before;throw e;}};
 const original=structuredClone(state);
 f.tx.appSetting.create.mockRejectedValueOnce(Error('audit indisponivel'));
 await expect(transaction()).rejects.toThrow('audit indisponivel');expect(state).toEqual(original);
 await transaction();expect(campos.every(c=>state.circular[c]===false)).toBe(true);
 expect(state.rows['contabil:correcao:v1:c:2026-09'].revision).toBe(2);
 const eventos=Object.values(state.rows).filter(r=>r.tipo==='CORRECAO_ALTERACAO');expect(eventos).toHaveLength(1);
 expect(eventos[0]).toMatchObject({autor:{id:'u',origem:'CLIENTE'},antes:{entries:[]},depois:{entries:expect.arrayContaining(lote().map(e=>({...e,lines:expect.arrayContaining(e.lines)})))}});
});

test('R25 envia origem CLIENTE e distingue contador executor do cliente declarante no DAS',async()=>{const f=fixture();f.args.userId='contador';f.args.confirmacao={...f.args.confirmacao,id:'cf',canal:'WHATSAPP',autor:{contatoId:'contato'}};await f.run();expect(executarBaixaProvisaoTx).toHaveBeenCalledWith(f.tx,expect.objectContaining({origem:'CLIENTE',autorAuditoria:{id:'contador',contatoId:'contato',confirmadoPor:{contatoId:'contato'},confirmacaoId:'cf',canal:'WHATSAPP',origem:'CLIENTE'}}));});
