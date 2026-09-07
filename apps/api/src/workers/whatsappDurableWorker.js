import { INTEGRACAO_WHATSAPP, log } from "../config.js";
import { processarInboxWhatsappUmaVez } from "../application/whatsapp/WhatsappInboxService.js";
import { processarTurnosIaUmaVez } from "../application/assistente/TurnoIaWhatsappService.js";

let timer = null;
let inboxEmCurso = null;
let iaEmCurso = null;
export function iniciarWorkerWhatsappDuravel() {
  if (timer || !INTEGRACAO_WHATSAPP) return;
  const tick = () => {
    // A latência do modelo nunca impede a ingestão de mensagens e recibos.
    if (!inboxEmCurso) inboxEmCurso = processarInboxWhatsappUmaVez({ log })
      .catch((e) => log.error({ codigo: e?.code }, "WhatsApp: inbox falhou; próximo ciclo recupera"))
      .finally(() => { inboxEmCurso = null; });
    if (!iaEmCurso) iaEmCurso = processarTurnosIaUmaVez({ log })
      .catch((e) => log.error({ codigo: e?.code }, "WhatsApp: turno falhou; próximo ciclo recupera"))
      .finally(() => { iaEmCurso = null; });
  };
  timer = setInterval(tick, 2000);
  timer.unref?.();
  tick();
}
export async function pararWorkerWhatsappDuravel() {
  clearInterval(timer);
  timer = null;
  await Promise.allSettled([inboxEmCurso, iaEmCurso].filter(Boolean));
}
