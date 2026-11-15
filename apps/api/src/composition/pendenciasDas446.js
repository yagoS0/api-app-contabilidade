import { consultarConciliacaoDas445Interna } from './conciliacaoDas445.js';
import { apresentarPendenciasDas446 } from '../modules/operations/publicPendenciasDas446.js';

export async function consultarPendenciasDas446(input, { auth } = {}) {
  return apresentarPendenciasDas446(await consultarConciliacaoDas445Interna(input, { auth }));
}
