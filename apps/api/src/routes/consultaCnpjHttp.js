import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { consultarCnpjComCache, repositorioConsultaCnpj } from '../application/tomador/consultaCnpjRuntime.js';
import { municipiosIbgeOuNulo } from '../application/nfse/lote/municipiosIbge.js';

// Router pai autentica; middleware da empresa é obrigatório no emissor.
export function criarRotasConsultaCnpj({ empresaAccess, permitirCadastro = false, consultar = consultarCnpjComCache,
  lerConsumo = () => repositorioConsultaCnpj.consumo() } = {}) {
  const router = Router();
  const limite = rateLimit({ windowMs: 60000, max: 30, standardHeaders: true, legacyHeaders: false });
  const handler = finalidade => async (req, res) => {
    if (!req.auth?.user?.id) return res.status(401).json({ ok: false });
    if (!req.body || Object.keys(req.body).some(k => k !== 'cnpj') || typeof req.body.cnpj !== 'string' || req.body.cnpj.length > 30) return res.status(400).json({ ok: false, motivo: 'entrada_invalida' });
    res.set('Cache-Control', 'no-store');
    try {
      const escopo = finalidade === 'EMISSOR' ? `empresa:${req.params.companyId}` : `conta:${req.auth.user.id}`;
      return res.json(await consultar(req.body.cnpj, { escopo, finalidade, municipios: await municipiosIbgeOuNulo({}) }));
    } catch { return res.status(503).json({ ok: false, motivo: 'indisponivel', mensagem: 'Consulta indisponível. Preencha os dados manualmente.' }); }
  };
  if (empresaAccess) router.post('/companies/:companyId/consulta-cnpj', empresaAccess, limite, handler('EMISSOR'));
  if (permitirCadastro) {
    router.post('/cadastro/consulta-cnpj', limite, handler('PUBLICO'));
    router.post('/cadastro/consulta-cnpj-completa', limite, handler('CADASTRO'));
    router.get('/cadastro/consumo-cnpj', async (req, res) => {
      if (String(req.auth?.user?.role).toLowerCase() !== 'admin') return res.sendStatus(403);
      res.set('Cache-Control', 'no-store');
      try { return res.json({ pagoHabilitadoNoRuntime: false, consumo: await lerConsumo() }); }
      catch { return res.status(503).json({ ok: false, motivo: 'consumo_indisponivel' }); }
    });
  }
  return router;
}
