import { revisaoDocumentoGuia } from '../application/whatsapp/EnvioDocumentoGuiaWhatsappService.js';
import { conferirEntregaGuiaWhatsapp as conferir } from '../modules/communication/public.js';
import { lerTentativasEntregaGuia } from '../modules/communication/infrastructure/prisma/leituraTentativasEntregaGuia.js';

export function conferirEntregaGuiaWhatsapp(db, guia, telefone, vinculoNumeroId = null) {
  return conferir(guia, telefone, vinculoNumeroId, {
    lerTentativas: (g, t) => lerTentativasEntregaGuia(db, g, t),
    revisaoDocumentoGuia,
  });
}
