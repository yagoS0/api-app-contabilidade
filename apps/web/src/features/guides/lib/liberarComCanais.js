// Cada resposta descreve só o que aquele canal confirmou.
import { decidirCanaisAoLiberar, resumirDesfechoDosCanais, PERGUNTA_WHATSAPP, perguntaDeReenvio, desfechoWhatsapp } from "./canalDeEnvio";
export async function liberarComCanais({ api, companyId, guideId, perguntar, reenviarConfirmado = false, ambos = false }) {
  let cadastro;
  try {
    cadastro = await api.listarContatosWhatsapp(companyId);
    if (!["EMAIL", "WHATSAPP", "PERGUNTAR"].includes(cadastro?.canalPadraoEnvio)) throw new Error("Canal de envio não informado pelo servidor.");
  } catch (err) {
    return { ok: false, tom: "erro", texto: `Não foi possível conferir a configuração de envio. Nenhum envio foi iniciado. ${err?.message || "Atualize e tente novamente."}`, email: null, whatsapp: null };
  }
  const confirmar = perguntar || ((p) => window.confirm(p));
  const decisao = decidirCanaisAoLiberar(cadastro);
  const querWhatsapp = ambos || decisao.whatsapp || (decisao.perguntar && confirmar(PERGUNTA_WHATSAPP));
  let email;
  let bloqueado = false;
  try {
    email = reenviarConfirmado ? await api.resendGuideEmail(guideId) : await api.liberarGuiaCliente(guideId);
  } catch (err) {
    // Recusa de acesso/dados bloqueia a ação. Transporte incerto não repete o e-mail.
    // O endpoint WhatsApp verifica acesso, guia e elegibilidade independentemente.
    bloqueado = Number(err?.status) >= 400 && Number(err?.status) < 500;
    email = { sent: false, incerto: !bloqueado, message: bloqueado ? (err?.message || "A liberação foi recusada.")
      : "Não foi possível confirmar a liberação e o e-mail. Confira o histórico antes de repetir esse canal." };
  }
  const emailDesfecho = { feito: Boolean(email?.sent), naoSeAplica: email?.envio?.naoSeAplica === true, message: email?.message || null };
  let whatsapp = null;
  if (querWhatsapp && !bloqueado) {
    try {
      const r = reenviarConfirmado ? await api.enviarGuiaWhatsapp(companyId, guideId, { reenviar: true }) : await api.enviarGuiaWhatsapp(companyId, guideId, { complementar: true });
      whatsapp = desfechoWhatsapp(r);
    } catch (err) {
      whatsapp = desfechoWhatsapp(err?.payload || { ok: false, message: err?.message, motivo: err?.code });
      if (!reenviarConfirmado && err?.code === "GUIA_JA_ENVIADA" && confirmar(perguntaDeReenvio(err?.message))) {
        try { whatsapp = desfechoWhatsapp(await api.enviarGuiaWhatsapp(companyId, guideId, { reenviar: true })); }
        catch (outro) { whatsapp = desfechoWhatsapp(outro?.payload || { ok: false, message: outro?.message, motivo: outro?.code }); }
      }
    }
  }
  const resumo = resumirDesfechoDosCanais({ email: emailDesfecho, whatsapp });
  return { ok: resumo.tom !== "erro", ...resumo, email, whatsapp };
}
