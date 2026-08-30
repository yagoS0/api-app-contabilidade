// A CIÊNCIA SOBRE AS GUIAS EM ATRASO — o "Estou ciente" do pop-up.
//
// > `SPEC-fluxo-de-caixa-v3.md` §1: *"Sem confirmação, reaparece em TODA abertura da tela. Depois de
// > confirmado, só reaparece se surgir guia NOVA vencida ou a 5 dias do vencimento (guia fora do
// > conjunto confirmado)."*
//
// ⚠⚠ **ISTO NÃO É CONFIRMAÇÃO DE PAGAMENTO, E A DISTÂNCIA ENTRE AS DUAS É O MOTIVO DE O MÓDULO
// EXISTIR.** `Guide.clienteConfirmouEm` guarda *"eu paguei esta guia"* e move `paymentStatus`; isto
// guarda *"eu vi o aviso"* e não move nada. A `CONSTITUICAO-do-produto.md` fecha a palavra na Lei 5:
// **Ciência nunca significa pagamento**. Um "Estou ciente" que marcasse guia como paga tiraria do
// contador a cobrança e do cliente a dívida, com um clique feito para dispensar um pop-up.
//
// ⚠ A REGRA É PURA e a leitura do banco mora embaixo, separadas de propósito: a decisão *"ainda
// preciso avisar?"* é testável sem banco, e é ela que decide se a pessoa vê um modal na cara.

import { prisma } from "../../infrastructure/db/prisma.js";

/** De que lado veio a ciência. ⚠ Vocabulário FECHADO — a tela do cliente diz "seu contador já viu". */
export const ORIGEM_DA_CIENCIA = Object.freeze({ FIRM: "FIRM", CLIENT: "CLIENT" });

/**
 * ⚠⚠ AINDA PRECISO AVISAR? — e a resposta é sobre o CONJUNTO, nunca sobre a última vez.
 *
 * A pergunta que esta função responde é *"existe alguma guia em atraso que ninguém reconheceu?"*.
 *
 * ⚠ **Um carimbo de data ("avisado em 27/08") não resolveria**, e é a armadilha óbvia: a guia que
 * vence no dia 28 ficaria silenciada por um clique dado antes de ela existir. Por isso o que se
 * guarda é o CONJUNTO de ids, e o que se compara é a diferença.
 *
 * ⚠ Lista de itens vazia responde `false`: sem guia em atraso não há o que avisar. Isso é diferente
 * de "já foi reconhecido", e quem consome não precisa distinguir — nos dois casos o pop-up não abre.
 *
 * @param {{itens: Array<{id: string}>, cientes: Iterable<string>}} args
 * @returns {{precisaAvisar: boolean, novas: string[]}}
 */
export function avaliarCiencia({ itens, cientes } = {}) {
  const jaVistas = new Set(cientes || []);
  const novas = (itens || [])
    .map((i) => String(i?.id || ""))
    .filter((id) => id && !jaVistas.has(id));
  return { precisaAvisar: novas.length > 0, novas };
}

/**
 * Os ids de guia que já receberam ciência nesta empresa.
 *
 * ⚠⚠ **NÃO HÁ JANELA DE TEMPO, e a ausência dela é deliberada.** A tentação é "só as ciências dos
 * últimos N dias" — e aí uma guia em atraso há seis meses volta a abrir o modal sozinha, todo dia,
 * sem nada ter mudado. O que faz o aviso voltar é guia NOVA, não a passagem do tempo.
 *
 * ⚠ Escopado por `portalClientId`, sempre: ciência de uma empresa não pode silenciar o aviso de
 * outra, e este é um portal multi-empresa.
 */
export async function lerGuiasComCiencia({ portalClientId, client = prisma }) {
  const linhas = await client.cienciaDeGuias.findMany({
    where: { portalClientId: String(portalClientId) },
    select: { guiaIds: true },
  });
  const ids = new Set();
  for (const l of linhas) for (const id of l.guiaIds || []) ids.add(id);
  return ids;
}

/**
 * Registra a ciência sobre um conjunto de guias.
 *
 * ⚠⚠ **NUNCA SOBRESCREVE.** Cada clique é uma linha nova, com autor e instante — o histórico é o
 * produto. Um `upsert` que fosse acumulando ids num registro só apagaria *quem* reconheceu *o quê*
 * e *quando*, que é o registro que uma cobrança contestada vai querer.
 *
 * ⚠ Ids repetidos são deduplicados, e lista vazia RECUSA: gravar ciência sobre nada produziria uma
 * linha que não silencia coisa nenhuma e faria o histórico mentir sobre ter havido um aviso.
 */
export async function registrarCiencia({ portalClientId, guiaIds, userId, origem, client = prisma }) {
  const ids = [...new Set((guiaIds || []).map((i) => String(i || "").trim()).filter(Boolean))];
  if (!ids.length) {
    const e = new Error("nenhuma guia informada");
    e.code = "CIENCIA_SEM_GUIAS";
    throw e;
  }
  if (!ORIGEM_DA_CIENCIA[origem]) {
    const e = new Error("origem desconhecida");
    e.code = "CIENCIA_ORIGEM_INVALIDA";
    throw e;
  }
  return client.cienciaDeGuias.create({
    data: { portalClientId: String(portalClientId), guiaIds: ids, userId: String(userId), origem },
    select: { id: true, criadoEm: true, guiaIds: true, origem: true },
  });
}
