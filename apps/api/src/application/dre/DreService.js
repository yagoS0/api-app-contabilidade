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
});

export const FRASE_DA_RECUSA_DO_DRE = Object.freeze({
  [RECUSA_DO_DRE.COMPETENCIA_INVALIDA]: "Use a competência no formato AAAA-MM.",
});

/**
 * ⚠⚠ O DRE DE UMA COMPETÊNCIA.
 *
 * ⚠ **A competência é OBRIGATÓRIA e conferida aqui**, não defaultada para o mês corrente: um DRE que
 * escolhesse o mês por conta própria mostraria um resultado que ninguém pediu, com o rótulo do mês
 * certo — o defeito mais caro desta família, porque parece correto.
 *
 * ⚠ **`carregarPlano` é REUSADA**, não reescrita: ela já sabe que empresa vence global e já traz o
 * `codigoCompleto`. Uma segunda leitura do plano faria o DRE e a tela de lançamento discordarem
 * sobre qual conta é qual.
 */
export async function montarDre({ portalClientId, competencia, client = prisma }) {
  const comp = String(competencia || "").trim();
  if (!COMPETENCIA_RE.test(comp)) {
    throw new DreRecusado(
      RECUSA_DO_DRE.COMPETENCIA_INVALIDA,
      FRASE_DA_RECUSA_DO_DRE[RECUSA_DO_DRE.COMPETENCIA_INVALIDA],
    );
  }

  const [lancamentos, plano] = await Promise.all([
    client.accountingEntry.findMany({
      where: { portalClientId: String(portalClientId), competencia: comp },
      // ⚠ Só o que a regra lê. O `historico` e o `tipo` do lançamento não entram no DRE — quem
      // decide o grupo é a CONTA, e trazer o resto seria carregar o razão para somar cinco linhas.
      select: { lines: { select: { tipo: true, valor: true, conta: true } } },
    }),
    carregarPlano(portalClientId, client),
  ]);

  return montarDreGerencial({
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
}
