import { Router } from 'express';
import { prisma } from '../../infrastructure/db/prisma.js';
import { requireFirmCompanyAccess } from '../../middlewares/requireFirmCompanyAccess.js';
import { definirPeriodos } from '../../application/planejamento/analiseEmpresa.js';
import { validarBaseSocios } from '../../../../../packages/shared/src/analise/socios.js';
export function createBaseSociosRouter() {
  const r=Router({mergeParams:true});
  r.get('/planejamento/base-socios',requireFirmCompanyAccess(),async(req,res)=>{
    try{definirPeriodos(req.query);const registros=await prisma.baseSociosGerencial.findMany({where:{companyId:req.params.companyId,competencia:{gte:req.query.de,lte:req.query.ate}},orderBy:[{competencia:'desc'},{id:'desc'}],distinct:['competencia']});return res.json({ok:true,registros});}catch(e){return res.status(e.message==='PERIODO_INVALIDO'?400:500).json({ok:false,message:'Não foi possível consultar a base de retiradas.'});}
  });
  r.post('/planejamento/base-socios',requireFirmCompanyAccess({minRole:'ACCOUNTANT'}),async(req,res)=>{
    let dados;try{dados=validarBaseSocios(req.body);}catch(e){return res.status(400).json({ok:false,message:e.message});}
    try{const registro=await prisma.baseSociosGerencial.create({data:{...dados,companyId:req.params.companyId,autorId:req.auth.user.id}});return res.status(201).json({ok:true,registro});}catch{return res.status(500).json({ok:false,message:'Não foi possível salvar a declaração de retiradas.'});}
  });return r;
}
