import { INTEGRACAO_WHATSAPP, log } from "../config.js";
import { processarInboxWhatsappUmaVez } from "../application/whatsapp/WhatsappInboxService.js";
import { processarTurnosIaUmaVez } from "../application/assistente/TurnoIaWhatsappService.js";
import { processarContingenciasComerciaisUmaVez } from "../application/onboarding/WatchdogComercialService.js";

import { criarFiscalLead } from "../application/onboarding/FiscalLeadService.js";
import { criarComunicadosWhatsapp } from "../application/whatsapp/ComunicadosWhatsappService.js";
const comunicados = criarComunicadosWhatsapp();
let comunicadoEmCurso = null;
const fiscal = criarFiscalLead();
let fiscalEmCurso = null;
let timer = null;
let inboxEmCurso = null;
let iaEmCurso = null;
let contingenciaEmCurso = null;
let proximaContingencia = 0;
export function iniciarWorkerWhatsappDuravel() {
  if (timer || !INTEGRACAO_WHATSAPP) return;
  const tick = () => {
    if (!contingenciaEmCurso && Date.now() >= proximaContingencia) {
      proximaContingencia = Date.now() + 30000;
      contingenciaEmCurso = processarContingenciasComerciaisUmaVez({ log })
        .catch(e => log.error({ codigo: e?.code }, "Comercial: observador de contingência interrompido"))
        .finally(() => { contingenciaEmCurso = null; });
    }
    if (!comunicadoEmCurso) comunicadoEmCurso = comunicados.processarUmaVez()
      .catch(e => log.error({ codigo: e.code }, "Comunicado WhatsApp interrompido"))
      .finally(() => { comunicadoEmCurso = null; });
    if (!fiscalEmCurso) fiscalEmCurso = fiscal.processarUmaVez().catch(e => log.error({ codigo: e.code }, "Consulta fiscal de lead interrompida")).finally(() => { fiscalEmCurso = null; });
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
  proximaContingencia = 0;
  await Promise.allSettled([inboxEmCurso, iaEmCurso, fiscalEmCurso, comunicadoEmCurso, contingenciaEmCurso].filter(Boolean));
}
