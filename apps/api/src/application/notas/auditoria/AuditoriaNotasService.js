// A LIGAÇÃO DA AUDITORIA COM O BANCO — e nada além disso.
//
// A REGRA mora em `auditoriaNotas.js`, que é puro. Este arquivo faz três coisas e para:
//   1. carrega as notas da competência — **e as que não têm competência nenhuma**, que é o conserto
//      de 21/08/2026 e está explicado em detalhe dentro de `auditarCompetencia`;
//   2. carrega o CADASTRO da empresa (`Company.codigosServicoNacional`), que é a autoridade da
//      primeira pergunta;
//   3. entrega as duas coisas à regra.
//
// ─── ⚠ A AUDITORIA NÃO ESCREVE NADA ────────────────────────────────────────────────────────────
//
// Nem marca nota, nem classifica, nem cria pendência, nem mexe em apuração. Não há `create`,
// `update`, `upsert`, `delete` nem `$transaction` neste módulo — e isso é PROVADO, não afirmado:
// `__tests__/auditoriaNaoEscreve.test.js` monta o prisma com os métodos de escrita lançando e, ao
// fim, varre `Object.values(prisma)` exigindo que nenhum tenha sido chamado. É o mesmo molde de
// `planejamento/__tests__/dadosPlanejamento.test.js`, que existe pelo mesmo motivo: uma leitura que
// grava "só um cachezinho" deixa de ser leitura (foi por isso que o Planejamento não pode usar
// `RbtExtratoService.getRbt12`, que faz `upsertCache` no fallback).
//
// ─── ⚠ NENHUMA CHAMADA EXTERNA ─────────────────────────────────────────────────────────────────
//
// ADN, SEFAZ, SERPRO e Meta ficam de fora. Tudo o que a auditoria lê já está no banco desde o
// backfill dos campos fiscais (16.818 notas) — e a captura passou a preenchê-los na entrada, nas
// três portas. Abrir a tela não pode gastar chamada paga nem mover cursor de NSU.
//
// ─── ⚠ MULTI-TENANCY ───────────────────────────────────────────────────────────────────────────
//
// `portalClientId` viaja no `where` de TODAS as queries. Quem confere se o chamador pode ver esta
// empresa é o middleware da rota (`requireFirmCompanyAccess`) — este serviço não reimplementa
// escopo, e não existe aqui uma quarta leitura de carteira.

import { prisma } from "../../../infrastructure/db/prisma.js";
import { auditarNotasDaCompetencia, SELECT_PARA_AUDITORIA } from "./auditoriaNotas.js";

/**
 * ⚠ QUANTAS NOTAS SEM COMPETÊNCIA A TELA LISTA — o TOTAL nunca é este número.
 *
 * A lista é amostra e vem limitada porque não há teto natural para quantas notas de uma empresa
 * podem estar sem `competencia` gravada, e esta é uma tela de leitura que abre a cada clique. O
 * **total** vem de um `count` separado e é ele que a tela mostra: uma lista truncada que dissesse
 * "são estas" mentiria exatamente sobre o número que este bloco existe para revelar.
 */
export const LIMITE_NOTAS_SEM_COMPETENCIA = 50;

const COMPETENCIA_RE = /^\d{4}-\d{2}$/;

function rangeDaCompetencia(competencia) {
  const [ano, mes] = String(competencia).split("-").map(Number);
  return { gte: new Date(Date.UTC(ano, mes - 1, 1)), lt: new Date(Date.UTC(ano, mes, 1)) };
}

/**
 * Roda a auditoria pré-apuração de UMA empresa numa competência. **Só leitura.**
 *
 * @param {Object} args
 * @param {string} args.portalClientId `PortalClient.id` — já autorizado pela rota.
 * @param {string} args.competencia    `"AAAA-MM"`.
 * @returns {Promise<Object>} o resultado de `auditarNotasDaCompetencia` (perguntas + `manutencao` +
 *                            `foraDaConferencia`) mais o bloco `empresa`.
 */
export async function auditarCompetencia({ portalClientId, competencia }) {
  if (!portalClientId) throw new Error("portalClientId obrigatório");
  if (!COMPETENCIA_RE.test(String(competencia || ""))) throw new Error("competencia inválida");

  // ⚠ O CADASTRO NÃO MORA NO `PortalClient`. A lista de serviços é do model legado `Company`,
  // alcançado por `PortalClient.companyId` (que é opcional — empresa sem `Company` existe, e nesse
  // caso a lista é vazia, que a regra já sabe responder como "não dá para conferir").
  const portal = await prisma.portalClient.findUnique({
    where: { id: portalClientId },
    select: { id: true, razao: true, cnpj: true, companyId: true },
  });
  if (!portal) throw new Error("empresa não encontrada");

  const legacy = portal.companyId
    ? await prisma.company.findUnique({
        where: { id: portal.companyId },
        // `codigoServicoNacional` (singular) vem junto de propósito: ele é o que a DPS LEVA, e a
        // tela precisa dos dois para explicar o cadastro sem que o contador precise abrir a ficha.
        select: { id: true, codigosServicoNacional: true, codigoServicoNacional: true },
      })
    : null;

  const { gte, lt } = rangeDaCompetencia(competencia);
  const daEmpresa = { clientId: portalClientId, type: "NFSE", papel: "EMIT" };

  // ⚠ ANTES DE 21/08/2026 ESTA QUERY CARREGAVA 12 MESES, para alimentar a pergunta de numeração da
  // DPS. Aquela pergunta foi removida (ver `auditoriaNotas.js`), e com ela caiu a janela: a
  // auditoria voltou a ler exatamente o mês que ela audita — 1/12 do volume, mesma resposta.
  const notasDoMes = await prisma.portalInvoice.findMany({
    where: { ...daEmpresa, competencia: { gte, lt } },
    select: SELECT_PARA_AUDITORIA,
    orderBy: [{ issueDate: "asc" }],
  });

  // ⚠⚠ AS DUAS QUERIES ABAIXO EXISTEM POR UM DEFEITO MEDIDO, e apagá-las reabre o defeito.
  //
  // O `where` acima filtra por `competencia: { gte, lt }`. Em SQL, `NULL` **não satisfaz** um BETWEEN
  // — então nota com `competencia` nula nunca chegava à regra. Ela não entrava em pergunta nenhuma e
  // **não aparecia nem na lista de "notas fora desta conferência"**, porque a regra nunca soube que
  // ela existia. A aba promete "nada some em silêncio"; era exatamente ali que ela quebrava a
  // promessa, e era isso que ajudava a fabricar os "buracos" da antiga pergunta de numeração.
  //
  // ⚠ ELA NÃO ENTRA NA CONFERÊNCIA DO MÊS, e isso é a decisão: sem competência gravada a nota não
  // pertence a mês nenhum, e atribuí-la a este pela data de emissão seria o sistema INVENTANDO a
  // competência dela — que decide em qual apuração a receita entra. Ela APARECE, separada, com o
  // motivo. Ver o bloco `foraDaConferencia` em `auditoriaNotas.js`.
  //
  // ⚠ SÃO DUAS QUERIES DE PROPÓSITO: o `count` dá o número REAL (é ele que a tela mostra) e o
  // `findMany` dá uma amostra limitada. `notas.length` como total mentiria assim que a lista
  // truncasse — justamente na empresa em que o problema é grande.
  const semCompetenciaWhere = { ...daEmpresa, competencia: null };
  const [totalSemCompetencia, notasSemCompetencia] = await Promise.all([
    prisma.portalInvoice.count({ where: semCompetenciaWhere }),
    prisma.portalInvoice.findMany({
      where: semCompetenciaWhere,
      select: SELECT_PARA_AUDITORIA,
      orderBy: [{ issueDate: "desc" }],
      take: LIMITE_NOTAS_SEM_COMPETENCIA,
    }),
  ]);

  const resultado = auditarNotasDaCompetencia({
    competencia,
    notas: notasDoMes,
    notasSemCompetencia,
    totalSemCompetencia,
    codigosServicoNacional: legacy?.codigosServicoNacional || [],
  });

  return {
    ...resultado,
    empresa: {
      portalClientId: portal.id,
      razao: portal.razao,
      cnpj: portal.cnpj,
      // ⚠ `temCadastroDeServicos: false` é o que a tela usa para mandar o contador ao cadastro em
      // vez de mostrar uma lista vazia de achados. É a mesma resposta da regra, dita do lado de fora.
      codigosServicoNacional: legacy?.codigosServicoNacional || [],
      codigoServicoNacionalDaDps: legacy?.codigoServicoNacional || null,
      temCadastroDeServicos: Boolean(legacy?.codigosServicoNacional?.length),
    },
  };
}
