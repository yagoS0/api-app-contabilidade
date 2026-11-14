import { createHash } from 'node:crypto';

// Identidade e serialização legadas do registro operacional; não ordena os campos.
export const fail = (code, message, status = 409) => Object.assign(new Error(message), { code, status });
export const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const keyOf = (company, competencia) => `envio_guias_ciclo:${company}:${competencia}`;
export function validInput(company, competencia) {
  if (typeof company !== 'string' || !company || !/^\d{4}-(0[1-9]|1[0-2])$/.test(competencia || '')) throw fail('ENVIO_GUIAS_PERIODO_INVALIDO', 'Confira a empresa e a competência.', 422);
}
export function stateBase(company, competencia) { return { portalClientId: company, competencia, revision: 0, attempts: [], warnings: [] }; }
export function warning(code, message, now, guideId = null) { return { id: hash([code, guideId]), code, message, guideId, createdAt: now.toISOString(), resolvedAt: null }; }

