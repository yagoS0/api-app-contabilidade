import { getSerproRuntimeSettings } from '../application/fiscal/serpro/SerproRuntimeSettings.js';
import { conferirContextoCicloFiscal } from '../application/fiscal/automacaoCicloFiscalContext.js';
import { solicitarPagamentosWhatsapp } from '../application/guides/SolicitarPagamentosWhatsappService.js';
import { runScheduledRoutine, recordWorkerHeartbeat } from './scheduledRoutineService.js';
import { log, INTEGRACAO_WHATSAPP } from '../config.js';

// Agenda diária salva: o contrato novo requer adesão e limita a consulta específica em D+2.
export async function runGuideWhatsappReminderTick({ agora = new Date(), settings = getSerproRuntimeSettings,
  schedule = runScheduledRoutine, solicitar = solicitarPagamentosWhatsapp, ligado = INTEGRACAO_WHATSAPP } = {}) {
  if (!ligado) return null;
  const salvo = (await settings()).rotinas?.avisos_guias_whatsapp;
  if (!salvo?.enabled) return null;
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hourCycle: 'h23' }).format(agora));
  // Hourly local evaluator; effect selection stays relative to each document. No catch-up.
  // Existing DAILY slot remains exclusively for LEGADO, preserving its claim identity.
  const resultados = [], failures = [];
  for (const executionMode of ['LEGADO', 'RELATIVO_V1']) {
    const config = { enabled: true, frequency: 'DAILY', hour: executionMode === 'LEGADO' ? salvo.hour : hour };
    const name = executionMode === 'LEGADO' ? 'avisos_guias_whatsapp' : 'avisos_guias_relativos_v1';
    try {
    const result = await schedule(name, config, async options => {
      const assertActive = async () => {
        await options.assertActive();
        await conferirContextoCicloFiscal();
        const atual = (await settings()).rotinas?.avisos_guias_whatsapp;
        if (!atual?.enabled || atual.hour !== salvo.hour) throw Object.assign(new Error('Agenda de avisos alterada.'), { code: 'AGENDA_ALTERADA' });
      };
      await assertActive();
      return solicitar({ scheduledAt: options.scheduledAt, assertActive, agora, executionMode });
    }, { now: agora });
    resultados.push({ executionMode, result });
    } catch (error) { failures.push(error); resultados.push({ executionMode, failed: true, code: error.code || 'EVENT_TICK_FAILED' }); }
  }
  if (failures.length) throw Object.assign(new AggregateError(failures, 'Um ou mais avaliadores de guias falharam.'), { code: 'EVENT_TICK_FAILED', resultados });
  return resultados;
}

export async function runGuideWhatsappReminderLoop() {
  while (true) {
    try {
      await recordWorkerHeartbeat('GUIAS_WHATSAPP_AVISOS');
      await runGuideWhatsappReminderTick();
    } catch (e) { log.error({ codigo: e.code || 'AVISOS_GUIAS_FALHA' }, 'Falha na rotina diária de avisos WhatsApp'); }
    await new Promise(resolve => setTimeout(resolve, 15000));
  }
}
