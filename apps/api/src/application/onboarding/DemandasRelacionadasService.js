import { prisma } from "../../infrastructure/db/prisma.js";
import { exigirEscopo } from "./ComercialService.js";
import { ORIGENS, OnboardingError, extrairColunas } from "./OnboardingService.js";

// Copia somente o contato. Preço, documentos, consentimentos e progresso pertencem a cada demanda.
export async function criarDemandaRelacionada(id, body, user, db = prisma) {
  if (!ORIGENS.includes(body?.origem) || !Number.isInteger(body?.versao) || body.versao < 0) throw new OnboardingError("demanda_invalida", "Escolha o atendimento e atualize a ficha antes de continuar.", 400);
  if (body.chaveSolicitacao != null && (typeof body.chaveSolicitacao !== "string" || !/^[a-zA-Z0-9-]{16,80}$/.test(body.chaveSolicitacao))) throw new OnboardingError("demanda_invalida", "Identificador da solicitação inválido.", 400);
  return db.$transaction(async tx => {
    const origem = await exigirEscopo(id, user, tx);
    const reserva = await tx.onboarding.updateMany({ where: { id, versao: body.versao }, data: { updatedAt: new Date() } });
    if (reserva.count !== 1) throw new OnboardingError("formulario_alterado", "A ficha mudou. Atualize antes de criar outra demanda.", 409);
    const anterior = await tx.onboardingEvento.findFirst({ where: { onboardingId: id, tipo: "DEMANDA_RELACIONADA_CRIADA", dados: body.chaveSolicitacao ? { path: ["chaveSolicitacao"], equals: body.chaveSolicitacao } : { path: ["versaoOrigem"], equals: body.versao } } });
    if (anterior) {
      if (anterior.dados.origem !== body.origem) throw new OnboardingError("formulario_alterado", "A ficha mudou. Confira as demandas vinculadas.", 409);
      return exigirEscopo(anterior.dados.onboardingId, user, tx);
    }
    const dados = Object.fromEntries(["responsavelNome", "responsavelEmail", "responsavelTelefone"].map(c => [c, origem[c] || origem.dados?.[c] || ""]));
    const criada = await tx.onboarding.create({ data: { origem: body.origem, status: "RASCUNHO", origemPreenchimento: "ESCRITORIO", criadoPorId: origem.criadoPorId || user.id, dados, ...extrairColunas(body.origem, dados), eventos: { create: { tipo: "DEMANDA_ORIGEM", atorId: user.id, dados: { onboardingId: id, origem: origem.origem } } } } });
    await tx.onboardingEvento.create({ data: { onboardingId: id, tipo: "DEMANDA_RELACIONADA_CRIADA", atorId: user.id, dados: { onboardingId: criada.id, origem: body.origem, versaoOrigem: body.versao, chaveSolicitacao: body.chaveSolicitacao || null } } });
    return criada;
  });
}
