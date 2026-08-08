// F2.1 — MATERIALIZAÇÃO DAS PARCELAS DO CONTRATO.
//
// A migration `20260808180000_add_parcela` fez isto uma vez, em SQL, para os dados que já existiam.
// Este arquivo é o GÊMEO EM JS: sem ele, todo parcelamento criado DEPOIS do deploy nasceria sem
// linhas em `parcelas` — e como as derivações passaram a ler essa tabela, um parcelamento novo
// apareceria vazio. É a mesma conta de calendário nos dois lados, de propósito.
//
// ⚠ O QUE ESTA ROTINA NÃO FAZ: não escreve nada em `Guide` nem em `accounting_entries`. Ela só
// insere/atualiza linhas de `parcelas` e aponta `parcelas.guiaId` para a guia. O vínculo contábil
// (`Guide.lancamentoId`, `accounting_entries.sourceGuideId`) nunca é tocado por aqui.

import { round2Decimal as round2 } from "./contracts.js";

/** "2026-05" + 3 → "2026-08". Igual ao `addMonths` que `createParcelamento` já usava. */
export function addMonths(competenciaInicial, n) {
  const [yyyy, mm] = String(competenciaInicial).split("-").map(Number);
  if (!yyyy || !mm) return competenciaInicial;
  const date = new Date(Date.UTC(yyyy, mm - 1 + n, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Data do dia `dayOfMonth` dentro da competência, CLAMPADA ao último dia do mês (dia 31 em
 * fevereiro vira 28/29). Meio-dia UTC — a mesma convenção que a migration reproduz.
 */
export function buildDateOfMonth(competencia, dayOfMonth) {
  const [yyyy, mm] = String(competencia).split("-").map(Number);
  if (!yyyy || !mm) return new Date();
  const lastDay = new Date(Date.UTC(yyyy, mm, 0)).getUTCDate();
  const day = Math.min(Math.max(Number(dayOfMonth) || 1, 1), lastDay);
  return new Date(Date.UTC(yyyy, mm - 1, day, 12, 0, 0));
}

/**
 * ⚠ SENTINELA, NÃO DATA. `ingestParcelamentoFromGuide` grava `competenciaInicial: compLabel ||
 * "1970-01"` quando a parcela chega sem `anoMesParcela`. Derivar um cronograma disso imprimiria a
 * sentinela como vencimento e marcaria o acordo inteiro como vencido em 1970. Sem competência
 * confiável, o cronograma sai SEM datas — ausência de data é o que se sabe.
 */
const COMPETENCIA_SENTINELA = "1970-01";

function competenciaBase(parcelamento) {
  const c = String(parcelamento?.competenciaInicial || "");
  if (!/^\d{4}-\d{2}$/.test(c) || c === COMPETENCIA_SENTINELA) return null;
  return c;
}

/** O calendário CONTRATADO da n-ésima prestação, ou datas nulas quando não há base confiável. */
export function calendarioDaParcela(parcelamento, numeroParcela) {
  const base = competenciaBase(parcelamento);
  const n = Number(numeroParcela);
  if (!base || !Number.isFinite(n) || n < 1) {
    return { competencia: null, anoMesParcela: null, vencimento: null };
  }
  const competencia = addMonths(base, n - 1);
  return {
    competencia,
    anoMesParcela: competencia.replace("-", ""),
    vencimento: buildDateOfMonth(competencia, parcelamento?.diaPagamento),
  };
}

const SELECT_PARCELAMENTO = {
  id: true, portalClientId: true, numParcelas: true, competenciaInicial: true,
  diaPagamento: true, valorParcelaReferencia: true, principalPerParcela: true,
};

/**
 * Cria as linhas de `parcelas` que faltam para um parcelamento e casa cada guia com a sua.
 * IDEMPOTENTE — pode rodar em toda ingestão, e roda.
 *
 * @param {object} client `prisma` OU um `tx` (a ingestão chama de dentro da transação, para que a
 *   guia recém-vinculada e a parcela dela nasçam juntas ou não nasçam).
 * @returns {Promise<{criadas: number, vinculadas: number, total: number}|null>}
 */
export async function sincronizarParcelas(client, { portalClientId, parcelamentoId }) {
  if (!parcelamentoId) return null;
  const parc = await client.parcelamento.findFirst({
    where: { id: String(parcelamentoId), ...(portalClientId ? { portalClientId: String(portalClientId) } : {}) },
    select: SELECT_PARCELAMENTO,
  });
  if (!parc) return null;

  const [existentes, guias] = await Promise.all([
    client.parcela.findMany({
      where: { parcelamentoId: parc.id },
      select: { id: true, numeroParcela: true, guiaId: true },
    }),
    client.guide.findMany({
      where: { parcelamentoId: parc.id },
      select: { id: true, numeroParcela: true, competencia: true, anoMesParcela: true, vencimento: true, valor: true },
    }),
  ]);

  const porNumero = new Map();
  const guiasJaVinculadas = new Set();
  for (const p of existentes) {
    if (p.numeroParcela != null) porNumero.set(p.numeroParcela, p);
    if (p.guiaId) guiasJaVinculadas.add(p.guiaId);
  }

  const valorPrevisto = parc.valorParcelaReferencia != null
    ? round2(Number(parc.valorParcelaReferencia))
    : (parc.principalPerParcela != null ? round2(Number(parc.principalPerParcela)) : null);

  let criadas = 0;
  let vinculadas = 0;

  // 1) O cronograma contratado: 1 … numParcelas.
  const total = Math.max(Number(parc.numParcelas) || 1, 1);
  for (let n = 1; n <= total; n += 1) {
    if (porNumero.has(n)) continue;
    const cal = calendarioDaParcela(parc, n);
    // eslint-disable-next-line no-await-in-loop
    const nova = await client.parcela.create({
      data: {
        parcelamentoId: parc.id,
        portalClientId: parc.portalClientId,
        numeroParcela: n,
        competencia: cal.competencia,
        anoMesParcela: cal.anoMesParcela,
        vencimento: cal.vencimento,
        valorPrevisto,
        origem: "CONTRATO",
      },
      select: { id: true, numeroParcela: true, guiaId: true },
    });
    porNumero.set(n, nova);
    criadas += 1;
  }

  // 2) ⚠ AS GUIAS QUE O CRONOGRAMA NÃO COBRE — o passo que impede perda de vínculo. Guia numerada
  //    fora de [1, numParcelas] (acordo reduzido depois da adesão) e guia SEM número
  //    (`normalizeParcelaDTO` aceita `numeroParcela: null`) ganham linha própria. Descartá-las
  //    tiraria da contagem uma baixa que já foi conciliada.
  for (const g of guias) {
    if (guiasJaVinculadas.has(g.id)) continue;
    if (g.numeroParcela != null && porNumero.has(g.numeroParcela)) {
      const alvo = porNumero.get(g.numeroParcela);
      if (alvo.guiaId) continue; // já casada com outra guia — não sobrescreve
      // eslint-disable-next-line no-await-in-loop
      await client.parcela.update({
        where: { id: alvo.id },
        data: { guiaId: g.id, origem: "GUIA" },
      });
      alvo.guiaId = g.id;
      guiasJaVinculadas.add(g.id);
      vinculadas += 1;
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const nova = await client.parcela.create({
      data: {
        parcelamentoId: parc.id,
        portalClientId: parc.portalClientId,
        numeroParcela: g.numeroParcela ?? null,
        competencia: g.competencia || null,
        anoMesParcela: g.anoMesParcela || null,
        vencimento: g.vencimento || null,
        valorPrevisto: g.valor != null ? round2(Number(g.valor)) : valorPrevisto,
        guiaId: g.id,
        origem: "GUIA",
      },
      select: { id: true, numeroParcela: true, guiaId: true },
    });
    if (nova.numeroParcela != null) porNumero.set(nova.numeroParcela, nova);
    guiasJaVinculadas.add(g.id);
    criadas += 1;
    vinculadas += 1;
  }

  return { criadas, vinculadas, total: porNumero.size };
}
