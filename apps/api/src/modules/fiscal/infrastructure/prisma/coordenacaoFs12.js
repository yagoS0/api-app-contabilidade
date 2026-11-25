import { createHash } from 'node:crypto';
import { erroFs12, validarIdentidadeFs12 } from '../../domain/serieManualFs12.js';

export function chaveCoordenacaoFs12({portalClientId,competencia}) {
  return 'fs12_coord_v1:'+createHash('sha256').update(JSON.stringify([portalClientId,competencia])).digest('hex');
}
export function serializacaoFs12(error) {
  const e=error?.code==='FS12_TX_ABORTADA' ? error.cause : error;
  return e?.code==='P2034' || e?.code==='40001' || (e?.code==='P2010' && e?.meta?.code==='40001');
}
// FIRST domain operation for B31/T1, or after SERPRO global/company-policy locks
// in T2. Real UPDATE creates a write conflict; advisory lock alone is insufficient
// to refresh an already established Serializable snapshot.
export async function coordenarEscopoFs12(tx,entrada) {
  validarIdentidadeFs12(entrada);
  const key=chaveCoordenacaoFs12(entrada);
  const rows=await tx.$queryRaw`
    INSERT INTO "AppSetting" ("key","value","createdAt","updatedAt")
    VALUES (${key}, jsonb_build_object('v',1,'revision',1),NOW(),NOW())
    ON CONFLICT ("key") DO UPDATE
      SET "value"=jsonb_set("AppSetting"."value",'{revision}',
          to_jsonb(("AppSetting"."value"->>'revision')::bigint+1)),
          "updatedAt"=NOW()
      WHERE "AppSetting"."value"->'v'='1'::jsonb
        AND jsonb_typeof("AppSetting"."value"->'revision')='number'
        AND ("AppSetting"."value"->>'revision') ~ '^[0-9]+$'
    RETURNING "value"`;
  if (rows.length!==1) throw erroFs12('FS12_COORDENACAO_INVALIDA','Coordenação indisponível. Nenhum despacho autorizado.',409);
}
// Full LOCAL transaction retries only. Never wrap HTTP, guard transactions, or a
// callback containing external side effects. Identity allocation inside a retry
// must be local and side-effect-free; only committed identities escape T1.
export async function transacaoCoordenadaFs12(db,entrada,executar,{maxTentativas=3}={}) {
  for(let i=0;;i++) {
    try {
      return await db.$transaction(async tx=>{
        await coordenarEscopoFs12(tx,entrada);
        return executar(tx);
      },{isolationLevel:'Serializable'});
    } catch(error) {
      if(serializacaoFs12(error) && i+1<maxTentativas) continue;
      if(serializacaoFs12(error)) throw erroFs12('FS12_COORDENACAO_CONFLITO','Conflito concorrente. Releia antes de continuar.',409);
      throw error;
    }
  }
}
