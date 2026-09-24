import crypto from 'node:crypto';
import { JWT_SECRET } from '../../config.js';
export function authDigest(value) {
  if (!JWT_SECRET) throw new Error('auth_not_configured');
  return crypto.createHmac('sha256', JWT_SECRET).update(value).digest('hex');
}
export const versaoCredencial = user => authDigest(`credential:${user.id}:${user.passwordHash}`);
export async function transacaoAuth(client, fn) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try { return await client.$transaction(fn, { isolationLevel: 'Serializable', timeout: 10000 }); }
    catch (error) { if (!['P2034', 'P2002'].includes(error.code) || attempt === 3) throw error; }
  }
}
