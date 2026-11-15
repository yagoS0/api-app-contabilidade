import { buildPgdasGuidePayload } from './interpretacaoDas.js';

export const SERVICOS_DAS_445 = ['GERARDAS12', 'GERARDASCOBRANCA17'];
const hash = v => typeof v === 'string' && /^[a-f0-9]{64}$/i.test(v) ? v : null;
const numero = v => typeof v === 'string' && /^\d{15,25}$/.test(v) ? v : null;
export function evidenciaChamada445(r) {
  return { id: r.id, assinatura: hash(r.assinatura), servico: SERVICOS_DAS_445.includes(r.idServico) ? r.idServico : null,
    estadoLocal: ['reservada','incerta','ok','erro','abortada_auth','abortada_politica','recusada_cooldown','recusada_teto'].includes(r.status) ? r.status : 'desconhecido',
    httpStatus: Number.isInteger(r.httpStatus) ? r.httpStatus : null, registradaEm: r.createdAt };
}

// Pure legacy interpretation only: no parser, storage, cache helper or writer is called.
// A response can confirm local content, never present-day fiscal validity or safe retry.
export function evidenciaCache445(r, { competencia, agora }) {
  const base = { assinatura: hash(r.chave), expiraEm: r.expiraEm, vigente: new Date(r.expiraEm).getTime() > agora.getTime() };
  try {
    const parsed = buildPgdasGuidePayload({ response: r.resposta, competencia, contribuinteCnpj: null });
    return { ...base, interpretacao: 'DOCUMENTO_NA_RESPOSTA_LOCAL', numeroDocumento: numero(parsed.numeroDocumento),
      valor: parsed.parsed.valor == null ? null : String(parsed.parsed.valor), pdfNaResposta: parsed.pdfBuffer.length > 0 };
  } catch (e) {
    const known = ['SERPRO_PGDASD_NO_DEBTS_FOUND','SERPRO_PGDASD_NO_AMOUNT_DUE','SERPRO_PGDASD_DECLARATION_NOT_TRANSMITTED'];
    return { ...base, interpretacao: known.includes(e?.code) ? e.code : 'RESPOSTA_NAO_VERIFICAVEL', pdfNaResposta: false };
  }
}

export function projetarFiscal445(fontes) {
  const chamadas = fontes.chamadas.items || [];
  const caches = fontes.cache.items || [];
  const pendente = chamadas.some(r => ['reservada','incerta'].includes(r.estadoLocal));
  const lacunas = ['LEDGER_NAO_COMPROVA_SUCESSO_FISCAL', 'NENHUMA_AUTORIZACAO_DE_RETRY'];
  if (!chamadas.length) lacunas.push('SEM_CHAMADA_ASSOCIAVEL_CACHE_NAO_VARRIDO');
  if (pendente) lacunas.push('RESULTADO_EXTERNO_INCERTO_CACHE_NAO_RESOLVE_RESERVA');
  if (caches.some(r => !r.vigente)) lacunas.push('CACHE_EXPIRADO_PRESERVADO_COMO_HISTORICO');
  return { estado: pendente ? 'Incerto' : caches.length ? 'Parcial' : 'Não verificável',
    chamadas: fontes.chamadas, cache: fontes.cache, despachos: fontes.despachos, lacunas };
}
