import { bloquearDocumentosDaEmpresa } from './persistirDocumentoNota.js';
import { camposDataEmissao, evidenciaDaNota, hashXml } from './dataEmissaoNota.js';

/** Read only by default; caller supplies a scoped client, never an external document search. */
export async function reconciliarDatasNotas(prisma, { clientId, ids, aplicar = false, confirmarBancoDescartavel = false } = {}) {
  if (!clientId || !Array.isArray(ids) || !ids.length || ids.length > 1000 || ids.some(id => typeof id !== 'string' || !id)) throw Error('Escopo explícito obrigatório (empresa e até 1000 IDs).');
  if (aplicar && !confirmarBancoDescartavel) throw Error('Escrita permitida apenas em banco local descartável confirmado.');
  if (aplicar && typeof prisma.$transaction === "function") return prisma.$transaction(tx => reconciliarDatasNotas(tx, { clientId, ids, aplicar, confirmarBancoDescartavel }));
  if (aplicar) await bloquearDocumentosDaEmpresa(prisma, clientId);
  const portal = prisma.portalClient?.findUnique
    ? await prisma.portalClient.findUnique({ where: { id: clientId }, select: { cnpj: true } }) : null;
  const rows = await prisma.portalInvoice.findMany({ where: { clientId, id: { in: [...new Set(ids)] } }, orderBy: { id: 'asc' } });
  const encontrados = new Set(rows.map(n => n.id));
  const resultados = ids.filter(id => !encontrados.has(id)).map(id => ({ id, clientId, estado: 'NAO_ENCONTRADA_NO_ESCOPO' }));
  for (const row of rows) {
    if (row.clientId !== clientId) throw Error('Fonte fora do escopo.');
    const xml = row.xmlRaw || row.xmlResumo || null;
    const evidencia = evidenciaDaNota(row, { documentoEmpresa: portal?.cnpj });
    if (evidencia.motivo === "IDENTIDADE_DIVERGENTE") {
      resultados.push({ id: row.id, clientId, hash: evidencia.hash, estado: 'IDENTIDADE_DIVERGENTE' });
      continue;
    }
    const before = row.dataEmissaoEvidencia || null;
    const result = { id: row.id, clientId, hash: xml ? hashXml(xml) : null, hashAnterior: before?.hash || null, anterior: row.dataEmissaoCivil || null,
      proposta: evidencia.civil || null, motivo: evidencia.motivo, estado: 'INDETERMINADA' };
    // Never replace stronger evidence with a summary, including on repeated backfills.
    if (before && !before.motivo && before.forca > evidencia.forca) result.estado = 'FONTE_MAIS_FORTE_PRESERVADA';
    else if (!evidencia.motivo) {
      const data = camposDataEmissao({ ...evidencia, ...(before?.historico ? { historico: before.historico } : {}) });
      const igual = row.dataEmissaoCivil === data.dataEmissaoCivil && before?.hash === evidencia.hash
        && before?.versaoExtrator === evidencia.versaoExtrator && before?.caminho === evidencia.caminho;
      result.estado = igual ? 'SEM_ALTERACAO' : 'DIFERENCA';
      if (aplicar && !igual) {
        // Compare source and row revision atomically; never update issueDate/competencia/closing.
        const written = await prisma.portalInvoice.updateMany({ where: { id: row.id, clientId,
          chaveAcesso: row.chaveAcesso ?? null, idDps: row.idDps ?? null, idNfse: row.idNfse ?? null,
          provenienciaDfe: row.provenienciaDfe ? { equals: row.provenienciaDfe } : undefined,
          updatedAt: row.updatedAt, xmlRaw: row.xmlRaw ?? null, xmlResumo: row.xmlResumo ?? null }, data });
        result.estado = written.count === 1 ? 'APLICADA' : 'FONTE_ALTERADA';
      }
    }
    resultados.push(result);
  }
  const contagens = resultados.reduce((out, r) => ({ ...out, [r.estado]: (out[r.estado] || 0) + 1 }), {});
  return { dryRun: !aplicar, clientId, ids: [...new Set(ids)], contagens, resultados };
}
