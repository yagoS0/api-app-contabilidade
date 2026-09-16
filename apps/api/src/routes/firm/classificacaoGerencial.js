import { Router } from 'express';
import { prisma } from '../../infrastructure/db/prisma.js';
import { carregarPlano } from '../../application/accounting/AliquotaPorLancamentosService.js';
import { requireFirmCompanyAccess } from '../../middlewares/requireFirmCompanyAccess.js';

export function createClassificacaoGerencialRouter() {
  const router=Router({mergeParams:true});
  router.get('/planejamento/classificacao',requireFirmCompanyAccess(),async(req,res)=>{
    try { const r=await prisma.classificacaoGerencial.findUnique({where:{companyId:req.params.companyId}});return res.json({ok:true,contas:r?.contasJson||{},revisao:r?.revisao||0}); }
    catch {return res.status(500).json({ok:false,message:'Não foi possível ler a classificação gerencial.'});}
  });
  router.put('/planejamento/classificacao',requireFirmCompanyAccess({minRole:'ACCOUNTANT'}),async(req,res)=>{
    try {
      const companyId=req.params.companyId,{contas,revisao}=req.body||{};
      if(!contas||Array.isArray(contas)||typeof contas!=='object'||Object.keys(contas).length>5000||!Number.isInteger(revisao)||revisao<0) return res.status(400).json({ok:false,message:'Classificação inválida.'});
      const plano=await carregarPlano(companyId),validas=new Set([...plano.values()].filter(c=>c.analitica!==false).map(c=>String(c.codigoCompleto)));
      const limpas={};
      for(const [codigo,v] of Object.entries(contas)) {
        if(!validas.has(codigo)||!['FIXO','VARIAVEL'].includes(v?.comportamento)||typeof v.prolabore!=='boolean'||(v.prolabore&&!codigo.startsWith('41101'))) return res.status(400).json({ok:false,message:'Confira as contas analíticas, o comportamento e o pró-labore (despesa com pessoal).'});
        limpas[codigo]={comportamento:v.comportamento,prolabore:v.prolabore};
      }
      if(revisao===0) await prisma.classificacaoGerencial.create({data:{companyId,contasJson:limpas,atualizadoPor:req.auth.user.id}});
      else {
        const r=await prisma.classificacaoGerencial.updateMany({where:{companyId,revisao},data:{contasJson:limpas,atualizadoPor:req.auth.user.id,revisao:{increment:1}}});
        if(r.count!==1)return res.status(409).json({ok:false,message:'Outra pessoa alterou a classificação. Recarregue antes de salvar.'});
      }
      return res.json({ok:true,contas:limpas,revisao:revisao+1});
    } catch(e) {return res.status(e.code==='P2002'?409:500).json({ok:false,message:e.code==='P2002'?'A classificação foi criada por outra pessoa. Recarregue.':'Não foi possível salvar a classificação.'});}
  });
  return router;
}
