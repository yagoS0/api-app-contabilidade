jest.mock('../../../infrastructure/db/prisma.js',()=>({prisma:{}}));
jest.mock('../../guides/guideCompliance.js',()=>({computeGuideComplianceMap:jest.fn(async()=>new Map([['a',{das:{required:true,state:'gerada'}}]]))}));
import { reconciliarObrigacoesCarteira, contextosCarteira } from '../FluxoCarteiraService.js';
import { normalizarEntrada } from '../../obrigacoes/ObrigacoesService.js';
import { MODELOS_OBRIGACOES_CARTEIRA } from '../../../../../../packages/shared/src/accounting/fluxoCarteira.js';
import { estadoCorrecaoTx, hashLancamentosConferidos } from '../../accounting/CorrecaoMesContabilService.js';
import { CHECKLIST_FECHAMENTO, checklistDosLancamentos, projetarChecklistFechamento } from '../../accounting/fechamentoBlockers.js';

const findMany=value=>({findMany:jest.fn(async()=>value)});
function banco({fechado=true}={}){
  return {
    appSetting: findMany([]),
    portalClient:findMany([{id:'a',companyId:'legado',razao:'Alfa'}]),company:findMany([{id:'legado',regimeTributario:'SIMPLES'}]),
    carteiraTarefa:findMany([]),apuracaoSnapshot:findMany([{portalClientId:'a',estado:'calculada'}]),
    companyMonthlyCircular:findMany(fechado?[{portalClientId:'a',fechadoContabilEm:'2026-10-06'}]:[]),
    accountingEntry:findMany([{id:'e',portalClientId:'a',status:'EXPORTADO',lines:[]}]),portalInvoice:findMany([]),
    ocorrenciaObrigacao:{...findMany([]),updateMany:jest.fn(async()=>({count:1}))},
  };
}
const oc=(chave,status='PENDENTE')=>({id:chave,competenciaRef:'2026-09',status,updatedAt:'versao',obrigacao:{portalClientId:'a',verificador:'CARTEIRA_'+chave.toUpperCase()}});

test('modelos usam a validação nativa de obrigações e separam regimes sem prazos pré-gravados',()=>{
  for(const modelo of MODELOS_OBRIGACOES_CARTEIRA){
    expect(modelo.diaVencimento).toBeUndefined();
    expect(normalizarEntrada({nome:modelo.titulo,verificador:modelo.verificador,periodicidade:'MENSAL',diaVencimento:20}).verificador).toBe(modelo.verificador);
  }
  expect(MODELOS_OBRIGACOES_CARTEIRA.filter(m=>m.verificador==='CARTEIRA_APURAR').map(m=>m.filtros.regimes)).toEqual([['SIMPLES'],['LUCRO_PRESUMIDO']]);
});

test('fechamento conclui obrigação por empresa, exportação não confirma importação no ERP',async()=>{
  const db=banco();
  expect(await reconciliarObrigacoesCarteira([oc('contabilizar'),oc('importar')],db)).toBe(1);
  expect(db.ocorrenciaObrigacao.updateMany).toHaveBeenCalledTimes(1);
  expect(db.ocorrenciaObrigacao.updateMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({id:'contabilizar',updatedAt:'versao'}),data:expect.objectContaining({status:'CONCLUIDA',fonteConclusao:'AUTOMATICA'})}));
  expect(db.ocorrenciaObrigacao.findMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({obrigacao:expect.objectContaining({OR:expect.any(Array)})})}));
});

test('reabrir mês invalida conclusão automática da obrigação sem marcar importação',async()=>{
  const db=banco({fechado:false});
  await reconciliarObrigacoesCarteira([oc('contabilizar','CONCLUIDA')],db);
  expect(db.ocorrenciaObrigacao.updateMany).toHaveBeenCalledWith(expect.objectContaining({data:{status:'PENDENTE',concluidaEm:null,fonteConclusao:null}}));
});

test('mede consultas da reconciliação para treze competências versus uma competência visível',async()=>{
 const ciclos=Array.from({length:13},(_,i)=>({...oc('importar'),competenciaRef:new Date(Date.UTC(2026,i,1)).toISOString().slice(0,7)}));
 const todos=banco(), periodo=banco();
 await reconciliarObrigacoesCarteira(ciclos,todos);
 await reconciliarObrigacoesCarteira(ciclos.slice(0,1),periodo);
 const leituras=db=>Object.values(db).reduce((n,t)=>n+(t.findMany?.mock.calls.length || 0),0);
 expect(leituras(todos)).toBe(93);
 expect(leituras(periodo)).toBe(9);
});

test.each(['manual', 'automatico', 'correcao', 'conferida', 'antiga'])('carteira reutiliza contrato do fechamento: %s', async modo => {
  const db = banco({ fechado: false });
  const circular = { id: 'circ', portalClientId: 'a', ...Object.fromEntries(Object.values(CHECKLIST_FECHAMENTO).map(c => [c.campo, modo !== 'automatico'])) };
  const entries = [
    { id: 'e', portalClientId: 'a', competencia: '2026-09', tipo: 'RECEITA', lines: [
      { id: 'd', ordem: 1, conta: '100', tipo: 'D', valor: 10 }, { id: 'c', ordem: 2, conta: '200', tipo: 'C', valor: 10 },
    ] },
    { id: 'rastreio', portalClientId: 'a', competencia: '2026-09', tipo: 'PARCELA', lines: [] },
  ];
  const active = ['correcao', 'conferida', 'antiga'].includes(modo) ? { id: 'corr', conferencia: {
    hashLancamentos: modo === 'conferida' ? hashLancamentosConferidos('a', '2026-09', { entries }) : 'antigo',
    itens: Object.fromEntries(Object.keys(CHECKLIST_FECHAMENTO).map(k => [k, true])),
  } } : null;
  const value = { revision: 3, active, history: [] };
  db.appSetting.findMany.mockResolvedValue([{ key: 'contabil:correcao:v1:a:2026-09', value }]);
  db.companyMonthlyCircular.findMany.mockResolvedValue([circular]);
  db.accountingEntry.findMany.mockResolvedValue(entries);
  const estado = await estadoCorrecaoTx({
    companyMonthlyCircular: { findUnique: async () => circular },
    accountingEntry: { findMany: async () => entries },
    appSetting: { findUnique: async () => ({ value }) },
  }, 'a', '2026-09');
  const mapa = await contextosCarteira([{ companyId: 'a' }, { companyId: 'b' }], '2026-09', db);
  expect(mapa.get('a').fluxo.contabilizacao).toMatchObject({
    ...projetarChecklistFechamento(circular, checklistDosLancamentos(entries), estado), versao: estado.versao,
    chave: 'aberto', total: 1, importados: 0,
  });
  expect(mapa.get('b').fluxo.contabilizacao.checklist.receitas).toBe(false);
  expect(db.appSetting.findMany).toHaveBeenCalledTimes(1);
  expect(db.appSetting.findMany.mock.calls[0][0].where.key.in).toEqual(['contabil:correcao:v1:a:2026-09', 'contabil:correcao:v1:b:2026-09']);
  expect(db.accountingEntry.findMany).toHaveBeenCalledTimes(1);
  expect(db.accountingEntry.findMany.mock.calls[0][0].where).toEqual({ portalClientId: { in: ['a', 'b'] }, competencia: '2026-09' });
  if (modo === 'conferida') {
    entries[1].historico = 'Rastreio alterado após conferência';
    const atualizado = (await contextosCarteira([{ companyId: 'a' }], '2026-09', db)).get('a').fluxo.contabilizacao;
    expect(atualizado.versao).not.toBe(estado.versao);
    expect(atualizado.conferenciaDesatualizada).toBe(true);
    expect(atualizado.checklistPendentes).toHaveLength(5);
    expect(atualizado.checklistAutomatico).toEqual({});
    expect(atualizado.total).toBe(1);
  }
});

test('falha de leitura da correção não retorna checklist concluído', async () => {
  const db = banco();
  db.appSetting.findMany.mockRejectedValue(new Error('indisponivel'));
  await expect(contextosCarteira([{ companyId: 'a' }], '2026-09', db)).rejects.toThrow('indisponivel');
});


test('leitura local carrega prova por empresa e competência, mantendo snapshot e fechamento', async () => {
  const db = banco({ fechado: false });
  db.apuracaoSnapshot.findMany.mockResolvedValue([{ portalClientId: 'a', estado: 'aberta' }]);
  db.companyMonthlyCircular.findMany.mockResolvedValue([{ portalClientId: 'a', pgdasNumeroDeclaracao: '123', fechadoContabilEm: null }]);
  const companies = ['a', 'b'].map(companyId => ({ companyId, legacyCompany: { regimeTributario: 'SIMPLES' } }));
  const mapa = await contextosCarteira(companies, '2026-09', db);
  expect(mapa.get('a').fluxo.apuracao.rotulo).toBe('Apurado');
  expect(mapa.get('a').company.apuracao.estado).toBe('aberta');
  expect(mapa.get('a').fluxo.contabilizacao.chave).toBe('aberto');
  expect(mapa.get('b').fluxo.apuracao.apurada).toBe(false);
  expect(db.companyMonthlyCircular.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { portalClientId: { in: ['a', 'b'] }, competencia: '2026-09' } }));
  expect(db.ocorrenciaObrigacao.updateMany).not.toHaveBeenCalled();
});

test('nova leitura do número interno preserva hashes das confirmações existentes', async () => {
 const db = banco();
 const companies = [{ companyId: 'a', legacyCompany: { regimeTributario: 'SIMPLES' } }];
 const antes = await contextosCarteira(companies, '2026-09', db);
 db.apuracaoSnapshot.findMany.mockResolvedValue([{ portalClientId: 'a', estado: 'calculada', numeroDeclaracao: null }]);
 const depois = await contextosCarteira(companies, '2026-09', db);
 expect(depois.get('a').contexto.hashes).toEqual(antes.get('a').contexto.hashes);
});
