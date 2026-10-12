import { Router } from 'express';
import { requireFirmCompanyAccess } from '../../middlewares/requireFirmCompanyAccess.js';
import { criarServicoParametros } from '../../application/nfse/parametrosMunicipaisService.js';
import { diaFiscal } from '../../application/nfse/regimeDaCompetencia.js';

export function createParametrosMunicipaisRouter({ servico = criarServicoParametros(), log } = {}) {
  const router = Router({ mergeParams: true });
  const acesso = requireFirmCompanyAccess({ minRole: 'ACCOUNTANT' });
  const falha = (res, err) => {
    const codigo = String(err?.code || '');
    const conhecida = codigo.startsWith('NFSE_PARAMETROS_') || codigo === 'NO_COMPANY_CERT';
    log?.warn?.({ code: conhecida ? codigo : 'NFSE_PARAMETROS_INDISPONIVEIS' }, 'Consulta municipal indisponível');
    return res.status(codigo === 'NFSE_PARAMETROS_ENTRADA_INVALIDA' ? 400 : codigo === 'NFSE_PARAMETROS_CONFLITO' ? 409 : 503)
      .json({ error: conhecida ? codigo : 'NFSE_PARAMETROS_INDISPONIVEIS', message: conhecida ? err.message : 'Não foi possível acessar a consulta municipal. Confira a configuração da integração.' });
  };
  router.get('/parametros-municipais', acesso, async (req, res) => {
    try { res.json(await servico.listar(String(req.params.companyId))); } catch (err) { falha(res, err); }
  });
  router.get('/parametros-municipais/competencia', acesso, async (req, res) => {
    const { municipio, codigoServico, competencia } = req.query;
    if (Object.keys(req.query).some(k => !['municipio', 'codigoServico', 'competencia'].includes(k))
      || typeof municipio !== 'string' || !/^\d{7}$/.test(municipio)
      || typeof codigoServico !== 'string' || !/^\d{9}$/.test(codigoServico)
      || typeof competencia !== 'string' || !diaFiscal(competencia)) return res.status(400).json({ error: 'NFSE_PARAMETROS_ENTRADA_INVALIDA' });
    try { res.json(await servico.porCompetencia({ portalClientId: String(req.params.companyId), municipio, codigoServico, competencia })); }
    catch (err) { falha(res, err); }
  });
  router.post('/parametros-municipais/consultas', acesso, async (req, res) => {
    const { municipio, recurso, codigoServico, codigoServicoMunicipal, requestKey } = req.body || {};
    if (Object.keys(req.body || {}).some(k => !['municipio', 'recurso', 'codigoServico', 'codigoServicoMunicipal', 'requestKey'].includes(k))) {
      return res.status(400).json({ error: 'NFSE_PARAMETROS_ENTRADA_INVALIDA', message: 'A consulta aceita somente município, recurso, serviço e identificador.' });
    }
    try { res.json(await servico.consultar({ portalClientId: String(req.params.companyId), autorId: String(req.auth.user.id), municipio, recurso, codigoServico, codigoServicoMunicipal, requestKey })); }
    catch (err) { falha(res, err); }
  });
  return router;
}
