import { randomUUID } from "node:crypto";
import { prisma } from "../../../../infrastructure/db/prisma.js";

const TIPOS = new Set(["REVENDA_MERCADORIA", "INDUSTRIALIZACAO", "SERVICO_ANEXO_III", "SERVICO_ANEXO_IV", "SERVICO_ANEXO_V", "SERVICO_FATOR_R"]);
function erro(message, status = 400) { return Object.assign(new Error(message), { status, code: "classificacao_manual_invalida" }); }

// Escolha explícita do contador, limitada às notas selecionadas desta empresa e mês.
export async function aplicarClassificacaoManual({ portalClientId, competencia, classificacoes, userId }) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(competencia || ""))) throw erro("Informe uma competência válida.");
  if (!Array.isArray(classificacoes) || !classificacoes.length || classificacoes.length > 1000) throw erro("Selecione entre 1 e 1.000 notas.");
  if (classificacoes.some(c => !c || typeof c.notaId !== "string" || !TIPOS.has(c.tipoReceita)) || new Set(classificacoes.map(c => c.notaId)).size !== classificacoes.length) throw erro("Seleção de notas ou tipo de receita inválido.");
  const [ano, mes] = competencia.split("-").map(Number);
  const nota = { clientId: portalClientId, papel: "EMIT", statusEfetivo: "autorizada", competencia: { gte: new Date(Date.UTC(ano, mes - 1, 1)), lt: new Date(Date.UTC(ano, mes, 1)) } };
  return prisma.$transaction(async tx => {
    const snapshot = await tx.apuracaoSnapshot.findUnique({ where: { portalClientId_competencia: { portalClientId, competencia } } });
    if (["fechada", "transmitida", "confirmada", "transmitindo", "erro_transmissao"].includes(snapshot?.estado)) throw erro("Reabra ou confira a apuração antes de alterar a classificação desta competência.", 409);
    const notas = await tx.portalInvoice.findMany({ where: { ...nota, id: { in: classificacoes.map(c => c.notaId) } }, select: { id: true, itens: { select: { id: true } } } });
    if (notas.length !== classificacoes.length || notas.some(n => !n.itens.length)) throw erro("Há nota fora desta empresa/competência, não autorizada ou sem itens. Atualize a lista.", 409);
    // Disputa a mesma versão usada por salvar/transmitir. Rotação impede que uma leitura
    // concorrente anterior à classificação reserve a transmissão com a base antiga.
    if (snapshot) {
      const reserva = await tx.apuracaoSnapshot.updateMany({ where: { id: snapshot.id, estado: snapshot.estado, idempotencyKey: snapshot.idempotencyKey }, data: { idempotencyKey: `reclassificada:${randomUUID()}` } });
      if (reserva.count !== 1) throw erro("A apuração mudou durante a classificação. Atualize a página.", 409);
    }
    let processed = 0;
    for (const c of classificacoes) {
      const result = await tx.notaItem.updateMany({ where: { notaId: c.notaId, nota }, data: { tipoReceita: c.tipoReceita, classificadoEm: new Date() } });
      processed += result.count;
    }
    const pendencias = await tx.filaPendencia.findMany({ where: { portalClientId, competencia, tipo: "ITEM_SEM_REGRA", resolvida: false } });
    for (const p of pendencias) {
      const codigo = p.detalhes?.codigo;
      if (!codigo || codigo === "(sem-codigo)") continue;
      const restantes = await tx.notaItem.count({ where: { nota, AND: [{ OR: [{ codigoServico: codigo }, { ncm: codigo }, { cfop: codigo }] }, { OR: [{ tipoReceita: null }, { tipoReceita: "RECEITA_NAO_CLASSIFICADA" }] }] } });
      if (!restantes) await tx.filaPendencia.update({ where: { id: p.id }, data: { resolvida: true, resolvidaPor: userId, resolvidaEm: new Date(), acaoResolucao: "REENQUADROU" } });
    }
    // A foto anterior permanece auditável. O hash das notas invalida seu reaproveitamento.
    const pendentes = await tx.notaItem.count({ where: { nota, OR: [{ tipoReceita: null }, { tipoReceita: "RECEITA_NAO_CLASSIFICADA" }] } });
    return { processed, classified: processed, pendentes, escopo: { tipo: "COMPETENCIA", competencia }, manual: true };
  }, { isolationLevel: "Serializable" });
}
