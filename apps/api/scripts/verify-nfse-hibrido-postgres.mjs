import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { normalizeRegimeHistorico } from '../src/application/company/companyProfile.js';
import { previaFiscalDoContador } from '../src/application/nfse/previaFiscalDoContador.js';
const [url, clientPath] = process.argv.slice(2);
assert.equal(new URL(url).hostname, '127.0.0.1');
const block = () => { throw Error('Transmissão não permitida neste ensaio de banco'); };
http.request = http.get = https.request = https.get = globalThis.fetch = block;
const { PrismaClient } = createRequire(import.meta.url)(path.join(clientPath, 'index.js'));
let db = new PrismaClient({ datasources: { db: { url } } });
try {
 const client = await db.client.create({ data: { name: 'Teste', email: 'hibrido@example.test', login: 'hibrido', passwordHash: 'nao-utilizavel' } });
 const empresa = await db.company.create({ data: { clientId: client.id, razaoSocial: 'Empresa sintética', cnpj: '11111111000111', atividades: [], codigoMunicipioIbge: '3304557', codigoServicoNacional: '170601' } });
 const portal = await db.portalClient.create({ data: { companyId: empresa.id, razao: 'Empresa sintética', cnpj: empresa.cnpj } });
 const periodos = normalizeRegimeHistorico([
 { regime: 'SIMPLES', vigenciaInicio: '2026-01-01', vigenciaFim: '2026-12-31' },
 { regime: 'SIMPLES', vigenciaInicio: '2027-01-01', vigenciaFim: '2027-06-30', apuracaoIbsCbs: 'REGULAR', comprovanteOpcaoIbsCbs: 'Comprovante sintético' },
 { regime: 'SIMPLES', vigenciaInicio: '2027-07-01', apuracaoIbsCbs: 'NO_DAS' },
 ]);
 assert.equal(periodos.ok,true);
 await db.regimeHistorico.createMany({ data: periodos.data.map(r=>({...r,companyId:empresa.id})) });
 await db.$disconnect();db=new PrismaClient({datasources:{db:{url}}});
 const salvos = await db.regimeHistorico.findMany({where:{companyId:empresa.id},orderBy:{vigenciaInicio:'asc'}});
 assert.equal(salvos[1].comprovanteOpcaoIbsCbs, 'Comprovante sintético');
 assert.equal(salvos[0].apuracaoIbsCbs,null);
 for (const [competencia,apuracao] of [['2026-12',null],['2027-01','REGULAR'],['2027-07','NO_DAS']]) {
 const previa=await previaFiscalDoContador({portalClientId:portal.id,competencia},{db,perfisHabilitados:false,ibscbsLigado:false,ambiente:'homolog'});
 assert.equal(previa.opcaoIbsCbs.apuracao,apuracao);
 if(apuracao) assert.equal(previa.pendencias[0].codigo,'NFSE_CONTRATO_SIMPLES_2027_PENDENTE');
 }
 await assert.rejects(db.regimeHistorico.create({data:{companyId:empresa.id,regime:'MEI',vigenciaInicio:new Date('2027-01-01'),apuracaoIbsCbs:'REGULAR'}}));
 assert.equal(await db.serviceInvoice.count(),0);
 console.log(JSON.stringify({passed:true,migracao:'20261010180000_regime_historico_ibscbs',persistenciaAposReconexao:true,periodosConferidos:3,restricaoBanco:true,notasCriadas:0}));
} finally {await db.$disconnect();}
