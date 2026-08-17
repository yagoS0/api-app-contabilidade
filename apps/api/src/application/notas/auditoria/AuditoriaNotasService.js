// A LIGAÇÃO DA AUDITORIA COM O BANCO — e nada além disso.
//
// A REGRA mora em `auditoriaNotas.js`, que é puro. Este arquivo faz três coisas e para:
//   1. carrega as notas da competência (e a janela da numeração da DPS);
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
 * ⚠ QUANTOS MESES A NUMERAÇÃO OLHA PARA TRÁS — e por que ela não é mensal.
 *
 * A série da DPS é um contador CONTÍNUO: a nota nº 100 de julho e a nº 101 de agosto são vizinhas
 * na série e estranhas na competência. Perguntar por salto dentro de um mês só produziria um
 * "buraco" em toda virada de mês — ruído que treina o contador a ignorar a pergunta.
 *
 * Doze meses porque é a janela que o resto do módulo fiscal já usa (RBT12, folha 12m) e porque ela
 * cobre um exercício inteiro. A janela examinada volta DECLARADA no resultado, e a regra só aponta
 * salto ENTRE dois números observados — a borda nunca vira achado.
 */
export const MESES_DA_JANELA_DA_SERIE = 12;

const COMPETENCIA_RE = /^\d{4}-\d{2}$/;

function rangeDaCompetencia(competencia) {
  const [ano, mes] = String(competencia).split("-").map(Number);
  return { gte: new Date(Date.UTC(ano, mes - 1, 1)), lt: new Date(Date.UTC(ano, mes, 1)) };
}

/** A janela da numeração: os `MESES_DA_JANELA_DA_SERIE` meses que TERMINAM na competência. */
function rangeDaJanela(competencia) {
  const [ano, mes] = String(competencia).split("-").map(Number);
  const gte = new Date(Date.UTC(ano, mes - MESES_DA_JANELA_DA_SERIE, 1));
  const lt = new Date(Date.UTC(ano, mes, 1));
  const rotulo = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  return { gte, lt, de: rotulo(gte), ate: competencia };
}

/**
 * Roda a auditoria pré-apuração de UMA empresa numa competência. **Só leitura.**
 *
 * @param {Object} args
 * @param {string} args.portalClientId `PortalClient.id` — já autorizado pela rota.
 * @param {string} args.competencia    `"AAAA-MM"`.
 * @returns {Promise<Object>} o resultado de `auditarNotasDaCompetencia` + `empresa` e `janelaDaSerie`.
 */
export async function auditarCompetencia({ portalClientId, competencia }) {
  if (!portalClientId) throw new Error("portalClientId obrigatório");
  if (!COMPETENCIA_RE.test(String(competencia || ""))) throw new Error("competencia inválida");

  const janela = rangeDaJanela(competencia);

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

  // ⚠ UMA QUERY SÓ, a da janela — a competência é um recorte dela em memória. Duas queries com
  // `where` parecidos é onde elas divergem, e aqui a divergência seria a numeração conferindo uma
  // população e o resto da auditoria outra.
  const notasDaJanela = await prisma.portalInvoice.findMany({
    where: { clientId: portalClientId, type: "NFSE", papel: "EMIT", competencia: { gte: janela.gte, lt: janela.lt } },
    select: SELECT_PARA_AUDITORIA,
    orderBy: [{ competencia: "asc" }, { issueDate: "asc" }],
  });

  const { gte, lt } = rangeDaCompetencia(competencia);
  const notasDoMes = notasDaJanela.filter((n) => n.competencia && n.competencia >= gte && n.competencia < lt);

  const resultado = auditarNotasDaCompetencia({
    competencia,
    notas: notasDoMes,
    notasDaSerie: notasDaJanela,
    janelaDaSerie: { de: janela.de, ate: janela.ate, meses: MESES_DA_JANELA_DA_SERIE },
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
    janelaDaSerie: { de: janela.de, ate: janela.ate, meses: MESES_DA_JANELA_DA_SERIE },
  };
}
