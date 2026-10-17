import { createHash } from 'node:crypto';

export const AUDITORIA_PREFIX = 'contabil:audit:v1:';
export const jsonSnapshot = (value) => JSON.parse(JSON.stringify(value ?? null));
export function hashSnapshot(value) {
  const ordenar = (v) => Array.isArray(v) ? v.map(ordenar) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, ordenar(v[k])])) : v;
  return createHash('sha256').update(JSON.stringify(ordenar(jsonSnapshot(value)))).digest('hex');
}

// Eventos nunca são atualizados. A unicidade da chave aborta duplicação na transação chamadora.
export async function appendEventoTx(tx, { tipo, companyId, entidadeId, chaveEvento, autor, antes = null, depois = null, metadados = {} }) {
  if (!tipo || !companyId || !entidadeId || !chaveEvento || !autor) throw new Error('auditoria_identidade_obrigatoria');
  const key = `${AUDITORIA_PREFIX}${encodeURIComponent(companyId)}:${hashSnapshot([tipo, entidadeId, chaveEvento])}`;
  const evento = jsonSnapshot({ id: key, tipo, companyId, entidadeId, chaveEvento, autor, em: new Date(), antes, depois, metadados });
  await tx.appSetting.create({ data: { key, value: evento } });
  return evento;
}

export async function listarEventosContabeis(client, companyId) {
  const rows = await client.appSetting.findMany({ where: { key: { startsWith: `${AUDITORIA_PREFIX}${encodeURIComponent(companyId)}:` } }, orderBy: { createdAt: 'asc' } });
  return rows.map((r) => r.value).filter((e) => e?.companyId === companyId);
}
