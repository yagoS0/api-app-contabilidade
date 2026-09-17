/**
 * O DRE GERENCIAL — a LIGAÇÃO com o banco (29/08/2026).
 *
 * > Dono: *"a nossa DRE para o cliente deve ser montada baseada no nosso plano de contas."*
 *
 * ⚠⚠ **A REGRA NÃO MORA AQUI** — ela está em `lib/dreGerencial.js`, pura e testada. Aqui só se lê o
 * que ela precisa: os lançamentos da competência e o plano de contas. Uma segunda regra neste
 * arquivo divergiria da primeira na correção seguinte.
 *
 * ⚠⚠ **NADA AQUI ESCREVE.** O DRE não classifica conta, não corrige lançamento e não chama serviço
 * externo — ele LÊ. Há teste varrendo a fonte para provar.
 */

import { prisma } from "../../infrastructure/db/prisma.js";
import { carregarPlano } from "../accounting/AliquotaPorLancamentosService.js";
import { montarDreGerencial } from "./lib/dreGerencial.js";

const COMPETENCIA_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export class DreRecusado extends Error {
  constructor(codigo, frase) {
    super(codigo);
    this.name = "DreRecusado";
    this.codigo = codigo;
    this.frase = frase;
  }
}

export const RECUSA_DO_DRE = Object.freeze({
  COMPETENCIA_INVALIDA: "competencia_invalida",
  COMPETENCIA_NAO_FECHADA: "competencia_nao_fechada",
});

export const FRASE_DA_RECUSA_DO_DRE = Object.freeze({
  [RECUSA_DO_DRE.COMPETENCIA_INVALIDA]: "Use a competência no formato AAAA-MM.",
  [RECUSA_DO_DRE.COMPETENCIA_NAO_FECHADA]: "A DRE está disponível somente para competências com fechamento contábil concluído.",
});

/**
 * ⚠⚠ O DRE DE UMA COMPETÊNCIA.
 *
 * A competência omitida seleciona o fechamento mais recente desta empresa. Competência explícita
 * precisa estar fechada: nunca consultar os lançamentos de um mês aberto para montar esta DRE.
 *
 * ⚠ **`carregarPlano` é REUSADA**, não reescrita: ela já sabe que empresa vence global e já traz o
 * `codigoCompleto`. Uma segunda leitura do plano faria o DRE e a tela de lançamento discordarem
 * sobre qual conta é qual.
 */
export async function montarDre({ portalClientId, competencia, client = prisma }) {
  const pedida = String(competencia ?? "").trim();
  if (pedida && !COMPETENCIA_RE.test(pedida)) {
    throw new DreRecusado(
      RECUSA_DO_DRE.COMPETENCIA_INVALIDA,
      FRASE_DA_RECUSA_DO_DRE[RECUSA_DO_DRE.COMPETENCIA_INVALIDA],
    );
  }

  const fechamentos = await client.companyMonthlyCircular.findMany({
    where: { portalClientId: String(portalClientId), fechadoContabilEm: { not: null } },
    select: { competencia: true, fechadoContabilEm: true },
    orderBy: { competencia: "desc" },
  });
  const competenciasDisponiveis = fechamentos.map(f => f.competencia);
  const fechamento = pedida ? fechamentos.find(f => f.competencia === pedida) : fechamentos[0];
  if (pedida && !fechamento) {
    throw new DreRecusado(
      RECUSA_DO_DRE.COMPETENCIA_NAO_FECHADA,
      FRASE_DA_RECUSA_DO_DRE[RECUSA_DO_DRE.COMPETENCIA_NAO_FECHADA],
    );
  }
  if (!fechamento) {
    return {
      semCompetenciaFechada: true, competencia: null, competenciasDisponiveis: [], fechadoEm: null,
      linhas: [], naoClassificado: [], inconsistencias: [], demonstracao: false, semLancamento: true,
    };
  }
  const comp = fechamento.competencia;

  const [lancamentos, plano] = await Promise.all([
    client.accountingEntry.findMany({
      where: { portalClientId: String(portalClientId), competencia: comp },
      // ⚠ Só o que a regra lê. O `historico` e o `tipo` do lançamento não entram no DRE — quem
      // decide o grupo é a CONTA, e trazer o resto seria carregar o razão para somar cinco linhas.
      select: { status: true, lines: { select: { tipo: true, valor: true, conta: true } } },
    }),
    carregarPlano(portalClientId, client),
  ]);

  const dre = montarDreGerencial({
    lancamentos,
    /**
     * ⚠⚠ O MAPA DE `carregarPlano` JÁ É O RESOLVIDO — não se resolve de novo.
     *
     * Ela devolve `Map<codigoREDUZIDO, conta>` com a precedência já aplicada (as globais entram
     * primeiro e as da EMPRESA sobrescrevem). Passá-lo por `resolverPlanoPorCodigo` seria uma
     * SEGUNDA precedência sobre o mesmo dado — e no dia em que as duas discordassem, o DRE leria uma
     * conta e a tela de lançamento outra, sobre o mesmo código.
     *
     * ⚠ A chave é o REDUZIDO porque é o que `AccountingEntryLine.conta` guarda (texto, sem FK); o
     * que decide o GRUPO é o `codigoCompleto` que vem dentro da conta. As duas são diferentes, e
     * trocá-las põe receita em despesa sem erro nenhum.
     */
    planoPorCodigo: plano,
    competencia: comp,
  });
  // O fechamento é a revisão explícita do mês. Não altera o status persistido dos lançamentos
  // nem esconde problemas de classificação/valores. A regra pura continua reconhecendo rascunhos.
  const motivos = dre.qualidade.motivos.filter(m => m !== "lancamento_rascunho");
  const provisorio = dre.qualidade.linhasNaoClassificadas > 0 || dre.qualidade.linhasInvalidas > 0;
  return {
    ...dre, semCompetenciaFechada: false, competenciasDisponiveis, fechadoEm: fechamento.fechadoContabilEm,
    qualidade: {
      ...dre.qualidade, motivos, provisorio,
      status: dre.semLancamento ? "SEM_LANCAMENTOS" : provisorio ? "PROVISORIO" : "SEM_PENDENCIAS_IDENTIFICADAS",
    },
  };
}
