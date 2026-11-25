import * as fs from 'node:fs/promises';
import { hashBytes } from '../../src/modules/fiscal/infrastructure/custody/cifraRespostaFs12.js';
export const corpo = Buffer.from([0, 255, 123, 34, 10, 13, 0, 125]);
export function origem() {
  return { respostaId: 'resposta-sintetica', comandoId: 'comando-sintetico', tentativaId: 'tentativa-sintetica',
    reservaId: 'reserva-sintetica', portalClientId: 'portal-sintetico', companyId: 'company-sintetica',
    custodianteId: 'custodiante-sintetico', capacidadeId: 'capacidade-sintetica',
    envelopeHash: 'a'.repeat(64), marcadorHash: 'b'.repeat(64),
    cnpj: '00000000000000', competencia: '2026-11', revisaoFs12: 1, intencao: 'TRANSMITIR'
     };
}
export function receipt(input) {
  return { durable: true, id: input.id, corpoHash: input.contexto.corpoHash,
    contextHash: input.contextHash, custodiaId: 'custodia-sintetica' };
}
// Explicit process-restart-only fixture. NOT production directory durability.
export const syncProcessOnly = async () => false;

export function contexto() {
  return { ...origem(), corpoHash:hashBytes(corpo), httpStatus:422, recebidoEm:'2026-11-25T12:00:00.000Z' };
}
export function resolverOrigemPersistida(file) {
  return async hints => {
    const stored=JSON.parse(await fs.readFile(file,'utf8'));
    // File written BEFORE observation; no response status/body hash/timestamp.
    for (const field of ['respostaId','comandoId','tentativaId','reservaId']) {
      if (hints[field] !== stored[field]) throw new Error('ORIGINAL_CHAIN_NOT_FOUND');
    }
    if (hints.stageId !== hashBytes(Buffer.from(stored.respostaId))) throw new Error('STAGE_NOT_ALLOCATED');
    return stored;
  };
}