import { Router } from 'express';
import { requireClientCompanyAccess } from '../../middlewares/requireClientCompanyAccess.js';
import { SaldoInicialRecusado, salvarSaldoInicialFluxo } from '../../application/fluxo/SaldoInicialFluxoService.js';

export function saldoInicialFluxoRouter({ client, log } = {}) {
  const router = Router();
  const salvar = remover => async (req, res) => {
    if (req.visitaDoEscritorio) return res.status(403).json({ ok: false, error: 'visita_somente_leitura', message: 'O saldo inicial deve ser informado por um usuário da empresa.' });
    try {
      const saldoInicial = await salvarSaldoInicialFluxo({
        portalClientId: req.params.companyId, usuarioId: req.auth?.user?.id,
        dataReferencia: req.body?.dataReferencia, valor: req.body?.valor, remover, client,
      });
      return res.json({ ok: true, saldoInicial });
    } catch (error) {
      if (error instanceof SaldoInicialRecusado) return res.status(error.status).json({ ok: false, error: error.codigo, message: error.message });
      log?.error?.({ err: error, companyId: req.params.companyId }, 'saldo_inicial_fluxo_falhou');
      return res.status(500).json({ ok: false, error: 'saldo_inicial_falhou', message: 'Não foi possível salvar o saldo inicial. Tente novamente.' });
    }
  };
  router.put('/companies/:companyId/fluxo-de-caixa/saldo-inicial', requireClientCompanyAccess(), salvar(false));
  router.delete('/companies/:companyId/fluxo-de-caixa/saldo-inicial', requireClientCompanyAccess(), salvar(true));
  return router;
}
