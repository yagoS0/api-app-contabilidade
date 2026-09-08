// Somente banco descartável local. Não lê .env, não chama serviços externos.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const arg = process.argv.indexOf('--url');
const url = new URL((arg >= 0 ? process.argv[arg + 1] : process.env.DATABASE_URL) || 'invalid:');
if (!['postgresql:', 'postgres:'].includes(url.protocol) || !['127.0.0.1','localhost'].includes(url.hostname) || !/^\/[a-zA-Z0-9_]+_check$/.test(url.pathname)) throw new Error('Use banco descartável local terminado em _check.');
process.env.DATABASE_URL = url.href;
globalThis.fetch = async () => { throw new Error('Consulta externa proibida no ensaio.'); };
const { prisma } = await import('../src/infrastructure/db/prisma.js');
const { montarFluxoDeCaixa } = await import('../src/application/fluxo/FluxoDeCaixaService.js');
const prefix = `cashflow-check-${randomUUID()}`;
const company = `${prefix}-a`, outra = `${prefix}-b`;
try {
  await prisma.portalClient.createMany({data:[company,outra].map(id=>({id,cnpj:id,razao:'Empresa descartável saldo'}))});
  // Registro legado permanece armazenado, mas não interfere no cálculo automático.
  await prisma.saldoInicialFluxo.create({data:{portalClientId:company,criadoPor:prefix,dataReferencia:new Date('2025-12-01T00:00:00Z'),valor:'5000.25'}});
  await prisma.chartOfAccount.createMany({data:[
    {portalClientId:company,codigo:`${prefix}-despesa`,codigoCompleto:'411020001',tipo:'DESPESA',nome:'Despesa ensaio',analitica:true},
    {portalClientId:company,codigo:`${prefix}-caixa`,codigoCompleto:'111010001',tipo:'ATIVO',nome:'Caixa ensaio',analitica:true},
  ]});
  await prisma.accountingEntry.create({data:{portalClientId:company,tipo:'DESPESA',status:'CONFIRMADO',competencia:'2025-12',data:new Date('2025-12-10T00:00:00Z'),historico:'Saída teste âncora',lines:{create:[
    {tipo:'D',conta:`${prefix}-despesa`,valor:'200.10'},
    {tipo:'C',conta:`${prefix}-caixa`,valor:'200.10'},
  ]}}});
  const fluxo = await montarFluxoDeCaixa({portalClientId:company,cicloAtual:'2026-09',hoje:'2026-09-08',janelaInicio:'2026-01'});
  const jan = fluxo.meses.find(m=>m.competencia==='2026-01');
  assert.deepEqual(jan.saldo,{inicial:-200.10,final:-200.10,projetado:true});
  const outraJanela = await montarFluxoDeCaixa({portalClientId:company,cicloAtual:'2026-09',hoje:'2026-09-08',janelaInicio:'2026-03'});
  assert.equal(outraJanela.meses[0].saldo.inicial,-200.10);
  assert.equal((await montarFluxoDeCaixa({portalClientId:outra,cicloAtual:'2026-09',hoje:'2026-09-08'})).meses[0].saldo.inicial,null);
  assert.equal(fluxo.saldoInicial,null);
  assert.deepEqual(fluxo.acumulado,{origem:'HISTORICO',calculoInicio:'2025-12'});
  assert.equal(await prisma.saldoInicialFluxo.count({where:{portalClientId:company}}),1);
  console.log('PASS: acumulado automático Decimal, escopo por empresa, histórico anterior à janela, meses vazios e saldo manual legado ignorado.');
} finally {
  await prisma.accountingEntry.deleteMany({where:{portalClientId:{in:[company,outra]}}});
  await prisma.chartOfAccount.deleteMany({where:{portalClientId:{in:[company,outra]}}});
  await prisma.portalClient.deleteMany({where:{id:{in:[company,outra]}}});
  await prisma.$disconnect();
}
