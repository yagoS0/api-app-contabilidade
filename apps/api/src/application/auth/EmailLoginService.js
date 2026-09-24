import crypto from 'node:crypto';
import { prisma } from '../../infrastructure/db/prisma.js';
import { authDigest, versaoCredencial, transacaoAuth } from './credentialSecurity.js';
import { ClientSessionService } from './ClientSessionService.js';
import { EmailService } from '../../infrastructure/mail/EmailService.js';

export const CODE_TTL_SECONDS = 600;
export const RESEND_SECONDS = 60;
const WINDOW_MS = 60 * 60 * 1000;
export const normalizarEmailAcesso = value => typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) ? value.trim().toLowerCase() : null;
async function elegivel(tx, user) {
  const membership = await tx.companyClientUser.findFirst({ where: { userId: user?.id || 'email-login-without-user', status: 'ACTIVE' }, select: { userId: true } });
  return Boolean(user && user.status === 'active' && user.accountType === 'CLIENT' && !['admin','contador'].includes(user.role) && membership);
}

// Um registro por endereço normalizado, inclusive para endereços desconhecidos.
// Códigos têm hash com segredo do servidor; o banco nunca recebe o código em claro.
export class EmailLoginService {
  static async solicitar(email, { client = prisma, now = new Date() } = {}) {
    const address = normalizarEmailAcesso(email);
    if (!address) throw new Error('email_invalid');
    const emailKey = authDigest(`email-login:${address}`);
    const challengeId = crypto.randomBytes(32).toString('hex');
    const code = String(crypto.randomInt(0, 100000000)).padStart(8, '0');
    return transacaoAuth(client, async tx => {
      const previous = await tx.emailLoginChallenge.findUnique({ where: { emailKey } });
      const sameWindow = previous && now - previous.windowStartedAt < WINDOW_MS;
      if (previous && (now - previous.sentAt < RESEND_SECONDS * 1000 || (sameWindow && previous.sentCount >= 5))) {
        // Não revelar se há conta/código ativo, nem devolver o desafio de outro navegador.
        return { challengeId, expiresIn: CODE_TTL_SECONDS, resendAfter: RESEND_SECONDS };
      }
      const user = await tx.user.findUnique({ where: { email: address } });
      const allowed = await elegivel(tx, user);
      const data = { challengeId, userId: allowed ? user.id : null,
        credentialVersion: allowed ? versaoCredencial(user) : null,
        codeHash: authDigest(`email-code:${challengeId}:${code}`), attempts: 0, usedAt: null,
        expiresAt: new Date(now.getTime() + CODE_TTL_SECONDS * 1000), sentAt: now,
        windowStartedAt: sameWindow ? previous.windowStartedAt : now,
        sentCount: sameWindow ? previous.sentCount + 1 : 1 };
      await tx.emailLoginChallenge.upsert({ where: { emailKey }, create: { emailKey, ...data }, update: data });
      return { challengeId, expiresIn: CODE_TTL_SECONDS, resendAfter: RESEND_SECONDS,
        delivery: allowed ? { to: user.email, code } : null };
    });
  }

  static async confirmar(challengeId, code, { client = prisma, now = new Date(), deviceLabel } = {}) {
    if (typeof challengeId !== 'string' || !/^[a-f0-9]{64}$/.test(challengeId) || typeof code !== 'string' || !/^\d{8}$/.test(code)) return null;
    return transacaoAuth(client, async tx => {
      const item = await tx.emailLoginChallenge.findUnique({ where: { challengeId } });
      if (!item || item.usedAt || item.expiresAt <= now || item.attempts >= 5) return null;
      await tx.emailLoginChallenge.update({ where: { emailKey: item.emailKey }, data: { attempts: { increment: 1 } } });
      const candidate = Buffer.from(authDigest(`email-code:${challengeId}:${code}`), 'hex');
      if (!crypto.timingSafeEqual(candidate, Buffer.from(item.codeHash, 'hex'))) return null;
      const user = item.userId ? await tx.user.findUnique({ where: { id: item.userId } }) : null;
      if (!await elegivel(tx, user) || item.emailKey !== authDigest(`email-login:${user.email.trim().toLowerCase()}`) || item.credentialVersion !== versaoCredencial(user)) return null;
      await tx.emailLoginChallenge.update({ where: { emailKey: item.emailKey }, data: { usedAt: now } });
      const session = await ClientSessionService.createSession(user.id, { deviceLabel, client: tx });
      return { user: { ...user, sessionId: session.sessionId }, refreshToken: session.refreshToken };
    });
  }
}

export async function enviarCodigoAcesso({ to, code }) {
  if (!/^\d{8}$/.test(code)) throw new Error('invalid_code');
  await new EmailService().send({ to, sensitive: true, subject: 'Seu código de acesso — Altan Contabilidade',
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;line-height:1.6"><h2>Acesse seu portal</h2><p>Digite este código na tela em que solicitou o acesso:</p><p style="font-size:30px;letter-spacing:5px;font-weight:bold">${code}</p><p>Válido por 10 minutos e para um único acesso. Não compartilhe este código, nem com alguém que diga ser do escritório.</p><p>Se você não solicitou o acesso, ignore esta mensagem. Sua senha não foi alterada.</p><p>Altan Contabilidade</p></div>` });
}
