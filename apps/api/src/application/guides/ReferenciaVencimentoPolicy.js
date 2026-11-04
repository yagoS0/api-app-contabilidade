import { createHash } from 'node:crypto';

export const erroReferencia = (code, message, status = 409) => Object.assign(new Error(message), { code, status });
const invalid = () => { throw erroReferencia('INVALID_REFERENCE', 'Confira empresa, tributo, período e fonte da referência.', 422); };
const taxes = ['DAS', 'IRPJ', 'CSLL', 'PIS', 'COFINS', 'ISS', 'INSS', 'FGTS'];
const object = x => x && typeof x === 'object' && !Array.isArray(x);
const keys = (x, allowed) => object(x) && Object.keys(x).every(k => allowed.includes(k));

export function identidadeReferencia(input) {
  if (!keys(input, ['tributo', 'tipoPeriodo', 'competencia'])) invalid();
  const { tributo, tipoPeriodo, competencia } = input;
  // Tipo do período é declaração explícita, nunca regra tributária derivada do imposto.
  if (!taxes.includes(tributo) || typeof competencia !== 'string') invalid();
  if (tipoPeriodo === 'MENSAL' ? !/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(competencia)
    : tipoPeriodo === 'TRIMESTRAL' ? !/^[1-9]\d{3}-T[1-4]$/.test(competencia) : true) invalid();
  return { tributo, tipoPeriodo, competencia, targetKey: 'TRIBUTO' };
}

export function dataCivilReferencia(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) invalid();
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) invalid();
  return date;
}

export function comandoReferencia(input) {
  if (!keys(input, ['identidade', 'acao', 'expectedRevision', 'requestId', 'dataCivil', 'origem', 'descricaoFonte', 'confirmacao', 'motivo'])) invalid();
  const identidade = identidadeReferencia(input.identidade);
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0
    || typeof input.requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(input.requestId)
    || !['CONFIRMAR', 'REVOGAR'].includes(input.acao)) invalid();
  if (typeof input.motivo !== 'string' || !input.motivo.trim() || input.motivo.trim().length > 300) invalid();
  const common = { identidade, acao: input.acao, expectedRevision: input.expectedRevision, requestId: input.requestId, motivo: input.motivo.trim() };
  if (input.acao === 'REVOGAR') {
    if (['dataCivil', 'origem', 'descricaoFonte', 'confirmacao'].some(k => Object.hasOwn(input, k))) invalid();
    return common;
  }
  if (input.origem !== 'CONFIRMADA_CONTADOR' || input.confirmacao !== true
    || typeof input.descricaoFonte !== 'string' || !input.descricaoFonte.trim() || input.descricaoFonte.trim().length > 300) invalid();
  dataCivilReferencia(input.dataCivil);
  return { ...common, dataCivil: input.dataCivil, origem: input.origem, descricaoFonte: input.descricaoFonte.trim(), confirmacao: true };
}

export function hashComandoReferencia(companyId, command) {
  return createHash('sha256').update(JSON.stringify([companyId, command])).digest('hex');
}

export function dtoReferencia(row) {
  if (!row) return null;
  return { id: row.id, companyId: row.portalClientId, tributo: row.tributo, tipoPeriodo: row.tipoPeriodo,
    competencia: row.competencia, targetKey: row.targetKey, parcelamentoId: row.parcelamentoId,
    numeroParcela: row.numeroParcela, dataCivil: row.dataCivil.toISOString().slice(0, 10), origem: row.origem,
    descricaoFonte: row.descricaoFonte, status: row.status, revision: row.revision,
    confirmedBy: row.confirmedBy, confirmedAt: row.confirmedAt.toISOString(),
    updatedBy: row.updatedBy, updatedAt: row.updatedAt.toISOString() };
}
