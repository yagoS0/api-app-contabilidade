import { processarPushAtendimento, limparHistoricoPush } from "../application/whatsapp/AtendimentoPushService.js";
import { expirarRascunhosAtendimento } from "../application/whatsapp/RascunhoAtendimentoService.js";
import { reconciliarHistoricoGuiasWhatsapp } from "../application/whatsapp/HistoricoArquivoWhatsappService.js";
import { log } from "../config.js";

let parado = true, timer, trabalho, ultimaLimpeza = 0;
export function iniciarWorkerAtendimento() {
  if (!parado || process.env.NODE_ENV === "test") return;
  parado = false;
  const ciclo = async () => {
    if (parado) return;
    const limpar = Date.now() - ultimaLimpeza > 3600000;
    if (limpar) ultimaLimpeza = Date.now();
    trabalho = Promise.allSettled([
      processarPushAtendimento(),
      expirarRascunhosAtendimento(),
      reconciliarHistoricoGuiasWhatsapp(),
      ...(limpar ? [limparHistoricoPush()] : []),
    ]).then(resultados => {
      if (resultados.some(resultado => resultado.status === "rejected")) {
        log.error("atendimento: manutenção pendente; nenhuma mensagem ao cliente foi reenviada");
      }
    });
    try { await trabalho; } catch { log.error("atendimento: manutenção pendente; nenhuma mensagem ao cliente foi reenviada"); }
    finally { trabalho = null; if (!parado) { timer = setTimeout(ciclo, 15000); timer.unref?.(); } }
  };
  void ciclo();
}
export async function pararWorkerAtendimento() { parado = true; clearTimeout(timer); await trabalho?.catch(() => {}); }
