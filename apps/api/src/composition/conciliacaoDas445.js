import { consultarConciliacaoDas445 } from '../modules/operations/publicConciliacaoDas445.js';
import { projetarFiscal445 } from '../modules/fiscal/publicConciliacaoDas445.js';
import { projetarGuias445 } from '../modules/guides/publicConciliacaoDas445.js';
import { projetarContabilidade445 } from '../modules/accounting/publicConciliacaoDas445.js';
import { criarLeiturasFiscais445 } from '../modules/fiscal/infrastructure/prisma/leituraConciliacaoDas445.js';
import { criarLeiturasGuias445 } from '../modules/guides/infrastructure/prisma/leituraConciliacaoDas445.js';
import { criarLeiturasContabeis445 } from '../modules/accounting/infrastructure/prisma/leituraConciliacaoDas445.js';
import { criarLeiturasOperacionais445 } from '../modules/operations/infrastructure/prisma/leituraConciliacaoDas445.js';
import { autorizarLeituraConciliacaoDas445 } from '../infrastructure/security/autorizarLeituraConciliacaoDas445.js';

// Internal entry only. The authenticated server session is a separate argument, not a DTO field.
export function consultarConciliacaoDas445Interna(input, { auth } = {}) {
  return consultarConciliacaoDas445(input, {
    autorizar: companyId => autorizarLeituraConciliacaoDas445(companyId, auth),
    projetarFiscal: projetarFiscal445, projetarGuias: projetarGuias445, projetarContabilidade: projetarContabilidade445,
    ...criarLeiturasFiscais445(), ...criarLeiturasGuias445(), ...criarLeiturasContabeis445(), ...criarLeiturasOperacionais445(),
  });
}
