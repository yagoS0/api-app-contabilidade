// Módulo Fiscal (§1.3) — Motor de sugestão de anexo, VISÃO POR NOTA.
//
// Empacota a classificação já persistida (NotaItem.tipoReceita, produzida pelo
// ClassificadorService — "cadastro é autoridade, nota é sinal, nunca chuta") numa
// sugestão de anexo POR NOTA, com nível de confiança + justificativa rastreável,
// validada contra o PERFIL (Bloco A: atividades ativas da empresa).
//
// Não altera dados. Itens sem classificação já geram FilaPendencia (fila de revisão)
// no ClassificadorService — aqui só sinalizamos "revisão" e apontamos pra lá.

import { prisma } from "../../../../infrastructure/db/prisma.js";
import { anexoDeTipoReceita, resolverPerfilFiscal } from "./PerfilFiscalService.js";

function rangeMes(competencia) {
  const [y, m] = competencia.split("-").map(Number);
  return { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) };
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Anexos "permitidos" pelo perfil ativo. Fator R ativo libera III e V.
function anexosAtivosDoPerfil(perfil) {
  const set = new Set();
  for (const c of perfil?.candidatos || []) {
    if (!c.ativo) continue;
    if (c.sujeitoFatorR) { set.add("III"); set.add("V"); continue; }
    if (c.anexo) set.add(c.anexo);
  }
  return set;
}

/**
 * Sugere o anexo de cada nota EMIT autorizada da competência.
 *
 * @returns {Promise<{ competencia, totalNotas, resumo, notas: Array }>}
 *   notas = [{ notaId, numero, tipo, total, itens, anexos, anexoDominante,
 *              confianca: 'alta'|'media'|'revisao', motivo, precisaRevisao }]
 */
export async function sugerirAnexosDaCompetencia({ portalClientId, competencia }) {
  if (!portalClientId) throw new Error("portalClientId obrigatório");
  if (!/^\d{4}-\d{2}$/.test(competencia)) throw new Error("competência YYYY-MM obrigatória");

  const perfil = await resolverPerfilFiscal({ portalClientId }).catch(() => null);
  const ativos = anexosAtivosDoPerfil(perfil);

  const { gte, lt } = rangeMes(competencia);
  const notas = await prisma.portalInvoice.findMany({
    where: { clientId: portalClientId, papel: "EMIT", statusEfetivo: "autorizada", competencia: { gte, lt } },
    select: {
      id: true, numero: true, type: true, total: true,
      itens: { select: { id: true, tipoReceita: true, codigoServico: true, ncm: true, cfop: true, valor: true } },
    },
    orderBy: { numero: "asc" },
  });

  const resumo = { alta: 0, media: 0, revisao: 0, porAnexo: {} };
  const out = notas.map((nota) => {
    const itens = nota.itens || [];
    // Agrega valor por anexo derivado do tipoReceita de cada item.
    const porAnexo = {}; // label → valor
    let temNaoClassificado = false;
    let temFatorR = false;
    let temForaDoPerfil = false;

    for (const it of itens) {
      const { anexo, anexoLabel, sujeitoFatorR, revisao } = anexoDeTipoReceita(it.tipoReceita);
      const v = round2(it.valor);
      if (revisao || !it.tipoReceita) { temNaoClassificado = true; }
      if (sujeitoFatorR) temFatorR = true;
      if (anexo && ativos.size && !ativos.has(anexo)) temForaDoPerfil = true;
      const key = anexoLabel;
      porAnexo[key] = round2((porAnexo[key] || 0) + v);
    }

    const anexos = Object.entries(porAnexo).map(([label, valor]) => ({ label, valor }));
    const anexoDominante = anexos.slice().sort((a, b) => b.valor - a.valor)[0]?.label || "—";

    let confianca, motivo, precisaRevisao = false;
    if (temNaoClassificado) {
      confianca = "revisao"; precisaRevisao = true;
      motivo = "Item(ns) sem classificação — resolva na aba Pendências (nunca é chutado).";
    } else if (temFatorR) {
      confianca = "media";
      motivo = "Sujeito a Fator R — o anexo III↔V é decidido na competência (motor local / FS12).";
    } else if (temForaDoPerfil) {
      confianca = "media";
      motivo = "Anexo derivado não está entre as atividades ATIVAS do perfil — confirme o Bloco A.";
    } else {
      confianca = "alta";
      motivo = "Classificado e dentro do perfil ativo da empresa.";
    }

    resumo[confianca] = (resumo[confianca] || 0) + 1;
    for (const a of anexos) resumo.porAnexo[a.label] = round2((resumo.porAnexo[a.label] || 0) + a.valor);

    return {
      notaId: nota.id,
      numero: nota.numero || null,
      tipo: nota.type, // NFSE | NFE
      total: round2(nota.total),
      itens: itens.length,
      anexos,
      anexoDominante,
      confianca,
      motivo,
      precisaRevisao,
    };
  });

  return {
    competencia,
    totalNotas: out.length,
    perfilConfigurado: Boolean(perfil?.candidatos?.length),
    anexosAtivos: [...ativos],
    resumo,
    notas: out,
  };
}
