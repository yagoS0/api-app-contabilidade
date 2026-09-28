import { extrairIbscbsXml } from './projecaoXml.js';

/** Só deriva XML local; não reabre competência, emite nota nem apropria crédito. */
export async function reprocessarIbscbs({ client, portalClientId, aplicar = false, lote = 100 }) {
  if (!portalClientId) throw new Error('portalClientId obrigatório');
  if (!Number.isInteger(lote) || lote < 1 || lote > 500) throw new Error('lote deve estar entre 1 e 500');
  const resultado = { aplicar, lidas: 0, iguais: 0, alterariam: 0, atualizadas: 0, concorrentes: 0, situacoes: {} };
  let cursor;
  for (;;) {
    const rows = await client.portalInvoice.findMany({
      where: { clientId: portalClientId, type: { in: ['NFE', 'NFSE'] } },
      orderBy: { id: 'asc' }, take: lote, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, type: true, xmlRaw: true, ibscbs: true, updatedAt: true },
    });
    if (!rows.length) break;
    for (const row of rows) {
      const ibscbs = extrairIbscbsXml(row.xmlRaw, row.type);
      resultado.lidas++;
      resultado.situacoes[ibscbs.situacao] = (resultado.situacoes[ibscbs.situacao] ?? 0) + 1;
      if (row.ibscbs?.xmlSha256 === ibscbs.xmlSha256 && row.ibscbs?.versaoExtrator === ibscbs.versaoExtrator) { resultado.iguais++; continue; }
      resultado.alterariam++;
      if (!aplicar) continue;
      const r = await client.portalInvoice.updateMany({
        where: { id: row.id, clientId: portalClientId, xmlRaw: row.xmlRaw, updatedAt: row.updatedAt }, data: { ibscbs },
      });
      if (r.count === 1) resultado.atualizadas++; else resultado.concorrentes++;
    }
    cursor = rows[rows.length - 1].id;
  }
  return resultado;
}
