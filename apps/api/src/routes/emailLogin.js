import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { EmailLoginService, enviarCodigoAcesso, normalizarEmailAcesso } from '../application/auth/EmailLoginService.js';
import { mailerConfigurado } from '../application/auth/PasswordResetService.js';

export function createEmailLoginRouter({ AuthService, log, service = EmailLoginService, send = enviarCodigoAcesso, mailReady = mailerConfigurado }) {
  const router = Router();
  const limiter = max => rateLimit({ windowMs: 15 * 60 * 1000, max, standardHeaders: true, legacyHeaders: false, message: { error: 'too_many_requests' } });
  router.post('/email-code/request', limiter(5), async (req,res) => {
    res.set('Cache-Control','no-store');
    if (!AuthService.isEnabled() || !mailReady()) return res.status(503).json({ error: 'mail_not_configured' });
    const email = normalizarEmailAcesso(req.body?.email);
    if (!email) return res.status(400).json({ error: 'email_invalid' });
    try {
      const { delivery, ...publicResult } = await service.solicitar(email);
      // Resposta independente da existência da conta e do tempo do provedor de e-mail.
      res.json({ ok: true, ...publicResult, message: 'Se este e-mail tiver acesso ativo, você receberá um código. Confira também o spam.' });
      if (delivery) await send(delivery);
    } catch {
      // Não registrar corpo, código, destinatário ou erro bruto do transporte.
      log.error('Falha na solicitação de código de acesso');
      if (!res.headersSent) res.status(503).json({ error: 'login_code_unavailable' });
    }
  });
  router.post('/email-code/verify', limiter(20), async (req,res) => {
    res.set('Cache-Control','no-store');
    if (!AuthService.isEnabled()) return res.status(503).json({ error: 'auth_not_configured' });
    try {
      const result = await service.confirmar(req.body?.challengeId, req.body?.code, { deviceLabel: req.headers['x-device-label'] });
      if (!result) return res.status(401).json({ error: 'invalid_login_code' });
      const { user, refreshToken } = result;
      return res.json({ accessToken: AuthService.generateToken(user), refreshToken,
        user: { id: user.id, name: user.name || null, role: user.role, accountType: 'CLIENT', defaultClientId: null, podeAbrirPortalDoCliente: false } });
    } catch {
      log.error('Falha na confirmação de código de acesso');
      return res.status(503).json({ error: 'login_code_unavailable' });
    }
  });
  return router;
}
