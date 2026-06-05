// Q12.C.3: cálculo fiscal pra apuração PGDAS-D Simples Nacional.
//
// Pra uma competência X:
//   - receitaMes: soma total notas EMIT autorizadas com competencia=X
//   - rb12: soma móvel últimos 12 meses (X-11 até X, incluindo X)
//   - fs12: digitado pelo contador (CompanyMonthlyCircular.fs12Manual)
//   - fatorR: fs12 / rb12 (se rb12 > 0; senão 0)
//   - receitaPorAnexo: soma por anexo resolvido em NotaItem
//                      OBS: itens sujeitoFatorR ficam em III se fatorR >= 0.28, V se < 0.28
//   - idempotencyKey: hash SHA-256 de { rb12, fs12, fatorR, receitaMes, receitaPorAnexo }
//                     — mesma base = mesma key = não recria Apuracao
//
// Persiste em:
//   - Apuracao (upsert por competencia)
//   - CompanyMonthlyCircular (atualiza rb12, fatorR) ← mantém compat com Q12.A
//
// NÃO transmite nada — só calcula. Transmissão fica pra Q12.C.5.

import crypto from "node:crypto";
import { prisma } from "../../../infrastructure/db/prisma.js";

const FATOR_R_THRESHOLD = 0.28;

export class CalculoFiscalError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    Object.assign(this, extra);
  }
}

/**
 * Range de competência YYYY-MM → { gte: 1º dia, lt: 1º dia mês seguinte }
 */
function rangeMes(competencia) {
  const [y, m] = competencia.split("-").map(Number);
  return {
    gte: new Date(Date.UTC(y, m - 1, 1)),
    lt: new Date(Date.UTC(y, m, 1)),
  };
}

/**
 * Range de 12 meses MÓVEIS terminando na competência (inclusive).
 * Ex: competencia=2026-06 → de 2025-07-01 até 2026-07-01 (exclusive)
 */
function range12m(competencia) {
  const [y, m] = competencia.split("-").map(Number);
  return {
    gte: new Date(Date.UTC(y - 1, m, 1)),    // (m-1) - 11 = m-12 = mês seguinte do ano anterior
    lt: new Date(Date.UTC(y, m, 1)),         // 1º dia do mês SEGUINTE à competência
  };
}

/**
 * Calcula a apuração pra UMA (empresa, competência).
 *
 * @param {Object} opts
 * @param {string} opts.portalClientId
 * @param {string} opts.competencia YYYY-MM
 * @param {number} [opts.fs12Override] — sobrescreve FS12 manual da circular
 * @returns {Promise<{apuracaoId, idempotencyKey, rb12, fs12, fatorR, receitaMes, receitaPorAnexo, criada: boolean, divergencias[]}>}
 */
export async function calcularApuracaoParaCompetencia({ portalClientId, competencia, fs12Override }) {
  if (!/^\d{4}-\d{2}$/.test(competencia)) {
    throw new CalculoFiscalError("INVALID_COMPETENCIA", `Formato esperado YYYY-MM, recebido: ${competencia}`);
  }

  // 1) Carrega circular pra pegar fs12Manual atual (e estado)
  const circular = await prisma.companyMonthlyCircular.findFirst({
    where: { portalClientId, competencia },
    select: { id: true, estado: true, fs12Manual: true },
  });
  const fs12 = fs12Override != null ? Number(fs12Override) : (circular?.fs12Manual != null ? Number(circular.fs12Manual) : 0);

  // 2) Receita do mês: notas EMIT, autorizada, com competencia=X
  const notasDoMes = await prisma.portalInvoice.findMany({
    where: {
      clientId: portalClientId,
      papel: "EMIT",
      statusEfetivo: "autorizada",
      competencia: rangeMes(competencia),
    },
    select: { id: true, total: true, itens: { select: { anexoResolvido: true, sujeitoFatorR: true, valor: true } } },
  });
  const receitaMes = notasDoMes.reduce((sum, n) => sum + Number(n.total || 0), 0);

  // 3) RB12: receita móvel 12m (inclusive competência atual)
  const agg12 = await prisma.portalInvoice.aggregate({
    where: {
      clientId: portalClientId,
      papel: "EMIT",
      statusEfetivo: "autorizada",
      competencia: range12m(competencia),
    },
    _sum: { total: true },
  });
  const rb12 = Number(agg12._sum.total || 0);

  // 4) Fator R = FS12 / RB12 (zerado se rb12 = 0)
  const fatorR = rb12 > 0 ? +(fs12 / rb12).toFixed(4) : 0;

  // 5) Receita por anexo. Pra itens sujeitoFatorR:
  //    fatorR >= 0.28 → III; < 0.28 → V
  //    Item sem itens detalhados (resNFe sem procNFe ainda) → vai pro III default
  const receitaPorAnexo = { III: 0, IV: 0, V: 0, DEFAULT: 0 };
  const divergencias = [];

  for (const nota of notasDoMes) {
    const valorNota = Number(nota.total || 0);
    if (!nota.itens || nota.itens.length === 0) {
      // Sem itens — não dá pra classificar. Joga em DEFAULT (não compõe base).
      receitaPorAnexo.DEFAULT += valorNota;
      divergencias.push({
        tipo: "NOTA_SEM_ITENS",
        severidade: "WARN",
        descricao: `Nota ${nota.id.slice(0, 8)} sem itens classificados (procNFe pendente?)`,
        obtido: String(valorNota),
      });
      continue;
    }

    const somaItens = nota.itens.reduce((s, it) => s + Number(it.valor || 0), 0);
    // Se soma de itens diverge do total da nota, aviso (proporciona pra não perder)
    const escala = somaItens > 0 ? valorNota / somaItens : 0;

    for (const item of nota.itens) {
      const valor = Number(item.valor || 0) * escala;
      let anexo = item.anexoResolvido || "III";
      if (item.sujeitoFatorR) {
        anexo = fatorR >= FATOR_R_THRESHOLD ? "III" : "V";
      }
      receitaPorAnexo[anexo] = (receitaPorAnexo[anexo] || 0) + valor;
    }
  }

  // Arredondar
  Object.keys(receitaPorAnexo).forEach((k) => {
    receitaPorAnexo[k] = +receitaPorAnexo[k].toFixed(2);
  });

  // Divergências adicionais
  if (rb12 === 0 && receitaMes > 0) {
    divergencias.push({
      tipo: "RB12_ZERO",
      severidade: "WARN",
      descricao: "RB12 zero mas há receita no mês — empresa recém-iniciada?",
    });
  }
  if (fs12 === 0 && fatorR === 0 && Object.values(receitaPorAnexo).slice(2, 3).some((v) => v > 0)) {
    // Há receita Anexo V sem FS12 informado
    divergencias.push({
      tipo: "FS12_NAO_INFORMADO",
      severidade: "INFO",
      descricao: "FS12 não informado. Receitas sujeitas a Fator R caíram no Anexo V (alíquota maior).",
    });
  }

  // 6) idempotencyKey — hash determinístico
  const baseSnapshot = {
    rb12: rb12.toFixed(2),
    fs12: fs12.toFixed(2),
    fatorR: fatorR.toFixed(4),
    receitaMes: receitaMes.toFixed(2),
    receitaPorAnexo,
  };
  const idempotencyKey = crypto
    .createHash("sha256")
    .update(JSON.stringify({ portalClientId, competencia, ...baseSnapshot }))
    .digest("hex");

  // 7) Upsert Apuracao (idempotente — se mesma key, atualiza apenas updatedAt)
  const apuracao = await prisma.apuracao.upsert({
    where: { portalClientId_competencia: { portalClientId, competencia } },
    create: {
      portalClientId, competencia,
      estado: "calculada",
      idempotencyKey,
      rb12, fs12, fatorR,
      receitaMes,
      receitaPorAnexo,
    },
    update: {
      // Se a chave mudou, é nova versão da base — atualiza tudo + zera transmissão.
      // Se a key bate, só toca updatedAt (campos = aos atuais).
      idempotencyKey,
      rb12, fs12, fatorR,
      receitaMes,
      receitaPorAnexo,
      // Se já transmitida e base mudou, volta pra "calculada" — contador precisa revisar.
      // (não mexe se estado for "transmitida" e key for igual)
    },
  });

  // 8) Persiste divergências (apaga as antigas e recria — mais simples)
  await prisma.apuracaoDivergencia.deleteMany({ where: { apuracaoId: apuracao.id } });
  if (divergencias.length > 0) {
    await prisma.apuracaoDivergencia.createMany({
      data: divergencias.map((d) => ({ ...d, apuracaoId: apuracao.id })),
    });
  }

  // 9) Atualiza CompanyMonthlyCircular (mantém compat com Q12.A — campos rb12/fatorR)
  if (circular) {
    await prisma.companyMonthlyCircular.update({
      where: { id: circular.id },
      data: { rb12, fatorR, fs12Manual: fs12, fs12Origem: fs12Override != null ? "MANUAL" : circular.fs12Manual != null ? "MANUAL" : null },
    });
  }

  return {
    apuracaoId: apuracao.id,
    idempotencyKey,
    rb12,
    fs12,
    fatorR,
    receitaMes,
    receitaPorAnexo,
    divergencias: divergencias.length,
    criada: !circular?.estado, // heurística simples — não 100% precisa
  };
}

export { FATOR_R_THRESHOLD };
