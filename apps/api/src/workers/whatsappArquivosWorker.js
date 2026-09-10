import { processarArquivosWhatsapp } from "../application/whatsapp/ArquivoWhatsappService.js";
import { INTEGRACAO_WHATSAPP, log } from "../config.js";
let timer;
let parado = true;
let trabalho = null;
export function iniciarWorkerArquivosWhatsapp() {
  if (!INTEGRACAO_WHATSAPP || !parado) return;
  parado = false;
  async function ciclo() {
    if (parado) return;
    trabalho = processarArquivosWhatsapp();
    try { await trabalho; } catch { log.error("whatsapp: falha no processamento dos arquivos recebidos"); }
    finally { trabalho = null; if (!parado) { timer = setTimeout(ciclo, 30000); timer.unref?.(); } }
  }
  void ciclo();
}
export async function pararWorkerArquivosWhatsapp() {
  parado = true;
  clearTimeout(timer);
  await trabalho?.catch(() => {});
}
