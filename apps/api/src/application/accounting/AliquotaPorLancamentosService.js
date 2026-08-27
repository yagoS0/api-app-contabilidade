// A ALÍQUOTA EFETIVA POR LANÇAMENTO — a LIGAÇÃO com o banco. A regra vive em
// `lib/impostosSobreReceita.js`, que é pura; aqui só se busca e se resolve a conta.
//
// ⚠ SOMENTE LEITURA, e isso é invariante: nenhuma escrita, nenhuma chamada externa. Uma pergunta
// de "quanto esta empresa paga de imposto?" não pode ter efeito colateral. Travado por teste que
// varre `Object.values(prisma)` (molde de `auditoriaNaoEscreve.test.js`).
//
// ⚠⚠ A RESOLUÇÃO DA CONTA TEM PRECEDÊNCIA, E ERRAR NELA É SILENCIOSO. `ChartOfAccount` tem
// `@@unique([portalClientId, codigo])` e o projeto serve um **plano GLOBAL** (`portalClientId
// null`) que atende 33 dos 34 clientes, com uma única empresa tendo plano próprio. Então a conta
// "419" pode existir DUAS vezes: a da empresa e a global. **A da empresa vence.** Pegar a global
// por engano leria o `codigoCompleto` de outro plano — e a classificação inteira sai desta coluna.
//
// ⚠ `AccountingEntryLine.conta` é TEXTO sem FK: ele guarda o código REDUZIDO ("419"), não o
// completo. É por isso que existe este de-para; e é por isso que a linha com conta vazia não tem
// para onde ir (ver `naoClassificadas` na regra pura).

import { prisma } from "../../infrastructure/db/prisma.js";
import { aliquotaEfetivaDeLancamentos } from "./lib/impostosSobreReceita.js";

const COMPETENCIA = /^\d{4}-\d{2}$/;

/**
 * Monta o de-para `codigo reduzido → conta do plano`, com a conta da EMPRESA vencendo a GLOBAL.
 * Exportada porque a série (N competências) a monta UMA vez e reusa — buscar o plano por mês seria
 * a mesma consulta repetida doze vezes.
 */
export async function carregarPlano(portalClientId, client = prisma) {
  const contas = await client.chartOfAccount.findMany({
    where: { OR: [{ portalClientId: String(portalClientId) }, { portalClientId: null }] },
    // ⚠⚠ `analitica` entra aqui como PRÉ-REQUISITO, e HOJE NINGUÉM NESTE CAMINHO A LÊ — medido:
    // zero ocorrências de `analitica` em `declarados/lib/formaDoLancamento.js`, que é quem vai
    // recusar conta sintética na Conferência. O gate de verdade só existe em POST/PUT /entries
    // (`routes/firm/accountingEntries.js`, via `lib/gateContaSintetica.js`). Esta linha existe para
    // que, quando a trava for escrita, ela NÃO nasça cega: sem a coluna no `select`, o predicado
    // receberia `undefined`, responderia `false` para TODA conta, e a guarda existiria sem guardar
    // nada — a classe de defeito do `legacyCompanySelect`, que já mordeu três vezes neste projeto.
    // ⚠ Não leia este comentário como "a trava está ligada": ela não está.
    // ⚠⚠ E ela é TRI-ESTADO: `null` = conta sem `codigoCompleto`, que NÃO é sintética. Comparar
    // com `=== false`, nunca `!analitica` — com a negação, todo plano não reimportado sai sintético.
    select: { portalClientId: true, codigo: true, nome: true, codigoCompleto: true, analitica: true },
  });
  const mapa = new Map();
  // ⚠ As GLOBAIS entram primeiro e as da EMPRESA sobrescrevem — a ordem do `findMany` não é
  // garantida, então a precedência não pode depender dela.
  for (const c of contas) if (c.portalClientId === null) mapa.set(String(c.codigo), c);
  for (const c of contas) if (c.portalClientId !== null) mapa.set(String(c.codigo), c);
  return mapa;
}

/** As linhas de uma competência, com a conta já resolvida — a entrada da regra pura. */
export async function linhasDaCompetencia({ portalClientId, competencia, plano, client = prisma }) {
  const entries = await client.accountingEntry.findMany({
    where: { portalClientId: String(portalClientId), competencia: String(competencia) },
    select: {
      parcelamentoId: true,
      lines: { select: { conta: true, tipo: true, valor: true } },
    },
  });
  const linhas = [];
  for (const e of entries) {
    for (const l of e.lines || []) {
      const codigo = String(l.conta || "").trim();
      linhas.push({
        conta: codigo ? plano.get(codigo) || null : null,
        contaCodigo: codigo || null,
        tipo: l.tipo,
        valor: l.valor,
        parcelamentoId: e.parcelamentoId || null,
      });
    }
  }
  return linhas;
}

/**
 * A alíquota efetiva de UMA competência, calculada pelos lançamentos.
 *
 * ⚠ Não decide QUANDO usar esta conta — quem escolhe entre ela e a do PGDAS-D é o consumidor, pelo
 * regime. Um serviço que decidisse o regime aqui esconderia a escolha dentro do cálculo.
 */
export async function aliquotaPorLancamentos({ portalClientId, competencia, plano = null, client = prisma }) {
  if (!COMPETENCIA.test(String(competencia || ""))) {
    throw Object.assign(new Error("competencia_invalida"), { code: "COMPETENCIA_INVALIDA" });
  }
  const mapa = plano || (await carregarPlano(portalClientId, client));
  const linhas = await linhasDaCompetencia({ portalClientId, competencia, plano: mapa, client });
  return { competencia: String(competencia), ...aliquotaEfetivaDeLancamentos(linhas) };
}

/** A mesma conta para N competências, com o plano carregado UMA vez. */
export async function serieAliquotaPorLancamentos({ portalClientId, competencias, client = prisma }) {
  const lista = (Array.isArray(competencias) ? competencias : []).filter((c) => COMPETENCIA.test(String(c)));
  if (!lista.length) return [];
  const plano = await carregarPlano(portalClientId, client);
  const out = [];
  for (const competencia of lista) {
    out.push(await aliquotaPorLancamentos({ portalClientId, competencia, plano, client }));
  }
  return out;
}
