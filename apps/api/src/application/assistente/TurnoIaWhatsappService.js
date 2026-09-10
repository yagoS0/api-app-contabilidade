import { randomUUID } from "node:crypto";
import { prisma } from "../../infrastructure/db/prisma.js";
import { INTEGRACAO_WHATSAPP_IA, IA_EMPRESAS_PILOTO, INTEGRACAO_IA_COMERCIAL, IA_COMERCIAL_TELEFONES_PILOTO } from "../../config.js";
import { adquirirLease, renovarLease, liberarLease } from "../whatsapp/WhatsappLeaseService.js";
import { chaveLeaseResponsavel } from "../whatsapp/AtendimentoResponsavelWhatsappService.js";

export async function enfileirarTurnoIa({ conversaId, mensagemId, portalClientId = null, perfil = "CLIENTE", contexto = null, atendimentoId = contexto?.atendimentoId ?? null, contextoVersao = contexto?.versao ?? null, client = prisma }) {
  if (atendimentoId && (!Number.isInteger(contextoVersao) || contexto?.conversaId && contexto.conversaId !== conversaId || contexto?.portalClientId && contexto.portalClientId !== portalClientId)) {
    throw Object.assign(new Error("O turno não possui um contexto de empresa válido."), { codigo: "CONTEXTO_ALTERADO" });
  }
  // Uma pequena pausa permite receber as bolhas que compõem o mesmo pedido.
  try { return await client.turnoIaWhatsapp.create({ data: { conversaId, mensagemId, portalClientId, perfil, ...(atendimentoId ? { atendimentoId, contextoVersao } : {}), proximaTentativaEm: new Date(Date.now() + 1500) } }); }
  catch (e) {
    if (e?.code !== "P2002") throw e;
    return client.turnoIaWhatsapp.findUnique({ where: { mensagemId } });
  }
}

export async function processarTurnosIaUmaVez({ client = prisma, agora = new Date(), responder = null, responderComercial = null, flag = INTEGRACAO_WHATSAPP_IA, piloto = IA_EMPRESAS_PILOTO, log = console, limite = 10, comercialFlag = INTEGRACAO_IA_COMERCIAL, comercialPiloto = IA_COMERCIAL_TELEFONES_PILOTO } = {}) {
  if ((!flag || !piloto.length) && (!comercialFlag || !comercialPiloto.length)) return { processados: 0 };
  const inicioCiclo = Date.now();
  const escopos = flag && piloto.length ? [{ perfil: "CLIENTE", portalClientId: { in: piloto } }] : [];
  if (comercialFlag && comercialPiloto.length) {
    // TurnoIaWhatsapp armazena conversaId, sem uma relação Prisma chamada conversa.
    // Resolver o piloto antes de ler a fila evita invalidar também a seleção dos clientes.
    const conversasLead = await client.conversaWhatsapp.findMany({
      where: { telefoneE164: { in: comercialPiloto }, portalClientId: null },
      select: { id: true },
    });
    if (conversasLead.length) escopos.push({ perfil: "LEAD", portalClientId: null, conversaId: { in: conversasLead.map(c => c.id) } });
  }
  if (!escopos.length) return { processados: 0 };
  const jobs = await client.turnoIaWhatsapp.findMany({ where: {
    AND: [{ OR: escopos }], OR: [
      { status: { in: ["pendente", "falhou"] }, tentativas: { lt: 5 }, proximaTentativaEm: { lte: agora } },
      { status: "processando", leaseAte: { lte: agora } },
    ],
  }, orderBy: { criadoEm: "asc" }, take: limite });
  const executar = responder || (await import("./AssistenteService.js")).responderMensagem;
  let processados = 0;
  for (const job of jobs) {
    const instanteReserva = new Date(agora.getTime() + Date.now() - inicioCiclo);
    // Um job antigo pode anteceder a associação do segmento ao responsável. Usa o lease atual
    // para coordenar, mas nunca ganha uma versão nova: o assistente recusará o pin ausente.
    const conversaDoJob = job.atendimentoId ? { id: job.conversaId, atendimentoId: job.atendimentoId }
      : await client.conversaWhatsapp?.findUnique?.({ where: { id: job.conversaId }, select: { id: true, atendimentoId: true } }) || { id: job.conversaId };
    const lease = await adquirirLease(chaveLeaseResponsavel(conversaDoJob), { client, agora: instanteReserva });
    if (!lease) continue; // permanece na fila; o próximo ciclo lê a nova mensagem.
    const token = randomUUID();
    let renovando = false;
    let leaseValido = true;
    let timer;
    try {
      const reserva = await client.turnoIaWhatsapp.updateMany({ where: { id: job.id, status: job.status, reservaToken: job.reservaToken }, data: {
        status: "processando", reservaToken: token, leaseAte: new Date(instanteReserva.getTime() + 90000), tentativas: { increment: 1 },
      } });
      if (!reserva.count) continue;
      // Se o processo morreu após iniciar uma saída, o desfecho é ambíguo: nunca reenvie sozinho.
      {
        const saida = await client.mensagemWhatsapp.findFirst({ where: { turnoIaId: job.id, direcao: "out" } });
        if (saida) {
          await client.turnoIaWhatsapp.updateMany({ where: { id: job.id, reservaToken: token }, data: { status: "indeterminado", motivo: "REINICIO_APOS_SAIDA", leaseAte: null } });
          continue;
        }
      }
      const conferirLease = async () => {
        const posse = await client.turnoIaWhatsapp.updateMany({ where: { id: job.id, reservaToken: token, status: "processando" }, data: { leaseAte: new Date(Date.now() + 90000) } });
        if (!posse.count) {
          leaseValido = false;
          throw Object.assign(new Error("O turno foi cancelado ou substituído."), { codigo: "TURNO_CANCELADO" });
        }
        if (!leaseValido || !await renovarLease(lease, { client })) {
          leaseValido = false;
          throw Object.assign(new Error("A reserva do turno expirou."), { codigo: "LEASE_PERDIDA" });
        }
      };
      timer = setInterval(async () => {
        if (renovando) return;
        renovando = true;
        try {
          await conferirLease();
        } catch { leaseValido = false; }
        finally { renovando = false; }
      }, 20000);
      timer.unref?.();
      const responderJob = job.perfil === "LEAD" ? responderComercial || (await import("./AssistenteComercialService.js")).responderLead : executar;
      const r = await responderJob({ conversaId: job.conversaId, mensagemId: job.mensagemId, deps: {
        client, log, turnoIaId: job.id, leaseExterno: true, conferirLease,
        contexto: job.atendimentoId ? { atendimentoId: job.atendimentoId, versao: job.contextoVersao, conversaId: job.conversaId, portalClientId: job.portalClientId } : null,
        contextoFixadoNoJob: true,
      } });
      const status = r?.feito ? "respondido" : r?.indeterminado ? "indeterminado"
        : ["CHAT_EXCLUIDO", "AUTOMACAO_INVALIDADA", "TURNO_CANCELADO", "CONTEXTO_INVALIDO", "CONTEXTO_ALTERADO", "CONTEXTO_EXPIRADO", "ACESSO_REVOGADO", "SEM_ESCOPO_VERIFICADO", "SEM_ESCOPO_COMERCIAL", "ASSUMIDA_POR_HUMANO", "FORA_DO_PILOTO", "FORA_DA_JANELA", "JA_RESPONDIDA"].includes(r?.motivo) ? "ignorado" : "falhou";
      await client.turnoIaWhatsapp.updateMany({ where: { id: job.id, reservaToken: token }, data: {
        status, motivo: r?.motivo || "ERRO", leaseAte: null,
        concluidoEm: ["respondido", "ignorado"].includes(status) ? new Date() : null,
        proximaTentativaEm: new Date(Date.now() + Math.min(300000, 5000 * 2 ** job.tentativas)),
      } });
      processados += 1;
    } catch (e) {
      const saida = await client.mensagemWhatsapp.findFirst({ where: { turnoIaId: job.id, direcao: "out" } }).catch(() => true);
      await client.turnoIaWhatsapp.updateMany({ where: { id: job.id, reservaToken: token }, data: { status: saida ? "indeterminado" : "falhou", motivo: String(e?.codigo || "ERRO"), leaseAte: null, proximaTentativaEm: new Date(Date.now() + 30000) } }).catch(() => {});
      log?.error?.({ turnoId: job.id, codigo: e?.codigo }, "IA: turno permanece registrado");
    } finally {
      clearInterval(timer);
      await liberarLease(lease, { client });
    }
  }
  return { processados };
}
