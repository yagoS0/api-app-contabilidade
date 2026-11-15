import { avaliarElegibilidadeRecuperacaoDas448 as avaliar } from '../modules/operations/publicPreviaRecuperacaoDas448.js';
import { consultarConciliacaoDas445Interna } from './conciliacaoDas445.js';
import { criarLeituraHistoricoDas448 } from '../modules/guides/infrastructure/prisma/leituraHistoricoDas448.js';
import { autorizarLeituraConciliacaoDas445 } from '../infrastructure/security/autorizarLeituraConciliacaoDas445.js';

// Server-only internal composition. Never forward consumer data as auth.
export function avaliarElegibilidadeRecuperacaoDas448(input, { auth } = {}) {
  return avaliar(input, {
    autorizar: companyId => autorizarLeituraConciliacaoDas445(companyId, auth),
    consultarContexto: args => consultarConciliacaoDas445Interna(args, { auth }),
    lerHistorico: criarLeituraHistoricoDas448(),
  });
}
