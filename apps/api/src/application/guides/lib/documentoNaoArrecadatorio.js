import { STATUS_DOCUMENTO, exigirGuiaArrecadatoria } from '../../../modules/guides/domain/classificacaoDocumento.js';
export { STATUS_DOCUMENTO, PREFIXO_DOCUMENTO, documentoNaoArrecadatorio, exigirGuiaArrecadatoria } from '../../../modules/guides/domain/classificacaoDocumento.js';

// O UPDATE sem mudança material obtém o lock de linha usado também pela reclassificação.
// Chamadores devem manter esta trava na mesma transação que grava o efeito/reserva.
export async function travarGuiaArrecadatoria(tx, guideId, portalClientId) {
  const guia = await tx.guide.findFirst({ where: { id: String(guideId), ...(portalClientId ? { portalClientId } : {}) } });
  if (!guia) throw Object.assign(new Error('Guia não encontrada.'), { code: 'guide_not_found', status: 404 });
  exigirGuiaArrecadatoria(guia);
  const lock = await tx.guide.updateMany({ where: { id: guia.id, updatedAt: guia.updatedAt, status: { not: STATUS_DOCUMENTO } }, data: { updatedAt: guia.updatedAt } });
  if (lock.count !== 1) throw Object.assign(new Error('A guia mudou. Atualize a prévia.'), { code: 'GUIA_ALTERADA', status: 409 });
  const atual = await tx.guide.findUnique({ where: { id: guia.id } });
  exigirGuiaArrecadatoria(atual);
  return atual;
}
