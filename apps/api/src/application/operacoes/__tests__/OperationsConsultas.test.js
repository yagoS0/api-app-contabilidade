import { listarErrosConsultas } from '../OperationsConsultas.js';
import { randomUUID } from 'node:crypto';
import { PrismaClient, Prisma } from '@prisma/client';

it.each(['recusada_cooldown', 'recusada_teto', 'incerta', 'reservada'])('preserva erro após %s e só sucesso posterior resolve', async status => {
  const erro = { id: 'erro', assinatura: 's', portalClientId: 'a', status: 'erro' };
  const attempt = { ...erro, id: 'tentativa', status };
  const db = { serproChamada: { findMany: jest.fn().mockResolvedValue([attempt, erro]) } };
  const pending = await listarErrosConsultas(db, ['a'], '2026-10');
  expect(pending.items).toEqual([expect.objectContaining({ id: 'erro', tentativaPosterior: expect.objectContaining({ id: 'tentativa', status }) })]);
  expect(pending.tentativasPendentes).toHaveLength(1);
  db.serproChamada.findMany.mockResolvedValue([{ ...erro, id: 'sucesso', status: 'ok' }, attempt, erro]);
  expect(await listarErrosConsultas(db, ['a'], '2026-10')).toMatchObject({ items: [], total: 0, tentativasPendentes: [] });
});

const localUrl = process.env.ALTAN_GOVERNANCE_TEST_DATABASE_URL || process.env.ALTAN_P0_DATABASE_URL;
(localUrl ? test : test.skip)('PostgreSQL: erro → recusa → sucesso seleciona resultado efetivo com isolamento', async () => {
  const target = new URL(localUrl);
  if (!['postgres:', 'postgresql:'].includes(target.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)
      || !target.pathname.endsWith('_governance_test') || target.searchParams.has('host')) {
    throw Error('Somente PostgreSQL loopback descartável _governance_test.');
  }
  const db = new PrismaClient({ datasources: { db: { url: localUrl } } });
  const prefix = `consultas-${randomUUID()}`;
  const ids = ['erro', 'recusa', 'sucesso', 'outra', 'mes', 'emissao'].map(s => `${prefix}-${s}`);
  const base = { cnpj: '', portalClientId: prefix, assinatura: prefix, competencia: '2026-10', rota: '/Consultar', idServico: 'TESTE_LOCAL' };
  try {
    await db.serproChamada.createMany({ data: [
      { ...base, id: ids[0], status: 'erro', createdAt: new Date('2026-10-01T10:00:00Z') },
      { ...base, id: ids[3], status: 'erro', portalClientId: `${prefix}-outra` },
      { ...base, id: ids[4], status: 'erro', competencia: '2026-09' },
      { ...base, id: ids[5], status: 'erro', rota: '/Emitir' },
    ] });
    expect((await listarErrosConsultas(db, [prefix], '2026-10')).items.map(i => i.id)).toEqual([ids[0]]);
    await db.serproChamada.create({ data: { ...base, id: ids[1], status: 'recusada_cooldown', createdAt: new Date('2026-10-01T10:01:00Z') } });
    const pending = await listarErrosConsultas(db, [prefix], '2026-10');
    expect(pending.total).toBe(1);
    expect(pending.items[0]).toMatchObject({ id: ids[0], tentativaPosterior: { id: ids[1], situacao: 'bloqueada' } });
    await db.serproChamada.create({ data: { ...base, id: ids[2], status: 'ok', createdAt: new Date('2026-10-01T10:02:00Z') } });
    expect(await listarErrosConsultas(db, [prefix], '2026-10')).toMatchObject({ items: [], total: 0, tentativasPendentes: [] });
  } finally {
    try { await db.serproChamada.deleteMany({ where: { id: { in: ids } } }); }
    finally { await db.$disconnect(); }
  }
}, 30000);
it('consulta somente a carteira e competência, exclui envio/emissão e retorna o mesmo conjunto contado', async () => {
  const db = { serproChamada: { findMany: jest.fn(async () => [
    { id: 'erro', portalClientId: 'a', competencia: '2026-10', status: 'erro', idServico: 'CONS', erroMensagem: 'Recusa' },
    { id: 'ok', portalClientId: 'b', status: 'ok' }, { id: 'bloqueio', portalClientId: 'c', status: 'recusada_cooldown' },
  ]) } };
  const r = await listarErrosConsultas(db, ['a', 'b', 'c'], '2026-10');
  expect(db.serproChamada.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { portalClientId: { in: ['a', 'b', 'c'] }, competencia: '2026-10', rota: '/Consultar' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }));
  expect(r.total).toBe(r.items.length); expect(r.items).toEqual([expect.objectContaining({ id: 'erro', companyId: 'a', errorMessage: 'Recusa' })]);
});
it('recusa mês inválido antes de consultar e não transforma erro em zero', async () => {
  const db = { serproChamada: { findMany: jest.fn().mockRejectedValue(Error('offline')) } };
  await expect(listarErrosConsultas(db, ['a'], '2026-13')).rejects.toMatchObject({ status: 422 });
  expect(db.serproChamada.findMany).not.toHaveBeenCalled();
  await expect(listarErrosConsultas(db, ['a'], '2026-10')).rejects.toThrow('offline');
});

import { listarEvidenciasOperacoes, destinoErroConsulta } from '../OperationsConsultas.js';
import { lerOperacao } from '../OperationsService.js';
function evidenceDb(ids, overrides = {}) {
 const records={portalClient:ids.map(id=>({id,cnpj:'12345678000190',companyId:null})),cadastroFiscal:[],company:[],portalInvoice:[],rbtExtratoCache:[],accountingEntry:[],apuracaoSnapshot:[],pendenciaPosFechamento:[],appSetting:[],...overrides};
 const select=(row,fields)=>!row?null:!fields?row:Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,v===true?row[k]:row[k]?.map(r=>select(r,v.select))]));
 const matches=(row,where={})=>Object.entries(where).every(([k,v])=>{
  if(v && typeof v==='object' && !(v instanceof Date)) {
   if(v.in) return v.in.includes(row[k]);
   if(v.gte || v.lt) return (!v.gte || row[k]>=v.gte) && (!v.lt || row[k]<v.lt);
   return matches(row,v);
  }
  return row[k]===v;
 });
 return Object.fromEntries(Object.entries(records).map(([table,rows])=>[table,{
  findMany:jest.fn(async({where,select:fields})=>rows.filter(r=>matches(r,where)).map(r=>select(r,fields))),
  findUnique:jest.fn(async({where,select:fields})=>select(rows.find(r=>matches(r,where)),fields)),
 }]));
}
test('lote fornece exatamente revisões do serviço existente sem consultas por empresa',async()=>{
 const db=evidenceDb(['a','b']);
 const individual=await lerOperacao(db,'a','2026-10');
 for(const model of Object.values(db)) { model.findMany.mockClear(); model.findUnique.mockClear(); }
 const result=await listarEvidenciasOperacoes(db,['a','b'],'2026-10');
 expect(result.items[0]).toEqual(individual);expect(result.total).toBe(2);expect(result.items.map(i=>i.companyId)).toEqual(['a','b']);
 for(const model of Object.values(db)) {expect(model.findUnique).not.toHaveBeenCalled();expect(model.findMany.mock.calls.length).toBeLessThanOrEqual(1);}
 expect(db.portalInvoice.findMany.mock.calls[0][0].where.clientId).toEqual({in:['a','b']});
 expect(db.apuracaoSnapshot.findMany.mock.calls[0][0].where.competencia).toBe('2026-10');
});

import { contextoOrigemCalculo } from '../../notas/apuracao/v2/RecuperacaoCalculo.js';
import { criarVinculoCalculo } from '../../notas/apuracao/v2/CalculoConfirmado.js';
test('lote mantém fingerprint, revisão e bloqueios com cálculos, confirmação, execução e períodos isolados',async()=>{
 const sources={
  cadastroFiscal:['a','b'].map(portalClientId=>({portalClientId,regime:'SIMPLES',regimeApuracao:'COMPETENCIA'})),
  portalInvoice:['a','b'].map(clientId=>({id:`nota-${clientId}`,clientId,papel:'EMIT',statusEfetivo:'autorizada',competencia:new Date('2026-10-01'),total:100,itens:[{id:`item-${clientId}`,valor:100,tipoReceita:'SERVICOS'}]})),
  accountingEntry:['a','b'].map(portalClientId=>({id:`folha-${portalClientId}`,portalClientId,tipo:'FOLHA',competencia:'2026-09',lines:[{tipo:'DEBIT',valor:50,conta:'folha'}]})),
  rbtExtratoCache:['a','b'].map(portalClientId=>({portalClientId,competencia:'2026-10',rbt12:1200,detalhePorMes:[],origem:'teste'})),
  apuracaoSnapshot:[],appSetting:[],pendenciaPosFechamento:[],
 };
 const db=evidenceDb(['a','b'],sources);
 for(const companyId of ['a','b']) {
  const context=await contextoOrigemCalculo({portalClientId:companyId,competencia:'2026-10'},db);
  const vinculo=criarVinculoCalculo({portalClientId:companyId,competencia:'2026-10',formulario:{atividades:[],folhaMensal12:[],regimeApuracao:'COMPETENCIA'},contribuinteCnpj:'12345678000190',contextoOrigem:context});
  sources.apuracaoSnapshot.push({portalClientId:companyId,competencia:'2026-10',estado:'calculada',dasSimuladoSerpro:10,rbt12:1200,idempotencyKey:vinculo.calculoId,simulacaoSerpro:{_portalCalculo:vinculo},atividadesEscolhidas:[],folhaMensal12:[]});
  const before=await lerOperacao(db,companyId,'2026-10');expect(before.blocked).toBeNull();
  sources.appSetting.push({key:`operations:v1:${companyId}:2026-10`,value:{status:companyId==='a'?'CONFIRMED':'RELEASED',fingerprint:before.fingerprint,contextHash:context.hash,releaseId:companyId==='b'?'release-b':null}});
 }
 sources.appSetting.push({key:'operations_execution:b:2026-10:release-b',value:{status:'DONE',message:'Execução local concluída'}});
 const compare=async competencia=>{
  const individual=await Promise.all(['a','b'].map(id=>lerOperacao(db,id,competencia)));
  const batch=await listarEvidenciasOperacoes(db,['a','b'],competencia);
  expect(batch.items).toEqual(individual);return batch.items;
 };
 const initial=await compare('2026-10');expect(initial.map(i=>i.status)).toEqual(['CONFIRMED','EXECUTED']);
 sources.portalInvoice[0].total=200;
 sources.pendenciaPosFechamento.push({id:'pendencia-a',portalClientId:'a',competencia:'2026-10',resolvida:false,motivo:'NOTA_POSTERIOR'});
 const changed=await compare('2026-10');expect(changed[0].status).toBe('INVALIDATED');expect(changed[0].blocked).toMatch(/posteriores/);expect(changed[0].revision).not.toBe(initial[0].revision);expect(changed[1]).toEqual(initial[1]);
 const previous=await compare('2026-09');expect(previous.map(i=>i.status)).toEqual(['PENDING','PENDING']);expect(previous[0].pending).toEqual([]);expect(previous[0].fingerprint).not.toBe(changed[0].fingerprint);
});
test('carteira vazia e competência inválida não consultam dados; erro de fonte não vira sucesso parcial',async()=>{
 const db=evidenceDb(['a']);await expect(listarEvidenciasOperacoes(db,[],'2026-10')).resolves.toEqual({items:[],total:0,competencia:'2026-10'});
 await expect(listarEvidenciasOperacoes(db,['a'],'2026-13')).rejects.toMatchObject({status:422});expect(db.portalClient.findMany).not.toHaveBeenCalled();
 db.accountingEntry.findMany.mockRejectedValueOnce(Error('offline'));await expect(listarEvidenciasOperacoes(db,['a'],'2026-10')).rejects.toThrow('offline');
});
test('correção por código desconhecido é conservadora',()=>{
 expect(destinoErroConsulta('CERTIFICADO_VENCIDO')).toBe('certificado');expect(destinoErroConsulta('PROCURACAO_INVALIDA')).toBe('automacao');expect(destinoErroConsulta('qualquer texto certificado')).toBe('automacao');
});

(localUrl ? test : test.skip)('PostgreSQL: lote e leitura individual preservam Decimal, datas, JSON e revisão por empresa/competência', async () => {
 const target = new URL(localUrl);
 if (!['postgres:', 'postgresql:'].includes(target.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)
     || !target.pathname.endsWith('_governance_test') || target.searchParams.has('host')) throw Error('Somente PostgreSQL loopback descartável _governance_test.');
 const db = new PrismaClient({datasources:{db:{url:localUrl}}});
 const prefix = `evidence-${randomUUID()}`, ids = [`${prefix}-a`, `${prefix}-b`];
 const rollback = new Error('rollback do fixture isolado');
 try {
  await db.$transaction(async tx => {
   const owner = await tx.client.create({data:{name:prefix,email:`${prefix}@example.invalid`,login:prefix,passwordHash:'fixture-inativo'}});
   for (const [index,id] of ids.entries()) {
    const cnpj = (BigInt(`0x${randomUUID().replaceAll('-','')}`) % 100000000000000n).toString().padStart(14,'0');
    const legacy = await tx.company.create({data:{clientId:owner.id,razaoSocial:id,cnpj,atividades:[],regimeTributario:'SIMPLES_NACIONAL',optanteSimples:true,simplesDataOpcao:new Date('2025-01-01T03:00:00Z'),cnaesSecundarios:['6201501','6202300']}});
    await tx.portalClient.create({data:{id,razao:id,cnpj,companyId:legacy.id}});
    await tx.cadastroFiscal.create({data:{portalClientId:id,regime:'SIMPLES_NACIONAL',cnaePrincipal:'6201501',dataOpcaoSN:new Date('2025-01-01T03:00:00Z'),perfilAtividades:[{cnae:'6201501',ativo:true}],regimeApuracao:'COMPETENCIA'}});
    await tx.portalInvoice.create({data:{id:`${id}-nota`,clientId:id,type:'NFSE',papel:'EMIT',statusEfetivo:'autorizada',competencia:new Date('2026-10-01T03:00:00Z'),total:new Prisma.Decimal(index ? '987.65' : '123.45'),itens:{create:[{valor:new Prisma.Decimal('123.45'),flagExportacao:false}]}}});
    await tx.accountingEntry.create({data:{portalClientId:id,tipo:'FOLHA',competencia:'2026-09',data:new Date('2026-09-30T03:00:00Z'),historico:'Fixture local',lines:{create:[{tipo:'D',conta:'folha',valor:new Prisma.Decimal('52.37')},{tipo:'C',conta:'banco',valor:new Prisma.Decimal('52.37')}]}}});
    for (const competencia of ['2026-09','2026-10']) {
     await tx.rbtExtratoCache.create({data:{portalClientId:id,competencia,rbt12:new Prisma.Decimal('12345.67'),detalhePorMes:[{pa:'2026-08',valorInterno:'123.45',valorExterno:null}],origem:'PARCIAL_LOCAL'}});
     const context = await contextoOrigemCalculo({portalClientId:id,competencia},tx);
     const vinculo = criarVinculoCalculo({portalClientId:id,competencia,formulario:{atividades:[],folhaMensal12:[],regimeApuracao:'COMPETENCIA'},contribuinteCnpj:cnpj,contextoOrigem:context});
     await tx.apuracaoSnapshot.create({data:{portalClientId:id,competencia,estado:'calculada',rbt12:new Prisma.Decimal('12345.67'),dasSimuladoSerpro:new Prisma.Decimal('10.25'),receitaPorTipo:{},atividadesEscolhidas:[],folhaMensal12:[],simulacaoSerpro:{_portalCalculo:vinculo},idempotencyKey:vinculo.calculoId,conferidaEm:new Date('2026-10-20T14:12:35Z')}});
     const before = await lerOperacao(tx,id,competencia);
     expect(before.blocked).toBeNull();
     await tx.appSetting.create({data:{key:`operations:v1:${id}:${competencia}`,value:{status:'CONFIRMED',fingerprint:before.fingerprint,contextHash:context.hash,changedAt:'2026-10-20T14:12:35Z'}}});
    }
   }
   const compare = async competencia => {
    const batch = await listarEvidenciasOperacoes(tx,ids,competencia);
    const individual = await Promise.all(ids.map(id=>lerOperacao(tx,id,competencia)));
    expect(batch.items).toEqual(individual);
    expect(batch.total).toBe(2);
    for(const item of batch.items) { expect(item.fingerprint).toMatch(/^[a-f0-9]{64}$/); expect(item.revision).toMatch(/^[a-f0-9]{64}$/); }
    return batch.items;
   };
   const initial = await compare('2026-10'), previous = await compare('2026-09');
   expect(initial.map(i=>i.status)).toEqual(['CONFIRMED','CONFIRMED']);
   expect(initial[0].fingerprint).not.toBe(previous[0].fingerprint);
   await tx.portalInvoice.update({where:{id:`${ids[0]}-nota`},data:{total:new Prisma.Decimal('123.46')}});
   await tx.pendenciaPosFechamento.create({data:{portalClientId:ids[0],competencia:'2026-10',motivo:'NOTA_POSTERIOR',observacoes:'Fixture local',createdAt:new Date('2026-10-21T14:12:35Z')}});
   const changed = await compare('2026-10');
   expect(changed[0].status).toBe('INVALIDATED');
   expect(changed[0].revision).not.toBe(initial[0].revision);
   expect(changed[0].pending).toHaveLength(1);
   expect(changed[1]).toEqual(initial[1]);
   expect(await compare('2026-09')).toEqual(previous);
   expect((await listarEvidenciasOperacoes(tx,[ids[1]],'2026-10')).items).toEqual([initial[1]]);
   throw rollback;
  },{timeout:30000});
 } catch(error) { if(error !== rollback) throw error; }
 finally { await db.$disconnect(); }
},40000);
