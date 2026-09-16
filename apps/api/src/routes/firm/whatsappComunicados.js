import { Router } from 'express';
import { empresasVisiveis } from './empresasVisiveis.js';
import { criarComunicadosWhatsapp } from '../../application/whatsapp/ComunicadosWhatsappService.js';

export function createWhatsappComunicadosRouter({ servico = criarComunicadosWhatsapp(), escopo = empresasVisiveis, log = console } = {}) {
  const router = Router();
  router.use('/whatsapp/comunicados', (req, res, next) => {
    if (!['admin', 'contador'].includes(String(req.auth?.user?.role).toLowerCase())) return res.status(403).json({ ok: false, message: 'Apenas a equipe do escritório pode gerenciar comunicados.' });
    return next();
  });
  const rota = fn => async (req, res) => {
    try { res.json(await fn(req, await escopo(req))); }
    catch (e) { if (!e.status) log.error({ codigo: e.code }, 'Falha em comunicado WhatsApp'); res.status(e.status || 500).json({ ok: false, message: e.status ? e.message : 'Não foi possível concluir. Atualize o comunicado antes de tentar novamente.' }); }
  };
  router.get('/whatsapp/comunicados', rota((req, ids) => servico.listar(ids, req.query.cursor || null)));
  router.post('/whatsapp/comunicados/previa', rota((req, ids) => servico.audiencia(req.body || {}, ids)));
  router.post('/whatsapp/comunicados', rota((req, ids) => servico.criar(req.body || {}, ids, String(req.auth.user.id))));
  router.get('/whatsapp/comunicados/:id', rota((req, ids) => servico.detalhe(req.params.id, ids)));
  router.post('/whatsapp/comunicados/:id/submeter', rota((req, ids) => servico.submeter(req.params.id, ids)));
  router.post('/whatsapp/comunicados/:id/consultar-aprovacao', rota((req, ids) => servico.consultar(req.params.id, ids)));
  router.post('/whatsapp/comunicados/:id/enviar', rota((req, ids) => servico.confirmar(req.params.id, ids, req.body?.previaHash, String(req.auth.user.id))));
  router.post('/whatsapp/comunicados/:id/cancelar', rota((req, ids) => servico.cancelar(req.params.id, ids)));
  return router;
}
