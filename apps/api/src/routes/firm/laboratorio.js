import { Router } from 'express';
import { prisma } from '../../infrastructure/db/prisma.js';
import { salvarCenario, listarCenarios } from '../../application/planejamento/LaboratorioService.js';

// Montado depois de requireAuth + requireAccountType(FIRM).
export function createLaboratorioRouter() {
  const router=Router();
  router.get('/laboratorio/cenarios',async(req,res)=>{
    try { return res.json({ok:true,cenarios:await listarCenarios({client:prisma,user:req.auth.user})}); }
    catch { return res.status(500).json({ok:false,message:'Não foi possível ler os cenários.'}); }
  });
  router.post('/laboratorio/cenarios',async(req,res)=>{
    try { return res.status(201).json({ok:true,cenario:await salvarCenario({client:prisma,user:req.auth.user,body:req.body})}); }
    catch(e) { return res.status(e.status||(/^Informe|^Clientes|^Custos/.test(e.message)?400:500)).json({ok:false,message:e.status||/^Informe|^Clientes|^Custos/.test(e.message)?e.message:'Não foi possível salvar o cenário.'}); }
  });
  return router;
}
