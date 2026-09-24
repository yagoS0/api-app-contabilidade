// Portal Cliente (#3.1): "liberar guias ao cliente".
// O app do cliente só mostra guias com liberadaCliente=true. Aqui o contador libera (ou revoga)
// todas as guias PROCESSED de uma competência. Ao liberar, dispara o e-mail (decisão do dono).

import { prisma } from "../../infrastructure/db/prisma.js";
import { sendCompanyGuidesEmail } from "./GuideCompanyEmailService.js";
import { conferirParcelasParaEnvio } from "./GuiaParcelaEnvioGuard.js";

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
  const guias = await prisma.guide.findMany({ where: { portalClientId: cid, competencia: comp, status: "PROCESSED" } });
  await conferirParcelasParaEnvio(guias);
  const upd = await prisma.$transaction(async tx => {
    let count = 0;
    for (const guide of guias.filter(g => !g.liberadaCliente)) {
      const r = await tx.guide.updateMany({
        where: { id: guide.id, portalClientId: cid, updatedAt: guide.updatedAt, competencia: comp, status: "PROCESSED", liberadaCliente: false },
        data: { liberadaCliente: true, liberadaEm: new Date(), liberadaPor: userId ? String(userId) : null },
      });
      if (r.count !== 1) throw Object.assign(new Error("Uma guia mudou durante a conferência. Atualize a lista antes de liberar."), { code: "CONFERENCIA_DIVERGENTE", status: 409 });
      count += r.count;
    }
    return { count };
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

// Libera UMA guia PROCESSED ao cliente (página da empresa, guia selecionada). Só marca a flag;
// o e-mail dessa única guia é disparado pela rota via worker por-guia — NÃO empacota DAS+INSS
// como o envio em lote da página principal. No-op (count 0) se já liberada ou não PROCESSED.
export async function liberarGuiaCliente({ guideId, userId }) {
  const gid = String(guideId || "").trim();
  if (!gid) {
    const err = new Error("guideId inválido");
    err.code = "INVALID_INPUT";
    throw err;
  }
  const guide = await prisma.guide.findUnique({ where: { id: gid } });
  await conferirParcelasParaEnvio(guide ? [guide] : []);
  const upd = await prisma.guide.updateMany({
    where: { id: gid, ...(guide?.updatedAt ? { updatedAt: guide.updatedAt } : {}), status: "PROCESSED", liberadaCliente: false },
    data: { liberadaCliente: true, liberadaEm: new Date(), liberadaPor: userId ? String(userId) : null },
  });
  return { liberadas: upd.count };
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
