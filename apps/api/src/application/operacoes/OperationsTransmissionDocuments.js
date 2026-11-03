import { arquivoHistoricoPgdas } from '../fiscal/serpro/PgdasHistoricoService.js';

const fail = (message, status = 422) => Object.assign(new Error(message), { status });
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const money = value => !['number', 'string'].includes(typeof value) || String(value).trim() === '' || !Number.isFinite(Number(value)) ? null : Number(value);
export function validateTransmissionContext(companyId, competencia) {
  if (typeof companyId !== 'string' || !companyId || companyId.length > 100 || !/^\d{4}-(0[1-9]|1[0-2])$/.test(competencia || '')) throw fail('Empresa ou competência inválida.');
}

// Only an immutable history record AND the persisted execution proof establish
// this relationship. The mutable snapshot/circular must never supply old values.
export async function readTransmissionDocuments(db, companyId, competencia) {
  validateTransmissionContext(companyId, competencia);
  const prefix = `operations_execution:${companyId}:${competencia}:`;
  const [executions, history] = await Promise.all([
    db.appSetting.findMany({ where: { key: { startsWith: prefix } }, select: { key: true, value: true }, orderBy: [{ createdAt: 'desc' }, { key: 'desc' }], take: 101 }),
    db.appSetting.findMany({ where: { key: { startsWith: `pgdas_historico:${companyId}:${competencia}:` } }, select: { key: true, value: true }, orderBy: [{ createdAt: 'desc' }, { key: 'desc' }], take: 501 }),
  ]);
  const versions = history.slice(0, 500).filter(r => r.key === `pgdas_historico:${companyId}:${competencia}:${r.value?.id}`).map(r => r.value).filter(v => v?.companyId === companyId && v.competencia === competencia && hash(v.id) && !v.legado);
  const items = [], unavailable = [];
  const confirmations = await db.appSetting.findMany({ where: { key: { startsWith: 'operations_request:' }, value: { path: ['companyId'], equals: companyId } }, orderBy: [{ createdAt: 'desc' }, { key: 'desc' }], take: 101 });
  const confirmed = confirmations.slice(0,100).map(r => r.value).find(v => v?.companyId === companyId && v.competencia === competencia && v.action === 'confirm'
    && v.result?.companyId === companyId && v.result?.competencia === competencia && v.result?.status === 'CONFIRMED' && v.result?.changedAt && v.userId && v.result?.fingerprint);
  const confirmation = confirmed ? { at: confirmed.result.changedAt, by: confirmed.userId, fingerprint: confirmed.result.fingerprint } : null;
  for (const record of executions.slice(0, 100)) {
    const execution = record.value, proof = execution?.evolucaoDocumental, document = proof?.documento;
    if (execution?.companyId !== companyId || execution.competencia !== competencia) continue;
    const valid = typeof proof?.releaseId === 'string' && proof.releaseId && record.key === prefix + proof.releaseId
      && typeof proof.calculoId === 'string' && proof.calculoId && hash(proof.proofHash)
      && document?.portalClientId === companyId && document.competencia === competencia
      && typeof document.numeroDeclaracao === 'string' && document.numeroDeclaracao && typeof document.declaracaoFileId === 'string' && document.declaracaoFileId;
    const matches = valid ? versions.filter(v => String(v.numeroDeclaracao) === String(document.numeroDeclaracao)
      && v.declaracaoFileId === document.declaracaoFileId && (v.reciboFileId || null) === (document.reciboFileId || null)) : [];
    if (matches.length !== 1) {
      unavailable.push({ estado: 'INDISPONIVEL', motivo: 'Vínculo imutável entre execução, revisão e documentos não comprovado.' });
      continue;
    }
    const version = matches[0];
    items.push({ companyId, competencia, releaseId: proof.releaseId, calculoId: proof.calculoId, proofHash: proof.proofHash,
      versionId: version.id, numeroDeclaracao: version.numeroDeclaracao, receitaBruta: money(version.receitaBruta), dasTotal: money(version.dasTotal),
      registradaEm: proof.recordedAt || null, estadoExecucao: execution.status || null,
      documentos: { extrato: Boolean(version.declaracaoFileId), recibo: Boolean(version.reciboFileId) } });
  }
  return { companyId, competencia, items, unavailable, confirmation, limitado: executions.length > 100 || history.length > 500 || confirmations.length > 100 };
}

export async function downloadTransmissionDocument(db, storage, selection) {
  const { companyId, competencia, releaseId, versionId, tipo = 'extrato' } = selection || {};
  validateTransmissionContext(companyId, competencia);
  if (!hash(versionId) || typeof releaseId !== 'string' || !['extrato', 'recibo'].includes(tipo)) throw fail('Seleção documental inválida.');
  const data = await readTransmissionDocuments(db, companyId, competencia);
  const item = data.items.find(i => i.releaseId === releaseId && i.versionId === versionId);
  if (!item || !item.documentos[tipo]) throw fail('Documento desta revisão indisponível.', 404);
  const key = await arquivoHistoricoPgdas(companyId, competencia, versionId, tipo === 'extrato' ? 'declaracao' : 'recibo', db);
  if (!key) throw fail('Documento desta revisão indisponível.', 404);
  let buffer;
  try { buffer = await storage.downloadBuffer({ key }); } catch { throw fail('Arquivo armazenado indisponível.', 404); }
  if (!Buffer.isBuffer(buffer) || buffer.length > 8 * 1024 * 1024 || buffer.subarray(0, 5).toString() !== '%PDF-' || !buffer.subarray(-1024).includes(Buffer.from('%%EOF'))) throw fail('PDF ausente, inválido ou acima de 8 MiB.', 422);
  try {
    const parse = (await import('pdf-parse')).default;
    // pdf.js antigo espera Uint8Array.slice copiando; Buffer.slice compartilha a memória.
    // A cópia preserva os bytes originais entregues ao usuário e evita corrupção no parser.
    const pdf = await parse(new Uint8Array(buffer));
    if (!Number.isInteger(pdf.numpages) || pdf.numpages < 1) throw Error('PDF sem páginas.');
  } catch { throw fail('Não foi possível validar o PDF armazenado.', 422); }
  const fresh = await readTransmissionDocuments(db, companyId, competencia);
  if (!fresh.items.some(i => i.releaseId === releaseId && i.versionId === versionId && JSON.stringify(i) === JSON.stringify(item))) throw fail('O vínculo documental mudou. Confira novamente.', 409);
  return { buffer, item, tipo };
}

// Caller supplies an authorization check for EACH item. Never put a denied
// identity, raw storage error or storage key in the returned manifest.
export async function prepareTransmissionArchive(db, storage, selections, authorize) {
  if (!Array.isArray(selections) || !selections.length || selections.length > 30) throw fail('Selecione de 1 a 30 documentos.');
  const identities = selections.map(i => JSON.stringify([i?.companyId, i?.competencia, i?.releaseId, i?.versionId, i?.tipo || 'extrato']));
  if (new Set(identities).size !== identities.length) throw fail('Documento repetido na seleção.');
  const files = [], results = [];
  let bytes = 0;
  for (const [index, selection] of selections.entries()) {
    if (!selection || !await authorize(selection.companyId)) { results.push({ item: index + 1, status: 'INDISPONIVEL' }); continue; }
    const identity = { item: index + 1, companyId: selection.companyId, competencia: selection.competencia, versionId: selection.versionId, tipo: selection.tipo || 'extrato' };
    try {
      const { buffer } = await downloadTransmissionDocument(db, storage, selection);
      if (bytes + buffer.length > 32 * 1024 * 1024) throw fail('Limite total de 32 MiB excedido.');
      if (!await authorize(selection.companyId)) { results.push({ item: index + 1, status: 'INDISPONIVEL' }); continue; }
      const name = `${index + 1}-${String(selection.companyId).replace(/[^a-z0-9_-]/gi, '_')}-${selection.competencia}-${identity.tipo}.pdf`;
      files.push({ name, buffer }); bytes += buffer.length;
      results.push({ ...identity, status: 'INCLUIDO', arquivo: name });
    } catch { results.push({ ...identity, status: 'INDISPONIVEL', motivo: 'Arquivo, vínculo ou limite de tamanho indisponível.' }); }
  }
  return { files, manifest: { completo: results.every(r => r.status === 'INCLUIDO'), solicitados: selections.length, incluidos: files.length, results } };
}
