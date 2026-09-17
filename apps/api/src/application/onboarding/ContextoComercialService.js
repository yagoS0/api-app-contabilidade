import { OnboardingError } from "./OnboardingService.js";
import { conferirIdentidadeVigente } from "../whatsapp/IdentidadeComunicacaoService.js";

export const emTransacaoComercial = (db, fn) => typeof db.$transaction === "function" ? db.$transaction(fn) : fn(db);
export const filtroCasoDaConversa = (conversa, interlocutorId = null) => interlocutorId
  ? { interlocutorId } : { conversaId: conversa.id };

// O CNPJ em análise pertence à ficha comercial, nunca à empresa operacional do chat.
export async function identidadeDoCaso(conversa, db, { travar = false } = {}) {
  if (!conversa || conversa.excluidaEm || String(conversa.chaveEscopo || "").startsWith("legado:")) {
    throw new OnboardingError("conversa_indisponivel", "Abra a conversa atual deste contato.", 409);
  }
  if (!conversa.vinculoNumeroId) return null; // segmento anterior à migração
  let vinculo;
  try { ({ vinculoNumero: vinculo } = await conferirIdentidadeVigente({ vinculoNumeroId: conversa.vinculoNumeroId, telefone: conversa.telefoneE164, client: db })); }
  catch { throw new OnboardingError("identidade_alterada", "A identificação deste número mudou. Confira o atendimento.", 409); }
  if (travar) await db.interlocutorComunicacao.update({ where: { id: vinculo.interlocutorId }, data: { updatedAt: new Date() } });
  return vinculo.interlocutorId;
}

export async function exigirConversaDoCaso(caso, conversa, db) {
  const interlocutorId = await identidadeDoCaso(conversa, db);
  if (!caso || caso.encerradoEm || (caso.interlocutorId ? caso.interlocutorId !== interlocutorId : caso.conversaId !== conversa.id)) {
    throw new OnboardingError("atendimento_alterado", "A solicitação não pertence à identificação atual desta conversa.", 409);
  }
  return interlocutorId;
}

export async function capturarIdentidadeComercial(conversa, db) {
  const interlocutorId = await identidadeDoCaso(conversa, db);
  if (!interlocutorId) return null;
  const pessoa = await db.interlocutorComunicacao.findUnique({ where: { id: interlocutorId } });
  return { interlocutorId, versao: pessoa.versao };
}
export async function conferirIdentidadeComercial(conversa, esperado, db) {
  if (!esperado) return;
  const atual = await capturarIdentidadeComercial(conversa, db);
  if (atual?.interlocutorId !== esperado.interlocutorId || atual.versao !== esperado.versao) throw new OnboardingError("identidade_alterada", "A identificação ou o responsável mudou durante a preparação. Confira antes de enviar.", 409);
}
export async function assumirEnvioComercial(conversa, user, esperado, db) {
  await conferirIdentidadeComercial(conversa, esperado, db);
  if (conversa.vinculoNumeroId) {
    const { alterarAtendimentoHumano } = await import("../whatsapp/AtendimentoResponsavelWhatsappService.js");
    await alterarAtendimentoHumano({ conversa, atendidaPor: user.id, atendidaDesde: new Date(), client: db });
    esperado.versao++; // somente o incremento realizado por este comando pode prosseguir
  } else await db.conversaWhatsapp.update({ where: { id: conversa.id }, data: { atendidaPor: user.id, atendidaDesde: new Date() } });
  Object.assign(conversa, await db.conversaWhatsapp.findUnique({ where: { id: conversa.id } }));
  await conferirIdentidadeComercial(conversa, esperado, db);
}
