import { Router } from 'express';
import { criarTesteIaWhatsapp, exigirAdministradorTeste } from '../../application/whatsapp/TesteIaWhatsappService.js';

export function createWhatsappTesteIaRouter({servico=criarTesteIaWhatsapp()}={}) {
  const router=Router();
  const executar=fn=>async(req,res)=>{
    try {
      const user=req.auth?.user;
      exigirAdministradorTeste(user);
      return res.json({ok:true,...await fn(req,user)});
    } catch(e) {
      return res.status(e.status||500).json({ok:false,message:e.status?e.message:'Teste isolado indisponível.'});
    }
  };
  router.post('/whatsapp/teste-ia',executar(async(req,user)=>({sessao:await servico.ativar({...req.body,user})})));
  router.get('/whatsapp/teste-ia/:id',executar(async(req,user)=>({sessao:await servico.consultar({user,id:req.params.id})})));
  router.post('/whatsapp/teste-ia/:id/encerrar',executar((req,user)=>servico.encerrar({user,id:req.params.id})));
  return router;
}
