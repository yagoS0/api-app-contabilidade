import { possuiProvaEntregaGuiaWhatsapp } from '../domain/provaEntregaGuiaWhatsapp.js';

export async function conferirEntregaGuiaWhatsapp(guia, telefone, vinculoNumeroId, { lerTentativas, revisaoDocumentoGuia }) {
  const tentativas = await lerTentativas(guia, telefone);
  const entregue = possuiProvaEntregaGuiaWhatsapp(tentativas, guia, telefone, vinculoNumeroId, revisaoDocumentoGuia);
  if (!entregue) throw Object.assign(new Error(
    `Guia sem entrega confirmada da versão atual no WhatsApp final ${telefone.slice(-4)}. Confira o envio da guia; o lembrete não será enviado.`,
  ), { code: 'GUIA_WHATSAPP_NAO_ENTREGUE' });
}
