// Q34 — Pagamento do INSS: ao confirmar a guia INSS como paga, gera a BAIXA contábil.
// Ciclo do INSS: provisão = lançamento de folha/pró-labore (C INSS a Recolher); pagamento = esta baixa
// (D INSS a Recolher / C Caixa). A conta "INSS a Recolher" vem da folha do mês (decisão do dono).
// Espelha o padrão de gerarPagamentoParcelaFromGuide (ParcelamentoV2Service.js).

import { prisma } from "../../infrastructure/db/prisma.js";
import { isMonthClosed } from "./fechamentoContabil.js";
import { PAYROLL_TEMPLATES } from "./payrollTemplate.js";
import { CONTA_JUROS, CONTA_MULTA } from "./contasAcrescimo.js";

function competenciaFromDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function round2(v) {
  return Math.round((Number(v) || 0) * 100) / 100;
}

function norm(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[\s\-_/]+/g, " ")
    .trim();
}

function competenciaLabel(competencia) {
  const m = String(competencia || "").match(/^(\d{4})-(\d{2})$/);
  return m ? `${m[2]}/${m[1]}` : String(competencia || "");
}

// Acha a conta "INSS a Recolher" creditada na folha/pró-labore da competência (linha C cujo
// histórico cita INSS — o template grava "VR REF INSS S/..."). Fallback: nome da conta no plano
// de contas batendo com os accountHints de INSS do payrollTemplate. "" se não achar.
export async function resolveInssAccountFromFolha(portalClientId, competencia) {
  const folhas = await prisma.accountingEntry.findMany({
    where: { portalClientId, competencia: String(competencia), tipo: "FOLHA" },
    select: { lines: { select: { conta: true, tipo: true, historico: true } } },
    orderBy: { createdAt: "desc" },
  });
  for (const f of folhas) {
    for (const l of f.lines || []) {
      if (l.tipo === "C" && String(l.conta || "").trim() && norm(l.historico).includes("inss")) {
        return String(l.conta).trim();
      }
    }
  }
  // Fallback: plano de contas por nome (hints de INSS do template de folha).
  const hints = (PAYROLL_TEMPLATES.FOLHA.lines.find((x) => x.role === "inss")?.accountHints || []).map(norm);
  return matchAccountByHints(portalClientId, hints);
}

// Caixa da baixa: resolve pelos creditAccountHints (caixa/banco) do template de folha. "" se não achar.
export async function resolveCaixaAccount(portalClientId) {
  const hints = (PAYROLL_TEMPLATES.FOLHA.baixa?.creditAccountHints || []).map(norm);
  return matchAccountByHints(portalClientId, hints);
}

async function matchAccountByHints(portalClientId, normalizedHints) {
  if (!normalizedHints.length) return "";
  const raw = await prisma.chartOfAccount.findMany({
    where: { OR: [{ portalClientId: String(portalClientId) }, { portalClientId: null }] },
    select: { codigo: true, nome: true, portalClientId: true },
  });
  // empresa tem prioridade sobre global no mesmo código
  const byCodigo = new Map();
  for (const acc of raw) {
    const ex = byCodigo.get(acc.codigo);
    if (!ex || (acc.portalClientId && !ex.portalClientId)) byCodigo.set(acc.codigo, acc);
  }
  const accounts = [...byCodigo.values()].map((a) => ({ ...a, _norm: norm(a.nome) }));
  for (const h of normalizedHints) {
    const f = accounts.find((a) => a._norm === h);
    if (f) return f.codigo;
  }
  for (const h of normalizedHints) {
    const f = accounts.find((a) => a._norm.startsWith(h));
    if (f) return f.codigo;
  }
  for (const h of normalizedHints) {
    const f = accounts.find((a) => a._norm.includes(h));
    if (f) return f.codigo;
  }
  return "";
}

/**
 * Gera a baixa do INSS a partir da guia confirmada como paga.
 * D INSS a Recolher (conta da folha do mês) / C Caixa — valor da guia, data = pagamento (ou hoje).
 * Idempotente; lança erro `MES_FECHADO` se o mês do pagamento estiver fechado.
 *
 * Q47: aceita override manual do modal "Dar baixa" da Circular:
 *  - `lines` (array {conta, tipo, valor, papel}) → usa essas partidas em vez de resolver contas;
 *  - `historico` → texto do lançamento (senão usa o padrão "PAGO INSS - MM/AAAA").
 *
 * `rateio` ({principal, juros, multa}) é o caminho AUTOMÁTICO com acréscimo: vem do comprovante de
 * arrecadação já validado (`parseComprovanteArrecadacao` só devolve os três quando a soma fecha com
 * o total). O serviço resolve as contas e marca os papéis — o chamador não precisa saber de conta
 * nenhuma, que é o motivo de o rateio entrar aqui em vez de o worker montar `lines`.
 *
 * Sem override e sem rateio, resolve conta INSS/caixa da folha e faz um lançamento só.
 *
 * ⚠ GUIA PAGA EM ATRASO SEM RATEIO CONFIÁVEL NÃO GERA LANÇAMENTO (`sem_rateio_do_acrescimo`).
 * O `guide.valor` de uma guia em atraso já inclui juros e multa; lançar esse total contra "INSS a
 * Recolher" amortizaria o passivo por mais do que foi provisionado e esconderia despesa do mês do
 * pagamento dentro do principal. Sem saber a divisão, a resposta certa é não lançar e deixar para o
 * contador — regra 5 do projeto: nunca gravar ato contábil por suposição. Pago em dia segue com um
 * lançamento só, que é o correto: ali não há acréscimo a separar.
 */
export async function gerarPagamentoInssFromGuide({ portalClientId, guideId, dataPagamento, historico, lines, rateio, userId }) {
  void userId; // reservado p/ auditoria futura
  const guide = await prisma.guide.findFirst({
    where: { id: String(guideId), portalClientId },
    select: {
      id: true, tipo: true, competencia: true, valor: true, lancamentoId: true, baixada: true,
      vencimento: true,
    },
  });
  if (!guide) return { skipped: true, reason: "guide_not_found" };
  if (String(guide.tipo || "").toUpperCase() !== "INSS") return { skipped: true, reason: "nao_e_inss" };
  if (guide.lancamentoId || guide.baixada) return { skipped: true, reason: "ja_baixada" };

  const baixaExistente = await prisma.accountingEntry.findFirst({
    where: { sourceGuideId: guide.id, tipo: "BAIXA" }, select: { id: true },
  });
  if (baixaExistente) return { skipped: true, reason: "ja_baixada" };

  const valor = round2(guide.valor);
  if (!Number.isFinite(valor) || valor <= 0) return { skipped: true, reason: "sem_valor" };

  const data = dataPagamento ? new Date(dataPagamento) : new Date();
  const competenciaPag = competenciaFromDate(data);
  if (await isMonthClosed(portalClientId, competenciaPag)) {
    const err = new Error(`Mês ${competenciaPag} fechado — reabra antes de baixar o INSS.`);
    err.code = "MES_FECHADO";
    throw err;
  }

  // Principal, juros e multa viram LANÇAMENTOS INDEPENDENTES (decisão do dono), cada um
  // balanceado contra o caixa. Antes tudo virava um lançamento só, debitando o TOTAL contra
  // "INSS a Recolher" — o que amortizava o passivo por mais do que foi provisionado: juros e
  // multa não são passivo previdenciário, são despesa do mês do pagamento.
  //
  // O papel vem marcado do modal (não é derivado da conta, porque o contador pode trocá-la).
  // Componente zerado não gera lançamento.
  function separarPorPapel(linhasEntrada) {
    const debitos = linhasEntrada.filter((l) => String(l.tipo || "").toUpperCase() === "D");
    const credito = linhasEntrada.find((l) => String(l.tipo || "").toUpperCase() === "C");
    const contaCaixaInput = String(credito?.conta || "").trim();

    const grupos = [];
    for (const papel of ["PRINCIPAL", "JUROS", "MULTA"]) {
      // Linha sem papel (adicionada à mão no modal) conta como principal.
      const doGrupo = debitos.filter((l) => {
        const p = String(l.papel || "").toUpperCase();
        return papel === "PRINCIPAL" ? (!p || p === "PRINCIPAL") : p === papel;
      });
      const total = round2(doGrupo.reduce((s, l) => s + (Number(l.valor) || 0), 0));
      if (!doGrupo.length || total <= 0) continue;
      grupos.push({ papel, debitos: doGrupo, total, contaCaixa: contaCaixaInput });
    }
    return grupos;
  }

  // Override manual (modal da Circular) tem prioridade; senão resolve as contas da folha do mês.
  const hasOverride = Array.isArray(lines) && lines.length > 0;
  const acrescimoDoRateio = round2(rateio?.juros) + round2(rateio?.multa);
  const temRateio = Boolean(rateio) && round2(rateio.principal) > 0 && acrescimoDoRateio > 0;

  // Pago depois do vencimento ⇒ o valor da guia embute acréscimo. Sem rateio para dividir, não há
  // lançamento honesto a fazer.
  const pagoEmAtraso = Boolean(guide.vencimento) && data > new Date(guide.vencimento);
  if (!hasOverride && !temRateio && pagoEmAtraso) {
    return {
      skipped: true,
      reason: "sem_rateio_do_acrescimo",
      message: "Guia paga em atraso sem o rateio de juros e multa do comprovante. "
        + "Dê a baixa pelo modal da Circular, que separa principal, juros e multa.",
    };
  }

  let contaInss = null;
  let contaCaixa = null;
  let entryLines;
  if (hasOverride) {
    entryLines = lines.map((l, i) => ({
      conta: String(l.conta || "").trim(),
      tipo: String(l.tipo || "").toUpperCase() === "C" ? "C" : "D",
      valor: round2(l.valor),
      // ⚠ O papel PRECISA atravessar. Ele é o que `separarPorPapel` lê; sem repassar, toda linha
      // do modal virava principal e a baixa saía num bloco só — o defeito relatado pelo dono.
      papel: l.papel ? String(l.papel).toUpperCase() : undefined,
      ordem: i,
    }));
  } else if (temRateio) {
    // Caminho automático COM acréscimo: monta as três pernas já com papel, e deixa
    // `separarPorPapel` fazer o resto. Nenhuma lógica de separação nova.
    contaInss = await resolveInssAccountFromFolha(portalClientId, guide.competencia);
    contaCaixa = await resolveCaixaAccount(portalClientId);
    entryLines = [
      { conta: contaInss || "", tipo: "D", valor: round2(rateio.principal), papel: "PRINCIPAL", ordem: 0 },
      { conta: CONTA_JUROS, tipo: "D", valor: round2(rateio.juros), papel: "JUROS", ordem: 1 },
      { conta: CONTA_MULTA, tipo: "D", valor: round2(rateio.multa), papel: "MULTA", ordem: 2 },
      { conta: contaCaixa || "", tipo: "C", valor, ordem: 3 },
    ].filter((l) => l.tipo === "C" || l.valor > 0); // componente zerado não vira lançamento
  } else {
    // Conta "INSS a Recolher" vem da folha da competência da guia (decisão do dono); caixa por hints.
    contaInss = await resolveInssAccountFromFolha(portalClientId, guide.competencia);
    contaCaixa = await resolveCaixaAccount(portalClientId);
    entryLines = [
      { conta: contaInss || "", tipo: "D", valor, ordem: 0 },
      { conta: contaCaixa || "", tipo: "C", valor, ordem: 1 },
    ];
  }
  const historicoFinal = String(historico || "").trim() || `PAGO INSS - ${competenciaLabel(guide.competencia)}`;

  // Sem papel marcado em lugar nenhum, é lançamento único — não há o que dividir.
  const grupos = (hasOverride || temRateio) ? separarPorPapel(entryLines) : [];
  const separar = grupos.length > 1;

  // ⚠ `papel` é campo de ROTEAMENTO, não coluna. `AccountingEntryLine` não o tem, e mandá-lo no
  // `createMany` quebra o Prisma.
  const paraGravar = (l, ordem) => ({
    conta: String(l.conta || "").trim(),
    tipo: String(l.tipo || "").toUpperCase() === "C" ? "C" : "D",
    valor: round2(l.valor),
    ordem,
  });

  const SUFIXO_HISTORICO = { PRINCIPAL: "", JUROS: " (juros)", MULTA: " (multa)" };

  return prisma.$transaction(async (tx) => {
    const base = {
      portalClientId,
      sourceGuideId: guide.id,
      data,
      competencia: competenciaPag,
      tipo: "BAIXA",
      subtipo: "INSS",
      origem: "MANUAL",
      loteImportacao: `INSS-PAG-${guide.id.slice(0, 8)}`,
      status: "RASCUNHO",
      statusPagamento: "PAGO",
    };

    if (!separar) {
      const entry = await tx.accountingEntry.create({
        data: { ...base, historico: historicoFinal, lines: { createMany: { data: entryLines.map(paraGravar) } } },
        include: { lines: true },
      });
      await tx.guide.update({
        where: { id: guide.id },
        data: { baixada: true, dataBaixa: data, lancamentoId: entry.id },
      });
      return { ok: true, pagamentoId: entry.id, lancamentos: 1, contaInss: contaInss || null, contaCaixa: contaCaixa || null };
    }

    const criados = [];
    for (const g of grupos) {
      const linhasGrupo = [
        ...g.debitos.map((l, i) => paraGravar(l, i)),
        // Cada lançamento credita o caixa pelo SEU total → fecha D=C sozinho.
        { conta: g.contaCaixa, tipo: "C", valor: g.total, ordem: g.debitos.length },
      ];
      const entry = await tx.accountingEntry.create({
        data: { ...base, historico: `${historicoFinal}${SUFIXO_HISTORICO[g.papel] || ""}`, lines: { createMany: { data: linhasGrupo } } },
        include: { lines: true },
      });
      criados.push({ papel: g.papel, id: entry.id, valor: g.total });
    }

    // A guia aponta para o lançamento do PRINCIPAL (é o que amortiza o passivo); os demais
    // continuam ligados a ela por sourceGuideId.
    const principal = criados.find((c) => c.papel === "PRINCIPAL") || criados[0];
    await tx.guide.update({
      where: { id: guide.id },
      data: { baixada: true, dataBaixa: data, lancamentoId: principal.id },
    });
    return {
      ok: true,
      pagamentoId: principal.id,
      lancamentos: criados.length,
      detalhe: criados,
      contaInss: contaInss || null,
      contaCaixa: contaCaixa || null,
    };
  });
}
