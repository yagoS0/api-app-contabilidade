import { Router } from 'express';
import { requireFirmCompanyAccess } from '../../middlewares/requireFirmCompanyAccess.js';
import { consultarGestaoParcelamento, preverCorrecaoParcelamento, corrigirParcelamento, GestaoParcelamentoError } from '../../application/accounting/parcelamento/GestaoParcelamentoService.js';
import { preverBaixaGestao, executarBaixaGestao } from '../../application/accounting/parcelamento/BaixaGestaoParcelamentoService.js';
import { candidatosConciliacao, preverConciliacao, executarConciliacao } from '../../application/accounting/parcelamento/ConciliacaoGestaoParcelamentoService.js';

export function createGestaoParcelamentoRouter({ log } = {}) {
  const router = Router({ mergeParams: true });
  const base = '/companies/:companyId/parcelamentos/:parcelamentoId/gestao';
  const guard = requireFirmCompanyAccess({ minRole: 'ACCOUNTANT' });
  const run = fn => async (req, res) => {
    try {
      return res.json(await fn({ ...req.params, referencia: req.query.referencia,
        alteracao: req.body?.alteracao, baixa: req.body?.baixa, conciliacao: req.body?.conciliacao,
        confirmacao: req.body?.confirmacao, userId: req.auth.user.id }));
    } catch (e) {
      const known = e instanceof GestaoParcelamentoError;
      if (!known) log?.error?.({ code: e.code }, 'Falha na gestão de parcelamento');
      return res.status(known ? e.status : 500).json({ error: known ? e.code : 'erro_interno', message: known ? e.message : 'Não foi possível concluir a operação.' });
    }
  };
  router.get(base, guard, run(consultarGestaoParcelamento));
  router.post(`${base}/correcao/previa`, guard, run(preverCorrecaoParcelamento));
  router.post(`${base}/correcao`, guard, run(corrigirParcelamento));
  router.get(`${base}/conciliacao/candidatos`, guard, run(async args => { await consultarGestaoParcelamento(args); return (await candidatosConciliacao(args)).map(({entries,...g})=>g); }));
  router.post(`${base}/conciliacao/previa`, guard, run(async args => { const {confirmacao,conferencia,pedido,grupo}=await preverConciliacao(args); return {confirmacao,conferencia,pedido,lancamentosVinculados:grupo?.ids.length||0,lancamentosCriados:0}; }));
  router.post(`${base}/conciliacao`, guard, run(executarConciliacao));
  router.post(`${base}/parcelas/:parcelaId/baixa/previa`, guard, run(async args => {
    const { base: _, ...preview } = await preverBaixaGestao(args);
    return preview;
  }));
  router.post(`${base}/parcelas/:parcelaId/baixa`, guard, run(executarBaixaGestao));
  return router;
}
