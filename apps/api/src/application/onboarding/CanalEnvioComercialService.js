import { OnboardingError } from "./OnboardingService.js";
import { exigirConversaDoCaso } from "./ContextoComercialService.js";

const recusar = () => new OnboardingError("canal_comercial_necessario", "Abra a conversa deste contato no canal comercial e confira o destino antes de enviar.", 409);

/** Resolve apenas conversas existentes. O mesmo interlocutor não autoriza outro telefone/vigência. */
export async function resolverConversaEnvioComercial({ caso, conversaId, db }) {
  if (conversaId !== undefined && (typeof conversaId !== "string" || !conversaId.trim())) throw recusar();
  if (!caso?.conversaId || caso.encerradoEm) throw recusar();
  const origem = await db.conversaWhatsapp.findUnique({ where: { id: caso.conversaId } });
  await exigirConversaDoCaso(caso, origem, db);
  // Cadastro ativo identifica cliente; não concede acesso fiscal nem altera a solicitação.
  const contato = await db.contatoWhatsapp.findFirst({ where: {
    ativo: true,
    ...(origem.vinculoNumeroId ? { vinculoNumeroId: origem.vinculoNumeroId }
      : { vinculoNumeroId: null, OR: [{ telefoneE164: origem.telefoneE164 }, { waId: origem.telefoneE164 }] }),
  }, select: { id: true } });
  let destino;
  if (conversaId !== undefined) destino = await db.conversaWhatsapp.findUnique({ where: { id: conversaId } });
  else if (contato) destino = origem;
  else if (!origem.vinculoNumeroId) destino = origem; // legado nunca salta para outro fio por telefone
  else {
    const candidatos = await db.conversaWhatsapp.findMany({ where: {
      telefoneE164: origem.telefoneE164, vinculoNumeroId: origem.vinculoNumeroId,
      portalClientId: origem.portalClientId, excluidaEm: null,
      canalWhatsapp: { is: { ativo: true, finalidade: "COMERCIAL" } },
    }, take: 2 });
    if (candidatos.length !== 1) throw recusar();
    [destino] = candidatos;
  }
  if (!destino || destino.telefoneE164 !== origem.telefoneE164 || (destino.vinculoNumeroId || null) !== (origem.vinculoNumeroId || null)) throw recusar();
  await exigirConversaDoCaso(caso, destino, db);
  const canal = await db.canalWhatsapp.findUnique({ where: { id: destino.canalId || "principal" } });
  if (!canal?.ativo || (!contato && canal.finalidade !== "COMERCIAL")) throw recusar();
  return destino;
}
