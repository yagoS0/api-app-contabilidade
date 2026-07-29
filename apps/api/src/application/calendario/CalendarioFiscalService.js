// Monta o calendário fiscal do mês: junta o que JÁ ESTÁ no banco com o que o contador marcou.
//
// A ideia central é que este calendário **não é uma agenda para digitar**. Agenda que depende de
// alimentação manual envelhece e ninguém confia. A maior parte do que o contador precisa ver já
// existe — só nunca foi reunida numa visão de mês:
//
//   • guia com vencimento no dia          → `Guide.vencimento`
//   • competência ainda não transmitida   → `ApuracaoSnapshot.estado`
//   • mês contábil ainda não fechado      → `CompanyMonthlyCircular.fechadoContabilEm`
//   • marco marcado à mão                 → `MarcoFiscal` (IBS/CBS e afins)
//
// Só o último é digitação.
//
// Consulta: uma query por fonte para o mês inteiro, agregadas em memória — mesmo molde do
// `GET /firm/companies/annual`, que faz duas queries pro ano em vez de doze por empresa.

import { prisma } from "../../infrastructure/db/prisma.js";

const APURADA = new Set(["transmitida", "confirmada"]);

const pad2 = (n) => String(n).padStart(2, "0");

/** Primeiro e último instante do mês, em UTC. `competencia` = "YYYY-MM". */
export function limitesDoMes(competencia) {
  const m = String(competencia || "").match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  if (mes < 1 || mes > 12) return null;
  return {
    ano,
    mes,
    inicio: new Date(Date.UTC(ano, mes - 1, 1)),
    // Início do mês seguinte — comparação por `lt` evita o clássico erro de "último dia às 23:59"
    // que perde eventos gravados com hora.
    fim: new Date(Date.UTC(ano, mes, 1)),
    diasNoMes: new Date(Date.UTC(ano, mes, 0)).getUTCDate(),
  };
}

/** "2026-07-20" a partir de um Date, sempre em UTC (a data fiscal não muda com fuso). */
function diaISO(data) {
  const d = new Date(data);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/**
 * @param {string[]} portalIds  empresas que o usuário pode ver (escopo já resolvido pela rota)
 * @param {string} competencia "YYYY-MM"
 * @param {string|null} companyId filtro opcional por uma empresa
 */
export async function montarCalendarioDoMes({ portalIds, competencia, companyId = null }) {
  const limites = limitesDoMes(competencia);
  if (!limites) return { ok: false, error: "competencia_invalida" };

  const alvos = companyId ? portalIds.filter((id) => id === companyId) : portalIds;
  const vazio = {
    ok: true, competencia, diasNoMes: limites.diasNoMes, dias: [], totais: { guias: 0, apuracoes: 0, fechamentos: 0, marcos: 0 },
  };
  if (!alvos.length) return vazio;

  const [empresas, guias, snapshots, circulares, marcos] = await Promise.all([
    prisma.portalClient.findMany({ where: { id: { in: alvos } }, select: { id: true, razao: true } }),
    // Guias com vencimento DENTRO do mês. `status: VAZIO` fica de fora: ausência confirmada não é
    // obrigação a cumprir, e poluiria o dia com algo que já foi resolvido.
    prisma.guide.findMany({
      where: {
        portalClientId: { in: alvos },
        vencimento: { gte: limites.inicio, lt: limites.fim },
        status: { not: "VAZIO" },
      },
      select: { id: true, portalClientId: true, tipo: true, competencia: true, vencimento: true, valor: true, paymentStatus: true },
    }),
    prisma.apuracaoSnapshot.findMany({
      where: { portalClientId: { in: alvos }, competencia },
      select: { portalClientId: true, competencia: true, estado: true },
    }),
    prisma.companyMonthlyCircular.findMany({
      where: { portalClientId: { in: alvos }, competencia },
      select: { portalClientId: true, competencia: true, fechadoContabilEm: true },
    }),
    // Marcos: os da empresa filtrada MAIS os do escritório (portalClientId nulo), que valem sempre.
    prisma.marcoFiscal.findMany({
      where: {
        data: { gte: limites.inicio, lt: limites.fim },
        OR: [{ portalClientId: null }, { portalClientId: { in: alvos } }],
      },
      select: { id: true, portalClientId: true, titulo: true, data: true, descricao: true, importancia: true },
      orderBy: { data: "asc" },
    }),
  ]);

  const razaoPor = new Map(empresas.map((e) => [e.id, e.razao]));
  const porDia = new Map();
  const adicionar = (dia, item) => {
    if (!dia) return;
    if (!porDia.has(dia)) porDia.set(dia, []);
    porDia.get(dia).push(item);
  };

  for (const g of guias) {
    adicionar(diaISO(g.vencimento), {
      tipo: "guia",
      id: g.id,
      titulo: g.tipo,
      companyId: g.portalClientId,
      empresa: razaoPor.get(g.portalClientId) || null,
      competencia: g.competencia,
      valor: g.valor != null ? Number(g.valor) : null,
      // Guia já paga continua no dia (é histórico do mês), mas resolvida — a tela a mostra apagada.
      resolvido: String(g.paymentStatus || "").toUpperCase() === "PAID",
    });
  }

  // Apuração e fechamento não têm dia próprio: são estado do MÊS. Entram como pendências do mês,
  // fora da grade de dias — pendurá-los num dia arbitrário seria inventar um prazo que não existe.
  const pendenciasDoMes = [];
  for (const s of snapshots) {
    if (APURADA.has(String(s.estado || ""))) continue;
    pendenciasDoMes.push({
      tipo: "apuracao",
      companyId: s.portalClientId,
      empresa: razaoPor.get(s.portalClientId) || null,
      competencia: s.competencia,
      titulo: "Apuração não transmitida",
      estado: s.estado,
    });
  }
  for (const c of circulares) {
    if (c.fechadoContabilEm) continue;
    pendenciasDoMes.push({
      tipo: "fechamento",
      companyId: c.portalClientId,
      empresa: razaoPor.get(c.portalClientId) || null,
      competencia: c.competencia,
      titulo: "Mês contábil não fechado",
    });
  }

  for (const m of marcos) {
    adicionar(diaISO(m.data), {
      tipo: "marco",
      id: m.id,
      titulo: m.titulo,
      descricao: m.descricao,
      importancia: m.importancia,
      companyId: m.portalClientId,
      empresa: m.portalClientId ? (razaoPor.get(m.portalClientId) || null) : null,
      // Marco sem empresa vale para o escritório inteiro — a tela sinaliza isso.
      doEscritorio: !m.portalClientId,
    });
  }

  const dias = [];
  for (let d = 1; d <= limites.diasNoMes; d += 1) {
    const chave = `${limites.ano}-${pad2(limites.mes)}-${pad2(d)}`;
    const itens = porDia.get(chave) || [];
    dias.push({ dia: d, data: chave, itens });
  }

  return {
    ok: true,
    competencia,
    diasNoMes: limites.diasNoMes,
    dias,
    pendenciasDoMes,
    totais: {
      guias: guias.length,
      marcos: marcos.length,
      apuracoes: pendenciasDoMes.filter((p) => p.tipo === "apuracao").length,
      fechamentos: pendenciasDoMes.filter((p) => p.tipo === "fechamento").length,
    },
  };
}
