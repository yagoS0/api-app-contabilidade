import { Router } from 'express';
import archiver from 'archiver';
import { prisma } from '../../infrastructure/db/prisma.js';
import { requireFirmCompanyAccess } from '../../middlewares/requireFirmCompanyAccess.js';
import { prepararLote } from '../../application/accounting/exportacao/exportacaoLote.js';

export function createExportacaoLoteRouter() {
  const router=Router();
  // Usa exatamente o middleware individual; "contador" não ganha bypass da carteira.
  const acesso=(req,id)=>new Promise((resolve,reject)=>{
    const res={status(){return this;},json(){resolve(false);}};
    Promise.resolve(requireFirmCompanyAccess()({...req,params:{...req.params,companyId:id}},res,()=>resolve(true))).catch(reject);
  });
  router.post('/entries/export/batch/:acao',async(req,res,next)=>{
    if(!['preflight','zip'].includes(req.params.acao)) return next();
    try {
      const gerar=req.params.acao==='zip';
      const result=await prepararLote({prisma,input:req.body,podeAcessar:id=>acesso(req,id),gerarArquivos:gerar});
      if(!gerar) {const {arquivos,...preview}=result;return res.json(preview);}
      if(result.empresas.some(e=>e.estado==='AGUARDA_CONFIRMACAO')) return res.status(409).json({ok:false,message:'Confira e confirme os alertas antes de exportar.',empresas:result.empresas});
      res.setHeader('Content-Type','application/zip');
      res.setHeader('Content-Disposition',`attachment; filename="lancamentos-${result.competenciaInicio}_${result.competenciaFim}.zip"`);
      const zip=archiver('zip',{zlib:{level:6}});
      zip.on('error',error=>res.destroy(error));
      zip.pipe(res);
      for(const arquivo of result.arquivos) zip.append(arquivo.conteudo,{name:arquivo.nome});
      const {arquivos,...manifesto}=result;
      zip.append(JSON.stringify({...manifesto,geradoEm:new Date().toISOString(),observacao:'Arquivos preparados; importação no ERP não foi confirmada. Status contábil não foi alterado.'},null,2),{name:'manifesto.json'});
      await zip.finalize();
    }catch(err){if(res.headersSent)return res.destroy(err);return res.status(err.status||500).json({ok:false,message:err.status?err.message:'Falha ao preparar exportação.'});}
  });
  return router;
}
