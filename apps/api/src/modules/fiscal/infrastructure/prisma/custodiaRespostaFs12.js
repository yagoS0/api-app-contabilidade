import { contextoCustodia, hashBytes, hashContexto, erroCustodia } from '../custody/cifraRespostaFs12.js';

const text = v => typeof v === 'string' && v.trim() === v && v.length > 0 && v.length <= 200;
const fail = code => { throw erroCustodia(code); };
// Canonical JSON for the existing dispatch marker: objects sorted, array order preserved.
// T2 must use this exact convention; no JSON coercion of unsupported values.
export function hashMarcadorCustodiaFs12(value) {
  const canonical = v => {
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (Array.isArray(v)) return v.map(canonical);
    if (v && Object.getPrototypeOf(v) === Object.prototype)
      return Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])]));
    return fail('FS12_MARCADOR_INVALIDO');
  };
  return hashBytes(Buffer.from(JSON.stringify(canonical(value))));
}
const originKeys = ['respostaId','comandoId','tentativaId','reservaId','portalClientId','companyId',
  'custodianteId','capacidadeId','envelopeHash','marcadorHash','cnpj','competencia','revisaoFs12','intencao'];
const equalOrigin = (a,b) => originKeys.every(k => a[k] === b[k]);

// Internal composition only. No route export, default/global Prisma, credentials or HTTP.
// custodianteId/capacidadeId identify the injected trusted recovery capability, not request fields.
export function criarCustodiaRespostaFs12Prisma({ db, cifra, custodianteId, capacidadeId }) {
  if (!db?.$transaction || typeof cifra?.decifrar !== 'function' || !text(custodianteId) || !text(capacidadeId))
    fail('FS12_CUSTODIA_CONFIG_INVALIDA');
  async function chain(tx, hints) {
    if (!hints || !['respostaId','comandoId','tentativaId','reservaId'].every(k => text(hints[k]))
      || hints.stageId !== hashBytes(Buffer.from(hints.respostaId))) fail('FS12_CUSTODIA_IDENTIDADE_INVALIDA');
    const command = await tx.fs12Comando.findUnique({ where:{ id:hints.comandoId } });
    const expected = command?.esperado?.custodia;
    if (!command || !expected || Object.keys(expected).sort().join(',') !== 'capacidadeId,custodianteId,respostaId'
      || expected.respostaId !== hints.respostaId || command.tentativaId !== hints.tentativaId
      || expected.custodianteId !== custodianteId || expected.capacidadeId !== capacidadeId)
      fail('FS12_CUSTODIA_ORIGEM_INVALIDA');
    const reservation = await tx.fs12ComandoReserva.findUnique({ where:{ comandoId:command.id } });
    if (!reservation || reservation.reservaId !== hints.reservaId) fail('FS12_CUSTODIA_ORIGEM_INVALIDA');
    // Immutable command/reservation plus locked ledger/marker, all read in the same transaction.
    await tx.$queryRaw`SELECT id FROM serpro_chamadas WHERE id = ${hints.reservaId} FOR SHARE`;
    const markerKey = `serpro_dispatch:${hints.reservaId}`;
    await tx.$queryRaw`SELECT key FROM "AppSetting" WHERE key = ${markerKey} FOR SHARE`;
    const ledger = await tx.serproChamada.findUnique({ where:{ id:hints.reservaId } });
    const marker = await tx.appSetting.findUnique({ where:{ key:markerKey } });
    const m = marker?.value;
    if (!ledger || !m || typeof m !== 'object' || Array.isArray(m)
      || m.reservaId !== hints.reservaId || m.companyId !== command.portalClientId
      || !text(m.authorizedAt) || !Number.isFinite(Date.parse(m.authorizedAt))
      || ledger.portalClientId !== command.portalClientId || ledger.cnpj !== command.cnpj
      || ledger.competencia !== command.competencia || ledger.acaoId !== command.id
      || !['reservada','ok','erro','incerta'].includes(ledger.status)
      || ['assinatura','rota','idSistema','idServico'].some(k => ledger[k] !== reservation[k])
      || reservation.rota !== '/Declarar' || reservation.idSistema !== 'PGDASD'
      || reservation.idServico !== 'TRANSDECLARACAO11') fail('FS12_CUSTODIA_CADEIA_INVALIDA');
    const origin = { respostaId:expected.respostaId, comandoId:command.id, tentativaId:command.tentativaId,
      reservaId:reservation.reservaId, portalClientId:command.portalClientId, companyId:command.companyId,
      custodianteId, capacidadeId, envelopeHash:reservation.envelopeHash,
      marcadorHash:hashMarcadorCustodiaFs12(m), cnpj:command.cnpj, competencia:command.competencia,
      revisaoFs12:command.revisaoFs12, intencao:command.intencao };
    return { origin, markerKey, marker:m };
  }
  return {
    async resolveOrigin(hints) {
      return db.$transaction(async tx => (await chain(tx,hints)).origin, { isolationLevel:'RepeatableRead' });
    },
    async importDurably({ id, contexto, corpo, envelope, contextHash }) {
      const ctx = contextoCustodia(contexto);
      if (!Buffer.isBuffer(corpo) || hashBytes(corpo) !== ctx.corpoHash
        || contextHash !== hashContexto(ctx) || id !== hashBytes(Buffer.from(ctx.respostaId)))
        fail('FS12_CUSTODIA_OBSERVACAO_INVALIDA');
      // Snapshot mutable caller buffers/JSON before awaits. No trust in a client durable flag.
      const supplied = Buffer.from(corpo);
      const sealed = JSON.parse(JSON.stringify(envelope));
      try {
        const verified = await cifra.decifrar({ envelope:sealed, contexto:ctx });
        try { if (!verified.equals(supplied)) fail('FS12_CUSTODIA_CORPO_DIVERGENTE'); }
        finally { verified.fill(0); }
        const hints = { stageId:id, respostaId:ctx.respostaId, comandoId:ctx.comandoId,
          tentativaId:ctx.tentativaId, reservaId:ctx.reservaId };
        const commit = () => db.$transaction(async tx => {
          const { origin, markerKey, marker } = await chain(tx,hints);
          if (!equalOrigin(origin,ctx)) fail('FS12_CUSTODIA_ORIGEM_DIVERGENTE');
          const existing = await tx.fs12ComandoResposta.findMany({ where:{ OR:[{ id:ctx.respostaId },
            { comandoId:ctx.comandoId, corpoHash:ctx.corpoHash, httpStatus:ctx.httpStatus }] } });
          if (existing.length) {
            if (existing.length !== 1) fail('FS12_CUSTODIA_CONFLITO');
            const row = existing[0];
            if (row.id !== ctx.respostaId || row.comandoId !== ctx.comandoId || row.reservaId !== ctx.reservaId
              || row.marcadorKey !== markerKey || row.httpStatus !== ctx.httpStatus || row.corpoHash !== ctx.corpoHash
              || row.recebidoEm.toISOString() !== ctx.recebidoEm || row.custodianteId !== ctx.custodianteId
              || row.capacidadeId !== ctx.capacidadeId || hashMarcadorCustodiaFs12(row.marcadorObservado) !== ctx.marcadorHash)
              fail('FS12_CUSTODIA_CONFLITO');
            const old = await cifra.decifrar({ envelope:row.corpoCifrado, contexto:ctx });
            try { if (!old.equals(supplied)) fail('FS12_CUSTODIA_CONFLITO'); } finally { old.fill(0); }
            return row.id;
          }
          const row = await tx.fs12ComandoResposta.create({ data:{ id:ctx.respostaId, comandoId:ctx.comandoId,
            reservaId:ctx.reservaId, marcadorKey:markerKey, httpStatus:ctx.httpStatus, corpoCifrado:sealed,
            corpoHash:ctx.corpoHash, recebidoEm:new Date(ctx.recebidoEm), custodianteId:ctx.custodianteId,
            capacidadeId:ctx.capacidadeId, marcadorObservado:marker } });
          return row.id;
        }, { isolationLevel:'ReadCommitted' });
        let custodiaId;
        try { custodiaId = await commit(); }
        catch (error) {
          // Unique-race only: start a NEW transaction, revalidate chain and compare both unique keys.
          if (error.code !== 'P2002') throw error;
          custodiaId = await commit();
        }
        return { durable:true, id, corpoHash:ctx.corpoHash, contextHash, custodiaId };
      } finally { supplied.fill(0); }
    },
  };
}
