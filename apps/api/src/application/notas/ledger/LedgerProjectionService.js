// Robustez NFS-e/ADN — Fase 1: projeção de situação da nota.
// Status é PROJEÇÃO recalculável a partir de documento + eventos ordenados — NUNCA coluna gravada.
// Pode ser reconstruída do zero a qualquer momento. Precedência: cancelamento/ofício vence tudo;
// senão substituição; senão bloqueio pendente; senão AUTORIZADA.

import { prisma } from "../../../infrastructure/db/prisma.js";

// Pura: recebe os eventos e devolve { situacao, chaveSubstituta }. Não lê o banco.
export function projetarSituacao(eventos) {
  const evs = [...(eventos || [])].sort((a, b) => {
    const da = a.dataEvento ? new Date(a.dataEvento).getTime() : 0;
    const db = b.dataEvento ? new Date(b.dataEvento).getTime() : 0;
    if (da !== db) return da - db;
    return (a.nSeqEvento || 0) - (b.nSeqEvento || 0);
  });

  let situacao = "AUTORIZADA";
  let chaveSubstituta = null;
  let bloqueada = false;

  for (const ev of evs) {
    switch (ev.tipoEvento) {
      case "cancelamento":
      case "canc_por_oficio":
        return { situacao: "CANCELADA", chaveSubstituta: null }; // vence tudo
      case "canc_por_substituicao":
        situacao = "SUBSTITUIDA";
        chaveSubstituta = ev.chaveSubstituta || null;
        break;
      case "bloqueio_oficio":
        bloqueada = true;
        break;
      case "desbloqueio_oficio":
        bloqueada = false;
        break;
      default:
        break; // confirmacao | confirmacao_tacita | anulacao_rejeicao não mudam a situação base
    }
  }

  if (situacao === "SUBSTITUIDA") return { situacao, chaveSubstituta };
  if (bloqueada) return { situacao: "BLOQUEADA", chaveSubstituta: null };
  return { situacao: "AUTORIZADA", chaveSubstituta: null };
}

// Lê os eventos da chave e projeta a situação. Documento sem eventos = AUTORIZADA.
export async function computeSituacao(chaveAcesso, tx = prisma) {
  const eventos = await tx.evento.findMany({
    where: { chaveAcesso },
    orderBy: [{ dataEvento: "asc" }, { nSeqEvento: "asc" }],
  });
  return projetarSituacao(eventos);
}
