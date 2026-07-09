// Portal Cliente (#3.1): "liberar guias ao cliente".
// O app do cliente só mostra guias com liberadaCliente=true. Aqui o contador libera (ou revoga)
// todas as guias PROCESSED de uma competência. Ao liberar, dispara o e-mail (decisão do dono).

import { prisma } from "../../infrastructure/db/prisma.js";
import { sendCompanyGuidesEmail } from "./GuideCompanyEmailService.js";

function validar({ portalClientId, competencia }) {
  const cid = String(portalClientId || "").trim();
  const comp = String(competencia || "").trim();
  if (!cid || !/^\d{4}-\d{2}$/.test(comp)) {
    const err = new Error("portalClientId/competencia inválidos");
    err.code = "INVALID_INPUT";
    throw err;
  }
  return { cid, comp };
}

// Libera todas as guias PROCESSED da competência + dispara o e-mail de guias ao cliente.
export async function liberarGuiasCliente({ portalClientId, competencia, userId }) {
  const { cid, comp } = validar({ portalClientId, competencia });
  const upd = await prisma.guide.updateMany({
    where: { portalClientId: cid, competencia: comp, status: "PROCESSED", liberadaCliente: false },
    data: { liberadaCliente: true, liberadaEm: new Date(), liberadaPor: userId ? String(userId) : null },
  });
  // Decisão do dono: liberar dispara o e-mail. Falha de e-mail não desfaz a liberação.
  let emailResult = null;
  try {
    emailResult = await sendCompanyGuidesEmail({ portalClientId: cid, competencia: comp });
  } catch (err) {
    emailResult = { ok: false, error: err?.code || "GUIDE_EMAIL_SEND_FAILED", message: err?.message };
  }
  return { liberadas: upd.count, emailResult };
}

// Revoga a liberação da competência (o cliente para de ver as guias). Não dispara e-mail.
export async function revogarLiberacaoCliente({ portalClientId, competencia }) {
  const { cid, comp } = validar({ portalClientId, competencia });
  const upd = await prisma.guide.updateMany({
    where: { portalClientId: cid, competencia: comp, liberadaCliente: true },
    data: { liberadaCliente: false, liberadaEm: null, liberadaPor: null },
  });
  return { revogadas: upd.count };
}
