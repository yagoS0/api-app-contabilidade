import { Router } from 'express';
import { empresasVisiveis } from './empresasVisiveis.js';
import { TarefaCalendarioError, listarTarefasUnificadas, criarTarefaUnificada, acaoTarefaUnificada } from '../../application/calendario/TarefasUnificadasService.js';
export function createTarefasUnificadasRouter({ log } = {}) {
  const router = Router();
  const rota = fn => async (req,res) => {
    try {
      const userId = req.auth?.user?.id;
      if (!userId) return res.status(401).json({ok:false});
      const ctx = {userId,portalIds:await empresasVisiveis(req)};
      return res.json({ok:true,...await fn(req,ctx)});
    } catch(e) {
      if (!(e instanceof TarefaCalendarioError)) log?.error?.({err:e.message},'Falha no calendário unificado');
      return res.status(e.status || 500).json({ok:false,error:e instanceof TarefaCalendarioError ? e.code : undefined,message:e instanceof TarefaCalendarioError ? e.message : 'Não foi possível atualizar o calendário.'});
    }
  };
  router.get('/agenda/unificada',rota((req,ctx)=>listarTarefasUnificadas({...ctx,inicio:req.query.inicio,fim:req.query.fim,companyId:req.query.companyId})));
  router.post('/agenda/unificada',rota(async(req,ctx)=>({tarefa:await criarTarefaUnificada({...ctx,dados:req.body || {}})})));
  router.post('/agenda/unificada/:id/acao',rota(async(req,ctx)=>({tarefa:await acaoTarefaUnificada({...ctx,id:req.params.id,dados:req.body || {}})})));
  return router;
}
