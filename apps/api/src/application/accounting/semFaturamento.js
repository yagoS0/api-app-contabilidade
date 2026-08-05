// "Mês sem faturamento" — a afirmação de que a competência não teve receita.
//
// POR QUE ISTO SAIU DA ROTA
// As duas recusas moravam DENTRO do handler HTTP. Enquanto o único caminho era o contador clicando,
// isso bastava. A partir do momento em que o extrato zerado do PGDAS-D passa a marcar sozinho, um
// caminho automático gravando direto no Prisma **nasceria sem nenhuma das duas travas** — e
// marcaria "sem faturamento" numa empresa com nota emitida, gravando uma afirmação falsa em nome do
// escritório. Uma definição só; duas divergiriam, que é o padrão de falha já registrado três vezes
// neste projeto.
//
// ⚠ NÃO é preferência de tela. É afirmação fiscal: grava quem afirmou e quando, libera o
// fechamento, e some com a exigência do DAS no painel.

import { prisma } from "../../infrastructure/db/prisma.js";
// Mesma definição de faturamento que a apuração usa — importada, não copiada. Duas cópias fariam
// apuração e fechamento discordarem sobre se o mês teve receita, com o contador no meio.
import { faturamentoEmitDaCompetencia } from "../notas/apuracao/v2/FechamentoService.js";

/**
 * @param {object} opts
 * @param {string} opts.portalClientId
 * @param {string} opts.competencia YYYY-MM
 * @param {boolean} opts.ok `true` afirma que não houve faturamento; `false` desfaz
 * @param {string|null} [opts.userId] quem afirmou. **`null` no caminho automático** — ali quem
 *   afirma é a declaração transmitida à Receita, não uma pessoa
 * @param {string} [opts.origem] rastro de quem marcou ("manual" | "extrato_pgdas_zerado")
 * @returns {Promise<{ok:true, competencia, semFaturamento, conferencia}|{ok:false, error, message, ...}>}
 *   Recusa é RETORNO, não exceção: o caminho automático precisa seguir a captura normalmente
 *   depois de uma recusa, e exceção obrigaria todo chamador a envolver em try/catch para um caso
 *   que é esperado.
 */
export async function marcarSemFaturamento({ portalClientId, competencia, ok, userId = null, origem = "manual" }) {
  if (!/^\d{4}-\d{2}$/.test(String(competencia || ""))) {
    return { ok: false, error: "competencia_required", message: "Competência inválida." };
  }

  let conferencia = "sem_conferencia";

  if (ok) {
    // 1ª recusa — evidência DIRETA contra a afirmação.
    const faturamento = await faturamentoEmitDaCompetencia(portalClientId, competencia);
    if (faturamento > 0) {
      return {
        ok: false,
        error: "SEM_FATURAMENTO_COM_RECEITA",
        faturamento,
        message: `A competência tem R$ ${faturamento.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} em notas emitidas autorizadas. Não dá para marcar como sem faturamento.`,
      };
    }

    // ⚠ Zero de faturamento e "não conseguimos ver o faturamento" são a MESMA leitura aqui.
    // Município fora do ADN, A1 vencido ou cursor NSU travado devolvem zero sem que ninguém tenha
    // provado ausência de receita. A conferência do ADN é a segunda fonte:
    //
    //  - `divergente` = o ADN tem chave que nós não temos. Não é falta de informação, é PROVA de
    //    nota faltando → recusa, mesma trava que `salvarFechamento` aplica.
    //  - `nao_conferivel` / nunca conferida = aceita, mas GRAVA que foi aceita sem conferir.
    //    Exigir conferência "ok" inutilizaria o campo em toda empresa de município fora do ADN —
    //    justamente onde ele mais serve (decisão do dono).
    const snap = await prisma.apuracaoSnapshot.findUnique({
      where: { portalClientId_competencia: { portalClientId, competencia } },
      select: { conferenciaStatus: true, conferenciaResultado: true },
    });
    const status = String(snap?.conferenciaStatus || "");
    if (status === "divergente") {
      const faltantes = Array.isArray(snap?.conferenciaResultado?.faltantes)
        ? snap.conferenciaResultado.faltantes.length
        : null;
      return {
        ok: false,
        error: "SEM_FATURAMENTO_CONFERENCIA_DIVERGENTE",
        faltantes,
        message: faltantes
          ? `A conferência contra o ADN encontrou ${faltantes} nota(s) que o ADN tem e nós não. Resolva a divergência antes de afirmar que o mês não teve faturamento.`
          : "A conferência contra o ADN está divergente. Resolva a divergência antes de afirmar que o mês não teve faturamento.",
      };
    }
    conferencia = status === "ok" ? "ok" : (status ? "nao_conferivel" : "sem_conferencia");
  }

  const dados = ok
    ? {
      semFaturamento: true,
      semFaturamentoEm: new Date(),
      semFaturamentoPor: userId,
      semFaturamentoConferencia: conferencia,
    }
    : {
      semFaturamento: false,
      semFaturamentoEm: null,
      semFaturamentoPor: null,
      semFaturamentoConferencia: null,
    };

  const existing = await prisma.companyMonthlyCircular.findUnique({
    where: { portalClientId_competencia: { portalClientId, competencia } },
    select: { id: true },
  });
  if (existing) await prisma.companyMonthlyCircular.update({ where: { id: existing.id }, data: dados });
  else await prisma.companyMonthlyCircular.create({ data: { portalClientId, competencia, ...dados } });

  return { ok: true, competencia, semFaturamento: ok, conferencia: ok ? conferencia : null, origem };
}
