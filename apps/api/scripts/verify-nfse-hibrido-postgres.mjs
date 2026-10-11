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
 const perfil = await db.perfilEmissaoNfse.create({ data: { portalClientId: portal.id, nome: 'Perfil sintético', codigoServicoNacional: '170601' } });
 assert.equal(perfil.cAtvSN, null);
 await db.perfilEmissaoNfse.update({ where: { id: perfil.id }, data: { cAtvSN: '09' } });
 await assert.rejects(db.$executeRaw`UPDATE perfis_emissao_nfse SET "cAtvSN" = '99' WHERE id = ${perfil.id}`,
   err => err.code === 'P2010' && err.meta?.code === '23514');
 await db.perfilEmissaoNfse.update({ where: { id: perfil.id }, data: { nome: 'Perfil renomeado' } });
 const periodos = normalizeRegimeHistorico([
 { regime: 'SIMPLES', vigenciaInicio: '2026-01-01', vigenciaFim: '2026-12-31' },
 { regime: 'SIMPLES', vigenciaInicio: '2027-01-01', vigenciaFim: '2027-06-30', apuracaoIbsCbs: 'REGULAR', comprovanteOpcaoIbsCbs: 'Comprovante sintético' },
 { regime: 'SIMPLES', vigenciaInicio: '2027-07-01', apuracaoIbsCbs: 'NO_DAS' },
 ]);
 assert.equal(periodos.ok,true);
 await db.regimeHistorico.createMany({ data: periodos.data.map(r=>({...r,companyId:empresa.id})) });
 await db.$disconnect();db=new PrismaClient({datasources:{db:{url}}});
 const salvos = await db.regimeHistorico.findMany({where:{companyId:empresa.id},orderBy:{vigenciaInicio:'asc'}});
 assert.equal((await db.perfilEmissaoNfse.findUnique({ where: { id: perfil.id } })).cAtvSN, '09');
 await db.perfilEmissaoNfse.update({ where: { id: perfil.id }, data: { cAtvSN: null } });
 await db.$disconnect(); db = new PrismaClient({ datasources: { db: { url } } });
 assert.equal((await db.perfilEmissaoNfse.findUnique({ where: { id: perfil.id } })).cAtvSN, null);
 assert.equal(salvos[1].comprovanteOpcaoIbsCbs, 'Comprovante sintético');
 assert.equal(salvos[0].apuracaoIbsCbs,null);
 for (const ambiente of ['homolog', 'producao']) {
 for (const [competencia,apuracao] of [['2026-12',null],['2027-01','REGULAR'],['2027-07','NO_DAS']]) {
 const previa=await previaFiscalDoContador({portalClientId:portal.id,competencia},{db,perfisHabilitados:true,ibscbsLigado:false,ambiente});
 assert.equal(previa.opcaoIbsCbs.apuracao,apuracao);
 if(apuracao) assert.equal(previa.pendencias[0].codigo,'NFSE_CONTRATO_SIMPLES_2027_PENDENTE');
 }
 }
 await assert.rejects(db.regimeHistorico.create({data:{companyId:empresa.id,regime:'MEI',vigenciaInicio:new Date('2027-01-01'),apuracaoIbsCbs:'REGULAR'}}));
 assert.equal(await db.serviceInvoice.count(),0);
 console.log(JSON.stringify({passed:true,migracao:'20261010220000_perfil_atividade_simples',atividadePersistidaAposReconexao:true,edicaoParcialPreservaAtividade:true,atividadeLimpaAposReconexao:true,dominioAtividadeProtegido:'23514',persistenciaAposReconexao:true,periodosConferidos:3,bloqueio2027:['homolog','producao'],restricaoBanco:true,notasCriadas:0}));
} finally {await db.$disconnect();}
