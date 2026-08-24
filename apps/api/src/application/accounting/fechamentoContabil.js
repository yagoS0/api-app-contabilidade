// Q18: fechamento contábil — utilitário compartilhado.
// Uma competência está FECHADA quando CompanyMonthlyCircular.fechadoContabilEm != null.
// Mês fechado bloqueia novos lançamentos e upload/registro de guias naquele mês.
import { prisma } from "../../infrastructure/db/prisma.js";

export async function isMonthClosed(portalClientId, competencia) {
  if (!portalClientId || !competencia) return false;
  const circ = await prisma.companyMonthlyCircular.findUnique({
    where: { portalClientId_competencia: { portalClientId: String(portalClientId), competencia: String(competencia) } },
    select: { fechadoContabilEm: true },
  });
  return Boolean(circ?.fechadoContabilEm);
}

/**
 * ⚠ A MESMA PERGUNTA, PARA VÁRIAS COMPETÊNCIAS DE UMA VEZ.
 *
 * Existe porque a fila de conferência precisa dizer, **antes do clique**, quais linhas não poderão
 * ser contabilizadas — e uma tela de 50 linhas faria 50 chamadas a `isMonthClosed`. O precedente
 * está registrado em `apps/api/CLAUDE.md`: *"Pré-voo no GET (…): a tela lê o que já foi buscado
 * ANTES do POST. A resposta do POST chegaria tarde demais."*
 *
 * ⚠⚠ ELA MORA AQUI, COLADA NA IRMÃ, E NÃO NO CONSUMIDOR. São duas leituras da mesma coluna, e
 * separá-las em arquivos diferentes é como as quatro cópias do filtro de envio de guia divergiram.
 * Juntas, quem mudar o critério de "fechada" vê as duas na mesma tela. Há teste exigindo que
 * concordem.
 *
 * ⚠ `isMonthClosed` NÃO foi reescrita para delegar a esta: ela tem dezenas de chamadores em
 * caminhos críticos (baixa, DELETE, guia, parcela), e trocar a query deles não é assunto da fila.
 *
 * @returns {Promise<Set<string>>} só as competências FECHADAS. Competência sem circular não está
 *   no conjunto — sem linha não há fechamento, que é a mesma resposta de `isMonthClosed`.
 */
export async function competenciasFechadas(portalClientId, competencias, client = prisma) {
  const alvo = [...new Set((competencias || []).filter(Boolean).map(String))];
  if (!portalClientId || !alvo.length) return new Set();
  const linhas = await client.companyMonthlyCircular.findMany({
    where: { portalClientId: String(portalClientId), competencia: { in: alvo } },
    select: { competencia: true, fechadoContabilEm: true },
  });
  return new Set(linhas.filter((l) => l.fechadoContabilEm).map((l) => l.competencia));
}
