import { getSerproRuntimeSettings } from '../application/fiscal/serpro/SerproRuntimeSettings.js';
import { solicitarPagamentosWhatsapp } from '../application/guides/SolicitarPagamentosWhatsappService.js';
import { runScheduledRoutine, recordWorkerHeartbeat } from './scheduledRoutineService.js';
import { log, INTEGRACAO_WHATSAPP } from '../config.js';

// Varredura diária local. Não altera a agenda nem aumenta as consultas fiscais pagas.
export async function runGuideWhatsappReminderTick({ agora = new Date(), settings = getSerproRuntimeSettings,
  schedule = runScheduledRoutine, solicitar = solicitarPagamentosWhatsapp, ligado = INTEGRACAO_WHATSAPP } = {}) {
  if (!ligado) return null;
  const salvo = (await settings()).rotinas?.pagamento;
  if (!salvo?.enabled) return null;
  const config = { enabled: true, frequency: 'DAILY', hour: salvo.hour };
  return schedule('avisos_guias_whatsapp', config, async options => {
    const assertActive = async () => {
      options.assertActive();
      const atual = (await settings()).rotinas?.pagamento;
      if (!atual?.enabled || atual.hour !== config.hour) throw Object.assign(new Error('Agenda de avisos alterada.'), { code: 'AGENDA_ALTERADA' });
    };
    await assertActive();
    return solicitar({ scheduledAt: options.scheduledAt, assertActive, agora });
  }, { now: agora });
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
