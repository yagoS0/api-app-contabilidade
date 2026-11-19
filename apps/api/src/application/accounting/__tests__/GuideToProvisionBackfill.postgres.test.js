import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { criarPortasBackfill } from '../../../modules/accounting/infrastructure/prisma/backfillProvisionsFromExistingGuides.js';
import { executarBackfillDeProvisoes } from '../../../modules/accounting/application/backfillProvisionsFromExistingGuides.js';
import { bloquearFechamentoContabil } from '../fechamentoContabil.js';
const url = process.env.DATABASE_URL;
const local = url && ['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname) && new URL(url).pathname.endsWith('_governance_test');
const deferred = () => { let resolve; const promise = new Promise(r=>resolve=r); return {promise,resolve}; };
jest.setTimeout(30000);
(local ? describe : describe.skip)('backfill supervisionado PostgreSQL descartável',()=>{
  let db, other, tenant, guide, input, portas;
  beforeAll(()=>{db=new PrismaClient();other=new PrismaClient();});
  beforeEach(async()=>{
    tenant=await db.portalClient.create({data:{razao:'SYNTHETIC BACKFILL',cnpj:randomUUID()}});
    guide=await db.guide.create({data:{portalClientId:tenant.id,competencia:'2026-10',tipo:'ISS',valor:125,status:'PROCESSED',source:'LOCAL',vencimento:new Date('2026-11-20')}});
    input={portalClientId:tenant.id,competencia:'2026-10',executar:true,logger:{info:jest.fn()}};
    portas=criarPortasBackfill(db);
  });
  afterEach(async()=>{await db.accountingEntry.deleteMany({where:{portalClientId:tenant.id}});await db.guide.deleteMany({where:{portalClientId:tenant.id}});await db.portalClient.delete({where:{id:tenant.id}});});
  afterAll(async()=>{await db.$disconnect();await other.$disconnect();});
  const count=()=>db.accountingEntry.count({where:{portalClientId:tenant.id}});
  const fechar=tx=>tx.companyMonthlyCircular.upsert({where:{portalClientId_competencia:{portalClientId:tenant.id,competencia:'2026-10'}},create:{portalClientId:tenant.id,competencia:'2026-10',fechadoContabilEm:new Date()},update:{fechadoContabilEm:new Date()}});
  test('prévia nenhuma escrita; criação única somente aberta e replay sem duplicação',async()=>{
    expect((await executarBackfillDeProvisoes({...input,executar:false},portas)).preview).toBe(true);expect(await count()).toBe(0);
    expect((await executarBackfillDeProvisoes(input,portas)).ok).toBe(1);expect(await count()).toBe(1);
    expect((await executarBackfillDeProvisoes(input,portas)).scanned).toBe(0);expect(await count()).toBe(1);
  });
  test('fechada recusa geração',async()=>{await fechar(db);expect((await executarBackfillDeProvisoes(input,portas)).resultados[0].status).toBe('MES_FECHADO');expect(await count()).toBe(0);});
  test('empresa diferente não lê guia',async()=>{expect((await executarBackfillDeProvisoes({...input,portalClientId:randomUUID()},portas)).scanned).toBe(0);expect(await count()).toBe(0);});
  test('guia alterada depois da seleção é recusada',async()=>{
    const listar=portas.listar;portas.listar=async scope=>{const rows=await listar(scope);await db.guide.update({where:{id:guide.id},data:{valor:200}});return rows;};
    expect((await executarBackfillDeProvisoes(input,portas)).resultados[0].status).toBe('GUIA_ALTERADA');expect(await count()).toBe(0);
  });
  test('provisão criada depois da seleção não é reescrita',async()=>{
    const listar=portas.listar;portas.listar=async scope=>{const rows=await listar(scope);await db.accountingEntry.create({data:{portalClientId:tenant.id,sourceGuideId:guide.id,competencia:'2026-10',data:new Date('2026-10-31'),historico:'SYNTHETIC',tipo:'PROVISAO',eventType:'DARF_ISS',lines:{create:[{conta:'D',tipo:'D',valor:50},{conta:'C',tipo:'C',valor:50}]}}});return rows;};
    expect((await executarBackfillDeProvisoes(input,portas)).resultados[0].status).toBe('GUIA_JA_CONTABILIZADA');
    const entry=await db.accountingEntry.findFirst({where:{portalClientId:tenant.id},include:{lines:true}});expect(entry.lines.map(l=>Number(l.valor))).toEqual([50,50]);
  });
  test('falha após escrita reverte provisão e linhas',async()=>{
    const transacao=portas.emTransacao;portas.emTransacao=f=>transacao(p=>f({...p,gerar:async id=>{await p.gerar(id);throw Error('synthetic rollback');}}));
    await expect(executarBackfillDeProvisoes(input,portas)).rejects.toThrow('synthetic rollback');expect(await count()).toBe(0);
  });
  test('fechamento primeiro: backfill concorrente aborta snapshot antigo',async()=>{
    const locked=deferred(),release=deferred(),attempt=deferred();
    const closing=other.$transaction(async tx=>{await bloquearFechamentoContabil(tx,tenant.id);await fechar(tx);locked.resolve();await release.promise;},{isolationLevel:'Serializable',timeout:20000});
    await locked.promise;
    const transacao=portas.emTransacao;portas.emTransacao=f=>transacao(p=>f({...p,bloquear:async id=>{attempt.resolve();await p.bloquear(id);}}));
    const running=executarBackfillDeProvisoes(input,portas);const observed=running.then(value=>({value}),error=>({error}));
    await attempt.promise;await new Promise(r=>setTimeout(r,150));release.resolve();await closing;
    expect((await observed).error?.code).toBe('P2034');expect(await count()).toBe(0);
  });
  test('backfill primeiro: fechamento concorrente não usa snapshot anterior',async()=>{
    const locked=deferred(),release=deferred(),attempt=deferred();
    const transacao=portas.emTransacao;portas.emTransacao=f=>transacao(p=>f({...p,gerar:async id=>{const result=await p.gerar(id);locked.resolve();await release.promise;return result;}}));
    const running=executarBackfillDeProvisoes(input,portas);await locked.promise;
    const closing=other.$transaction(async tx=>{attempt.resolve();await bloquearFechamentoContabil(tx,tenant.id);await fechar(tx);},{isolationLevel:'Serializable',timeout:20000});const observed=closing.then(value=>({value}),error=>({error}));
    await attempt.promise;await new Promise(r=>setTimeout(r,150));release.resolve();expect((await running).ok).toBe(1);
    expect((await observed).error?.code).toBe('P2034');expect(await count()).toBe(1);
  });
});
