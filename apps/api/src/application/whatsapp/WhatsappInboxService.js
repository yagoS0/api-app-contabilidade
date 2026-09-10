import { createHash, randomUUID } from "node:crypto";
import { prisma } from "../../infrastructure/db/prisma.js";

export async function persistirWebhookWhatsapp(payload, { corpoRaw = null, client = prisma } = {}) {
  const hash = createHash("sha256").update(corpoRaw || JSON.stringify(payload)).digest("hex");
  try { return await client.inboxWebhookWhatsapp.create({ data: { hash, payload } }); }
  catch (e) {
    if (e?.code !== "P2002") throw e;
    return client.inboxWebhookWhatsapp.findUnique({ where: { hash } });
  }
}

const atraso = (tentativa) => Math.min(3600000, 1000 * 2 ** Math.min(tentativa, 12));

/** Só processamento local: o ACK depende da persistência, nunca desta execução. */
export async function processarInboxWhatsappUmaVez({ client = prisma, agora = new Date(), processar = null, log = console, limite = 20 } = {}) {
  const pendentes = await client.inboxWebhookWhatsapp.findMany({
    where: { OR: [
      { status: { in: ["pendente", "falhou"] }, proximaTentativaEm: { lte: agora } },
      { status: "processando", leaseAte: { lte: agora } },
    ] }, orderBy: { recebidoEm: "asc" }, take: limite,
  });
  const executar = processar || (await import("./ProcessarEventoWhatsappService.js")).processarEventoWhatsapp;
  const resumo = { processados: 0, falhas: 0 };
  for (const entrada of pendentes) {
    const token = randomUUID();
    const reserva = await client.inboxWebhookWhatsapp.updateMany({
      where: { id: entrada.id, status: entrada.status, reservaToken: entrada.reservaToken },
      data: { status: "processando", reservaToken: token, leaseAte: new Date(agora.getTime() + 120000), tentativas: { increment: 1 } },
    });
    if (!reserva.count) continue;
    try {
      const r = await executar(entrada.payload, { logger: log });
      if (r?.erros?.length) throw Object.assign(new Error("Falha ao processar itens do envelope."), { code: "ITENS_FALHARAM" });
      // O status pode preceder a gravação do wamid. Preserve-o para reconciliação por 24h.
      if (r?.statuses?.semEnvio && agora.getTime() - new Date(entrada.recebidoEm).getTime() < 86400000) {
        throw Object.assign(new Error("Status aguardando correlação com saída."), { code: "STATUS_AGUARDANDO_CORRELACAO" });
      }
      await client.inboxWebhookWhatsapp.updateMany({ where: { id: entrada.id, reservaToken: token }, data: {
        status: r?.statuses?.semEnvio ? "esgotado" : "concluido", concluidoEm: new Date(), leaseAte: null,
        erroCodigo: r?.statuses?.semEnvio ? "STATUS_ORFAO" : null,
      } });
      resumo.processados += 1;
    } catch (err) {
      const tentativas = entrada.tentativas + 1;
      await client.inboxWebhookWhatsapp.updateMany({ where: { id: entrada.id, reservaToken: token }, data: {
        status: tentativas >= 36 ? "esgotado" : "falhou", leaseAte: null,
        erroCodigo: String(err?.code || "PROCESSAMENTO_FALHOU"), proximaTentativaEm: new Date(agora.getTime() + atraso(tentativas)),
      } });
      log?.error?.({ inboxId: entrada.id, codigo: err?.code, tentativas }, "WhatsApp: evento preservado para recuperação");
      resumo.falhas += 1;
    }
  }
  return resumo;
}
