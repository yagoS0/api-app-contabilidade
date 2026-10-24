import { camposDataEmissao, evidenciaDaNota, extrairDataEmissao, normalizarChaveDocumental } from './dataEmissaoNota.js';
import { lerEnvelopeXml } from '../nfse/lerEnvelopeXml.js';

export const conflitoDocumental = () => Object.assign(new Error('Identidades documentais contraditórias; conferir a fonte recusada.'), { code: 'IDENTIDADE_DOCUMENTAL_CONFLITANTE' });
export function chaveCanonica(value) {
  return normalizarChaveDocumental(value, 'NFSE_NACIONAL') || normalizarChaveDocumental(value, 'NFE_COMPLETA') || String(value || '').trim() || null;
}
const fonte = nota => extrairDataEmissao(lerEnvelopeXml(nota?.xmlRaw || nota?.xmlResumo || nota?.xml).xml);
export function conferirIdentidadeDocumento(existing, incoming) {
  const old = fonte(existing), next = fonte(incoming);
  const keys = [existing?.chaveAcesso, incoming?.chaveAcesso, old.identidade, next.identidade].filter(Boolean).map(chaveCanonica);
  if (new Set(keys).size > 1) throw conflitoDocumental();
  for (const key of ['idDps', 'idNfse']) {
    if (existing?.[key] && incoming?.[key] && String(existing[key]).trim() !== String(incoming[key]).trim()) throw conflitoDocumental();
  }
  return { old, next };
}

// All writers and reconciliation share one transaction-scoped lock per tenant.
// Legacy DPS/number/key aliases may identify the same row.
export async function bloquearDocumentosDaEmpresa(tx, clientId) {
  if (typeof tx.$queryRaw === 'function') {
    const key = `documentos-notas:${clientId}`;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))::text AS lock_result`;
  }
}

// Source and derived evidence are selected together and written atomically.
export function prepararDocumentoNota(existing, incoming, documentoEmpresa = null) {
  const identities = conferirIdentidadeDocumento(existing, incoming);
  const next = evidenciaDaNota(incoming, { documentoEmpresa });
  const previous = existing ? evidenciaDaNota(existing, { documentoEmpresa }) : null;
  const history = existing?.dataEmissaoEvidencia?.historico;
  if (history) { next.historico = history; if (previous) previous.historico = history; }
  const conflict = previous && !previous.motivo && !next.motivo && previous.forca === next.forca
    && previous.civil !== next.civil;
  const semIgualdade = Boolean((existing?.xmlRaw || existing?.xmlResumo) && (incoming?.xmlRaw || incoming?.xmlResumo)
    && (!identities.old.identidade || identities.old.identidade !== identities.next.identidade));
  const retain = Boolean(existing && (next.motivo || conflict || semIgualdade || (!previous?.motivo && previous.forca > next.forca)));
  if (retain) previous.fonteRecusada = { hash: next.hash, motivo: next.motivo || (conflict ? 'FONTES_CONFLITANTES' : 'FONTE_MAIS_FRACA'), civil: next.civil };
  if (retain) return { xmlRaw: existing.xmlRaw ?? null, xmlResumo: existing.xmlResumo ?? null,
    provenienciaDfe: existing.provenienciaDfe || {},
    ...camposDataEmissao(previous), documentoPreservado: true };
  return { xmlRaw: incoming.xmlRaw ?? null, xmlResumo: incoming.xmlResumo ?? null,
    provenienciaDfe: incoming.provenienciaDfe || {},
    ...camposDataEmissao(next), documentoPreservado: false };
}
