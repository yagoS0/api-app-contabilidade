jest.mock('../../../infrastructure/db/prisma.js',()=>({prisma:{companyClientUser:{findUnique:jest.fn()}}}));
jest.mock('../../../application/planejamento/AnaliseEmpresaService.js',()=>({obterAnaliseEmpresa:jest.fn()}));
jest.mock('../../../application/planejamento/ClientesAnaliseService.js',()=>({obterClientesAnalise:jest.fn()}));
import express from 'express';
import request from 'supertest';
import { prisma } from '../../../infrastructure/db/prisma.js';
import { createRelatoriosClienteRouter } from '../relatorios.js';
import { disponibilidadeRelatorios, validarPeriodoPortal, cardsContabeis } from '../../../../../../packages/shared/src/analise/portalCliente.js';
const meses=['2026-06','2026-07','2026-08'];
function preparar(fechados=meses,usuario=true){
 const tx={companyMonthlyCircular:{findMany:jest.fn(async()=>fechados.map(competencia=>({competencia})))}};
 const client={$transaction:jest.fn(fn=>fn(tx))};
 const analise=jest.fn(async()=>({ok:true,guias:[{id:'publica',liberadaCliente:true},{id:'privada',liberadaCliente:false}]}));
 const clientes=jest.fn(async()=>({ok:true,clientes:[]}));
 const app=express();app.use((req,res,next)=>{if(usuario)req.auth={user:{id:'u',role:'client'}};next();});
 app.use('/companies/:companyId/relatorios',createRelatoriosClienteRouter({client,analise,clientes,agora:()=>new Date('2026-09-24T12:00:00Z')}));
 return {app,tx,client,analise,clientes};
}
beforeEach(()=>{prisma.companyClientUser.findUnique.mockResolvedValue({status:'ACTIVE',role:'FINANCEIRO'});});
test('três meses anteriores e virada de ano, não quaisquer três fechados',()=>{
 expect(disponibilidadeRelatorios(meses,'2026-09')).toMatchObject({liberado:true,de:'2025-09',ate:'2026-08'});
 expect(disponibilidadeRelatorios(['2026-05','2026-07','2026-08'],'2026-09')).toMatchObject({liberado:false,pendentes:['2026-06']});
 expect(disponibilidadeRelatorios(['2025-10','2025-11','2025-12'],'2026-01').liberado).toBe(true);
});
test('intervalo limitado a 12 meses concluídos, sem ampliar pelo navegador',()=>{
 const a=disponibilidadeRelatorios(meses,'2026-09');
 expect(()=>validarPeriodoPortal({de:'2025-08',ate:'2026-08'},a)).toThrow();
 expect(()=>validarPeriodoPortal({de:'2026-08',ate:'2026-09'},a)).toThrow();
 expect(validarPeriodoPortal({de:'2026-07',ate:'2026-08'},a).de).toBe('2026-07');
});
test('sem login ou vínculo, não lê fechamentos nem valores',async()=>{
 let r=preparar(meses,false);expect((await request(r.app).get('/companies/a/relatorios/analise')).status).toBe(401);expect(r.client.$transaction).not.toHaveBeenCalled();
 r=preparar();prisma.companyClientUser.findUnique.mockResolvedValue(null);expect((await request(r.app).get('/companies/b/relatorios/fechamentos')).status).toBe(403);expect(r.client.$transaction).not.toHaveBeenCalled();
});
test('metadados não liberam valores com fechamento pendente; todos os endpoints revalidam',async()=>{
 const r=preparar(['2026-07','2026-08']);
 expect((await request(r.app).get('/companies/a/relatorios/fechamentos')).body.liberado).toBe(false);
 for(const tipo of ['analise','clientes'])expect((await request(r.app).get('/companies/a/relatorios/'+tipo+'?de=2026-07&ate=2026-08')).status).toBe(409);
 expect(r.analise).not.toHaveBeenCalled();expect(r.clientes).not.toHaveBeenCalled();
});
test('janela de 12 meses aceita lacunas antigas com escopo da empresa e sem guia privada',async()=>{
 const r=preparar();const res=await request(r.app).get('/companies/a/relatorios/analise?de=2025-09&ate=2026-08');
 expect(res.status).toBe(200);expect(res.body.guias.map(g=>g.id)).toEqual(['publica']);
 expect(r.analise).toHaveBeenCalledWith(expect.objectContaining({portalClientId:'a',permitirLacunas:true,client:r.tx}));
 expect(r.tx.companyMonthlyCircular.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{portalClientId:'a',fechadoContabilEm:{not:null}}}));
 expect((await request(r.app).get('/companies/a/relatorios/analise?de=2026-08&ate=2026-09')).status).toBe(400);
});
test('cards não descontam folha e tributos duas vezes e ausência não vira zero',()=>{
 const v={receitaBruta:1000,receitasFinanceiras:10,outrasReceitas:0,deducoes:-80,custos:-200,pessoal:-100,gerais:-50,tributarias:-10,depreciacao:-10,despesasFinanceiras:-5,irpjCsll:-20,resultadoDoPeriodo:535};
 const cards=cardsContabeis({linhas:Object.entries(v).map(([chave,valor])=>({chave,valor}))});
 expect(cards).toEqual({entradas:1010,saidas:265,folha:100,impostos:110,resultado:535});
 expect(cards.entradas-cards.saidas-cards.folha-cards.impostos).toBe(cards.resultado);
 expect(cardsContabeis({semLancamento:true}).resultado).toBeNull();
});
test('seleção sem fechado responde diretamente, sem gerar relatório vazio',async()=>{
 const r=preparar();
 for(const tipo of ['analise','clientes']){const res=await request(r.app).get('/companies/a/relatorios/'+tipo+'?de=2026-01&ate=2026-02');expect(res.status).toBe(409);expect(res.body.error).toBe('SEM_MESES_FECHADOS');}
 expect(r.analise).not.toHaveBeenCalled();expect(r.clientes).not.toHaveBeenCalled();
});
test('seleção mista ajusta as extremidades para os fechados',()=>{
 const a=disponibilidadeRelatorios(['2026-01','2026-03',...meses],'2026-09');
 expect(validarPeriodoPortal({de:'2025-09',ate:'2026-04'},a)).toEqual({de:'2026-01',ate:'2026-03',comparar:'anterior'});
});
