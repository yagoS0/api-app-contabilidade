import express from "express";
import request from "supertest";
import { createPgdasHistoricoRouter } from "../pgdasHistorico";
jest.mock("../../../infrastructure/db/prisma.js", () => ({ prisma: { companyFirmAccess: { findUnique: jest.fn() } } }));
import { prisma as accessDb } from "../../../infrastructure/db/prisma";
import { requireFirmCompanyAccess } from "../../../middlewares/requireFirmCompanyAccess";
let app, db, download, authUser;
beforeEach(()=>{
 authUser={id:"u",role:"contador"};jest.clearAllMocks();accessDb.companyFirmAccess.findUnique.mockResolvedValue({role:"ACCOUNTANT",status:"ACTIVE"});
 db={apuracaoSnapshot:{findUnique:jest.fn(async()=>null)},appSetting:{findMany:jest.fn(async()=>[]),findUnique:jest.fn(async()=>null)},companyMonthlyCircular:{findUnique:jest.fn(async()=>null)}};
 download=jest.fn(async()=>Buffer.from("%PDF-1"));app=express();app.use((req,res,next)=>{req.auth={user:authUser};next();});
 app.use(createPgdasHistoricoRouter({prisma:db,requireFirmCompanyAccess,storage:()=>({downloadBuffer:download})}));
});
test("acesso negado não lê histórico ou arquivos",async()=>{
 accessDb.companyFirmAccess.findUnique.mockResolvedValue(null);
 expect((await request(app).get('/companies/b/pgdas/2026-09/historico')).status).toBe(403);
 expect((await request(app).get('/companies/b/pgdas/2026-09/historico/'+ 'a'.repeat(64)+'/pdf')).status).toBe(403);
 expect(db.appSetting.findMany).not.toHaveBeenCalled();expect(download).not.toHaveBeenCalled();
});
test("leitura é limitada à empresa/competência e não expõe chaves",async()=>{
 db.companyMonthlyCircular.findUnique.mockResolvedValue({pgdasNumeroDeclaracao:"123",pgdasDeclaracaoFileId:"chave-privada"});
 const r=await request(app).get('/companies/a/pgdas/2026-09/historico');
 expect(r.status).toBe(200);expect(JSON.stringify(r.body)).not.toContain('chave-privada');
 expect(db.appSetting.findMany.mock.calls[0][0].where.key.startsWith).toBe('pgdas_historico:a:2026-09:');
});
test("PDF de outro escopo ou ausente não aciona storage",async()=>{
 db.appSetting.findUnique.mockResolvedValue({value:{companyId:'b',competencia:'2026-09',declaracaoFileId:'segredo'}});
 expect((await request(app).get('/companies/a/pgdas/2026-09/historico/'+ 'a'.repeat(64)+'/pdf')).status).toBe(404);
 expect(download).not.toHaveBeenCalled();
});
test("competência e versão inválidas são recusadas",async()=>{
 expect((await request(app).get('/companies/a/pgdas/2026-13/historico')).status).toBe(400);
 expect((await request(app).get('/companies/a/pgdas/2026-09/historico/arbitrario/pdf')).status).toBe(400);
 expect(db.appSetting.findMany).not.toHaveBeenCalled();
});

test.each(['STAFF','ACCOUNTANT','FIRM_ADMIN'])('vínculo ativo %s permite leitura e PDF salvo',async role=>{
 accessDb.companyFirmAccess.findUnique.mockResolvedValue({role,status:'ACTIVE'});
 db.appSetting.findUnique.mockResolvedValue({value:{companyId:'a',competencia:'2026-09',declaracaoFileId:'salvo'}});
 expect((await request(app).get('/companies/a/pgdas/2026-09/historico')).status).toBe(200);
 expect((await request(app).get('/companies/a/pgdas/2026-09/historico/'+'a'.repeat(64)+'/pdf')).status).toBe(200);
 expect(download).toHaveBeenCalledWith({key:'salvo'});
});
test('admin global lê sem vínculo; ausência de autenticação recusa antes dos dados',async()=>{
 authUser={id:'admin',role:'admin'};accessDb.companyFirmAccess.findUnique.mockResolvedValue(null);
 expect((await request(app).get('/companies/a/pgdas/2026-09/historico')).status).toBe(200);expect(accessDb.companyFirmAccess.findUnique).not.toHaveBeenCalled();
 db.appSetting.findMany.mockClear();authUser=null;
 expect((await request(app).get('/companies/a/pgdas/2026-09/historico')).status).toBe(401);
 expect((await request(app).get('/companies/a/pgdas/2026-09/historico/'+'a'.repeat(64)+'/pdf')).status).toBe(401);expect(db.appSetting.findMany).not.toHaveBeenCalled();expect(download).not.toHaveBeenCalled();
});
test('vínculo inativo não permite histórico nem PDF',async()=>{
 accessDb.companyFirmAccess.findUnique.mockResolvedValue({role:'FIRM_ADMIN',status:'INACTIVE'});
 expect((await request(app).get('/companies/a/pgdas/2026-09/historico')).body.error).toBe('forbidden');
 expect((await request(app).get('/companies/a/pgdas/2026-09/historico/'+'a'.repeat(64)+'/pdf')).body.error).toBe('forbidden');expect(db.appSetting.findMany).not.toHaveBeenCalled();expect(download).not.toHaveBeenCalled();
});
test.each([['STAFF',403],['ACCOUNTANT',204],['FIRM_ADMIN',204]])('middleware real de escrita %s respeita mínimo ACCOUNTANT',async(role,status)=>{
 accessDb.companyFirmAccess.findUnique.mockResolvedValue({role,status:'ACTIVE'});const reached=jest.fn((req,res)=>res.sendStatus(204));
 app.post('/company/:companyId/prova-escrita',requireFirmCompanyAccess({minRole:'ACCOUNTANT'}),reached);
 const response=await request(app).post('/company/a/prova-escrita');expect(response.status).toBe(status);
 if(status===403){expect(response.body.error).toBe('insufficient_role');expect(reached).not.toHaveBeenCalled();}else expect(reached).toHaveBeenCalledTimes(1);
});

test('PDF de outra competência e storage ausente não expõem documento',async()=>{
 const url='/companies/a/pgdas/2026-09/historico/'+'a'.repeat(64)+'/pdf';
 db.appSetting.findUnique.mockResolvedValue({value:{companyId:'a',competencia:'2026-08',declaracaoFileId:'privado'}});
 expect((await request(app).get(url)).status).toBe(404);expect(download).not.toHaveBeenCalled();
 db.appSetting.findUnique.mockResolvedValue({value:{companyId:'a',competencia:'2026-09',declaracaoFileId:'salvo'}});download.mockRejectedValue(Error('objeto ausente'));
 expect((await request(app).get(url)).body.error).toBe('pdf_not_available');
});
