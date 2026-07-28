// Anotações do contador sobre a empresa — o que hoje mora só na cabeça de quem atende.
//
// Duas regras que o dono definiu e que valem por toda a feature:
//  1. A anotação FIXADA aparece sempre no topo, INDEPENDENTE da ordenação escolhida.
//  2. Só uma fica fixada por vez: fixar uma nova desafixa a anterior.
//
// A regra 1 é fácil de quebrar sem dar erro (basta alguém trocar o `orderBy` numa manutenção e a
// fixada afunda no meio da lista), então a ordenação vive aqui, num lugar só, e não na rota.

import { prisma } from "../../infrastructure/db/prisma.js";

export const IMPORTANCIAS = ["ALTA", "MEDIA", "BAIXA"];

// Ordem de exibição da importância. Não dá pra usar `orderBy` do Prisma direto: alfabeticamente
// ALTA < BAIXA < MEDIA, que não é a ordem que interessa. Por isso o desempate é em memória.
const PESO_IMPORTANCIA = { ALTA: 0, MEDIA: 1, BAIXA: 2 };

export class CompanyNoteError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function normalizaImportancia(valor, fallback = "MEDIA") {
  const v = String(valor || "").trim().toUpperCase();
  return IMPORTANCIAS.includes(v) ? v : fallback;
}

export async function listar({ portalClientId, ordenarPor = "data" }) {
  const notas = await prisma.companyNote.findMany({ where: { portalClientId } });
  const porData = (a, b) => new Date(b.createdAt) - new Date(a.createdAt);
  const porImportancia = (a, b) => {
    const d = (PESO_IMPORTANCIA[a.importancia] ?? 9) - (PESO_IMPORTANCIA[b.importancia] ?? 9);
    return d !== 0 ? d : porData(a, b); // mesma importância → mais recente primeiro
  };
  const criterio = ordenarPor === "importancia" ? porImportancia : porData;

  // A fixada vem antes de tudo — este `sort` é a regra 1, não uma preferência de exibição.
  return notas.sort((a, b) => {
    if (a.fixada !== b.fixada) return a.fixada ? -1 : 1;
    return criterio(a, b);
  });
}

export async function criar({ portalClientId, texto, importancia, fixada = false, autorId }) {
  const conteudo = String(texto || "").trim();
  if (!conteudo) throw new CompanyNoteError("texto_vazio", "A anotação não pode ser vazia.");

  return prisma.$transaction(async (tx) => {
    if (fixada) await tx.companyNote.updateMany({ where: { portalClientId, fixada: true }, data: { fixada: false } });
    return tx.companyNote.create({
      data: {
        portalClientId,
        texto: conteudo,
        importancia: normalizaImportancia(importancia),
        fixada: Boolean(fixada),
        autorId: autorId || null,
      },
    });
  });
}

export async function atualizar({ portalClientId, noteId, texto, importancia, fixada }) {
  const atual = await prisma.companyNote.findFirst({ where: { id: noteId, portalClientId } });
  if (!atual) throw new CompanyNoteError("anotacao_nao_encontrada", "Anotação não encontrada.", 404);

  const data = {};
  if (texto !== undefined) {
    const conteudo = String(texto || "").trim();
    if (!conteudo) throw new CompanyNoteError("texto_vazio", "A anotação não pode ser vazia.");
    data.texto = conteudo;
  }
  if (importancia !== undefined) data.importancia = normalizaImportancia(importancia, atual.importancia);
  if (fixada !== undefined) data.fixada = Boolean(fixada);

  return prisma.$transaction(async (tx) => {
    // Desafixa as outras ANTES de fixar esta — a exclusividade é garantida aqui, na aplicação, e
    // não por constraint (um único parcial impediria o caso legítimo de nenhuma fixada).
    if (data.fixada === true) {
      await tx.companyNote.updateMany({
        where: { portalClientId, fixada: true, id: { not: noteId } },
        data: { fixada: false },
      });
    }
    return tx.companyNote.update({ where: { id: noteId }, data });
  });
}

export async function remover({ portalClientId, noteId }) {
  const atual = await prisma.companyNote.findFirst({ where: { id: noteId, portalClientId } });
  if (!atual) throw new CompanyNoteError("anotacao_nao_encontrada", "Anotação não encontrada.", 404);
  await prisma.companyNote.delete({ where: { id: noteId } });
  return atual;
}
