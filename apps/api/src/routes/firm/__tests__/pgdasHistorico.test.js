import express from "express";
import request from "supertest";
import { createPgdasHistoricoRouter } from "../pgdasHistorico";
jest.mock("../../../infrastructure/db/prisma.js", () => ({ prisma: { companyFirmAccess: { findUnique: jest.fn() } } }));
import { prisma as accessDb } from "../../../infrastructure/db/prisma";
import { requireFirmCompanyAccess } from "../../../middlewares/requireFirmCompanyAccess";
let app, db, download;
beforeEach(()=>{
 jest.clearAllMocks();accessDb.companyFirmAccess.findUnique.mockResolvedValue({role:"ACCOUNTANT",status:"ACTIVE"});
 db={apuracaoSnapshot:{findUnique:jest.fn(async()=>null)},appSetting:{findMany:jest.fn(async()=>[]),findUnique:jest.fn(async()=>null)},companyMonthlyCircular:{findUnique:jest.fn(async()=>null)}};
 download=jest.fn(async()=>Buffer.from("%PDF-1"));app=express();app.use((req,res,next)=>{req.auth={user:{id:"u",role:"contador"}};next();});
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
