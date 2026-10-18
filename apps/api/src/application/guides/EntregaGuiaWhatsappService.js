import { revisaoDocumentoGuia } from '../whatsapp/EnvioDocumentoGuiaWhatsappService.js';
const dataCivil = value => {
  const d = new Date(value || '');
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null;
};

// Aceitação da Meta não é entrega. O recibo pertence a uma tentativa e ao
// documento enviado, não apenas à empresa ou ao último estado do canal.
export async function conferirEntregaGuiaWhatsapp(db, guia, telefone, vinculoNumeroId = null) {
  const tentativas = await db.envioGuiaTentativa.findMany({
    where: {
      envioGuia: { guideId: guia.id, canal: 'WHATSAPP', destino: telefone },
      status: { in: ['entregue', 'lido'] },
      OR: [{ entregueEm: { not: null } }, { lidoEm: { not: null } }],
    },
    select: { arquivoSha256: true, snapshot: true },
  });
  const entregue = guia.hash && tentativas.some(t => {
    const s = t.snapshot;
    // Histórico sem revisão integral continua consultável, mas não comprova a
    // composição atual para uma nova cobrança. Não completar prova por inferência.
    return s?.revisaoDocumento === revisaoDocumentoGuia(guia) && t.arquivoSha256 === guia.hash && s?.guideId === guia.id
      && s.portalClientId === guia.portalClientId && s.telefone === telefone
      && (!vinculoNumeroId || s.vinculoNumeroId === vinculoNumeroId)
      && s.competencia === guia.competencia
      && Number(s.valor) === Number(guia.valor)
      && dataCivil(s.vencimento) === dataCivil(guia.vencimento);
  });
  if (!entregue) throw Object.assign(new Error(
    `Guia sem entrega confirmada da versão atual no WhatsApp final ${telefone.slice(-4)}. Confira o envio da guia; o lembrete não será enviado.`,
  ), { code: 'GUIA_WHATSAPP_NAO_ENTREGUE' });
}
