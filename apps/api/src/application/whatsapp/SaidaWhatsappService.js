import { prisma } from "../../infrastructure/db/prisma.js";
import { log } from "../../config.js";

// Uma saída é registrada antes da rede. Timeout nunca dispara reenvio automático.
export async function enviarMensagemRastreada({ conversa, tipo = "text", corpo = null, autor = "HUMANO", turnoIaId = null, enviar, antesDeEnviar = null, client = prisma }) {
  if (antesDeEnviar) await antesDeEnviar();
  const mensagem = await client.mensagemWhatsapp.create({ data: {
    conversaId: conversa.id, direcao: "out", tipo, corpo, autor, turnoIaId, statusEnvio: "enviando",
  } });
  let iniciouRede = false;
  let aceitou = false;
  let wamid = null;
  try {
    if (antesDeEnviar) await antesDeEnviar();
    iniciouRede = true;
    const r = await enviar();
    aceitou = true;
    wamid = r?.wamid || null;
    if (!wamid) throw Object.assign(new Error("A Meta não devolveu o identificador da mensagem."), { codigo: "SEM_WAMID", indeterminado: true });
    const salva = await client.mensagemWhatsapp.update({ where: { id: mensagem.id }, data: {
      providerMessageId: wamid, statusEnvio: "enviado", enviadoEm: new Date(),
    } });
    await client.conversaWhatsapp.update({ where: { id: conversa.id }, data: { updatedAt: new Date() } });
    return { ...r, mensagem: salva };
  } catch (err) {
    const httpStatus = err?.httpStatus ?? err?.traducao?.httpStatus;
    const indeterminado = iniciouRede && (aceitou || err?.indeterminado === true || !httpStatus);
    const recuperacao = {
      statusEnvio: indeterminado ? "indeterminado" : "falhou",
      ...(wamid ? { providerMessageId: wamid, enviadoEm: new Date() } : {}),
      erroEnvioCodigo: String(err?.codigo || (indeterminado ? "ENVIO_INDETERMINADO" : "ENVIO_INTERROMPIDO")),
      erroEnvioMensagem: indeterminado ? "Não foi possível confirmar a entrega. Confira o histórico antes de reenviar." : String(err?.mensagemUsuario || "O envio foi interrompido antes da confirmação."),
    };
    try {
      await client.mensagemWhatsapp.updateMany({ where: { id: mensagem.id, statusEnvio: "enviando" }, data: recuperacao });
    } catch {
      // Identificadores bastam para reconciliar; nunca registrar texto, destinatário ou credenciais.
      log.error({ mensagemId: mensagem.id, turnoIaId, providerMessageId: wamid, codigo: "SAIDA_RECONCILIACAO_NECESSARIA" }, "WhatsApp: falha ao preservar o resultado do envio");
    }
    err.indeterminado = indeterminado;
    throw err;
  }
}

/** Eventos repetidos/fora de ordem não rebaixam prova de entrega nem apagam rejeição com sent atrasado. */
export async function aplicarStatusMensagem({ providerMessageId, status, ocorridaEmProvedor = null, erroCodigo = null, erroMensagem = null, client = prisma }) {
  const m = await client.mensagemWhatsapp.findUnique({ where: { providerMessageId } });
  if (!m || m.envioGuiaId || m.direcao !== "out") return null;
  const novo = { sent: "enviado", delivered: "entregue", read: "lido", failed: "falhou" }[status];
  if (!novo) return null;
  const peso = { enviado: 1, entregue: 2, lido: 3 };
  if (m.statusEnvio === "falhou" && novo === "enviado") return { mudou: false, mensagem: m };
  if ((m.statusEnvio === "entregue" || m.statusEnvio === "lido") && novo === "falhou") return { mudou: false, mensagem: m };
  if (novo !== "falhou" && (peso[m.statusEnvio] || 0) >= peso[novo]) return { mudou: false, mensagem: m };
  const quando = ocorridaEmProvedor || new Date();
  const data = { statusEnvio: novo,
    ...(novo === "enviado" ? { enviadoEm: m.enviadoEm || quando } : {}),
    ...(novo === "entregue" ? { entregueEm: m.entregueEm || quando } : {}),
    ...(novo === "lido" ? { entregueEm: m.entregueEm || quando, lidoEm: m.lidoEm || quando } : {}),
    erroEnvioCodigo: novo === "falhou" ? erroCodigo : null,
    erroEnvioMensagem: novo === "falhou" ? erroMensagem : null,
  };
  const r = await client.mensagemWhatsapp.updateMany({ where: { id: m.id, statusEnvio: m.statusEnvio }, data });
  if (!r.count) return aplicarStatusMensagem({ providerMessageId, status, ocorridaEmProvedor, erroCodigo, erroMensagem, client });
  return { mudou: true, mensagem: { ...m, ...data } };
}
