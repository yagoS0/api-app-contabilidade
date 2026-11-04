import { lerModoEventos } from './AgendaEventosModo.js';
import { prisma } from "../../../infrastructure/db/prisma.js";
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

const tentativa = new AsyncLocalStorage();
export const chaveConsultaAutomatica = ({ guideId, parcelaId }) => guideId
  ? `pagamento_auto_tentativa:guia:${guideId}` : `pagamento_auto_tentativa:parcela:${parcelaId}`;
const reservas = input => [input.guideId && chaveConsultaAutomatica({ guideId: input.guideId }),
  input.parcelaId && chaveConsultaAutomatica({ parcelaId: input.parcelaId })].filter(Boolean).sort();

// A posse é interna, não vem do corpo HTTP. Toda reutilização confere o claim persistido.
export async function conferirReservaConsulta(input, db = prisma) {
  const owner = tentativa.getStore();
  if (!owner || owner.db !== db || owner.companyId !== input.companyId) return false;
  const modeNow = await lerModoEventos(db, owner.companyId);
  if (modeNow.modeRevision !== owner.modeRevision || modeNow.executionMode !== owner.executionMode) return false;
  for (const key of reservas(input)) {
    const row = await db.appSetting.findUnique({ where: { key } });
    if (!owner.keys.includes(key) || row?.value?.claim !== owner.claim || row.value.status !== 'INICIADA') return false;
  }
  return reservas(input).length > 0;
}

export async function executarConsultaAutomatica(input, run, db = prisma) {
  if (!input.scheduledAt) return run();
  if (await conferirReservaConsulta(input, db)) return run();
  const modo = await lerModoEventos(db, input.companyId);
  if (modo.executionMode === 'RELATIVO_V1' && input.executionMode !== 'RELATIVO_V1'
    || modo.executionMode === 'LEGADO' && input.executionMode === 'RELATIVO_V1') return { ok: true, skipped: 'acompanhamento_exclusivo' };
  const keys = reservas(input);
  if (!keys.length || !input.companyId) throw new Error('Identidade da consulta automática incompleta.');
  const config = (await db.appSetting.findUnique({ where: { key: `acompanhamento_guias_config:${input.companyId}` } }))?.value;
  if (config?.enabled === true && input.politica !== config.politica) return { ok: true, skipped: 'acompanhamento_exclusivo' };
  const claim = randomUUID();
  const value = { companyId: input.companyId, guideId: input.guideId || null, parcelaId: input.parcelaId || null,
    revisao: input.revisao || null, politica: input.politica || 'LEGADO', fase: input.fase || 'PAGAMENTO',
    executionMode: modo.executionMode, modeRevision: modo.modeRevision, claim, status: 'INICIADA', scheduledAt: input.scheduledAt, iniciadaEm: new Date().toISOString() };
  try {
    await db.$transaction(async tx => {
      if (await consultaAutomaticaEncerrada(input, tx)) throw Object.assign(new Error('Consulta encerrada.'), { code: 'CONSULTA_ENCERRADA' });
      for (const key of keys) await tx.appSetting.create({ data: { key, value } });
    });
  } catch (e) {
    if (!['P2002', 'CONSULTA_ENCERRADA'].includes(e.code)) throw e;
    return { ok: true, skipped: 'conferencia_manual' };
  }
  return tentativa.run({ db, companyId: input.companyId, keys, claim, executionMode: modo.executionMode, modeRevision: modo.modeRevision }, async () => {
    const finish = async extra => db.$transaction(async tx => {
      for (const key of keys) {
        const persisted = await tx.appSetting.findUnique({ where: { key } });
        if (persisted?.value?.claim !== claim || persisted.value.status !== 'INICIADA') throw new Error('A reserva da consulta mudou; exige conferência.');
        await tx.appSetting.update({ where: { key }, data: { value: { ...value, ...extra, concluidaEm: new Date().toISOString() } } });
      }
    });
    try {
      await conferirModoConsultaDespacho(db, { portalClientId: input.companyId });
      const result = await run();
      await finish({ status: result?.pago === true ? 'PAGA' : 'REVISAO', resultado: result?.pago === true ? 'PAGA' : result?.negativaConfirmada || result?.status === 'NAO_LOCALIZADO' ? 'NAO_LOCALIZADO' : 'INCONCLUSIVO' });
      return result;
    } catch (e) {
      await finish({ status: 'REVISAO', resultado: 'ERRO', motivo: 'Confira a tentativa fiscal; não haverá repetição automática.' });
      throw e;
    }
  });
}

const chaves = ({ guideId, parcelaId }) => [guideId && `pagamento_auto_negativo:guia:${guideId}`, parcelaId && `pagamento_auto_negativo:parcela:${parcelaId}`].filter(Boolean);

export function elegibilidadeVencimentoAutomatico(vencimento, now = new Date()) {
  if (!vencimento || !Number.isFinite(new Date(vencimento).getTime())) return "sem_vencimento_confirmado";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const hoje = ["year", "month", "day"].map(t => parts.find(p => p.type === t).value).join("-");
  return new Date(vencimento).toISOString().slice(0, 10) < hoje ? null : "ainda_nao_vencida";
}

export async function consultaAutomaticaEncerrada(input, db = prisma) {
  if (!input.scheduledAt) return false;
  for (const key of chaves(input)) if (await db.appSetting.findUnique({ where: { key } })) return true;
  const owner = tentativa.getStore();
  for (const key of reservas(input)) {
    const row = await db.appSetting.findUnique({ where: { key } });
    if (row && !(owner?.db === db && owner.keys.includes(key) && row.value?.claim === owner.claim && row.value.status === 'INICIADA')) return true;
  }
  return false;
}

// Uma negativa concluída transfere a conferência ao contador. Trocar o PDF não reabre a rotina.
export async function registrarNegativaAutomatica(input, db = prisma) {
  if (!input.scheduledAt) return;
  for (const key of chaves(input)) await db.appSetting.upsert({ where: { key }, update: {},
    create: { key, value: { status: "CONFERENCIA_MANUAL", scheduledAt: input.scheduledAt,
      guideId: input.guideId || null, parcelaId: input.parcelaId || null, registradaEm: new Date().toISOString() } } });
}

// Called by the real SerproCallGuard under the existing company policy lock,
// after authentication and before issuing the dispatch authorization.
export async function conferirModoConsultaDespacho(tx, { portalClientId } = {}) {
  const owner = tentativa.getStore();
  if (!owner) return; // Manual/non-payment routines preserve their contracts.
  const current = await lerModoEventos(tx, owner.companyId);
  if (portalClientId !== owner.companyId || current.executionMode !== owner.executionMode || current.modeRevision !== owner.modeRevision)
    throw Object.assign(new Error('A estratégia de pagamento mudou durante a preparação.'), { code: 'AUTOMACAO_EMPRESA_AGENDA_ALTERADA' });
  for (const key of owner.keys) {
    const row = await owner.db.appSetting.findUnique({ where: { key } });
    if (row?.value?.claim !== owner.claim || row.value.status !== 'INICIADA')
      throw Object.assign(new Error('A reserva de pagamento mudou; confira o histórico.'), { code: 'AUTOMACAO_EMPRESA_RESERVA_ALTERADA' });
  }
}
