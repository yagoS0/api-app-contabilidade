// Q14.3.b — Motor de apuração próprio do Simples Nacional.
//
// Calcula DAS LOCALMENTE usando AliquotaSimplesNacional versionada.
// Retorno do SERPRO (Fase 6) será conferência, não fonte.
//
// Sequência:
//   1. Pré-checagens: cadastro fiscal completo? notas classificadas?
//      pendências abertas? → estado bloqueada_pendencias
//   2. Segrega receita do mês por TipoReceita (a partir de NotaItem.tipoReceita)
//   3. Calcula RBT12 (12m móvel)
//   4. Pra cada TipoReceita com receita:
//      - REVENDA_MERCADORIA → Anexo I
//      - INDUSTRIALIZACAO → Anexo II
//      - SERVICO_ANEXO_III → Anexo III
//      - SERVICO_ANEXO_IV → Anexo IV
//      - SERVICO_ANEXO_V → Anexo V
//      - SERVICO_FATOR_R → bloqueia (Fase 4 resolve com Fator R mensal)
//      - RECEITA_NAO_CLASSIFICADA → bloqueia (Fase 2 resolve)
//   5. Pra cada anexo: alíquota efetiva × receita
//   6. Soma → dasCalculadoLocal
//   7. Persiste ApuracaoSnapshot (idempotente por (portalClientId, competencia))

import crypto from "node:crypto";
import { prisma } from "../../../../infrastructure/db/prisma.js";
import { resolverAliquota, calcularAliquotaEfetiva, AliquotaResolverError } from "./AliquotaResolver.js";
import { calcularEPersistirFatorR, resolverFolha12m, FatorRError } from "./FatorRService.js";

export class MotorApuracaoError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    Object.assign(this, extra);
  }
}

// Mapeia TipoReceita → Anexo (fixo)
const TIPO_RECEITA_PARA_ANEXO = {
  REVENDA_MERCADORIA: "I",
  INDUSTRIALIZACAO: "II",
  SERVICO_ANEXO_III: "III",
  SERVICO_ANEXO_IV: "IV",
  SERVICO_ANEXO_V: "V",
};
// SERVICO_FATOR_R e RECEITA_NAO_CLASSIFICADA não têm anexo fixo —
// tratados separadamente.

function rangeMes(competencia) {
  const [y, m] = competencia.split("-").map(Number);
  return { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) };
}
function range12m(competencia) {
  const [y, m] = competencia.split("-").map(Number);
  return {
    gte: new Date(Date.UTC(y - 1, m, 1)), // mês equivalente ano anterior
    lt: new Date(Date.UTC(y, m, 1)),       // primeiro dia mês competência
  };
}
function dataReferenciaCompetencia(competencia) {
  const [y, m] = competencia.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1));
}

/**
 * Calcula apuração local pra (empresa, competência).
 *
 * @returns {Promise<{ok, snapshot, divergencias, blockers?}>}
 */
export async function calcularApuracaoLocal({ portalClientId, competencia, folha12mOverride, userId }) {
  if (!portalClientId) throw new MotorApuracaoError("MISSING_PORTAL", "portalClientId obrigatório");
  if (!/^\d{4}-\d{2}$/.test(competencia)) {
    throw new MotorApuracaoError("INVALID_COMPETENCIA", `Formato YYYY-MM esperado, recebido: ${competencia}`);
  }

  // ─── PRÉ-CHECAGENS (pré-validação) ────────────────────────────────────────
  const blockers = [];

  // 1. Cadastro fiscal completo?
  const cadastro = await prisma.cadastroFiscal.findUnique({ where: { portalClientId } });
  if (!cadastro) {
    blockers.push({
      tipo: "CADASTRO_FALTANDO",
      mensagem: "Cadastro fiscal não preenchido. Vá em aba Apuração V2 → Cadastro Fiscal.",
    });
  } else if (cadastro.regime !== "SIMPLES_NACIONAL") {
    blockers.push({
      tipo: "REGIME_INVALIDO",
      mensagem: `Empresa não está no Simples Nacional (regime atual: ${cadastro.regime}). Motor só apura SN.`,
    });
  }

  // 2. Pendências abertas (ITEM_SEM_REGRA)?
  const pendenciasAbertas = await prisma.filaPendencia.count({
    where: { portalClientId, resolvida: false, tipo: { in: ["ITEM_SEM_REGRA", "DIVERGENCIA_CADASTRO"] } },
  });
  if (pendenciasAbertas > 0) {
    blockers.push({
      tipo: "PENDENCIAS_ABERTAS",
      mensagem: `${pendenciasAbertas} pendência(s) aberta(s). Resolva antes de apurar.`,
    });
  }

  // Se tem blockers, salva estado "bloqueada_pendencias" e retorna
  if (blockers.length > 0) {
    return { ok: false, blockers, estado: "bloqueada_pendencias" };
  }

  // ─── SEGREGA RECEITA DO MÊS POR TIPO_RECEITA ─────────────────────────────
  // Soma valor de NotaItem cujas notas EMIT/autorizada caem no mês.
  // Pra ratear: nota.total → distribui pelos items proporcionalmente ao item.valor.
  const notasDoMes = await prisma.portalInvoice.findMany({
    where: {
      clientId: portalClientId,
      papel: "EMIT",
      statusEfetivo: "autorizada",
      competencia: rangeMes(competencia),
    },
    select: {
      id: true, total: true,
      itens: { select: { tipoReceita: true, valor: true } },
    },
  });

  const receitaPorTipo = {
    REVENDA_MERCADORIA: 0, INDUSTRIALIZACAO: 0,
    SERVICO_ANEXO_III: 0, SERVICO_ANEXO_IV: 0, SERVICO_ANEXO_V: 0,
    SERVICO_FATOR_R: 0, RECEITA_NAO_CLASSIFICADA: 0,
  };
  let receitaMes = 0;

  for (const nota of notasDoMes) {
    const valorNota = Number(nota.total || 0);
    receitaMes += valorNota;
    if (!nota.itens || nota.itens.length === 0) {
      // Não deveria acontecer após Q14.2 (NotaItem é criado no upsert). Cai em não-classificada.
      receitaPorTipo.RECEITA_NAO_CLASSIFICADA += valorNota;
      continue;
    }
    const somaItens = nota.itens.reduce((s, it) => s + Number(it.valor || 0), 0);
    const escala = somaItens > 0 ? valorNota / somaItens : 0;
    for (const it of nota.itens) {
      const tipo = it.tipoReceita || "RECEITA_NAO_CLASSIFICADA";
      receitaPorTipo[tipo] = (receitaPorTipo[tipo] || 0) + Number(it.valor || 0) * escala;
    }
  }

  // Arredonda
  for (const k of Object.keys(receitaPorTipo)) {
    receitaPorTipo[k] = +receitaPorTipo[k].toFixed(2);
  }

  // ─── BLOQUEIOS PÓS-SEGREGAÇÃO ─────────────────────────────────────────────
  if (receitaPorTipo.RECEITA_NAO_CLASSIFICADA > 0) {
    return {
      ok: false,
      blockers: [{
        tipo: "RECEITA_NAO_CLASSIFICADA",
        mensagem: `R$ ${receitaPorTipo.RECEITA_NAO_CLASSIFICADA.toFixed(2)} em itens não classificados. Resolva pendências antes.`,
      }],
      estado: "bloqueada_pendencias",
      receitaPorTipo,
    };
  }

  // ─── RBT12 (móvel 12m) ────────────────────────────────────────────────────
  const agg12 = await prisma.portalInvoice.aggregate({
    where: {
      clientId: portalClientId,
      papel: "EMIT",
      statusEfetivo: "autorizada",
      competencia: range12m(competencia),
    },
    _sum: { total: true },
  });
  const rbt12 = +Number(agg12._sum.total || 0).toFixed(2);

  // ─── FATOR R (Q14.4): decide anexo do SERVICO_FATOR_R mensalmente ────────
  let decisaoFatorR = null;
  if (receitaPorTipo.SERVICO_FATOR_R > 0) {
    // Resolve folha 12m: override > circular atual > sugestão da anterior
    let folha12m = folha12mOverride;
    let fonteFolha = "MANUAL";
    if (folha12m == null) {
      const resolved = await resolverFolha12m({ portalClientId, competencia });
      folha12m = resolved.folha12m;
      fonteFolha = resolved.origem || "MANUAL";
    }
    if (folha12m == null || !Number.isFinite(Number(folha12m))) {
      return {
        ok: false,
        blockers: [{
          tipo: "FOLHA_12M_FALTANDO",
          mensagem: `Empresa tem R$ ${receitaPorTipo.SERVICO_FATOR_R.toFixed(2)} de receita Fator R. ` +
            `Informe a folha 12m (input "Folha 12m" no painel Apurar).`,
          receitaFatorR: receitaPorTipo.SERVICO_FATOR_R,
        }],
        estado: "bloqueada_pendencias",
        receitaPorTipo,
      };
    }
    try {
      decisaoFatorR = await calcularEPersistirFatorR({
        portalClientId, competencia,
        folha12m, rbt12, fonteFolha,
      });
    } catch (err) {
      if (err instanceof FatorRError) {
        return {
          ok: false,
          blockers: [{ tipo: err.code, mensagem: err.message }],
          estado: "erro_calculo",
        };
      }
      throw err;
    }
  }

  // Mapeia SERVICO_FATOR_R pro anexo decidido (III ou V)
  const tipoReceitaParaAnexoComFR = { ...TIPO_RECEITA_PARA_ANEXO };
  if (decisaoFatorR) {
    tipoReceitaParaAnexoComFR.SERVICO_FATOR_R = decisaoFatorR.anexoDecidido;
  }

  // ─── RESOLVE ALÍQUOTA POR ANEXO + CALCULA DAS ─────────────────────────────
  const dataRef = dataReferenciaCompetencia(competencia);
  const receitaPorAnexo = {};
  const aliquotaEfetivaPorAnexo = {};
  let dasCalculadoLocal = 0;
  let vigenciaAliquotaUsada = null;

  for (const [tipo, receita] of Object.entries(receitaPorTipo)) {
    if (receita <= 0) continue;
    const anexo = tipoReceitaParaAnexoComFR[tipo];
    if (!anexo) continue; // RECEITA_NAO_CLASSIFICADA já bloqueada acima
    try {
      const faixa = await resolverAliquota({ anexo, rbt12, dataReferencia: dataRef });
      const efetiva = calcularAliquotaEfetiva({
        rbt12, aliquotaNominal: faixa.aliquotaNominal, parcelaDeduzir: faixa.parcelaDeduzir,
      });
      const valorAnexo = +(receita * efetiva).toFixed(2);
      receitaPorAnexo[anexo] = +((receitaPorAnexo[anexo] || 0) + receita).toFixed(2);
      // Acumula no anexo (Fator R pode somar com Anexo III/V já existente)
      const prev = aliquotaEfetivaPorAnexo[anexo] || { receita: 0, dasParcial: 0 };
      aliquotaEfetivaPorAnexo[anexo] = {
        efetiva, faixa: faixa.faixa, nominal: faixa.aliquotaNominal,
        parcelaDeduzir: faixa.parcelaDeduzir, vigenciaInicio: faixa.vigenciaInicio,
        receita: +(prev.receita + receita).toFixed(2),
        dasParcial: +(prev.dasParcial + valorAnexo).toFixed(2),
      };
      dasCalculadoLocal += valorAnexo;
      vigenciaAliquotaUsada = faixa.vigenciaInicio;
    } catch (err) {
      if (err instanceof AliquotaResolverError) {
        // Erro de tabela (sem vigência / RBT12 acima limite) — bloqueia
        return {
          ok: false,
          blockers: [{ tipo: `ALIQUOTA_ERR_${err.code}`, mensagem: err.message }],
          estado: "erro_calculo",
          receitaPorTipo,
        };
      }
      throw err;
    }
  }
  dasCalculadoLocal = +dasCalculadoLocal.toFixed(2);

  // Aplica sublimite ICMS/ISS (R$ 3,6 mi) se configurado
  // Por enquanto só registra warning — implementação detalhada do sublimite
  // requer separar ICMS+ISS dos demais tributos do DAS (TODO Fase futura).
  const divergencias = [];
  if (cadastro.sublimiteICMSISS && rbt12 > 3600000.0) {
    divergencias.push({
      tipo: "SUBLIMITE_ICMS_ISS_ATIVO",
      severidade: "INFO",
      descricao: `RBT12 R$ ${rbt12.toFixed(2)} > R$ 3.600.000 com sublimite ativo. ` +
        `ICMS/ISS deve ser pago fora do DAS (implementação detalhada na Fase futura).`,
    });
  }

  // ─── IDEMPOTÊNCIA ────────────────────────────────────────────────────────
  const snapshot = {
    rbt12: rbt12.toFixed(2),
    receitaPorTipo,
    receitaPorAnexo,
    dasCalculadoLocal: dasCalculadoLocal.toFixed(2),
    vigencia: vigenciaAliquotaUsada?.toISOString() || null,
    fatorR: decisaoFatorR?.fatorR || null,
  };
  const idempotencyKey = crypto
    .createHash("sha256")
    .update(JSON.stringify({ portalClientId, competencia, ...snapshot }))
    .digest("hex");

  // ─── UPSERT ApuracaoSnapshot ─────────────────────────────────────────────
  const existing = await prisma.apuracaoSnapshot.findUnique({
    where: { portalClientId_competencia: { portalClientId, competencia } },
  });
  const data = {
    rbt12,
    folha12m: decisaoFatorR?.folha12m || null,
    fatorR: decisaoFatorR?.fatorR || null,
    receitaPorTipo, receitaPorAnexo,
    dasCalculadoLocal,
    aliquotaEfetivaPorAnexo,
    vigenciaAliquota: vigenciaAliquotaUsada,
    estado: "calculada",
    idempotencyKey,
    erroMensagem: null,
  };
  const snap = existing
    ? await prisma.apuracaoSnapshot.update({ where: { id: existing.id }, data })
    : await prisma.apuracaoSnapshot.create({ data: { ...data, portalClientId, competencia } });

  return {
    ok: true,
    snapshot: snap,
    divergencias,
    receitaPorTipo,
    receitaPorAnexo,
    aliquotaEfetivaPorAnexo,
    dasCalculadoLocal,
    rbt12,
    fatorR: decisaoFatorR ? {
      fatorR: decisaoFatorR.fatorR,
      anexoDecidido: decisaoFatorR.anexoDecidido,
      folha12m: decisaoFatorR.folha12m,
      threshold: decisaoFatorR.threshold,
    } : null,
  };
}

export { TIPO_RECEITA_PARA_ANEXO };
