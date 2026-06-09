// Q15.4 — RBT12 (receita bruta dos 12 meses anteriores) + receitasBrutasAnteriores.
//
// Custo SERPRO por requisição → cache é REQUISITO (não otimização). TTL longo:
// declaração transmitida não muda salvo retificadora.
//
// Fontes (em ordem de preferência):
//   1. cache RbtExtratoCache (se não forçar refresh)
//   2. SIMULAÇÃO — o retorno do TRANSDECLARACAO11 (indicadorTransmissao:false) já
//      traz o RBT12 oficial que a RFB usou. Quando disponível, é a fonte mais barata
//      e fiel (uma chamada que já fazemos no [Calcular]).
//   3. fallback local — soma das notas EMIT/autorizada por mês (origem PARCIAL_LOCAL),
//      sinaliza que pode divergir do oficial.
//
// ⚠ Passo 0 (validar no trial): confirmar se CONSDECLARACAO13 traz receita no índice
// ou só metadados; se CONSULTIMADECREC14 retorna JSON ou PDF. Enquanto não validado,
// usamos simulação (fonte 2) + fallback local (fonte 3).

import { prisma } from "../../../../infrastructure/db/prisma.js";

function paFromCompetencia(comp) { return String(comp || "").replace("-", ""); }
function round2(n) { return +Number(n || 0).toFixed(2); }

/** Lista os 12 PAs anteriores à competência (YYYY-MM), do mais antigo ao mais recente. */
export function pasAnteriores(competencia, n = 12) {
  const [y, m] = String(competencia).split("-").map(Number);
  const out = [];
  for (let i = n; i >= 1; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

/**
 * Soma local da receita por mês (EMIT/autorizada), segregada interno/externo.
 * Fallback quando não há fonte oficial.
 */
async function somarReceitaLocalPorMes({ portalClientId, competencia }) {
  const pas = pasAnteriores(competencia);
  const primeiro = pas[0];
  const [y0, m0] = primeiro.split("-").map(Number);
  const [yF, mF] = competencia.split("-").map(Number);
  const gte = new Date(Date.UTC(y0, m0 - 1, 1));
  const lt = new Date(Date.UTC(yF, mF - 1, 1)); // até o mês anterior à competência

  const notas = await prisma.portalInvoice.findMany({
    where: {
      clientId: portalClientId, papel: "EMIT", statusEfetivo: "autorizada",
      competencia: { gte, lt },
    },
    select: {
      total: true, competencia: true,
      itens: { select: { valor: true, flagExportacao: true } },
    },
  });

  const porMes = new Map(pas.map((pa) => [pa, { pa, valorInterno: 0, valorExterno: 0 }]));
  for (const n of notas) {
    if (!n.competencia) continue;
    const d = new Date(n.competencia);
    const pa = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const bucket = porMes.get(pa);
    if (!bucket) continue;
    const total = Number(n.total || 0);
    // segrega por exportação dos itens; se sem itens, tudo interno
    const somaItens = (n.itens || []).reduce((s, it) => s + Number(it.valor || 0), 0);
    if (somaItens > 0) {
      const escala = total / somaItens;
      for (const it of n.itens) {
        const v = Number(it.valor || 0) * escala;
        if (it.flagExportacao) bucket.valorExterno += v;
        else bucket.valorInterno += v;
      }
    } else {
      bucket.valorInterno += total;
    }
  }
  const detalhe = [...porMes.values()].map((b) => ({
    pa: b.pa, valorInterno: round2(b.valorInterno), valorExterno: round2(b.valorExterno),
  }));
  const rbt12 = round2(detalhe.reduce((s, b) => s + b.valorInterno + b.valorExterno, 0));
  return { rbt12, detalhe };
}

/**
 * Lê o RBT12 (cache → fallback local). A fonte SIMULACAO é gravada via
 * `gravarDaSimulacao` quando o [Calcular] roda (evita chamada extra).
 *
 * @returns {Promise<{rbt12, detalhePorMes, origem, capturadoEm}>}
 */
export async function getRbt12({ portalClientId, competencia, forceRefresh = false }) {
  if (!forceRefresh) {
    const cached = await prisma.rbtExtratoCache.findUnique({
      where: { portalClientId_competencia: { portalClientId, competencia } },
    });
    if (cached) {
      return {
        rbt12: Number(cached.rbt12),
        detalhePorMes: cached.detalhePorMes,
        origem: cached.origem,
        capturadoEm: cached.capturadoEm,
      };
    }
  }
  // fallback local
  const { rbt12, detalhe } = await somarReceitaLocalPorMes({ portalClientId, competencia });
  const saved = await upsertCache({ portalClientId, competencia, rbt12, detalhePorMes: detalhe, origem: "PARCIAL_LOCAL" });
  return { rbt12: Number(saved.rbt12), detalhePorMes: saved.detalhePorMes, origem: saved.origem, capturadoEm: saved.capturadoEm };
}

/**
 * Grava no cache o RBT12 oficial vindo da simulação SERPRO (fonte preferida).
 * Chamado pelo endpoint [Calcular] quando a simulação retorna rbt12/receitasBrutasAnteriores.
 */
export async function gravarDaSimulacao({ portalClientId, competencia, rbt12, receitasBrutasAnteriores }) {
  const detalhe = Array.isArray(receitasBrutasAnteriores) && receitasBrutasAnteriores.length
    ? receitasBrutasAnteriores.map((r) => ({
        pa: r.pa, valorInterno: round2(r.valorInterno), valorExterno: round2(r.valorExterno),
      }))
    : [];
  return upsertCache({
    portalClientId, competencia,
    rbt12: round2(rbt12),
    detalhePorMes: detalhe,
    origem: "SIMULACAO",
  });
}

async function upsertCache({ portalClientId, competencia, rbt12, detalhePorMes, origem }) {
  const existing = await prisma.rbtExtratoCache.findUnique({
    where: { portalClientId_competencia: { portalClientId, competencia } },
  });
  const data = { rbt12, detalhePorMes, origem, capturadoEm: new Date() };
  return existing
    ? prisma.rbtExtratoCache.update({ where: { id: existing.id }, data })
    : prisma.rbtExtratoCache.create({ data: { ...data, portalClientId, competencia } });
}
