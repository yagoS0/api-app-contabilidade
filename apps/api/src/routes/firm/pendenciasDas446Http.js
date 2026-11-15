import { consultarPendenciasDas446 } from '../../composition/pendenciasDas446.js';

export function criarHandlerPendenciasDas446(consultar = consultarPendenciasDas446) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    try {
      const query = req.query || {};
      if (Object.entries(query).some(([key, value]) => !['servico','documentoId','limit'].includes(key) || typeof value !== 'string' || !value.length)
        || (query.limit != null && !/^(?:[1-9]\d?|100)$/.test(query.limit))) throw Object.assign(new Error(), { code: 'ENTRADA_INVALIDA' });
      const input = { companyId: req.params.companyId, competencia: req.params.competencia };
      for (const key of ['servico','documentoId','limit']) if (query[key] != null) input[key] = key === 'limit' ? Number(query[key]) : query[key];
      res.json({ ok: true, ...await consultar(input, { auth: req.auth }) });
    } catch (error) {
      const status = error.code === 'ENTRADA_INVALIDA' ? 400 : error.code === 'ACESSO_NEGADO' ? (error.status === 401 ? 401 : 403) : 503;
      res.status(status).json({ ok: false, message: status === 400 ? 'Parâmetros inválidos para esta leitura.' : status === 401 ? 'Sessão necessária para consultar evidências.' : status === 403 ? 'Leitura desta empresa não autorizada.' : 'Não foi possível consultar as evidências locais. Nenhuma retentativa foi realizada.' });
    }
  };
}
