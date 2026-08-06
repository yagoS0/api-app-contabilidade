import { Router } from "express";
import multer from "multer";
import { prisma } from "../../infrastructure/db/prisma.js";
import { requireFirmCompanyAccess } from "../../middlewares/requireFirmCompanyAccess.js";
import { generateEntriesFromCircular, resolveRule, applyTemplate, formatCompetenciaLabel, lookupAccountsFromHistorico } from "../../application/accounting/AccountingEntryGeneratorService.js";
import { syncPgdasByCompetencia } from "../../application/fiscal/serpro/SerproPgdasDeclaracaoService.js";
import { resolvePayrollTemplate } from "../../application/accounting/payrollTemplate.js";
import { PROVISAO_TO_BAIXA_EVENT } from "./accountingEntryRules.js";
import { importChartOfAccountsFromBuffer } from "../../application/accounting/chartOfAccountsImport.js";
import { isMonthClosed } from "../../application/accounting/fechamentoContabil.js";
import { CONTA_JUROS, CONTA_MULTA, CONTAS_ACRESCIMO } from "../../application/accounting/contasAcrescimo.js";
import { marcarSemFaturamento } from "../../application/accounting/semFaturamento.js";
import { comContextoSerpro, podeForcarSerpro } from "../../application/fiscal/serpro/serproCallContext.js";
import {
  computeFechamentoBlockers, SELECT_PARA_BLOQUEIOS,
  CHECKLIST_FECHAMENTO, CHECKLIST_SELECT, checklistPendentes,
} from "../../application/accounting/fechamentoBlockers.js";
import { INTEGRACAO_SERPRO_DCTFWEB_LP } from "../../config.js";
// Mesma definição de faturamento que a apuração usa — importada de propósito, não copiada.
import { faturamentoEmitDaCompetencia } from "../../application/notas/apuracao/v2/FechamentoService.js";
import { parseExcelBuffer, findHistoricoMatches, upsertHistoricoFromImport } from "../../application/accounting/excelImport.js";
import { sanitizeFilename } from "../../lib/httpHeaders.js";
// Q47: baixa do INSS pela Circular (guia sintética) — reusa o serviço de pagamento do INSS.
import {
  gerarPagamentoInssFromGuide,
  resolveInssAccountFromFolha,
  resolveCaixaAccount,
} from "../../application/accounting/InssPagamentoService.js";
import { markGuidePaidManual } from "../../application/guides/GuidePaymentStatusService.js";
// Q50: históricos agnósticos de competência (chave normalizada com {{competencia}}).
import { normalizarHistorico } from "../../application/accounting/historicoCompetencia.js";

// Q16/Q37: memória de contas por (empresa, eventType). Grava/atualiza AccountingHistorico para que o
// próximo lançamento do mesmo evento (provisão automática OU baixa) venha com D/C pré-preenchidos —
// "último preenchido permanece". Best-effort: nunca derruba a operação principal.
// Q50: a chave é o texto NORMALIZADO ({{competencia}} no lugar de MM/AAAA / AAAA-MM) — "DAS 05/2026"
// e "DAS 06/2026" são o MESMO histórico. Além da linha da empresa, mantém uma linha GLOBAL
// (companyPortalClientId null) que serve de fallback pra empresas novas; nela as contas só são
// preenchidas quando estão vazias (a linha da empresa é que manda no caso específico).
async function memorizeAccountHistorico({ userId, portalClientId, text, contaDebito, contaCredito, eventType }) {
  if (!userId || !portalClientId || !text) return;
  // (sem guard de contas: histórico só-texto também vale — alimenta o autocomplete; o POST /entries
  // sempre salvou assim.)
  const textNorm = normalizarHistorico(text);
  if (!textNorm) return;
  try {
    const existing = await prisma.accountingHistorico.findFirst({
      where: { createdByUserId: String(userId), companyPortalClientId: String(portalClientId), text: textNorm },
    });
    if (existing) {
      await prisma.accountingHistorico.update({
        where: { id: existing.id },
        data: {
          contaDebito: contaDebito ?? existing.contaDebito,
          contaCredito: contaCredito ?? existing.contaCredito,
          eventType: eventType ?? existing.eventType,
          usageCount: existing.usageCount + 1,
          updatedAt: new Date(),
        },
      });
    } else {
      await prisma.accountingHistorico.create({
        data: {
          createdByUserId: String(userId),
          companyPortalClientId: String(portalClientId),
          text: textNorm,
          contaDebito: contaDebito || null,
          contaCredito: contaCredito || null,
          eventType: eventType || null,
        },
      });
    }

    // Linha GLOBAL (fallback pra empresa nova): cria se não existe; se existe, incrementa uso e só
    // completa conta que estiver vazia — divergência pontual de uma empresa não sobrescreve o padrão.
    const global = await prisma.accountingHistorico.findFirst({
      where: { createdByUserId: String(userId), companyPortalClientId: null, text: textNorm },
    });
    if (global) {
      await prisma.accountingHistorico.update({
        where: { id: global.id },
        data: {
          contaDebito: global.contaDebito ?? (contaDebito || null),
          contaCredito: global.contaCredito ?? (contaCredito || null),
          eventType: global.eventType ?? (eventType || null),
          usageCount: global.usageCount + 1,
          updatedAt: new Date(),
        },
      });
    } else {
      await prisma.accountingHistorico.create({
        data: {
          createdByUserId: String(userId),
          companyPortalClientId: null,
          text: textNorm,
          contaDebito: contaDebito || null,
          contaCredito: contaCredito || null,
          eventType: eventType || null,
        },
      });
    }
  } catch {
    // best-effort: memória não derruba a operação
  }
}

// Q37: deriva o eventType da BAIXA a partir da provisão. DAS tem mapa explícito
// (PROVISAO_TO_BAIXA_EVENT); os demais tributos usam chave genérica por eventType/subtipo
// (memória por tributo). Retorna null quando não há como chavear (cai na inversão da provisão).
function deriveBaixaEventType(entry) {
  if (!entry) return null;
  if (entry.eventType && PROVISAO_TO_BAIXA_EVENT[entry.eventType]) return PROVISAO_TO_BAIXA_EVENT[entry.eventType];
  if (entry.eventType) return `BAIXA_${entry.eventType}`;
  if (entry.subtipo) return `BAIXA_${entry.subtipo}`;
  return null;
}

// Frente B / item 2: acréscimo (juros+multa) do tributo do lançamento, lido de circular.acrescimos.
// Usado na baixa pra somar linhas de despesa quando a guia veio recalculada.
// Contas conferidas no plano de contas (ChartOfAccount): 501 = JUROS, 506 = MULTAS (ambas DESPESA/DEVEDORA).
// 1:1 desde que PIS e COFINS ganharam linha própria na Circular — cada um lê o SEU acréscimo.
// `PIS_COFINS` fica no mapa para lançamento ANTIGO ainda não convertido pelo script de separação:
// sem ele, o juros/multa daqueles meses sumiria da tela até a migração rodar.
const SUBTIPO_TO_ACRESCIMO_TRIB = {
  DAS: ["DAS"], INSS: ["INSS"], IRPJ: ["IRPJ"], CSLL: ["CSLL"],
  PIS: ["PIS"], COFINS: ["COFINS"], PIS_COFINS: ["PIS", "COFINS"], ISS: ["ISS"],
};
// 501/502 vinham escritos aqui, no script de remediação e como literal no modal do front. Três
// cópias de um código de conta divergem sem ninguém notar — agora vêm de `contasAcrescimo.js`.
async function acrescimoDoEntry(client, portalClientId, entry) {
  const keys = SUBTIPO_TO_ACRESCIMO_TRIB[String(entry?.subtipo || "").toUpperCase()];
  if (!keys || !entry?.competencia) return null;
  const circ = await client.companyMonthlyCircular.findUnique({
    where: { portalClientId_competencia: { portalClientId, competencia: entry.competencia } },
    select: { acrescimos: true },
  }).catch(() => null);
  const src = circ?.acrescimos;
  if (!src || typeof src !== "object") return null;
  let principal = 0, juros = 0, multa = 0;
  for (const k of keys) { const t = src[k]; if (t) { principal += Number(t.principal) || 0; juros += Number(t.juros) || 0; multa += Number(t.multa) || 0; } }
  principal = Math.round(principal * 100) / 100;
  juros = Math.round(juros * 100) / 100;
  multa = Math.round(multa * 100) / 100;
  const total = Math.round((juros + multa) * 100) / 100;
  // Retorna se houver acréscimo OU principal editado (INSS usa o principal p/ o valor da baixa).
  if (total <= 0 && principal <= 0) return null;
  // Cada acréscimo na sua conta: juros → 501, multa → 506. `conta` mantido p/ compat (= juros).
  return { principal, juros, multa, total, contaJuros: CONTA_JUROS, contaMulta: CONTA_MULTA, conta: CONTA_JUROS };
}

// ── Baixa parcial por quota (IRPJ/CSLL trimestral: até 3 quotas com saldo) ───────────────
// O PRINCIPAL abatido por uma baixa = débitos que NÃO são acréscimo (juros 501 / multa 506).
// Assim uma baixa parcial só amortiza o passivo da provisão; juros/multa de quota não contam no saldo.
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
function principalAbatidoDaBaixa(baixa) {
  const lines = baixa?.lines || [];
  return lines
    .filter((l) => String(l.tipo).toUpperCase() === "D" && !CONTAS_ACRESCIMO.has(String(l.conta).trim()))
    .reduce((s, l) => s + Number(l.valor || 0), 0);
}
// ── Separação da baixa em lançamentos independentes (principal / juros / multa) ──────────────
// Regra do projeto: cada componente é um LANÇAMENTO próprio, balanceado contra o caixa. Um único
// lançamento 3D/1C escondia que juros e multa são DESPESA do mês, e não amortização do passivo.
//
// O papel vem MARCADO do modal (não é deduzido da conta — o contador pode trocá-la). Linha sem
// papel conta como principal, que é o comportamento seguro para lançamentos montados à mão.
const SUFIXO_PAPEL = { PRINCIPAL: "", JUROS: " (juros)", MULTA: " (multa)" };
function separarLinhasPorPapel(linhas) {
  const debitos = linhas.filter((l) => String(l.tipo || "").toUpperCase() === "D");
  const credito = linhas.find((l) => String(l.tipo || "").toUpperCase() === "C");
  const contaCaixa = String(credito?.conta || "").trim();
  const grupos = [];
  for (const papel of ["PRINCIPAL", "JUROS", "MULTA"]) {
    const doGrupo = debitos.filter((l) => {
      const p = String(l.papel || "").toUpperCase();
      return papel === "PRINCIPAL" ? (!p || p === "PRINCIPAL") : p === papel;
    });
    const total = r2(doGrupo.reduce((acc, l) => acc + (parseFloat(String(l.valor).replace(",", ".")) || 0), 0));
    if (!doGrupo.length || total <= 0) continue;
    grupos.push({ papel, debitos: doGrupo, total, contaCaixa });
  }
  return grupos;
}

// Saldo de uma provisão = principal (D da provisão) − principal já abatido pelas baixas.
// entry deve vir com `lines` e `baixas: { lines }`.
function computeSaldoProvisao(entry) {
  const lines = entry?.lines || [];
  const principal = lines.filter((l) => l.tipo === "D").reduce((s, l) => s + Number(l.valor || 0), 0);
  const baixas = Array.isArray(entry?.baixas) ? entry.baixas : [];
  const abatido = r2(baixas.reduce((s, b) => s + principalAbatidoDaBaixa(b), 0));
  const saldoRaw = r2(principal - abatido);
  return { principal: r2(principal), abatido, saldo: saldoRaw > 0 ? saldoRaw : 0, quotasPagas: baixas.length };
}

// ---------------------------------------------------------------------------
// OFX Parser (SGML v1 e XML v2)
// Suporta: namespaces de tag (n0:STMTTRN), encoding UTF-8/Latin-1,
// formatos de data YYYYMMDD[HHMMSS[.XXX]][TZ], entidades HTML, sinais +/-,
// separadores de milhar BR (1.234,56) e US (1,234.56).
// ---------------------------------------------------------------------------

function decodeOfxBuffer(buffer) {
  // Tenta UTF-8 primeiro; se header indicar ENCODING:USASCII ou Latin-1, decodifica como latin1.
  const utf8Text = buffer.toString("utf-8");
  const headerSlice = utf8Text.slice(0, 600).toUpperCase();
  const isLatinHeader =
    /ENCODING:\s*(USASCII|LATIN-?1|ISO-?8859-?1)/.test(headerSlice) ||
    /CHARSET=(LATIN-?1|ISO-?8859-?1|1252)/.test(headerSlice);
  if (isLatinHeader) return buffer.toString("latin1");
  // Detecção heurística: bytes 0x80-0xFF sem padrão UTF-8 multibyte → provavelmente latin1
  if (/�/.test(utf8Text)) return buffer.toString("latin1");
  return utf8Text;
}

function decodeHtmlEntities(value) {
  if (!value) return value;
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
}

function parseOfxDate(raw) {
  if (!raw) return null;
  // Remove timezone bracket (ex: [-3:GMT]) e qualquer espaço.
  const s = String(raw).replace(/\[[^\]]*\]/, "").trim();
  if (s.length < 8) return null;
  const y = s.slice(0, 4);
  const mo = s.slice(4, 6);
  const d = s.slice(6, 8);
  if (!/^\d{4}$/.test(y) || !/^\d{2}$/.test(mo) || !/^\d{2}$/.test(d)) return null;
  const dt = new Date(`${y}-${mo}-${d}T00:00:00.000Z`);
  return isNaN(dt.getTime()) ? null : dt;
}

function parseOfxAmount(raw) {
  if (raw == null) return 0;
  const s = String(raw).trim();
  if (!s) return 0;
  // Detecta separador decimal: o último '.' ou ',' é o decimal; o outro é separador de milhar.
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  let normalized;
  if (lastDot === -1 && lastComma === -1) {
    normalized = s;
  } else if (lastDot > lastComma) {
    // formato US: 1,234.56 → remove vírgulas
    normalized = s.replace(/,/g, "");
  } else {
    // formato BR: 1.234,56 → remove pontos, troca vírgula por ponto
    normalized = s.replace(/\./g, "").replace(",", ".");
  }
  const parsed = parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

// Match de tag insensível a namespace (n0:STMTTRN, ofx:STMTTRN, STMTTRN)
const NS = "(?:[a-z][a-z0-9]*:)?";

function parseOfxSgml(text) {
  const transactions = [];
  const blockRegex = new RegExp(`<${NS}STMTTRN>([\\s\\S]*?)<\\/${NS}STMTTRN>`, "gi");
  // Fallback se não houver tag de fechamento (SGML estrito): usa STMTTRN abertura como delimitador.
  // Aqui aceitamos o fechamento opcional via OR adicional abaixo.
  let match;
  const matched = [];
  while ((match = blockRegex.exec(text)) !== null) matched.push(match[1]);

  // Se não casou nada com fechamento, divide por <STMTTRN>
  let blocks = matched;
  if (!blocks.length) {
    const splits = text.split(new RegExp(`<${NS}STMTTRN>`, "i")).slice(1);
    blocks = splits.map((b) => b.split(new RegExp(`<${NS}(?:STMTTRN|BANKTRANLIST|/STMTRS)>`, "i"))[0]);
  }

  for (const block of blocks) {
    const get = (tag) => {
      const r = new RegExp(`<${NS}${tag}>([^<\\n\\r]*)`, "i");
      const m = r.exec(block);
      return m ? decodeHtmlEntities(m[1].trim()) : null;
    };
    transactions.push({
      trnType: get("TRNTYPE"),
      dtPosted: get("DTPOSTED"),
      trnAmt: get("TRNAMT"),
      fitId: get("FITID"),
      memo: get("MEMO") || get("NAME") || "",
    });
  }
  return transactions;
}

function parseOfxXml(text) {
  const transactions = [];
  const blockRegex = new RegExp(`<${NS}STMTTRN>([\\s\\S]*?)<\\/${NS}STMTTRN>`, "gi");
  let match;
  while ((match = blockRegex.exec(text)) !== null) {
    const block = match[1];
    const get = (tag) => {
      const r = new RegExp(`<${NS}${tag}>([^<]*)<\\/${NS}${tag}>`, "i");
      const m = r.exec(block);
      return m ? decodeHtmlEntities(m[1].trim()) : null;
    };
    transactions.push({
      trnType: get("TRNTYPE"),
      dtPosted: get("DTPOSTED"),
      trnAmt: get("TRNAMT"),
      fitId: get("FITID"),
      memo: get("MEMO") || get("NAME") || "",
    });
  }
  return transactions;
}

function parseOfx(buffer) {
  const text = decodeOfxBuffer(buffer);
  const headerSlice = text.slice(0, 800);
  const isXml = /<\?xml/i.test(headerSlice) || /<\?OFX/i.test(headerSlice);
  const raw = isXml ? parseOfxXml(text) : parseOfxSgml(text);

  return raw
    .map((t) => {
      const amount = parseOfxAmount(t.trnAmt);
      return {
        fitId: t.fitId || null,
        trnType: String(t.trnType || "").toUpperCase(),
        data: parseOfxDate(t.dtPosted),
        valor: Math.abs(amount),
        // Convenção bancária: TRNAMT < 0 = saída (DEBITO no extrato), > 0 = entrada (CREDITO no extrato)
        sinal: amount < 0 ? "DEBITO" : "CREDITO",
        historico: t.memo || "",
      };
    })
    .filter((t) => t.data && t.valor > 0);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validateLines(lines) {
  if (!Array.isArray(lines) || lines.length === 0) {
    return { ok: false, error: "lines_required" };
  }
  for (const l of lines) {
    if (!l.conta || String(l.conta).trim() === "") {
      return { ok: false, error: "linha_sem_conta" };
    }
    if (!["D", "C"].includes(String(l.tipo || "").toUpperCase())) {
      return { ok: false, error: "linha_tipo_invalido" };
    }
    const v = parseFloat(String(l.valor || "0").replace(",", "."));
    if (isNaN(v) || v <= 0) {
      return { ok: false, error: "linha_valor_invalido" };
    }
  }
  const totalD = lines
    .filter((l) => String(l.tipo).toUpperCase() === "D")
    .reduce((s, l) => s + parseFloat(String(l.valor).replace(",", ".")), 0);
  const totalC = lines
    .filter((l) => String(l.tipo).toUpperCase() === "C")
    .reduce((s, l) => s + parseFloat(String(l.valor).replace(",", ".")), 0);
  const diferenca = Math.abs(totalD - totalC);
  // Lançamentos desequilibrados são permitidos — ficam marcados como "em aberto"
  return { ok: true, totalD, totalC, diferenca, balanced: diferenca <= 0.01 };
}

/**
 * As contas usadas existem no plano da empresa?
 *
 * ⚠ POR QUE ISTO É UMA CHECAGEM SEPARADA, NA ROTA
 * `validateLines` só exigia que a conta não fosse VAZIA. Digitar "9999" — um código que não existe
 * no plano — salvava sem uma palavra, e o erro só aparecia lá na frente, na exportação para o ERP,
 * longe do lançamento que o causou e às vezes semanas depois. Quem recebe o erro nem sempre é quem
 * digitou, e a essa altura o lançamento já entrou em conciliação e fechamento.
 *
 * Fica na ROTA, e não dentro de `createEntry`: a captura do SERPRO e os workers resolvem conta por
 * template e não podem ser derrubados por um plano de contas incompleto no meio de uma sincronia.
 * Mesmo critério da guarda de `MES_FECHADO`.
 *
 * Conta GLOBAL (`portalClientId: null`) vale para todas as empresas — por isso o `OR`.
 */
/** Mesma mensagem em vários lançamentos vira UMA linha, com a contagem. */
function dedupePorTexto(itens) {
  const porMotivo = new Map();
  for (const i of itens) {
    const atual = porMotivo.get(i.motivo);
    if (atual) { atual.ocorrencias += 1; continue; }
    porMotivo.set(i.motivo, { ...i, ocorrencias: 1 });
  }
  return [...porMotivo.values()];
}

async function contasInexistentes(prisma, portalClientId, lines) {
  const codigos = [...new Set((lines || []).map((l) => String(l.conta || "").trim()).filter(Boolean))];
  if (!codigos.length) return [];
  const achadas = await prisma.chartOfAccount.findMany({
    where: {
      codigo: { in: codigos },
      OR: [{ portalClientId }, { portalClientId: null }],
    },
    select: { codigo: true },
  });
  const conhecidas = new Set(achadas.map((a) => a.codigo));
  return codigos.filter((c) => !conhecidas.has(c));
}

// Q17: valida se a competência pode ser FECHADA (fechamento contábil).
// Bloqueia por lançamento: em branco (sem linhas / conta vazia) OU D≠C (desbalanceado).
// Ignora linhas de rastreio de parcela (tipo="PARCELA") e a abertura/baixas de parcelamento
// não são desbalanceadas. Retorna { ok, blockers: [{ entryId, competencia, historico, motivo }] }.
async function validateFechamentoContabil(prisma, { portalClientId, competencia }) {
  const entries = await prisma.accountingEntry.findMany({
    where: { portalClientId, competencia, tipo: { not: "PARCELA" } },
    select: SELECT_PARA_BLOQUEIOS,
  });
  // A regra em si mora em `application/accounting/fechamentoBlockers.js`: a visão de carteira
  // precisa da MESMA resposta para dezenas de empresas numa query só, e duas cópias divergiriam.
  return computeFechamentoBlockers(entries, competencia);
}

function entryToResponse(entry) {
  const lines = entry.lines || [];
  const totalD = lines
    .filter((l) => l.tipo === "D")
    .reduce((s, l) => s + Number(l.valor), 0);
  const totalC = lines
    .filter((l) => l.tipo === "C")
    .reduce((s, l) => s + Number(l.valor), 0);
  // placeholder = PROVISAO sem linhas (agendado, aguardando valor)
  const placeholder = entry.tipo === "PROVISAO" && lines.length === 0;
  const result = { ...entry, totalD, totalC, valor: totalD, placeholder };
  // Baixa parcial por quota: expõe saldo/abatido/quotas quando as baixas vierem com linhas.
  if (entry.tipo === "PROVISAO" && Array.isArray(entry.baixas)) {
    const s = computeSaldoProvisao(entry);
    result.saldo = s.saldo;
    result.abatido = s.abatido;
    result.quotasPagas = s.quotasPagas;
    result.parcial = entry.statusPagamento === "PARCIAL" || (s.abatido > 0.009 && s.saldo > 0.009);
  }
  return result;
}

// Meses "YYYY-MM" de um ano
function monthsOfYear(year) {
  return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
}

function parseMoney(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const raw = String(value).trim();
  if (!raw) return null;
  const normalized = raw.includes(",") ? Number(raw.replace(/\./g, "").replace(",", ".")) : Number(raw);
  return Number.isFinite(normalized) ? normalized : null;
}

function parseOptionalDate(value) {
  if (value == null || value === "") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

// Cria placeholders de provisão para os meses do ano que ainda não têm entrada
async function createProvisionPlaceholders(tx, { portalClientId, subtipo, competenciaOrigem, historico }) {
  const year = Number(competenciaOrigem.slice(0, 4));
  const meses = monthsOfYear(year);

  // Quais meses já têm entrada para este subtipo?
  const existing = await tx.accountingEntry.findMany({
    where: { portalClientId, tipo: "PROVISAO", subtipo, competencia: { in: meses } },
    select: { competencia: true },
  });
  const covered = new Set(existing.map((e) => e.competencia));

  const missing = meses.filter((m) => !covered.has(m));
  if (missing.length === 0) return;

  // Data padrão = dia 1 de cada mês
  await tx.accountingEntry.createMany({
    data: missing.map((comp) => {
      const [y, mo] = comp.split("-");
      return {
        portalClientId,
        data: new Date(`${y}-${mo}-01T00:00:00.000Z`),
        competencia: comp,
        historico: `Provisão ${historico} — aguardando valor`,
        tipo: "PROVISAO",
        subtipo,
        origem: "TEMPLATE",
        statusPagamento: "ABERTO",
        status: "RASCUNHO",
      };
    }),
  });
}

// ---------------------------------------------------------------------------
// CSV export (por linha de lançamento)
// ---------------------------------------------------------------------------

function entriesToCsv(entries) {
  // Formato "lançamento partido": 5 colunas (Data | Codigo Debito | Codigo Credito | Historico | Valor).
  // SEM header — sistema contábil destino consome desde a linha 1.
  // Valor SEM separador de milhar — só vírgula decimal (ex: 17614,98).
  // - Lançamento simples (1D + 1C, mesmo valor, mesmo histórico): uma linha consolidada.
  // - Lançamento composto: uma linha por linha contábil, lado oposto vazio.
  // - line.historico (se presente) tem prioridade sobre entry.historico.
  const rows = [];
  const sanitize = (s) => String(s || "").replace(/;/g, " ").replace(/[\r\n]+/g, " ").trim();
  const fmtValor = (v) => Number(v || 0).toFixed(2).replace(".", ",");

  for (const e of entries) {
    const data = e.data ? new Date(e.data).toLocaleDateString("pt-BR") : "";
    const entryHistorico = sanitize(e.historico);
    const lines = e.lines || [];
    const debits = lines.filter((l) => String(l.tipo).toUpperCase() === "D");
    const credits = lines.filter((l) => String(l.tipo).toUpperCase() === "C");
    const lineHistoric = (l) => sanitize(l.historico) || entryHistorico;

    if (debits.length === 1 && credits.length === 1
        && Math.abs(Number(debits[0].valor) - Number(credits[0].valor)) < 0.01
        && lineHistoric(debits[0]) === lineHistoric(credits[0])) {
      rows.push(`${data};${debits[0].conta};${credits[0].conta};${lineHistoric(debits[0])};${fmtValor(debits[0].valor)}`);
    } else {
      for (const d of debits) {
        rows.push(`${data};${d.conta};;${lineHistoric(d)};${fmtValor(d.valor)}`);
      }
      for (const c of credits) {
        rows.push(`${data};;${c.conta};${lineHistoric(c)};${fmtValor(c.valor)}`);
      }
    }
  }
  return rows.join("\r\n");
}

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

export function createAccountingEntriesRouter({ log }) {
  const router = Router({ mergeParams: true });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
  });

  // ─── Plano de Contas ──────────────────────────────────────────────────────

  // GET /firm/companies/:companyId/chart-of-accounts
  // Retorna UNION dedupada de contas globais + contas da empresa.
  // Quando uma conta com mesmo `codigo` existe em ambos os escopos, a da EMPRESA tem
  // prioridade e a global é ocultada (override semantic).
  router.get("/chart-of-accounts", requireFirmCompanyAccess(), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const accounts = await prisma.chartOfAccount.findMany({
      where: { OR: [{ portalClientId }, { portalClientId: null }] },
      orderBy: [{ tipo: "asc" }, { codigo: "asc" }],
    });
    // Dedup por código: empresa vence sobre global
    const byCodigo = new Map();
    for (const acc of accounts) {
      const isCompany = Boolean(acc.portalClientId);
      const existing = byCodigo.get(acc.codigo);
      if (!existing || (isCompany && !existing.portalClientId)) {
        byCodigo.set(acc.codigo, acc);
      }
    }
    const data = [...byCodigo.values()].map((acc) => ({
      ...acc,
      scope: acc.portalClientId ? "COMPANY" : "GLOBAL",
    }));
    return res.json({ data });
  });

  // GET /firm/companies/:companyId/payroll/template?kind=PROLABORE|FOLHA&competencia=YYYY-MM
  router.get("/payroll/template", requireFirmCompanyAccess(), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const kind = String(req.query?.kind || "").toUpperCase();
    const competencia = String(req.query?.competencia || "").trim();
    if (!kind) return res.status(400).json({ error: "kind_required" });
    if (!competencia) return res.status(400).json({ error: "competencia_required" });
    try {
      const template = await resolvePayrollTemplate({ portalClientId, kind, competencia });
      return res.json({ ok: true, template });
    } catch (err) {
      const code = err?.code || "PAYROLL_TEMPLATE_FAILED";
      const status = code === "UNKNOWN_PAYROLL_KIND" ? 400 : 500;
      return res.status(status).json({ ok: false, error: code, message: err?.message });
    }
  });

  // POST /firm/companies/:companyId/chart-of-accounts
  router.post("/chart-of-accounts", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const body = req.body || {};
    const codigo = String(body.codigo || "").trim();
    const nome = String(body.nome || "").trim();
    const tipo = String(body.tipo || "DESPESA").toUpperCase();
    const natureza = String(body.natureza || "DEVEDORA").toUpperCase();

    if (!codigo) return res.status(400).json({ error: "codigo_required" });
    if (!nome) return res.status(400).json({ error: "nome_required" });

    const TIPOS = ["ATIVO", "PASSIVO", "RECEITA", "DESPESA", "PATRIMONIO"];
    if (!TIPOS.includes(tipo)) return res.status(400).json({ error: "tipo_invalido" });

    // Override semantic: per-empresa pode coexistir com global de mesmo código.
    // Quando ambos existem, empresa tem prioridade na visualização (dedupe na rota GET).
    try {
      const account = await prisma.chartOfAccount.create({
        data: {
          portalClientId,
          codigo,
          nome,
          tipo,
          natureza,
          status: "PENDENTE_ERP",
        },
      });
      return res.status(201).json({ ok: true, account });
    } catch (err) {
      if (err?.code === "P2002") {
        return res.status(409).json({ error: "codigo_ja_existe" });
      }
      log.error({ err }, "Erro ao criar conta no plano de contas");
      return res.status(500).json({ error: "internal_error" });
    }
  });

  // PATCH /firm/companies/:companyId/chart-of-accounts/:codigo
  router.patch("/chart-of-accounts/:codigo", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const codigo = String(req.params.codigo);
    const body = req.body || {};

    const existing = await prisma.chartOfAccount.findUnique({
      where: { portalClientId_codigo: { portalClientId, codigo } },
    });
    if (!existing) return res.status(404).json({ error: "conta_nao_encontrada" });

    const data = {};
    if (body.nome !== undefined) data.nome = String(body.nome).trim();
    if (body.tipo !== undefined) data.tipo = String(body.tipo).toUpperCase();
    if (body.natureza !== undefined) data.natureza = String(body.natureza).toUpperCase();
    if (body.status !== undefined && ["CONFIRMADA", "PENDENTE_ERP"].includes(String(body.status))) {
      data.status = String(body.status);
    }

    const updated = await prisma.chartOfAccount.update({
      where: { portalClientId_codigo: { portalClientId, codigo } },
      data,
    });
    return res.json({ ok: true, account: updated });
  });

  // DELETE /firm/companies/:companyId/chart-of-accounts/:codigo
  router.delete("/chart-of-accounts/:codigo", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const codigo = String(req.params.codigo);

    const existing = await prisma.chartOfAccount.findUnique({
      where: { portalClientId_codigo: { portalClientId, codigo } },
    });
    if (!existing) return res.status(404).json({ error: "conta_nao_encontrada" });

    await prisma.chartOfAccount.delete({
      where: { portalClientId_codigo: { portalClientId, codigo } },
    });
    return res.json({ ok: true });
  });

  // POST /firm/companies/:companyId/chart-of-accounts/import (CSV ou PDF)
  router.post(
    "/chart-of-accounts/import",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    upload.single("file"),
    async (req, res) => {
      const portalClientId = String(req.params.companyId);
      if (!req.file?.buffer) return res.status(400).json({ error: "file_required" });

      const result = await importChartOfAccountsFromBuffer({
        portalClientId,
        buffer: req.file.buffer,
        filename: req.file.originalname,
        mimeType: req.file.mimetype,
      });

      if (!result.ok) {
        const status = result.error === "pdf_no_accounts_found" ? 422 : 500;
        if (result.error === "pdf_import_failed") log.error({ message: result.message }, "Erro ao importar plano de contas via PDF");
        return res.status(status).json(result);
      }
      return res.json(result);
    }
  );

  // ─── Lançamentos ─────────────────────────────────────────────────────────

  // GET /firm/companies/:companyId/entries/circular  (deve vir antes de /entries/:entryId)
  router.get("/entries/circular", requireFirmCompanyAccess(), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const rawYear = parseInt(String(req.query.year || ""), 10);
    const year = rawYear >= 2000 && rawYear <= 2100 ? rawYear : new Date().getUTCFullYear();

    const meses = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);

    // darfGuides removido (Q5): DARFs agora viram AccountingEntry real via GuideToProvisionService
    // e aparecem naturalmente na query `provisoes`. Sintética DARF foi descontinuada.
    const [provisoes, receitas, inssGuides, circulars, simplesGuides] = await Promise.all([
      prisma.accountingEntry.findMany({
        where: {
          portalClientId,
          tipo: "PROVISAO",
          competencia: { in: meses },
          statusPagamento: { in: ["ABERTO", "PARCIAL", "PAGO"] },
        },
        include: {
          lines: { orderBy: { ordem: "asc" } },
          baixas: { select: { id: true }, take: 1 },
          // Q41: dados do pagamento confirmado pelo SERPRO (para o selo verde na célula).
          sourceGuide: {
            select: {
              id: true,
              tipo: true,
              paymentStatus: true,
              paymentStatusSource: true,
              paymentConfirmedAt: true,
              serproLastCheckResult: true,
              comprovantePdfFileId: true,
              // ⚠ O VENCIMENTO É O QUE SEPARA "a vencer" DE "vencida".
              // Sem ele a Circular pintava de VERMELHO toda guia em aberto — a que vence daqui a
              // duas semanas com a mesma força da que venceu há dois meses. Vermelho é a cor de
              // "bloqueia/vencido"; gasto no prazo normal, ele deixa de apontar o que realmente
              // atrasou. É o mesmo paredão que a listagem já teve de desmontar.
              vencimento: true,
              // Envio ao cliente, para a linha "Enviada ao cliente" do popover da célula.
              // `emailStatus` é legado de transporte; a verdade do ENVIO mora em `envios_guia`.
              emailStatus: true,
              envios: { select: { canal: true, status: true, destino: true, enviadoEm: true, entregueEm: true, lidoEm: true } },
            },
          },
        },
        orderBy: [{ competencia: "asc" }, { createdAt: "asc" }],
      }),
      prisma.accountingEntry.findMany({
        where: {
          portalClientId,
          tipo: "RECEITA",
          competencia: { in: meses },
        },
        select: { competencia: true, id: true, lines: { select: { tipo: true, valor: true } } },
      }),
      // Guias INSS (que não geram mais lançamento contábil automático após a remoção de INSS_DCTFWEB).
      // Aqui criamos provisões sintéticas para que apareçam na linha INSS da circular.
      // Inclui guia de UPLOAD (antes só `source:"SERPRO"`): ao subir a guia o contador escolhe o
      // tipo, então dá pra colocá-la na linha certa — não havia motivo pra ela ficar invisível.
      prisma.guide.findMany({
        where: {
          portalClientId,
          tipo: "INSS",
          status: "PROCESSED",
          competencia: { in: meses },
        },
        select: {
          id: true,
          competencia: true,
          valor: true,
          valorOriginal: true,
          source: true, // usado só pra desempatar SERPRO × upload no mesmo mês
          paymentStatus: true,
          paymentStatusSource: true, // Q41: selo verde SERPRO
          paymentConfirmedAt: true,
          serproLastCheckResult: true,
          comprovantePdfFileId: true,
          vencimento: true,
          updatedAt: true,
          parcelamentoId: true, // Q31: vínculo a parcelamento (célula amarela na Circular)
        },
      }),
      prisma.companyMonthlyCircular.findMany({
        where: { portalClientId, competencia: { in: meses } },
        select: {
          competencia: true, dasTotal: true, acrescimos: true,
          // Os PDFs do extrato existem no storage desde sempre; o que faltava era a Circular saber
          // que existem para oferecer o botão. Só o ID viaja — a URL gravada é `file:///…` no
          // provider LOCAL, inútil no browser; quem serve o arquivo é a rota `/pgdas/:comp/pdf`.
          pgdasDeclaracaoFileId: true, pgdasReciboFileId: true,
          // Extrato zerado marca o mês; a Circular mostra isso junto do que veio (ou não veio).
          semFaturamento: true,
        },
      }),
      prisma.guide.findMany({
        where: {
          portalClientId,
          status: "PROCESSED",
          competencia: { in: meses },
          tipo: "SIMPLES",
          // Guia de PARCELAMENTO não é DAS do mês: o parcelamento já provisionou tudo na abertura
          // e é acompanhado na aba Parcelamento. Sem este filtro ela virava uma linha "DAS" na
          // Circular — mesma regra que generateProvisionsFromGuide já aplica ("linked_to_parcelamento").
          parcelamentoId: null,
        },
        select: {
          competencia: true, valor: true, valorOriginal: true, updatedAt: true,
          // Q45: reflete o pagamento confirmado da guia (SERPRO/manual) na provisão DAS da Circular.
          id: true, paymentStatus: true, paymentStatusSource: true, paymentConfirmedAt: true, comprovantePdfFileId: true,
          // `vencimento`/`source`: data e desempate da provisão DAS sintética (guia de upload).
          vencimento: true, source: true,
          // `extracted`: traz o comprovante lido do SERPRO (data real + principal/juros/multa),
          // usado pra pré-preencher a baixa.
          extracted: true,
        },
      }),
    ]);

    // Q52.INSS: baixas contábeis reais do INSS (tipo=BAIXA, sourceGuideId) — para que a provisão
    // sintética paga possa ser EDITADA e ter a baixa CANCELADA na Circular, igual ao DAS.
    // Inclui também as guias de DAS: a linha sintética do DAS precisa saber se já FOI BAIXADA,
    // senão ela se pinta de paga só porque o pagamento foi localizado no SERPRO.
    const guiaIdsComBaixa = [...inssGuides.map((g) => g.id), ...simplesGuides.map((g) => g.id)];
    const inssBaixas = guiaIdsComBaixa.length
      ? await prisma.accountingEntry.findMany({
          where: { portalClientId, tipo: "BAIXA", sourceGuideId: { in: guiaIdsComBaixa } },
          include: { lines: { orderBy: { ordem: "asc" } } },
        })
      : [];
    // ⚠ UMA GUIA PODE TER TRÊS BAIXAS — principal, juros e multa são lançamentos separados.
    //
    // Aqui havia `new Map(inssBaixas.map((b) => [b.sourceGuideId, b]))`, que guarda só a ÚLTIMA:
    // a Circular enxergava uma baixa de três, e "Cancelar baixa" mandava esse id sozinho —
    // apagando um lançamento (provavelmente o da multa) e deixando os outros dois órfãos, com a
    // guia reaberta. O agrupamento passa a ser por guia, e o PRINCIPAL vem primeiro porque é ele
    // que a UI mostra como "a" baixa.
    const inssBaixasByGuide = new Map();
    for (const b of inssBaixas) {
      if (!inssBaixasByGuide.has(b.sourceGuideId)) inssBaixasByGuide.set(b.sourceGuideId, []);
      inssBaixasByGuide.get(b.sourceGuideId).push(b);
    }
    for (const lista of inssBaixasByGuide.values()) {
      // Sufixo no histórico é o que distingue os três (" (juros)" / " (multa)") — o principal não
      // tem sufixo, então ele é o que NÃO casa.
      lista.sort((a, b) => Number(/\((juros|multa)\)/i.test(a.historico)) - Number(/\((juros|multa)\)/i.test(b.historico)));
    }
    const inssBaixaByGuide = new Map([...inssBaixasByGuide].map(([guiaId, lista]) => [guiaId, lista[0]]));

    const receitasPorComp = {};
    for (const e of receitas) {
      const total = e.lines.filter((l) => l.tipo === "D").reduce((s, l) => s + Number(l.valor), 0);
      receitasPorComp[e.competencia] = (receitasPorComp[e.competencia] || 0) + total;
    }

    // Mapas por competência para resolver o valor ORIGINAL do DAS_SIMPLES.
    // Prioridade do "valor original": circular.dasTotal (extrato PGDAS-D) > guide.valorOriginal > guide.valor.
    // Necessário porque entries antigos podem ter lines com valor recalculado (criados antes do fix).
    const circularByComp = new Map(circulars.map((c) => [c.competencia, c]));
    const simplesGuideByComp = new Map(simplesGuides.map((g) => [g.competencia, g]));

    function enrichDasProvisao(entry) {
      if (entry.eventType !== "DAS_SIMPLES") return entry;
      const circ = circularByComp.get(entry.competencia);
      const guide = simplesGuideByComp.get(entry.competencia);
      // Valor do extrato (truth). Se não existir, mantém o totalD (lines).
      const extratoValor = circ?.dasTotal != null ? Number(circ.dasTotal) : null;
      // Valor atual da guia (pode estar recalculado pelo SERPRO).
      const guideValorAtual = guide?.valor != null ? Number(guide.valor) : null;
      const valorOriginal = extratoValor != null
        ? extratoValor
        : (guide?.valorOriginal != null ? Number(guide.valorOriginal) : Number(entry.valor || entry.totalD || 0));
      const recalculado =
        guideValorAtual != null && Math.abs(guideValorAtual - valorOriginal) > 0.01;
      // Pagamento LOCALIZADO no SERPRO ≠ baixa LANÇADA. São dois estados distintos:
      //   • guia PAID sem baixa  → "pagamento localizado" (tag), o contador ainda vai lançar;
      //   • provisão com baixa   → PAGO de fato (verde + ✅).
      // Antes a guia paga já pintava a célula de verde sem existir lançamento nenhum — escondia
      // trabalho pendente e dava a impressão de que a contabilidade estava fechada.
      const guidePaid = guide && String(guide.paymentStatus || "").toUpperCase() === "PAID";
      const hasBaixa = Array.isArray(entry.baixas) && entry.baixas.length > 0;
      const comprovante = guide?.extracted && typeof guide.extracted === "object"
        ? guide.extracted.comprovante || null
        : null;
      return {
        ...entry,
        valor: valorOriginal,
        totalD: valorOriginal,
        totalC: valorOriginal,
        pagamentoLocalizado: Boolean(guidePaid && !hasBaixa),
        // Dados do comprovante pra pré-preencher a baixa (data real + quebra principal/juros/multa).
        comprovante,
        // sourceGuide: dados do pagamento p/ o selo ✅ (data/origem/comprovante).
        sourceGuide: guide
          ? {
              id: guide.id,
              paymentStatus: guide.paymentStatus,
              paymentStatusSource: guide.paymentStatusSource,
              paymentConfirmedAt: guide.paymentConfirmedAt,
              comprovantePdfFileId: guide.comprovantePdfFileId,
            }
          : entry.sourceGuide,
        recalculatedAt: recalculado ? (guide?.updatedAt || entry.recalculatedAt || null) : entry.recalculatedAt,
        recalculatedFromValor: recalculado ? valorOriginal : entry.recalculatedFromValor,
        recalculatedToValor: recalculado ? guideValorAtual : entry.recalculatedToValor,
        recalculatedNotes: recalculado
          ? (entry.recalculatedNotes || "Guia atualizada pelo SERPRO")
          : entry.recalculatedNotes,
      };
    }

    // Frente B: split principal/juros/multa por tributo, por competência (pra matriz e p/ o INSS).
    const acrescimosByMonth = {};
    for (const c of circulars) {
      if (c?.acrescimos && typeof c.acrescimos === "object") acrescimosByMonth[c.competencia] = c.acrescimos;
    }

    // O extrato de cada mês: quais PDFs existem e se o mês foi declarado sem faturamento. É o que
    // permite à Circular mostrar "declaração zerada" em vez de uma linha vazia idêntica a
    // "ninguém buscou nada".
    const extratoByMonth = {};
    for (const c of circulars) {
      if (!c?.pgdasDeclaracaoFileId && !c?.pgdasReciboFileId && !c?.semFaturamento) continue;
      extratoByMonth[c.competencia] = {
        temDeclaracao: Boolean(c.pgdasDeclaracaoFileId),
        temRecibo: Boolean(c.pgdasReciboFileId),
        semFaturamento: Boolean(c.semFaturamento),
      };
    }

    // Provisões sintéticas a partir das guias INSS (não há lançamento contábil PROVISAO para INSS).
    // valorOriginal = valor do extrato (1ª captura, imutável). valor = pode estar recalculado pelo SERPRO.
    // Circular exibe o valor original; badge "↻ R$ X" mostra o recalculado se diferente.
    // A5: se o contador editou o principal do INSS na circular (acrescimos.INSS.principal), esse valor
    // prevalece como o número exibido/base da baixa.
    // Uma célula da Circular = um mês. Se a empresa tem a guia do SERPRO E uma subida à mão no
    // mesmo mês, a do SERPRO vence (é a autoritativa) — senão a linha do INSS apareceria duplicada.
    const inssGuidesUnicas = Array.from(
      inssGuides.reduce((mapa, g) => {
        const atual = mapa.get(g.competencia);
        const ganha = !atual
          || (String(g.source || "").toUpperCase() === "SERPRO"
              && String(atual.source || "").toUpperCase() !== "SERPRO");
        if (ganha) mapa.set(g.competencia, g);
        return mapa;
      }, new Map()).values(),
    );

    const inssSynthetic = inssGuidesUnicas.map((g) => {
      const valorAtual = Number(g.valor || 0);
      const valorOriginal = g.valorOriginal != null ? Number(g.valorOriginal) : valorAtual;
      const principalEditado = Number(acrescimosByMonth[g.competencia]?.INSS?.principal) || 0;
      const valor = principalEditado > 0 ? Math.round(principalEditado * 100) / 100 : valorOriginal; // principal editado > original
      const recalculado = g.valorOriginal != null && Math.abs(valorAtual - valorOriginal) > 0.01;
      const isPaid = String(g.paymentStatus || "").toUpperCase() === "PAID";
      // Baixa contábil real associada à guia (existe quando o INSS foi baixado pela Circular).
      const baixa = inssBaixaByGuide.get(g.id) || null;
      const baixaEntry = baixa
        ? {
            id: baixa.id,
            data: baixa.data,
            competencia: baixa.competencia,
            historico: baixa.historico,
            tipo: baixa.tipo,
            subtipo: baixa.subtipo,
            eventType: baixa.eventType,
            lines: baixa.lines,
          }
        : null;
      return {
        id: `synthetic-inss-${g.id}`,
        portalClientId,
        circularId: null,
        ruleId: null,
        eventType: "INSS_GUIDE_SYNTHETIC",
        data: g.vencimento || new Date(`${g.competencia}-01T00:00:00.000Z`),
        competencia: g.competencia,
        historico: `INSS DCTFWEB - ${g.competencia}`,
        tipo: "PROVISAO",
        subtipo: "INSS",
        origem: "SERPRO",
        loteImportacao: null,
        status: "RASCUNHO",
        // PAGO só com BAIXA lançada. Guia PAID sem baixa = pagamento localizado no SERPRO, que é
        // outra coisa: o contador ainda precisa lançar. Antes bastava a busca de pagamento marcar
        // a guia pra célula ficar verde sem existir lançamento nenhum — escondia trabalho pendente.
        statusPagamento: baixa ? "PAGO" : "ABERTO",
        pagamentoLocalizado: Boolean(isPaid && !baixa),
        // Quebra real (data/principal/juros/multa) lida do comprovante, pra pré-preencher a baixa.
        comprovante: (g.extracted && typeof g.extracted === "object" ? g.extracted.comprovante : null) || null,
        openEntryId: null,
        recalculatedAt: recalculado ? g.updatedAt : null,
        recalculatedFromValor: recalculado ? valorOriginal : null,
        recalculatedToValor: recalculado ? valorAtual : null,
        recalculatedNotes: recalculado ? "Guia atualizada pelo SERPRO" : null,
        createdAt: new Date(),
        updatedAt: new Date(),
        lines: [
          { id: null, entryId: null, conta: "INSS", tipo: "D", valor, ordem: 0, historico: null },
          { id: null, entryId: null, conta: "INSS", tipo: "C", valor, ordem: 1, historico: null },
        ],
        // Q52.INSS: quando pago, expõe a baixa real (id p/ cancelar + entry completo p/ editar).
        // TODAS as baixas da guia: cancelar precisa apagar o lote inteiro (principal +
        // juros + multa), senão sobram lançamentos órfãos com a guia reaberta.
        baixas: (inssBaixasByGuide.get(g.id) || []).map((b) => ({ id: b.id })),
        baixaEntry,
        totalD: valor,
        totalC: valor,
        valor,
        placeholder: false,
        synthetic: true, // sinaliza ao frontend que é uma "fake provisão"
        parcelamentoId: g.parcelamentoId || null, // Q31: vínculo (amarelo) — roteado pela guia
        // Q41: dados do pagamento confirmado pelo SERPRO (selo verde na célula).
        sourceGuide: {
          id: g.id,
          paymentStatus: g.paymentStatus,
          paymentStatusSource: g.paymentStatusSource,
          paymentConfirmedAt: g.paymentConfirmedAt,
          serproLastCheckResult: g.serproLastCheckResult,
          comprovantePdfFileId: g.comprovantePdfFileId,
        },
      };
    });

    // Q5: DARFs agora são AccountingEntry reais (gerados via GuideToProvisionService no momento
    // em que a guia vira PROCESSED). Já aparecem no `provisoes` acima — não há mais sintéticas.

    // DAS: a provisão normalmente vem do extrato PGDAS. Quando a empresa não tem esse extrato
    // (ex.: a guia do DAS foi subida à mão), não havia NADA na linha DAS — a guia existia mas a
    // Circular ficava vazia. Aqui sintetizamos a partir da guia, só nos meses SEM provisão de DAS.
    const mesesComDas = new Set(
      provisoes.filter((p) => p.eventType === "DAS_SIMPLES" || p.subtipo === "DAS").map((p) => p.competencia),
    );
    const dasSynthetic = Array.from(
      simplesGuides
        .filter((g) => !mesesComDas.has(g.competencia))
        // Uma célula por mês: com SERPRO e upload no mesmo mês, o do SERPRO vence (autoritativo).
        .reduce((mapa, g) => {
          const atual = mapa.get(g.competencia);
          const ganha = !atual
            || (String(g.source || "").toUpperCase() === "SERPRO"
                && String(atual.source || "").toUpperCase() !== "SERPRO");
          if (ganha) mapa.set(g.competencia, g);
          return mapa;
        }, new Map()).values(),
    )
      .map((g) => {
        const valorAtual = Number(g.valor || 0);
        const valorOriginal = g.valorOriginal != null ? Number(g.valorOriginal) : valorAtual;
        const principalEditado = Number(acrescimosByMonth[g.competencia]?.DAS?.principal) || 0;
        const valor = principalEditado > 0 ? Math.round(principalEditado * 100) / 100 : valorOriginal;
        const isPaid = String(g.paymentStatus || "").toUpperCase() === "PAID";
        const baixa = inssBaixaByGuide.get(g.id) || null;
        return {
          id: `synthetic-das-${g.id}`,
          portalClientId,
          circularId: null,
          ruleId: null,
          eventType: "DAS_GUIDE_SYNTHETIC",
          data: g.vencimento || new Date(`${g.competencia}-01T00:00:00.000Z`),
          competencia: g.competencia,
          historico: `DAS SIMPLES NACIONAL - ${g.competencia}`,
          tipo: "PROVISAO",
          subtipo: "DAS",
          origem: "UPLOAD",
          loteImportacao: null,
          status: "RASCUNHO",
          // Mesma regra do INSS sintetico: PAGO exige BAIXA lancada. Pagamento localizado no
          // SERPRO e so uma tag - o ato contabil continua sendo do contador.
          statusPagamento: baixa ? "PAGO" : "ABERTO",
          pagamentoLocalizado: Boolean(isPaid && !baixa),
          comprovante: (g.extracted && typeof g.extracted === "object" ? g.extracted.comprovante : null) || null,
          openEntryId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          lines: [
            { id: null, entryId: null, conta: "DAS", tipo: "D", valor, ordem: 0, historico: null },
            { id: null, entryId: null, conta: "DAS", tipo: "C", valor, ordem: 1, historico: null },
          ],
          baixas: (inssBaixasByGuide.get(g.id) || []).map((b) => ({ id: b.id })),
          baixaEntry: baixa
            ? {
                id: baixa.id, data: baixa.data, competencia: baixa.competencia,
                historico: baixa.historico, tipo: baixa.tipo, subtipo: baixa.subtipo,
                eventType: baixa.eventType, lines: baixa.lines,
              }
            : null,
          totalD: valor,
          totalC: valor,
          valor,
          placeholder: false,
          synthetic: true,
          parcelamentoId: null,
          sourceGuide: {
            id: g.id,
            paymentStatus: g.paymentStatus,
            paymentStatusSource: g.paymentStatusSource,
            paymentConfirmedAt: g.paymentConfirmedAt,
            comprovantePdfFileId: g.comprovantePdfFileId,
          },
        };
      });

    return res.json({
      year,
      provisoes: [
        ...provisoes.map((p) => enrichDasProvisao(entryToResponse(p))),
        ...inssSynthetic,
        ...dasSynthetic,
      ],
      receitas: receitasPorComp,
      acrescimos: acrescimosByMonth,
      extrato: extratoByMonth,
    });
  });

  // GET /firm/companies/:companyId/circular/:competencia/accounting-entries
  router.get("/circular/:competencia/accounting-entries", requireFirmCompanyAccess(), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const competencia = String(req.params.competencia || "").trim();

    if (!competencia) return res.status(400).json({ error: "competencia_required" });

    const circular = await prisma.companyMonthlyCircular.findUnique({
      where: {
        portalClientId_competencia: {
          portalClientId,
          competencia,
        },
      },
    });
    if (!circular) return res.status(404).json({ error: "circular_nao_encontrada" });

    const entries = await prisma.accountingEntry.findMany({
      where: {
        portalClientId,
        competencia,
        tipo: { not: "PARCELA" }, // Q16: linhas leves de rastreio não entram na listagem
      },
      include: { lines: { orderBy: { ordem: "asc" } } },
      orderBy: [{ createdAt: "asc" }],
    });

    const generatedEntries = await prisma.accountingEntry.findMany({
      where: {
        portalClientId,
        competencia,
        origem: "SERPRO",
      },
      include: { lines: { orderBy: { ordem: "asc" } } },
      orderBy: [{ createdAt: "asc" }],
    });

    return res.json({
      circular,
      entries: generatedEntries.map(entryToResponse),
      allEntries: entries.map(entryToResponse),
    });
  });

  // PATCH /firm/companies/:companyId/circular/:competencia
  router.patch("/circular/:competencia", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const competencia = String(req.params.competencia || "").trim();
    if (!competencia) return res.status(400).json({ error: "competencia_required" });

    const body = req.body || {};
    const data = {};
    if (body.receitaBruta !== undefined) data.receitaBruta = parseMoney(body.receitaBruta);
    if (body.receitaServicos !== undefined) data.receitaServicos = parseMoney(body.receitaServicos) ?? 0;
    if (body.receitaVendas !== undefined) data.receitaVendas = parseMoney(body.receitaVendas) ?? 0;
    if (body.dasTotal !== undefined) data.dasTotal = parseMoney(body.dasTotal);
    if (body.dasNumeroDocumento !== undefined) data.dasNumeroDocumento = String(body.dasNumeroDocumento || "").trim() || null;
    if (body.dasPago !== undefined) data.dasPago = body.dasPago === null ? null : Boolean(body.dasPago);
    if (body.dasDataEmissao !== undefined) data.dasDataEmissao = parseOptionalDate(body.dasDataEmissao);
    if (body.inssTotal !== undefined) data.inssTotal = parseMoney(body.inssTotal);
    if (body.inssVencimento !== undefined) data.inssVencimento = parseOptionalDate(body.inssVencimento);
    if (body.inssPdfFileId !== undefined) data.inssPdfFileId = String(body.inssPdfFileId || "").trim() || null;
    if (body.inssPdfUrl !== undefined) data.inssPdfUrl = String(body.inssPdfUrl || "").trim() || null;
    if (body.inssStatus !== undefined) data.inssStatus = String(body.inssStatus || "").trim().toUpperCase() || null;
    if (body.pgdasNumeroDeclaracao !== undefined) data.pgdasNumeroDeclaracao = String(body.pgdasNumeroDeclaracao || "").trim() || null;
    if (body.pgdasDeclaracaoFileId !== undefined) data.pgdasDeclaracaoFileId = String(body.pgdasDeclaracaoFileId || "").trim() || null;
    if (body.pgdasDeclaracaoFileUrl !== undefined) data.pgdasDeclaracaoFileUrl = String(body.pgdasDeclaracaoFileUrl || "").trim() || null;
    if (body.pgdasReciboFileId !== undefined) data.pgdasReciboFileId = String(body.pgdasReciboFileId || "").trim() || null;
    if (body.pgdasReciboFileUrl !== undefined) data.pgdasReciboFileUrl = String(body.pgdasReciboFileUrl || "").trim() || null;
    if (body.receitaStatus !== undefined) data.receitaStatus = String(body.receitaStatus || "").trim().toUpperCase() || null;
    if (body.dasStatus !== undefined) data.dasStatus = String(body.dasStatus || "").trim().toUpperCase() || null;
    if (body.serproSyncStatus !== undefined) data.serproSyncStatus = String(body.serproSyncStatus || "").trim().toUpperCase() || null;
    if (body.serproLastSyncAt !== undefined) data.serproLastSyncAt = parseOptionalDate(body.serproLastSyncAt);
    if (body.serproLastError !== undefined) data.serproLastError = String(body.serproLastError || "").trim() || null;
    if (body.metadata !== undefined) data.metadata = body.metadata && typeof body.metadata === "object" ? body.metadata : null;
    // Frente B: split principal/juros/multa por tributo (editável pelo contador).
    if (body.acrescimos !== undefined) data.acrescimos = body.acrescimos && typeof body.acrescimos === "object" ? body.acrescimos : null;

    const computedReceitaBruta =
      body.receitaBruta !== undefined
        ? data.receitaBruta ?? 0
        : (body.receitaServicos !== undefined || body.receitaVendas !== undefined)
          ? Number(data.receitaServicos || 0) + Number(data.receitaVendas || 0)
          : undefined;

    const circular = await prisma.companyMonthlyCircular.upsert({
      where: {
        portalClientId_competencia: { portalClientId, competencia },
      },
      create: {
        portalClientId,
        competencia,
        receitaBruta: computedReceitaBruta ?? data.receitaBruta ?? null,
        receitaServicos: data.receitaServicos ?? 0,
        receitaVendas: data.receitaVendas ?? 0,
        dasTotal: data.dasTotal ?? null,
        dasNumeroDocumento: data.dasNumeroDocumento ?? null,
        dasPago: data.dasPago ?? null,
        dasDataEmissao: data.dasDataEmissao ?? null,
        inssTotal: data.inssTotal ?? null,
        inssVencimento: data.inssVencimento ?? null,
        inssPdfFileId: data.inssPdfFileId ?? null,
        inssPdfUrl: data.inssPdfUrl ?? null,
        inssStatus: data.inssStatus ?? null,
        pgdasNumeroDeclaracao: data.pgdasNumeroDeclaracao ?? null,
        pgdasDeclaracaoFileId: data.pgdasDeclaracaoFileId ?? null,
        pgdasDeclaracaoFileUrl: data.pgdasDeclaracaoFileUrl ?? null,
        pgdasReciboFileId: data.pgdasReciboFileId ?? null,
        pgdasReciboFileUrl: data.pgdasReciboFileUrl ?? null,
        receitaStatus: data.receitaStatus ?? null,
        dasStatus: data.dasStatus ?? null,
        serproSyncStatus: data.serproSyncStatus ?? null,
        serproLastSyncAt: data.serproLastSyncAt ?? null,
        serproLastError: data.serproLastError ?? null,
        metadata: data.metadata ?? null,
        acrescimos: data.acrescimos ?? null,
      },
      update: {
        ...(body.receitaBruta !== undefined ? { receitaBruta: data.receitaBruta } : {}),
        ...(body.receitaServicos !== undefined ? { receitaServicos: data.receitaServicos } : {}),
        ...(body.receitaVendas !== undefined ? { receitaVendas: data.receitaVendas } : {}),
        ...(body.dasTotal !== undefined ? { dasTotal: data.dasTotal } : {}),
        ...(body.dasNumeroDocumento !== undefined ? { dasNumeroDocumento: data.dasNumeroDocumento } : {}),
        ...(body.dasPago !== undefined ? { dasPago: data.dasPago } : {}),
        ...(body.dasDataEmissao !== undefined ? { dasDataEmissao: data.dasDataEmissao } : {}),
        ...(body.inssTotal !== undefined ? { inssTotal: data.inssTotal } : {}),
        ...(body.inssVencimento !== undefined ? { inssVencimento: data.inssVencimento } : {}),
        ...(body.inssPdfFileId !== undefined ? { inssPdfFileId: data.inssPdfFileId } : {}),
        ...(body.inssPdfUrl !== undefined ? { inssPdfUrl: data.inssPdfUrl } : {}),
        ...(body.inssStatus !== undefined ? { inssStatus: data.inssStatus } : {}),
        ...(body.pgdasNumeroDeclaracao !== undefined ? { pgdasNumeroDeclaracao: data.pgdasNumeroDeclaracao } : {}),
        ...(body.pgdasDeclaracaoFileId !== undefined ? { pgdasDeclaracaoFileId: data.pgdasDeclaracaoFileId } : {}),
        ...(body.pgdasDeclaracaoFileUrl !== undefined ? { pgdasDeclaracaoFileUrl: data.pgdasDeclaracaoFileUrl } : {}),
        ...(body.pgdasReciboFileId !== undefined ? { pgdasReciboFileId: data.pgdasReciboFileId } : {}),
        ...(body.pgdasReciboFileUrl !== undefined ? { pgdasReciboFileUrl: data.pgdasReciboFileUrl } : {}),
        ...(body.receitaStatus !== undefined ? { receitaStatus: data.receitaStatus } : {}),
        ...(body.dasStatus !== undefined ? { dasStatus: data.dasStatus } : {}),
        ...(body.serproSyncStatus !== undefined ? { serproSyncStatus: data.serproSyncStatus } : {}),
        ...(body.serproLastSyncAt !== undefined ? { serproLastSyncAt: data.serproLastSyncAt } : {}),
        ...(body.serproLastError !== undefined ? { serproLastError: data.serproLastError } : {}),
        ...(body.metadata !== undefined ? { metadata: data.metadata } : {}),
        ...(body.acrescimos !== undefined ? { acrescimos: data.acrescimos } : {}),
      },
    });

    // Edição vinda deste PATCH é MANUAL: se o contador corrigiu o valor, ele é a verdade e as
    // linhas do lançamento acompanham (senão a baixa do valor certo deixaria a diferença aberta).
    const accounting = await generateEntriesFromCircular({ portalClientId, competencia, edicaoManual: true });
    return res.json({ ok: true, circular, accounting });
  });

  router.post("/circular/:competencia/sync-pgdas", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const portalClientId = String(req.params.companyId || "").trim();
    const competencia = String(req.params.competencia || "").trim();
    const contratanteCnpj = String(req.body?.contratanteCnpj || req.query?.contratanteCnpj || "").trim();

    if (!portalClientId) return res.status(400).json({ ok: false, error: "company_id_required" });
    if (!competencia) return res.status(400).json({ ok: false, error: "competencia_required" });

    // Esta rota GRAVA lançamentos (`generateEntriesFromCircular`), então tem que respeitar o mês
    // fechado igual ao "+ Adicionar lançamento" e ao marcar Vazio. Sem isto, o botão novo na aba
    // vira o caminho fácil para escrever dentro de um mês já fechado, sem rastro de reabertura.
    // A guarda fica na ROTA e não no serviço de propósito: o worker continua podendo sincronizar.
    if (await isMonthClosed(portalClientId, competencia)) {
      return res.status(409).json({
        ok: false,
        error: "MES_FECHADO",
        message: "O mês está fechado. Reabra antes de buscar o extrato de novo.",
      });
    }

    try {
      // Duas chamadas PAGAS por clique (CONSDECLARACAO13 + CONSULTIMADECREC14). O contexto leva
      // quem disparou para o registro e permite ao ADMIN furar o teto diário com `?forcar=1`.
      const result = await comContextoSerpro(
        { origem: "lancamentos:extrato-simples", userId: req.auth?.user?.id, forcar: podeForcarSerpro(req) },
        () => syncPgdasByCompetencia({
          portalClientId,
          competencia,
          contratanteCnpj: contratanteCnpj || undefined,
        }),
      );
      return res.json({ ok: true, result });
    } catch (err) {
      const code = err?.code || "SERPRO_PGDASD_SYNC_FAILED";
      const message = err?.message || "Erro ao sincronizar PGDAS-D.";
      if (
        [
          "SERPRO_INVALID_COMPETENCIA",
          "SERPRO_PROCURADOR_CNPJ_NOT_CONFIGURED",
          "SERPRO_AUTH_URL_NOT_CONFIGURED",
          "SERPRO_BASE_URL_NOT_CONFIGURED",
          "SERPRO_CONSUMER_KEY_NOT_CONFIGURED",
          "SERPRO_CONSUMER_SECRET_NOT_CONFIGURED",
          "SERPRO_CERTIFICATE_NOT_CONFIGURED",
          "SERPRO_CERT_FILE_NOT_FOUND",
          "SERPRO_CERT_PASSWORD_NOT_FOUND",
          "SERPRO_PGDASD_DADOS_NOT_FOUND",
          "SERPRO_PGDASD_DADOS_INVALID",
          "SERPRO_PGDASD_PDF_INVALID",
          "SERPRO_INVALID_CONTRIBUINTE_CNPJ",
        ].includes(code)
      ) {
        return res.status(400).json({ ok: false, error: code, reason: message });
      }
      if (code === "PORTAL_COMPANY_NOT_FOUND") {
        return res.status(404).json({ ok: false, error: code, reason: message });
      }
      log.error({ err: err?.message || err, code, portalClientId, competencia }, "Falha ao sincronizar PGDAS-D");
      return res.status(502).json({ ok: false, error: code, reason: message, retryable: Boolean(err?.retryable) });
    }
  });

  // GET /firm/companies/:companyId/entries/provisoes  (deve vir antes de /entries/:entryId)
  router.get("/entries/provisoes", requireFirmCompanyAccess(), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const { competencia, subtipo } = req.query || {};

    const where = {
      portalClientId,
      tipo: "PROVISAO",
      statusPagamento: { in: ["ABERTO", "PARCIAL", "PAGO"] },
    };
    if (competencia) where.competencia = String(competencia);
    if (subtipo) where.subtipo = String(subtipo).toUpperCase();

    const entries = await prisma.accountingEntry.findMany({
      where,
      include: {
        lines: { orderBy: { ordem: "asc" } },
        baixas: { include: { lines: { orderBy: { ordem: "asc" } } } },
      },
      orderBy: [{ data: "desc" }],
    });

    return res.json({ data: entries.map(entryToResponse) });
  });


  /**
   * O que já foi buscado no SERPRO nesta competência — para a tela AVISAR antes de gastar de novo.
   *
   * As duas consultas são PAGAS e as rotas manuais não têm trava (só o worker tem). Pior: a do
   * Presumido são DUAS chamadas por clique (a declaração e o DARF). Sem isto, um duplo clique é uma
   * cobrança dupla, e a tela não tem como saber — a resposta do POST chega tarde demais.
   *
   * ⚠ `NOT_FOUND` conta como buscado: a chamada saiu e foi cobrada do mesmo jeito. Tratar como "não
   * buscado" convidaria o contador a repetir de graça o que já custou.
   */
  async function estadoDasBuscasSerpro({ portalClientId, competencia, circular }) {
    const status = String(circular?.serproSyncStatus || "").toUpperCase();
    const extrato = {
      buscado: status === "SUCCESS" || status === "NOT_FOUND",
      em: circular?.serproLastSyncAt || null,
      status: circular?.serproSyncStatus || null,
    };

    // A guia do LP usa `sourceFileId` determinístico como chave de upsert
    // (`LucroPresumidoProvisaoService.js:61`), então ela é a marca exata de "já busquei" — a mesma
    // em que o worker se apoia. `updatedAt` é a data que a mensagem mostra.
    // A flag viaja junto para a tela poder DESABILITAR o item com o motivo, em vez de deixar o
    // contador descobrir pelo 409 depois do clique.
    let presumido = { buscado: false, em: null, disponivel: INTEGRACAO_SERPRO_DCTFWEB_LP };
    try {
      const portal = await prisma.portalClient.findUnique({
        where: { id: portalClientId },
        select: { cnpj: true },
      });
      const cnpj = String(portal?.cnpj || "").replace(/\D+/g, "");
      if (cnpj) {
        const guia = await prisma.guide.findUnique({
          where: { sourceFileId: `serpro:dctfweb:lp:${cnpj}:${competencia}` },
          select: { updatedAt: true, status: true },
        });
        if (guia && guia.status === "PROCESSED") {
          presumido = { ...presumido, buscado: true, em: guia.updatedAt };
        }
      }
    } catch {
      // Pré-voo é conveniência: se falhar, a tela pergunta sem a data em vez de travar o GET.
    }

    return { extrato, presumido };
  }

  // Q17: FECHAMENTO CONTÁBIL do mês ─────────────────────────────────────────
  // GET estado + bloqueios (lançamentos em branco / desbalanceados).
  router.get("/fechamento-contabil/:competencia", requireFirmCompanyAccess(), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const competencia = String(req.params.competencia || "").trim();
    if (!competencia) return res.status(400).json({ error: "competencia_required" });
    try {
      const circular = await prisma.companyMonthlyCircular.findUnique({
        where: { portalClientId_competencia: { portalClientId, competencia } },
        select: {
          fechadoContabilEm: true,
          fechadoContabilPor: true,
          serproSyncStatus: true,
          serproLastSyncAt: true,
          semFaturamento: true,
          semFaturamentoEm: true,
          semFaturamentoConferencia: true,
          ...CHECKLIST_SELECT,
        },
      });
      const validation = await validateFechamentoContabil(prisma, { portalClientId, competencia });
      const serpro = await estadoDasBuscasSerpro({ portalClientId, competencia, circular });
      // O faturamento viaja junto para o alternador já nascer desabilitado com o motivo, em vez de
      // o contador descobrir a recusa clicando.
      const faturamentoEmit = await faturamentoEmitDaCompetencia(portalClientId, competencia).catch(() => null);
      // Segunda fonte do faturamento: sem snapshot, `status: null` = nunca conferida (que é
      // diferente de "conferimos e não deu para conferir" — `nao_conferivel`).
      const snapConferencia = await prisma.apuracaoSnapshot.findUnique({
        where: { portalClientId_competencia: { portalClientId, competencia } },
        select: { conferenciaStatus: true, conferidaEm: true },
      }).catch(() => null);
      const conferenciaAdn = {
        status: snapConferencia?.conferenciaStatus || null,
        em: snapConferencia?.conferidaEm || null,
      };
      // Quem fechou, por NOME. `fechadoContabilPor` guarda o id do usuário, e o selo da tela
      // ("Mês fechado em DD/MM por …") com um uuid não informa nada a ninguém. Best-effort: a
      // consulta falhar, ou o usuário ter sido removido, não pode derrubar o GET do fechamento —
      // o selo cai para a data sozinha, que é o dado que importa.
      const fechadoPorNome = circular?.fechadoContabilPor
        ? await prisma.user
          .findUnique({ where: { id: circular.fechadoContabilPor }, select: { name: true, email: true } })
          .then((u) => u?.name || u?.email || null)
          .catch(() => null)
        : null;
      // Checklist manual (folha/pró-labore, despesas, receitas, provisões, pagamentos).
      const pendentes = checklistPendentes(circular);
      const checklist = Object.fromEntries(
        Object.entries(CHECKLIST_FECHAMENTO).map(([chave, c]) => [chave, circular?.[c.campo] === true]),
      );
      return res.json({
        ok: true,
        competencia,
        fechado: Boolean(circular?.fechadoContabilEm),
        fechadoEm: circular?.fechadoContabilEm || null,
        fechadoPor: circular?.fechadoContabilPor || null,
        fechadoPorNome,
        // Mantido no payload: a UI antiga (e o gate do fechamento) já liam este nome.
        folhaProlaboreOk: checklist.folhaProlabore,
        checklist,
        checklistPendentes: pendentes,
        podeFechar: validation.ok && pendentes.length === 0,
        blockers: validation.blockers,
        serpro,
        semFaturamento: circular?.semFaturamento === true,
        semFaturamentoEm: circular?.semFaturamentoEm || null,
        // Como a afirmação FOI verificada (quando já existe) e como ELA SERIA verificada agora.
        // O segundo é o que permite avisar ANTES do clique que não vai dar para conferir — a
        // recusa por divergência o contador precisa saber que existe antes de tentar.
        semFaturamentoConferencia: circular?.semFaturamentoConferencia || null,
        conferenciaAdn,
        faturamentoEmit,
      });
    } catch (err) {
      log.error({ err }, "Falha ao consultar fechamento contábil");
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  // POST fechar — bloqueia se houver lançamento em branco ou desbalanceado.
  router.post("/fechamento-contabil/:competencia/fechar", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const competencia = String(req.params.competencia || "").trim();
    if (!competencia) return res.status(400).json({ error: "competencia_required" });
    try {
      const validation = await validateFechamentoContabil(prisma, { portalClientId, competencia });
      if (!validation.ok) {
        return res.status(400).json({ ok: false, error: "fechamento_bloqueado", blockers: validation.blockers });
      }
      // Só fecha com TODO o checklist de conferência marcado (folha/pró-labore, despesas,
      // receitas, provisões, pagamentos).
      const flags = await prisma.companyMonthlyCircular.findUnique({
        where: { portalClientId_competencia: { portalClientId, competencia } },
        select: CHECKLIST_SELECT,
      });
      const pendentes = checklistPendentes(flags);
      if (pendentes.length > 0) {
        return res.status(400).json({
          ok: false,
          // Substitui folha_prolabore_pendente (que ninguém consumia por código — o front usa
          // `message`), agora que a trava é o checklist inteiro e não só a folha.
          error: "checklist_pendente",
          checklistPendentes: pendentes,
          message: `Confirme antes de fechar: ${pendentes.map((p) => p.label).join(", ")}.`,
        });
      }
      // Garante a linha da circular (cria se não existir) e marca o fechamento contábil.
      const existing = await prisma.companyMonthlyCircular.findUnique({
        where: { portalClientId_competencia: { portalClientId, competencia } },
        select: { id: true },
      });
      const data = { fechadoContabilEm: new Date(), fechadoContabilPor: req.auth?.user?.id || null };
      if (existing) {
        await prisma.companyMonthlyCircular.update({ where: { id: existing.id }, data });
      } else {
        await prisma.companyMonthlyCircular.create({ data: { portalClientId, competencia, ...data } });
      }
      return res.json({ ok: true, competencia, fechado: true });
    } catch (err) {
      log.error({ err }, "Falha ao fechar empresa (contábil)");
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  // POST reabrir — limpa o fechamento contábil.
  router.post("/fechamento-contabil/:competencia/reabrir", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const competencia = String(req.params.competencia || "").trim();
    if (!competencia) return res.status(400).json({ error: "competencia_required" });
    try {
      await prisma.companyMonthlyCircular.updateMany({
        where: { portalClientId, competencia },
        data: { fechadoContabilEm: null, fechadoContabilPor: null },
      });
      return res.json({ ok: true, competencia, fechado: false });
    } catch (err) {
      log.error({ err }, "Falha ao reabrir empresa (contábil)");
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  // Marca/desmarca um item do checklist de conferência da competência (pré-requisito do fechamento).
  // `:item` = folhaProlabore | despesas | receitas | provisoes | pagamentos.
  async function setChecklistItem(req, res, itemChave) {
    const portalClientId = String(req.params.companyId);
    const competencia = String(req.params.competencia || "").trim();
    if (!competencia) return res.status(400).json({ error: "competencia_required" });
    const def = CHECKLIST_FECHAMENTO[itemChave];
    if (!def) return res.status(400).json({ error: "item_invalido", itens: Object.keys(CHECKLIST_FECHAMENTO) });
    const ok = req.body?.ok === true;
    try {
      // Upsert por (empresa, competência) — garante a linha da circular como no fechar.
      const existing = await prisma.companyMonthlyCircular.findUnique({
        where: { portalClientId_competencia: { portalClientId, competencia } },
        select: { id: true },
      });
      if (existing) {
        await prisma.companyMonthlyCircular.update({ where: { id: existing.id }, data: { [def.campo]: ok } });
      } else {
        await prisma.companyMonthlyCircular.create({ data: { portalClientId, competencia, [def.campo]: ok } });
      }
      return res.json({ ok: true, competencia, item: itemChave, valor: ok });
    } catch (err) {
      log.error({ err, item: itemChave }, "Falha ao marcar item do checklist de fechamento");
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  }

  // Rota antiga (Q47) preservada — clientes já publicados continuam funcionando.
  router.post("/fechamento-contabil/:competencia/folha-prolabore", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), (req, res) =>
    setChecklistItem(req, res, "folhaProlabore"));

  router.post("/fechamento-contabil/:competencia/checklist/:item", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), (req, res) =>
    setChecklistItem(req, res, String(req.params.item || "")));

  /**
   * Marca/desmarca "o mês não teve faturamento".
   *
   * NÃO é um sexto item do checklist: o checklist confirma que algo FOI LANÇADO; isto afirma que
   * algo NÃO EXISTIU. Por isso fica separado na tela e grava quem/quando — é afirmação fiscal.
   *
   * A recusa é o coração da coisa. O sistema já enxerga as notas EMIT autorizadas da competência;
   * deixar marcar "sem faturamento" com nota no mês transformaria uma confirmação numa declaração
   * contra a evidência — e a empresa sairia da apuração em silêncio. Mesmo espírito do
   * SEM_MOVIMENTO_COM_FATURAMENTO que a apuração já aplica.
   */
  router.post("/fechamento-contabil/:competencia/sem-faturamento", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const competencia = String(req.params.competencia || "").trim();
    if (!/^\d{4}-\d{2}$/.test(competencia)) return res.status(400).json({ ok: false, error: "competencia_required" });
    const ok = req.body?.ok === true;

    try {
      // ⚠ As duas recusas moram no SERVICE, não aqui. O extrato zerado do PGDAS-D marca por outro
      // caminho, e uma trava que vive no handler HTTP não protege quem não passa por ele.
      const r = await marcarSemFaturamento({
        portalClientId,
        competencia,
        ok,
        userId: req.auth?.user?.id || null,
        origem: "manual",
      });
      if (!r.ok) {
        const status = r.error === "competencia_required" ? 400 : 409;
        return res.status(status).json(r);
      }
      return res.json({ ok: true, competencia, semFaturamento: r.semFaturamento, conferencia: r.conferencia });
    } catch (err) {
      log.error({ err, portalClientId, competencia }, "Falha ao marcar mês sem faturamento");
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  /**
   * PRÉ-VOO DA EXPORTAÇÃO — o que o ERP recusaria, dito ANTES de baixar o arquivo.
   *
   * ⚠ POR QUE EXISTE
   * A exportação despejava o CSV sem olhar nada. O erro aparecia do outro lado, no ERP, sem dizer
   * qual lançamento o causou — e voltava como "o arquivo não entrou", que é o pior formato possível
   * para quem precisa consertar sete linhas no meio de trezentas.
   *
   * ⚠ ERRO ≠ ALERTA, e a diferença é quem decide:
   *   • ERRO   bloqueia. É o que o ERP recusa: lançamento em branco, conta em branco, D≠C, conta
   *            fora do plano. Não há julgamento a fazer — está quebrado.
   *   • ALERTA confirma. É o que PODE estar certo e só o contador sabe: conta ainda não confirmada
   *            no ERP (`PENDENTE_ERP`) e mês contábil ainda aberto. Transformar isso em bloqueio
   *            inutilizaria a exportação de quem trabalha com o ERP em implantação.
   *
   * A regra estrutural NÃO é reescrita aqui: vem de `computeFechamentoBlockers`, a mesma que o
   * cadeado da aba Lançamentos e a visão de carteira usam. Uma segunda cópia faria a exportação
   * discordar do fechamento sobre o mesmo mês.
   */
  router.get("/entries/export/preflight", requireFirmCompanyAccess(), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const competencia = String(req.query?.competencia || "").trim();
    if (!competencia) return res.status(400).json({ ok: false, error: "competencia_required" });

    try {
      const entries = await prisma.accountingEntry.findMany({
        where: { portalClientId, competencia, tipo: { not: "PARCELA" } },
        select: { ...SELECT_PARA_BLOQUEIOS, id: true, historico: true, competencia: true, status: true },
      });

      const { blockers } = computeFechamentoBlockers(entries, competencia);
      const MOTIVOS = {
        em_branco: "lançamento sem nenhuma linha",
        conta_em_branco: "linha sem conta",
        desbalanceado: "débito ≠ crédito",
        parcelamento_desbalanceado: "grupo de parcelamento com débito ≠ crédito",
        folha_desbalanceada: "lote de folha com débito ≠ crédito",
      };
      const erros = blockers.map((b) => ({
        entryId: b.entryId || null,
        historico: b.historico || "(sem histórico)",
        motivo: MOTIVOS[b.motivo] || b.motivo,
      }));

      // Contas usadas × plano de contas. Uma query para a competência inteira.
      const codigosUsados = [...new Set(
        entries.flatMap((e) => (e.lines || []).map((l) => String(l.conta || "").trim())).filter(Boolean),
      )];
      const contasDoPlano = codigosUsados.length
        ? await prisma.chartOfAccount.findMany({
          where: { codigo: { in: codigosUsados }, OR: [{ portalClientId }, { portalClientId: null }] },
          select: { codigo: true, status: true },
        })
        : [];
      const porCodigo = new Map(contasDoPlano.map((c) => [c.codigo, c]));

      const alertas = [];
      for (const e of entries) {
        for (const l of e.lines || []) {
          const cod = String(l.conta || "").trim();
          if (!cod) continue;
          const conta = porCodigo.get(cod);
          if (!conta) {
            erros.push({ entryId: e.id, historico: e.historico || "(sem histórico)", motivo: `conta ${cod} não existe no plano` });
          } else if (conta.status === "PENDENTE_ERP") {
            alertas.push({ entryId: e.id, historico: e.historico || "(sem histórico)", motivo: `conta ${cod} ainda não confirmada no ERP` });
          }
        }
      }

      const circular = await prisma.companyMonthlyCircular.findUnique({
        where: { portalClientId_competencia: { portalClientId, competencia } },
        select: { fechadoContabilEm: true },
      });
      if (!circular?.fechadoContabilEm) {
        alertas.push({ entryId: null, historico: null, motivo: "o mês ainda não foi fechado contabilmente" });
      }

      // ⚠ REEXPORTAÇÃO. Não bloqueia — reexportar é legítimo (o ERP recusou o arquivo, o contador
      // trocou de sistema). Mas mandar o mesmo mês duas vezes sem saber disso duplica lançamento
      // do outro lado, e o único jeito de descobrir é pela conciliação, semanas depois.
      const jaExportados = entries.filter((e) => e.status === "EXPORTADO").length;
      if (jaExportados > 0) {
        alertas.push({
          entryId: null,
          historico: null,
          motivo: `${jaExportados} lançamento${jaExportados > 1 ? "s" : ""} desta competência já foi exportado antes`,
        });
      }

      let totalD = 0; let totalC = 0; let linhas = 0;
      for (const e of entries) {
        for (const l of e.lines || []) {
          linhas += 1;
          const v = Number(l.valor || 0);
          if (String(l.tipo).toUpperCase() === "D") totalD += v; else totalC += v;
        }
      }

      return res.json({
        ok: true,
        competencia,
        // ⚠ Erro repetido não vira linha repetida: a mesma conta inexistente em oito lançamentos
        // encheria a tela e escondera os outros problemas.
        erros: dedupePorTexto(erros),
        alertas: dedupePorTexto(alertas),
        totais: { entries: entries.length, linhas, totalD, totalC, diferenca: Math.abs(totalD - totalC) },
        mesFechado: Boolean(circular?.fechadoContabilEm),
        jaExportados,
      });
    } catch (err) {
      log.error({ err, portalClientId, competencia }, "preflight da exportação falhou");
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  /**
   * MARCA a competência como exportada, DEPOIS do download ter dado certo.
   *
   * ⚠ POR QUE UM POST SEPARADO, E NÃO DENTRO DO GET DO CSV
   * O download é um GET, e GET não pode ter efeito colateral: um prefetch do browser, um clique
   * duplo ou um antivírus abrindo o link marcariam a competência sem ninguém ter exportado nada.
   * O front baixa o arquivo (já via `fetch` + blob) e só então confirma.
   *
   * ⚠ O QUE ISTO LIGA — e por que importa
   * `status: "EXPORTADO"` JÁ existia no schema e JÁ era respeitado em três lugares
   * (`AccountingEntryGeneratorService`, `GuideToProvisionService`, `ParcelamentoService` recusam
   * sobrescrever quem está exportado), mas **nada no sistema inteiro escrevia esse valor**. Ou
   * seja: a proteção contra sobrescrever o que já foi para a contabilidade nunca pôde disparar —
   * uma recaptura do SERPRO podia reescrever um lançamento já entregue, em silêncio.
   *
   * A reabertura (`/export/reabrir`) existe pelo mesmo motivo que o mês fechado tem "Reabrir":
   * marca que não se desfaz vira armadilha na primeira correção legítima.
   */
  router.post("/entries/export/confirmar", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const { competenciaInicio, competenciaFim } = req.body || {};
    if (!competenciaInicio || !competenciaFim) {
      return res.status(400).json({ ok: false, error: "competencia_required" });
    }
    try {
      const where = {
        portalClientId,
        competencia: { gte: String(competenciaInicio), lte: String(competenciaFim) },
        tipo: { not: "PARCELA" },
        // Rascunho não vai para o ERP e não deve ser marcado como se tivesse ido.
        status: "CONFIRMADO",
      };
      const { count } = await prisma.accountingEntry.updateMany({ where, data: { status: "EXPORTADO" } });
      return res.json({ ok: true, marcados: count });
    } catch (err) {
      log.error({ err, portalClientId }, "falha ao marcar lançamentos como exportados");
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  /** Desfaz a marca de exportado — o "Reabrir" da exportação. */
  router.post("/entries/export/reabrir", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const { competenciaInicio, competenciaFim } = req.body || {};
    if (!competenciaInicio || !competenciaFim) {
      return res.status(400).json({ ok: false, error: "competencia_required" });
    }
    try {
      const { count } = await prisma.accountingEntry.updateMany({
        where: {
          portalClientId,
          competencia: { gte: String(competenciaInicio), lte: String(competenciaFim) },
          status: "EXPORTADO",
        },
        data: { status: "CONFIRMADO" },
      });
      return res.json({ ok: true, reabertos: count });
    } catch (err) {
      log.error({ err, portalClientId }, "falha ao reabrir lançamentos exportados");
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  // GET /firm/companies/:companyId/entries/export/csv
  // Query params:
  //   - competencia=YYYY-MM (m\u00EAs \u00FAnico)  OU
  //   - competenciaInicio=YYYY-MM & competenciaFim=YYYY-MM (intervalo inclusivo)
  //   - tipo, status (opcionais)
  router.get("/entries/export/csv", requireFirmCompanyAccess(), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const { competencia, competenciaInicio, competenciaFim, tipo, status } = req.query || {};

    const where = { portalClientId };
    let filenameSuffix = "todos";

    if (competenciaInicio && competenciaFim) {
      where.competencia = { gte: String(competenciaInicio), lte: String(competenciaFim) };
      filenameSuffix = `${competenciaInicio}_a_${competenciaFim}`;
    } else if (competenciaInicio) {
      where.competencia = { gte: String(competenciaInicio) };
      filenameSuffix = `desde_${competenciaInicio}`;
    } else if (competenciaFim) {
      where.competencia = { lte: String(competenciaFim) };
      filenameSuffix = `ate_${competenciaFim}`;
    } else if (competencia) {
      where.competencia = String(competencia);
      filenameSuffix = String(competencia);
    }
    if (tipo) where.tipo = String(tipo).toUpperCase();
    else where.tipo = { not: "PARCELA" }; // Q16: rastreio de parcela não vai pro CSV
    if (status) where.status = String(status).toUpperCase();

    const entries = await prisma.accountingEntry.findMany({
      where,
      include: { lines: { orderBy: { ordem: "asc" } } },
      orderBy: [{ competencia: "asc" }, { data: "asc" }, { createdAt: "asc" }],
    });

    const csv = entriesToCsv(entries);
    const filename = `lancamentos-${filenameSuffix}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    // Q8.A.6: sanitiza filename (defesa contra header injection).
    res.setHeader("Content-Disposition", `attachment; filename="${sanitizeFilename(filename)}"`);
    return res.send("\uFEFF" + csv);
  });

  // GET /firm/companies/:companyId/entries
  /**
   * RELATÓRIO — receitas e despesas por competência, num intervalo.
   *
   * ⚠ O QUE ESTE RELATÓRIO É, E O QUE ELE NÃO É
   * Ele soma o que foi LANÇADO, por competência e por tipo. Não é balanço nem balancete: aqueles
   * exigem saldo por conta com classificação patrimonial (ativo/passivo/PL), e o plano de contas
   * deste projeto guarda `tipo` (ATIVO|PASSIVO|RECEITA|DESPESA|PATRIMONIO) mas não os saldos
   * acumulados nem os ajustes de encerramento. Entregar "balancete" a partir do que existe seria
   * um demonstrativo com nome de peça contábil — e alguém o mandaria para o cliente.
   *
   * Por isso a tela NÃO oferece balanço/balancete como opção desabilitada: opção que existe e não
   * funciona ensina que o produto é capenga; opção que não existe, com o motivo dito uma vez, é
   * escopo declarado.
   *
   * ⚠ O INTERVALO É PRÓPRIO desta tela, e é a única exceção documentada à competência global da
   * empresa: relatório de um mês só não é relatório — a pergunta aqui é a evolução.
   */
  router.get("/relatorios/resumo", requireFirmCompanyAccess(), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const de = String(req.query?.de || "").trim();
    const ate = String(req.query?.ate || "").trim();
    if (!/^\d{4}-\d{2}$/.test(de) || !/^\d{4}-\d{2}$/.test(ate)) {
      return res.status(400).json({ ok: false, error: "intervalo_invalido" });
    }
    if (ate < de) return res.status(400).json({ ok: false, error: "intervalo_invertido" });

    try {
      const entries = await prisma.accountingEntry.findMany({
        where: {
          portalClientId,
          competencia: { gte: de, lte: ate },
          // Parcela é rastreio, não movimento do mês — mesma exclusão do CSV e da tabela.
          tipo: { not: "PARCELA" },
        },
        select: { competencia: true, tipo: true, lines: { select: { tipo: true, valor: true } } },
      });

      // Soma pelo DÉBITO das linhas: é a convenção que a Circular e a tabela de lançamentos já
      // usam para "quanto foi este lançamento". Trocar aqui faria o relatório discordar delas.
      const porCompetencia = new Map();
      for (const e of entries) {
        const chave = e.competencia;
        if (!porCompetencia.has(chave)) porCompetencia.set(chave, { competencia: chave, porTipo: {}, total: 0 });
        const bucket = porCompetencia.get(chave);
        const valor = (e.lines || [])
          .filter((l) => String(l.tipo).toUpperCase() === "D")
          .reduce((s, l) => s + Number(l.valor || 0), 0);
        const tipo = String(e.tipo || "OUTRO").toUpperCase();
        bucket.porTipo[tipo] = (bucket.porTipo[tipo] || 0) + valor;
        bucket.total += valor;
      }

      // ⚠ Competência SEM lançamento entra na série com zero, não some. Uma série que pula meses
      // esconde justamente o mês em que ninguém lançou nada — que é o que o relatório deveria
      // gritar. Ausência vira zero explícito, não buraco.
      const linhas = [];
      let [ano, mes] = de.split("-").map(Number);
      const [anoFim, mesFim] = ate.split("-").map(Number);
      while (ano < anoFim || (ano === anoFim && mes <= mesFim)) {
        const comp = `${ano}-${String(mes).padStart(2, "0")}`;
        linhas.push(porCompetencia.get(comp) || { competencia: comp, porTipo: {}, total: 0, semLancamento: true });
        mes += 1;
        if (mes > 12) { mes = 1; ano += 1; }
      }

      return res.json({ ok: true, de, ate, linhas });
    } catch (err) {
      log.error({ err, portalClientId, de, ate }, "falha ao montar o relatório de resumo");
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  router.get("/entries", requireFirmCompanyAccess(), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const { competencia, tipo, subtipo, origem, status, statusPagamento, page = "1", limit = "50" } = req.query || {};

    const where = { portalClientId };
    if (competencia) where.competencia = String(competencia);
    if (tipo) where.tipo = String(tipo).toUpperCase();
    else where.tipo = { not: "PARCELA" }; // Q16: rastreio de parcela fora da lista de lançamentos
    if (subtipo) where.subtipo = String(subtipo).toUpperCase();
    if (origem) where.origem = String(origem).toUpperCase();
    if (status) where.status = String(status).toUpperCase();
    if (statusPagamento) where.statusPagamento = String(statusPagamento).toUpperCase();

    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(200, Math.max(1, Number(limit)));
    const skip = (pageNum - 1) * limitNum;

    const [entries, total] = await Promise.all([
      prisma.accountingEntry.findMany({
        where,
        include: { lines: { orderBy: { ordem: "asc" } } },
        orderBy: [{ data: "asc" }, { createdAt: "asc" }],
        skip,
        take: limitNum,
      }),
      prisma.accountingEntry.count({ where }),
    ]);

    return res.json({ data: entries.map(entryToResponse), page: pageNum, limit: limitNum, total });
  });

  // ─── Históricos ───────────────────────────────────────────────────────────

  // GET /firm/companies/:companyId/historicos?q=texto
  router.get("/historicos", requireFirmCompanyAccess(), async (req, res) => {
    const companyPortalClientId = String(req.params.companyId);
    const userId = req.auth?.user?.id;
    if (!userId) return res.json([]);

    // Q50: normaliza o q — quem digita "DAS 06/2026" acha o histórico tokenizado ({{competencia}}).
    const q = normalizarHistorico(String(req.query.q || "").trim());
    const rawLimit = parseInt(String(req.query.limit || "12"), 10);
    const take = Math.min(200, rawLimit > 0 ? rawLimit : 12);

    const where = {
      createdByUserId: userId,
      OR: [
        { companyPortalClientId: companyPortalClientId },
        { companyPortalClientId: null },
      ],
    };
    if (q.length >= 2) {
      where.text = { contains: q, mode: "insensitive" };
    }

    try {
      const results = await prisma.accountingHistorico.findMany({
        where,
        orderBy: [{ usageCount: "desc" }, { text: "asc" }],
        take,
      });

      return res.json(results.map((h) => ({
        id: h.id,
        text: h.text,
        contaDebito: h.contaDebito,
        contaCredito: h.contaCredito,
        scope: h.companyPortalClientId ? "COMPANY" : "GLOBAL",
        usageCount: h.usageCount,
      })));
    } catch (err) {
      log.warn({ err }, "Falha ao buscar históricos");
      return res.json([]);
    }
  });

  // GET /firm/companies/:companyId/historicos/by-code/:codigo
  router.get("/historicos/by-code/:codigo", requireFirmCompanyAccess(), async (req, res) => {
    const companyPortalClientId = String(req.params.companyId);
    const codigo = String(req.params.codigo || "").trim();
    const userId = req.auth?.user?.id;
    if (!userId || !codigo) return res.json([]);

    try {
      const results = await prisma.accountingHistorico.findMany({
        where: {
          createdByUserId: userId,
          AND: [
            { OR: [{ companyPortalClientId: companyPortalClientId }, { companyPortalClientId: null }] },
            { OR: [{ contaDebito: codigo }, { contaCredito: codigo }] },
          ],
        },
        orderBy: [{ usageCount: "desc" }, { text: "asc" }],
        take: 10,
      });

      return res.json(results.map((h) => ({
        id: h.id,
        text: h.text,
        contaDebito: h.contaDebito,
        contaCredito: h.contaCredito,
        scope: h.companyPortalClientId ? "COMPANY" : "GLOBAL",
        usageCount: h.usageCount,
      })));
    } catch (err) {
      log.warn({ err }, "Falha ao buscar históricos por código");
      return res.json([]);
    }
  });

  // POST /firm/companies/:companyId/historicos
  router.post("/historicos", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const companyPortalClientId = String(req.params.companyId);
    const userId = req.auth?.user?.id;
    if (!userId) return res.status(401).json({ error: "unauthorized" });

    const body = req.body || {};
    const text = String(body.text || "").trim();
    const scope = String(body.scope || "COMPANY").toUpperCase();
    const contaDebito = body.contaDebito ? String(body.contaDebito).trim() : null;
    const contaCredito = body.contaCredito ? String(body.contaCredito).trim() : null;

    if (!text) return res.status(400).json({ error: "text_required" });

    const compId = scope === "GLOBAL" ? null : companyPortalClientId;

    try {
      const existing = await prisma.accountingHistorico.findFirst({
        where: { createdByUserId: userId, companyPortalClientId: compId, text },
      });

      let historico;
      if (existing) {
        historico = await prisma.accountingHistorico.update({
          where: { id: existing.id },
          data: { contaDebito, contaCredito, usageCount: existing.usageCount + 1, updatedAt: new Date() },
        });
      } else {
        historico = await prisma.accountingHistorico.create({
          data: { createdByUserId: userId, companyPortalClientId: compId, text, contaDebito, contaCredito },
        });
      }

      return res.status(201).json({ ok: true, historico });
    } catch (err) {
      log.error({ err }, "Erro ao salvar histórico");
      return res.status(500).json({ error: "internal_error" });
    }
  });

  // PATCH /firm/companies/:companyId/historicos/:historicoId
  router.patch("/historicos/:historicoId", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const companyPortalClientId = String(req.params.companyId);
    const userId = req.auth?.user?.id;
    const historicoId = String(req.params.historicoId);
    if (!userId) return res.status(401).json({ error: "unauthorized" });

    try {
      const existing = await prisma.accountingHistorico.findFirst({
        where: { id: historicoId, createdByUserId: userId },
      });
      if (!existing) return res.status(404).json({ error: "historico_nao_encontrado" });

      const body = req.body || {};
      const data = {};

      if (body.scope !== undefined) {
        const scope = String(body.scope).toUpperCase();
        data.companyPortalClientId = scope === "GLOBAL" ? null : companyPortalClientId;
      }
      if (body.contaDebito !== undefined) data.contaDebito = body.contaDebito ? String(body.contaDebito).trim() : null;
      if (body.contaCredito !== undefined) data.contaCredito = body.contaCredito ? String(body.contaCredito).trim() : null;

      const updated = await prisma.accountingHistorico.update({
        where: { id: historicoId },
        data: { ...data, updatedAt: new Date() },
      });

      return res.json({
        ok: true,
        historico: { ...updated, scope: updated.companyPortalClientId ? "COMPANY" : "GLOBAL" },
      });
    } catch (err) {
      log.error({ err }, "Erro ao atualizar histórico");
      return res.status(500).json({ error: "internal_error" });
    }
  });

  // DELETE /firm/companies/:companyId/historicos/:historicoId
  router.delete("/historicos/:historicoId", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const userId = req.auth?.user?.id;
    const historicoId = String(req.params.historicoId);

    try {
      const existing = await prisma.accountingHistorico.findFirst({
        where: { id: historicoId, createdByUserId: userId },
      });
      if (!existing) return res.status(404).json({ error: "historico_nao_encontrado" });

      await prisma.accountingHistorico.delete({ where: { id: historicoId } });
      return res.json({ ok: true });
    } catch (err) {
      log.error({ err }, "Erro ao excluir histórico");
      return res.status(500).json({ error: "internal_error" });
    }
  });

  // ─── Lançamentos ─────────────────────────────────────────────────────────

  // POST /firm/companies/:companyId/entries/parcelamento
  // Cria N parcelas de um parcelamento (Simples Nacional, INSS, etc.) em uma transaction.
  // Cada parcela vira 1 AccountingEntry com subtipo=PARC_DAS, tipo=PROVISAO, statusPagamento=ABERTO,
  // com 3 linhas: D principal + D juros + C contrapartida (total = principal + juros).
  // Histórico inclui "N/<numero>" para identificar a parcela ("N/1", "N/2", ..., "N/9").
  router.post(
    "/entries/parcelamento",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    async (req, res) => {
      const portalClientId = String(req.params.companyId);
      const body = req.body || {};

      const principalAccount = String(body.principalAccount || "").trim();
      const jurosAccount = String(body.jurosAccount || "").trim();
      const contraAccount = String(body.contraAccount || "").trim();
      const principalValue = Number(body.principalValue);
      const jurosValue = Number(body.jurosValue || 0);
      const numParcelas = Math.min(60, Math.max(1, Number(body.numParcelas) || 1));
      const competenciaInicial = String(body.competenciaInicial || "").trim();
      const diaPagamento = Math.min(31, Math.max(1, Number(body.diaPagamento) || 1));
      const periodosReferenciados = String(body.periodosReferenciados || "").trim();
      const labelParcelamento = String(body.label || "PARCELAMENTO SIMPLES NACIONAL").trim();

      // Validações
      if (!principalAccount || !contraAccount) {
        return res.status(400).json({ error: "contas_principal_e_contrapartida_obrigatorias" });
      }
      if (!Number.isFinite(principalValue) || principalValue <= 0) {
        return res.status(400).json({ error: "principal_value_invalido" });
      }
      if (!/^\d{4}-\d{2}$/.test(competenciaInicial)) {
        return res.status(400).json({ error: "competencia_inicial_invalida" });
      }
      // Se houver juros, jurosAccount é obrigatório
      if (Number.isFinite(jurosValue) && jurosValue > 0 && !jurosAccount) {
        return res.status(400).json({ error: "juros_account_required" });
      }

      // Helpers locais
      function addMonthsToCompetencia(comp, n) {
        const [yyyy, mm] = comp.split("-").map(Number);
        const date = new Date(Date.UTC(yyyy, mm - 1 + n, 1));
        return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
      }
      function buildDate(comp, dayOfMonth) {
        const [yyyy, mm] = comp.split("-").map(Number);
        // Se o dia não existir no mês (ex: 31 em fev), usa o último dia.
        const lastDay = new Date(Date.UTC(yyyy, mm, 0)).getUTCDate();
        const dayReal = Math.min(dayOfMonth, lastDay);
        return new Date(Date.UTC(yyyy, mm - 1, dayReal));
      }

      const totalLinha = Number(((principalValue + (jurosValue || 0)) * 100).toFixed(0)) / 100;
      const loteImportacao = `PARC_DAS-${Date.now()}`;
      const created = [];

      try {
        await prisma.$transaction(async (tx) => {
          for (let i = 0; i < numParcelas; i++) {
            const competenciaN = addMonthsToCompetencia(competenciaInicial, i);
            const dataN = buildDate(competenciaN, diaPagamento);
            const numeroParcela = i + 1;
            const sufixoPeriodos = periodosReferenciados ? ` DE ${periodosReferenciados}` : "";
            const historicoPrincipal =
              `VR REF ${labelParcelamento}${sufixoPeriodos} EM ${numParcelas} PARCELAS N/${numeroParcela}`;
            const historicoJuros =
              `VR REF JUROS S/${labelParcelamento}${sufixoPeriodos} EM ${numParcelas} PARCELAS N/${numeroParcela}`;

            const entry = await tx.accountingEntry.create({
              data: {
                portalClientId,
                data: dataN,
                competencia: competenciaN,
                historico: historicoPrincipal,
                tipo: "PROVISAO",
                subtipo: "PARC_DAS",
                origem: "MANUAL",
                loteImportacao,
                status: "RASCUNHO",
                statusPagamento: "ABERTO",
              },
            });

            const linhas = [
              {
                entryId: entry.id, conta: principalAccount, tipo: "D",
                valor: principalValue, ordem: 0, historico: historicoPrincipal,
              },
            ];
            if (jurosValue > 0) {
              linhas.push({
                entryId: entry.id, conta: jurosAccount, tipo: "D",
                valor: jurosValue, ordem: 1, historico: historicoJuros,
              });
            }
            linhas.push({
              entryId: entry.id, conta: contraAccount, tipo: "C",
              valor: totalLinha, ordem: linhas.length, historico: historicoPrincipal,
            });

            await tx.accountingEntryLine.createMany({ data: linhas });
            created.push({
              parcela: numeroParcela,
              entryId: entry.id,
              competencia: competenciaN,
              data: dataN.toISOString(),
              valor: totalLinha,
            });
          }
        });
        return res.status(201).json({ ok: true, loteImportacao, created, totalParcelas: numParcelas });
      } catch (err) {
        log.error({ err }, "Erro ao criar parcelamento Simples Nacional");
        return res.status(500).json({ ok: false, error: "internal_error", message: err?.message });
      }
    },
  );

  // POST /firm/companies/:companyId/entries/folha
  // Q52: cada linha do modal de Folha/Pró-labore vira UM lançamento individual (1 perna),
  // seguindo a regra dos parcelamentos (Q24.6). Todos os lançamentos da chamada compartilham
  // o mesmo loteImportacao ("FOLHA-<ts>"/"PROLABORE-<ts>") — o fechamento valida o balanço
  // D=C na SOMA do grupo (não por lançamento). Baixas (pagamento) têm 2 pernas e entram no
  // mesmo lote com tipo FOLHA (não há provisão ABERTO individual para vincular via openEntryId).
  router.post(
    "/entries/folha",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    async (req, res) => {
      const portalClientId = String(req.params.companyId);
      const body = req.body || {};

      const competencia = String(body.competencia || "").trim();
      const subtipoRaw = String(body.subtipo || "FOLHA").toUpperCase();
      const subtipo = subtipoRaw === "PROLABORE" ? "PROLABORE" : "FOLHA";
      const provisoes = Array.isArray(body.provisoes) ? body.provisoes : [];
      const baixas = Array.isArray(body.baixas) ? body.baixas : [];

      if (!/^\d{4}-\d{2}$/.test(competencia)) {
        return res.status(400).json({ error: "competencia_invalida", message: "Competência inválida (use AAAA-MM)." });
      }
      if (provisoes.length === 0 && baixas.length === 0) {
        return res.status(400).json({ error: "linhas_required", message: "Preencha valor e contas em ao menos uma linha." });
      }

      const parseValor = (v) => parseFloat(String(v ?? "").replace(",", "."));

      // Provisões: exatamente 1 perna cada (D xor C), conta + valor > 0 + data válida.
      let totalD = 0;
      let totalC = 0;
      const provisoesN = [];
      for (const p of provisoes) {
        const line = p?.line || {};
        const conta = String(line.conta || "").trim();
        const tipoLinha = String(line.tipo || "").toUpperCase();
        const valor = parseValor(line.valor);
        const dataP = p?.data ? new Date(p.data) : null;
        if (!conta) return res.status(400).json({ error: "linha_sem_conta", message: "Há linha de provisão sem conta preenchida." });
        if (!["D", "C"].includes(tipoLinha)) {
          return res.status(400).json({ error: "linha_tipo_invalido", message: "Linha de provisão deve ter uma perna D ou C." });
        }
        if (!Number.isFinite(valor) || valor <= 0) {
          return res.status(400).json({ error: "linha_valor_invalido", message: "Há linha de provisão com valor inválido." });
        }
        if (!dataP || isNaN(dataP.getTime())) {
          return res.status(400).json({ error: "data_invalida", message: "Há linha de provisão com data inválida." });
        }
        if (tipoLinha === "D") totalD += valor;
        else totalC += valor;
        provisoesN.push({
          data: dataP,
          historico: String(p.historico || "").trim(),
          conta,
          tipoLinha,
          valor,
        });
      }
      if (provisoesN.length > 0 && Math.abs(totalD - totalC) > 0.01) {
        return res.status(400).json({
          error: "folha_desbalanceada",
          totalD,
          totalC,
          message: `Provisão desbalanceada — débito R$ ${totalD.toFixed(2)} difere do crédito R$ ${totalC.toFixed(2)}.`,
        });
      }

      // Baixas: 2 pernas (1 D + 1 C) de mesmo valor.
      const baixasN = [];
      for (const b of baixas) {
        const lines = Array.isArray(b?.lines) ? b.lines : [];
        const dataB = b?.data ? new Date(b.data) : null;
        if (!dataB || isNaN(dataB.getTime())) {
          return res.status(400).json({ error: "data_invalida", message: "Há baixa com data inválida." });
        }
        const dLine = lines.find((l) => String(l?.tipo || "").toUpperCase() === "D");
        const cLine = lines.find((l) => String(l?.tipo || "").toUpperCase() === "C");
        if (lines.length !== 2 || !dLine || !cLine) {
          return res.status(400).json({ error: "baixa_invalida", message: "Baixa deve ter uma perna de débito e uma de crédito." });
        }
        const contaD = String(dLine.conta || "").trim();
        const contaC = String(cLine.conta || "").trim();
        if (!contaD || !contaC) return res.status(400).json({ error: "linha_sem_conta", message: "Há baixa sem conta preenchida." });
        const valorD = parseValor(dLine.valor);
        const valorC = parseValor(cLine.valor);
        if (!Number.isFinite(valorD) || valorD <= 0 || !Number.isFinite(valorC) || valorC <= 0) {
          return res.status(400).json({ error: "linha_valor_invalido", message: "Há baixa com valor inválido." });
        }
        if (Math.abs(valorD - valorC) > 0.01) {
          return res.status(400).json({ error: "baixa_desbalanceada", message: "Baixa com débito e crédito de valores diferentes." });
        }
        baixasN.push({
          data: dataB,
          historico: String(b.historico || "").trim(),
          contaD,
          contaC,
          valor: valorD,
        });
      }

      if (await isMonthClosed(portalClientId, competencia)) {
        return res.status(409).json({ error: "mes_fechado", competencia, message: "Mês fechado — reabra a empresa para lançar." });
      }

      const loteImportacao = `${subtipo}-${Date.now()}`;
      const created = [];
      try {
        await prisma.$transaction(async (tx) => {
          for (const p of provisoesN) {
            const entry = await tx.accountingEntry.create({
              data: {
                portalClientId,
                data: p.data,
                competencia,
                historico: p.historico || subtipo,
                tipo: "FOLHA",
                subtipo,
                origem: "MANUAL",
                loteImportacao,
                status: "RASCUNHO",
                statusPagamento: "NA",
              },
            });
            await tx.accountingEntryLine.create({
              data: {
                entryId: entry.id,
                conta: p.conta,
                tipo: p.tipoLinha,
                valor: p.valor,
                ordem: 0,
                historico: p.historico || null,
              },
            });
            created.push({ entryId: entry.id, historico: entry.historico, valor: p.valor });
          }
          for (const b of baixasN) {
            const entry = await tx.accountingEntry.create({
              data: {
                portalClientId,
                data: b.data,
                competencia,
                historico: b.historico || `PAGO ${subtipo}`,
                tipo: "FOLHA",
                subtipo,
                origem: "MANUAL",
                loteImportacao,
                status: "RASCUNHO",
                statusPagamento: "NA",
              },
            });
            await tx.accountingEntryLine.createMany({
              data: [
                { entryId: entry.id, conta: b.contaD, tipo: "D", valor: b.valor, ordem: 0, historico: b.historico || null },
                { entryId: entry.id, conta: b.contaC, tipo: "C", valor: b.valor, ordem: 1, historico: b.historico || null },
              ],
            });
            created.push({ entryId: entry.id, historico: entry.historico, valor: b.valor });
          }
        });

        // Memória de históricos (Q50) — best-effort, fora da transaction.
        const userId = req.auth?.user?.id;
        if (userId) {
          for (const p of provisoesN) {
            if (!p.historico) continue;
            await memorizeAccountHistorico({
              userId,
              portalClientId,
              text: p.historico,
              contaDebito: p.tipoLinha === "D" ? p.conta : null,
              contaCredito: p.tipoLinha === "C" ? p.conta : null,
              eventType: null,
            });
          }
          for (const b of baixasN) {
            if (!b.historico) continue;
            await memorizeAccountHistorico({
              userId,
              portalClientId,
              text: b.historico,
              contaDebito: b.contaD,
              contaCredito: b.contaC,
              eventType: null,
            });
          }
        }

        return res.status(201).json({ ok: true, loteImportacao, created });
      } catch (err) {
        log.error({ err }, "Erro ao criar lançamentos de folha/pró-labore");
        return res.status(500).json({ error: "internal_error", message: err?.message });
      }
    },
  );

  // POST /firm/companies/:companyId/entries
  router.post("/entries", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const body = req.body || {};

    const data = body.data ? new Date(body.data) : null;
    const historico = String(body.historico || "").trim();
    const tipo = String(body.tipo || "DESPESA").toUpperCase();
    const subtipo = body.subtipo ? String(body.subtipo).toUpperCase() : null;
    // statusPagamento é sempre derivado do tipo no backend — nunca aceitar do frontend
    const statusPagamento = tipo === "PROVISAO" ? "ABERTO" : "NA";
    const origem = "MANUAL";
    const lines = body.lines;

    if (!data || isNaN(data.getTime())) return res.status(400).json({ error: "data_invalida" });
    if (!historico) return res.status(400).json({ error: "historico_required" });

    const validation = validateLines(lines);
    if (!validation.ok) {
      return res.status(400).json({
        error: validation.error,
        totalD: validation.totalD,
        totalC: validation.totalC,
        diferenca: validation.diferenca,
      });
    }

    // ⚠ Conta que não existe no plano é recusada AQUI, não na exportação.
    const desconhecidas = await contasInexistentes(prisma, portalClientId, lines);
    if (desconhecidas.length) {
      return res.status(400).json({
        error: "conta_inexistente",
        contas: desconhecidas,
        // A mensagem nomeia as contas: "conta_inexistente" sozinho manda procurar em sete linhas.
        message: desconhecidas.length === 1
          ? `A conta ${desconhecidas[0]} não existe no plano de contas desta empresa.`
          : `Estas contas não existem no plano de contas desta empresa: ${desconhecidas.join(", ")}.`,
      });
    }

    const competencia = `${data.getUTCFullYear()}-${String(data.getUTCMonth() + 1).padStart(2, "0")}`;

    // Q18: não permite lançar em mês fechado (fechamento contábil).
    if (await isMonthClosed(portalClientId, competencia)) {
      return res.status(409).json({ error: "mes_fechado", competencia, message: "Mês fechado — reabra a empresa para lançar." });
    }

    try {
      const entry = await prisma.$transaction(async (tx) => {
        const created = await tx.accountingEntry.create({
          data: {
            portalClientId,
            data,
            competencia,
            historico,
            tipo,
            subtipo,
            origem,
            statusPagamento,
            status: "RASCUNHO",
          },
        });
        await tx.accountingEntryLine.createMany({
          data: lines.map((l, idx) => ({
            entryId: created.id,
            conta: String(l.conta).trim(),
            tipo: String(l.tipo).toUpperCase(),
            valor: parseFloat(String(l.valor).replace(",", ".")),
            ordem: idx,
            historico: l.historico ? String(l.historico).trim() : null,
          })),
        });

        // Se for PROVISÃO, criar placeholders para os meses do ano sem cobertura
        if (tipo === "PROVISAO" && subtipo) {
          await createProvisionPlaceholders(tx, {
            portalClientId,
            subtipo,
            competenciaOrigem: competencia,
            historico: historico.length <= 60 ? historico : subtipo,
          });
        }

        return tx.accountingEntry.findUnique({
          where: { id: created.id },
          include: { lines: { orderBy: { ordem: "asc" } } },
        });
      });

      // Auto-save do histórico (fora da transaction principal — não é crítico).
      // Para entries automáticos (que vieram do gerador), o body inclui `eventType` —
      // gravamos esse marcador para permitir o lookup futuro (mesma empresa + mesmo eventType
      // já tem D/C memorizados, próxima sync auto-preenche em vez de vir vazio).
      const userId = req.auth?.user?.id;
      const bodyEventType = body?.eventType ? String(body.eventType).trim() : null;
      if (userId && historico) {
        const debitLine = lines.find((l) => String(l.tipo).toUpperCase() === "D");
        const creditLine = lines.find((l) => String(l.tipo).toUpperCase() === "C");
        // Q50: ponto único de gravação (normaliza a competência + mantém a linha global).
        await memorizeAccountHistorico({
          userId,
          portalClientId,
          text: historico,
          contaDebito: debitLine ? String(debitLine.conta || "").trim() || null : null,
          contaCredito: creditLine ? String(creditLine.conta || "").trim() || null : null,
          eventType: bodyEventType,
        });
      }

      return res.status(201).json({ ok: true, entry: entryToResponse(entry) });
    } catch (err) {
      log.error({ err }, "Erro ao criar lançamento");
      return res.status(500).json({ error: "internal_error" });
    }
  });

  // PUT /firm/companies/:companyId/entries/:entryId
  router.put("/entries/:entryId", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const entryId = String(req.params.entryId);
    const body = req.body || {};

    const existing = await prisma.accountingEntry.findFirst({
      where: { id: entryId, portalClientId },
    });
    if (!existing) return res.status(404).json({ error: "lancamento_nao_encontrado" });
    if (existing.status === "EXPORTADO") {
      return res.status(400).json({ error: "lancamento_ja_exportado" });
    }

    const data = {};
    if (body.data) {
      const d = new Date(body.data);
      if (!isNaN(d.getTime())) {
        data.data = d;
        data.competencia = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      }
    }
    if (body.historico !== undefined) data.historico = String(body.historico).trim();
    if (body.tipo !== undefined) data.tipo = String(body.tipo).toUpperCase();
    if (body.subtipo !== undefined) data.subtipo = body.subtipo ? String(body.subtipo).toUpperCase() : null;
    if (body.statusPagamento !== undefined) data.statusPagamento = String(body.statusPagamento).toUpperCase();
    if (body.status !== undefined && ["RASCUNHO", "CONFIRMADO"].includes(String(body.status))) {
      data.status = String(body.status);
    }

    const lines = body.lines;
    const isTemplate = existing.origem === "TEMPLATE";

    if (lines !== undefined) {
      // Template sendo preenchido pela primeira vez: não valida se lines estiver vazio
      const validation = validateLines(lines);
      if (!validation.ok) {
        // Se o entry é um template e não há linhas ainda, isso é válido (continua como template)
        if (!(isTemplate && lines.length === 0)) {
          // Log detalhado para diagnosticar saves rejeitados (lines vazias, conta sem código, etc).
          log.warn(
            {
              entryId,
              portalClientId,
              validationError: validation.error,
              linesSummary: (lines || []).map((l) => ({
                tipo: l?.tipo,
                contaLen: String(l?.conta || "").length,
                valor: l?.valor,
              })),
            },
            "PUT /entries — validação de linhas falhou"
          );
          return res.status(400).json({
            error: validation.error,
            totalD: validation.totalD,
            totalC: validation.totalC,
            diferenca: validation.diferenca,
          });
        }
      } else if (isTemplate && lines.length > 0) {
        // Template sendo preenchido com linhas válidas: promover a MANUAL
        data.origem = "MANUAL";
      }

      // Mesma guarda do POST: conta fora do plano é recusada na EDIÇÃO também. Sem isto, bastava
      // criar certo e depois trocar o código pelo caminho da edição para o furo continuar aberto.
      if (lines.length > 0) {
        const desconhecidas = await contasInexistentes(prisma, portalClientId, lines);
        if (desconhecidas.length) {
          return res.status(400).json({
            error: "conta_inexistente",
            contas: desconhecidas,
            message: desconhecidas.length === 1
              ? `A conta ${desconhecidas[0]} não existe no plano de contas desta empresa.`
              : `Estas contas não existem no plano de contas desta empresa: ${desconhecidas.join(", ")}.`,
          });
        }
      }
    }

    // Não permitir CONFIRMADO se for template (sem linhas)
    if (data.status === "CONFIRMADO" && isTemplate && lines === undefined) {
      return res.status(400).json({ error: "template_sem_valor" });
    }

    // statusPagamento é sempre derivado do tipo — ignorar o que vier do frontend
    delete data.statusPagamento;

    try {
      const updated = await prisma.$transaction(async (tx) => {
        const entry = await tx.accountingEntry.update({
          where: { id: entryId },
          data,
        });
        if (lines !== undefined && lines.length > 0) {
          await tx.accountingEntryLine.deleteMany({ where: { entryId } });
          await tx.accountingEntryLine.createMany({
            data: lines.map((l, idx) => ({
              entryId,
              conta: String(l.conta).trim(),
              tipo: String(l.tipo).toUpperCase(),
              valor: parseFloat(String(l.valor).replace(",", ".")),
              ordem: idx,
              historico: l.historico ? String(l.historico).trim() : null,
            })),
          });
        }
        return tx.accountingEntry.findUnique({
          where: { id: entryId },
          include: { lines: { orderBy: { ordem: "asc" } } },
        });
      });

      // Auto-save do histórico (mesma lógica do POST). Para entries automáticos editados pelo
      // contador, gravamos `eventType` para que sync seguinte da mesma empresa auto-preencha D/C.
      const userId = req.auth?.user?.id;
      const bodyEventType = body?.eventType
        ? String(body.eventType).trim()
        : (updated?.eventType ? String(updated.eventType).trim() : null);
      const finalLines = Array.isArray(updated?.lines) ? updated.lines : [];
      const finalHistorico = updated?.historico || data.historico || null;
      if (userId && finalHistorico) {
        const debitLine = finalLines.find((l) => String(l.tipo).toUpperCase() === "D");
        const creditLine = finalLines.find((l) => String(l.tipo).toUpperCase() === "C");
        const contaD = debitLine ? String(debitLine.conta || "").trim() || null : null;
        const contaC = creditLine ? String(creditLine.conta || "").trim() || null : null;
        // Só auto-saveia se tiver pelo menos uma conta preenchida (helper guarda contaD||contaC).
        await memorizeAccountHistorico({
          userId,
          portalClientId,
          text: finalHistorico,
          contaDebito: contaD,
          contaCredito: contaC,
          eventType: bodyEventType,
        });
      }

      // Q16: entries de parcelamento (abertura/baixa) memorizam contas POR LINHA, pra a
      // próxima abertura/baixa da mesma empresa (mesmo kind) vir pré-preenchida.
      if (existing.parcelamentoId && Array.isArray(updated?.lines) && updated.lines.length > 0) {
        try {
          const { memorizeParcelamentoLineAccounts } = await import(
            "../../application/accounting/ParcelamentoService.js"
          );
          await memorizeParcelamentoLineAccounts({
            userId: req.auth?.user?.id,
            portalClientId,
            entry: updated,
          });
        } catch (memErr) {
          log.warn({ memErr }, "Falha ao memorizar contas de parcelamento (não crítico)");
        }
      }

      return res.json({ ok: true, entry: entryToResponse(updated) });
    } catch (err) {
      log.error({ err }, "Erro ao atualizar lançamento");
      return res.status(500).json({ error: "internal_error" });
    }
  });

  // PATCH /firm/companies/:companyId/entries/:entryId/approve
  router.patch("/entries/:entryId/approve", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const entryId = String(req.params.entryId);

    const existing = await prisma.accountingEntry.findFirst({
      where: { id: entryId, portalClientId },
    });
    if (!existing) return res.status(404).json({ error: "lancamento_nao_encontrado" });
    if (existing.status === "EXPORTADO") {
      return res.status(400).json({ error: "lancamento_ja_exportado" });
    }

    const updated = await prisma.accountingEntry.update({
      where: { id: entryId },
      data: { status: "CONFIRMADO" },
      include: { lines: { orderBy: { ordem: "asc" } } },
    });

    return res.json({ ok: true, entry: entryToResponse(updated) });
  });

  // DELETE /firm/companies/:companyId/entries/:entryId
  router.delete("/entries/:entryId", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const entryId = String(req.params.entryId);

    const existing = await prisma.accountingEntry.findFirst({
      where: { id: entryId, portalClientId },
    });
    if (!existing) return res.status(404).json({ error: "lancamento_nao_encontrado" });
    if (existing.status === "EXPORTADO") {
      return res.status(400).json({ error: "lancamento_ja_exportado" });
    }

    if (existing.tipo === "BAIXA" && existing.openEntryId) {
      await prisma.$transaction(async (tx) => {
        await tx.accountingEntry.delete({ where: { id: entryId } });
        // Baixa parcial: recalcula o status pelas baixas RESTANTES (pode ainda estar PARCIAL).
        const open = await tx.accountingEntry.findFirst({
          where: { id: existing.openEntryId, portalClientId },
          include: {
            lines: { orderBy: { ordem: "asc" } },
            baixas: { include: { lines: { orderBy: { ordem: "asc" } } } },
          },
        });
        if (open) {
          const s = computeSaldoProvisao(open);
          const status = s.abatido <= 0.009 ? "ABERTO" : (s.saldo <= 0.009 ? "PAGO" : "PARCIAL");
          await tx.accountingEntry.update({ where: { id: open.id }, data: { statusPagamento: status } });
        }
      });
    } else if (existing.tipo === "BAIXA" && existing.sourceGuideId) {
      // Q52.INSS: cancelar baixa do INSS — apaga o lançamento e reabre a guia (volta a vermelho).
      // Só reverte o pagamento se ele veio DESTA baixa (fonte MANUAL); não desfaz confirmação do SERPRO.
      await prisma.$transaction(async (tx) => {
        await tx.accountingEntry.delete({ where: { id: entryId } });
        const guide = await tx.guide.findFirst({
          where: { id: existing.sourceGuideId, portalClientId },
          select: { id: true, paymentStatusSource: true },
        });
        if (guide) {
          const fromManual = String(guide.paymentStatusSource || "").toUpperCase() === "MANUAL";
          await tx.guide.update({
            where: { id: guide.id },
            data: {
              baixada: false,
              dataBaixa: null,
              lancamentoId: null,
              ...(fromManual
                ? {
                    paymentStatus: "OPEN",
                    paymentStatusSource: null,
                    paymentConfirmedAt: null,
                    paymentConfirmedByUserId: null,
                    serproLastCheckResult: null,
                  }
                : {}),
            },
          });
        }
      });
    } else {
      await prisma.accountingEntry.delete({ where: { id: entryId } });
    }
    return res.json({ ok: true });
  });

  // GET /firm/companies/:companyId/entries/:entryId/baixa-template
  // Resolve a regra de BAIXA para uma provisão, retornando contas/histórico pré-preenchidos.
  router.get("/entries/:entryId/baixa-template", requireFirmCompanyAccess(), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const entryId = String(req.params.entryId);

    const entry = await prisma.accountingEntry.findFirst({
      where: { id: entryId, portalClientId },
      include: {
        lines: { orderBy: { ordem: "asc" } },
        baixas: { include: { lines: { orderBy: { ordem: "asc" } } } },
      },
    });
    if (!entry) return res.status(404).json({ error: "lancamento_nao_encontrado" });

    // Baixa parcial por quota: saldo restante da provisão (principal − já abatido).
    const saldoInfo = computeSaldoProvisao(entry);
    const quotaNumero = saldoInfo.quotasPagas + 1;

    // Frente B / item 2: juros+multa da guia (acréscimo) → linha extra na baixa (conta de juros 501).
    const acrescimo = await acrescimoDoEntry(prisma, portalClientId, entry);

    const baixaEventType = deriveBaixaEventType(entry);
    if (!baixaEventType) {
      return res.json({ ok: true, template: null, acrescimo, saldoInfo, quotaNumero, reason: "no_baixa_mapping" });
    }

    const company = await prisma.portalClient.findUnique({
      where: { id: portalClientId },
      select: { razao: true, cnpj: true },
    });

    // Q37: prioriza a MEMÓRIA do último preenchido sobre a regra fixa (AccountingEntryRule).
    const mem = await lookupAccountsFromHistorico(prisma, { portalClientId, eventType: baixaEventType });
    const rule = await resolveRule(prisma, { portalClientId, eventType: baixaEventType });
    const debitAccountCode = mem.debitAccountCode || rule?.debitAccountCode || "";
    const creditAccountCode = mem.creditAccountCode || rule?.creditAccountCode || "";
    if (!debitAccountCode && !creditAccountCode) {
      // Sem memória nem regra → modal inverte as linhas da provisão (comportamento atual).
      return res.json({ ok: true, template: null, acrescimo, saldoInfo, quotaNumero, reason: "sem_memoria_nem_regra" });
    }

    // Baixa parcial: o valor sugerido é o SALDO restante (não o principal cheio). Numa provisão
    // ainda intacta, saldo == principal → comportamento idêntico ao de antes.
    const valor = saldoInfo.saldo > 0 ? saldoInfo.saldo : saldoInfo.principal;

    const historico = rule?.descriptionTemplate
      ? applyTemplate(rule.descriptionTemplate, {
          competencia: entry.competencia,
          competenciaLabel: formatCompetenciaLabel(entry.competencia),
          companyName: company?.razao || "",
          cnpj: company?.cnpj || "",
        })
      : `PAGAMENTO ${entry.subtipo || "PROVISÃO"} - ${formatCompetenciaLabel(entry.competencia)}`;

    const fromMemoria = Boolean(mem.debitAccountCode || mem.creditAccountCode);
    return res.json({
      ok: true,
      acrescimo,
      saldoInfo,
      quotaNumero,
      template: {
        eventType: baixaEventType,
        debitAccountCode,
        creditAccountCode,
        historico,
        valor,
        ruleId: rule?.id || null,
        scope: fromMemoria ? "MEMORIA" : (rule?.id ? (rule.portalClientId ? "COMPANY" : "GLOBAL") : "FALLBACK"),
      },
    });
  });

  // POST /firm/companies/:companyId/entries/:entryId/baixa
  router.post("/entries/:entryId/baixa", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const entryId = String(req.params.entryId);
    const body = req.body || {};

    const openEntry = await prisma.accountingEntry.findFirst({
      where: { id: entryId, portalClientId },
      include: {
        lines: { orderBy: { ordem: "asc" } },
        baixas: { include: { lines: { orderBy: { ordem: "asc" } } } },
      },
    });
    if (!openEntry) return res.status(404).json({ error: "lancamento_nao_encontrado" });
    // Baixa parcial: aceita provisão ABERTA ou já PARCIAL (com saldo). PAGO/NA não pode.
    if (!["ABERTO", "PARCIAL"].includes(openEntry.statusPagamento)) {
      return res.status(400).json({ error: "lancamento_nao_esta_aberto" });
    }

    const data = body.data ? new Date(body.data) : null;
    const historico = String(body.historico || "").trim();
    const lines = body.lines;

    if (!data || isNaN(data.getTime())) return res.status(400).json({ error: "data_invalida" });
    if (!historico) return res.status(400).json({ error: "historico_required" });

    const validation = validateLines(lines);
    if (!validation.ok) {
      return res.status(400).json({
        error: validation.error,
        totalD: validation.totalD,
        totalC: validation.totalC,
        diferenca: validation.diferenca,
      });
    }

    // Baixa parcial por quota: quanto ESTA baixa amortiza do principal (exclui juros 501 / multa 506).
    const saldoAtual = computeSaldoProvisao(openEntry);
    const principalDestaBaixa = r2(
      lines
        .filter((l) => String(l.tipo).toUpperCase() === "D" && !CONTAS_ACRESCIMO.has(String(l.conta).trim()))
        .reduce((s, l) => s + parseFloat(String(l.valor).replace(",", ".")), 0)
    );
    // Não deixa a soma das baixas passar do principal da provisão (tolerância de centavo).
    if (principalDestaBaixa - saldoAtual.saldo > 0.01) {
      return res.status(400).json({
        error: "baixa_excede_saldo",
        saldo: saldoAtual.saldo,
        principalDestaBaixa,
        message: `A baixa (principal R$ ${principalDestaBaixa.toFixed(2)}) excede o saldo da provisão (R$ ${saldoAtual.saldo.toFixed(2)}).`,
      });
    }
    // Quita a provisão quando o abatido acumulado alcança o principal; senão fica PARCIAL.
    const abatidoAcumulado = r2(saldoAtual.abatido + principalDestaBaixa);
    const novoStatus = abatidoAcumulado + 0.01 >= saldoAtual.principal ? "PAGO" : "PARCIAL";

    const competencia = `${data.getUTCFullYear()}-${String(data.getUTCMonth() + 1).padStart(2, "0")}`;

    try {
      const result = await prisma.$transaction(async (tx) => {
        // PRINCIPAL, JUROS e MULTA viram lançamentos INDEPENDENTES (regra do projeto), cada um
        // balanceado contra o caixa. Um lançamento único misturando os três (3D/1C) some no
        // dropdown e esconde que juros/multa são DESPESA do mês, não amortização do passivo.
        // Componente zerado não gera lançamento.
        const grupos = separarLinhasPorPapel(lines);
        const criados = [];
        for (const g of grupos) {
          const entry = await tx.accountingEntry.create({
            data: {
              portalClientId,
              data,
              competencia,
              historico: `${historico}${SUFIXO_PAPEL[g.papel] || ""}`,
              tipo: "BAIXA",
              // Q37: o eventType alimenta a memória de contas — e há @@unique(portalClientId,
              // competencia, eventType, origem), então SÓ o lançamento do principal pode carregá-lo.
              // Repetir nos três violaria a constraint e derrubaria a baixa inteira. Também é o
              // certo semanticamente: a memória D/C é do par do tributo, não de juros/multa.
              eventType: g.papel === "PRINCIPAL" ? deriveBaixaEventType(openEntry) : null,
              // Todos apontam para a MESMA provisão: o cálculo de saldo soma as três (e juros/multa
              // não entram no principal abatido, por conta de CONTAS_ACRESCIMO).
              openEntryId: entryId,
              origem: "MANUAL",
              statusPagamento: "NA",
              status: "CONFIRMADO",
            },
          });
          await tx.accountingEntryLine.createMany({
            data: [
              ...g.debitos.map((l, idx) => ({
                entryId: entry.id,
                conta: String(l.conta).trim(),
                tipo: "D",
                valor: r2(parseFloat(String(l.valor).replace(",", "."))),
                ordem: idx,
              })),
              { entryId: entry.id, conta: g.contaCaixa, tipo: "C", valor: g.total, ordem: g.debitos.length },
            ],
          });
          criados.push(entry);
        }
        // A baixa "principal" é a referência devolvida ao cliente (é a que amortiza o passivo).
        const baixa = criados[0];
        const updatedOpen = await tx.accountingEntry.update({
          where: { id: entryId },
          data: { statusPagamento: novoStatus },
          include: {
            lines: { orderBy: { ordem: "asc" } },
            baixas: { include: { lines: { orderBy: { ordem: "asc" } } } },
          },
        });
        const fullBaixa = await tx.accountingEntry.findUnique({
          where: { id: baixa.id },
          include: { lines: { orderBy: { ordem: "asc" } } },
        });
        return { entry: fullBaixa, openEntry: updatedOpen };
      });
      // Q37: memoriza as contas D/C da baixa por (empresa, eventType) → próxima baixa vem pré-preenchida
      // com o último preenchido. Best-effort.
      const dLine = lines.find((l) => String(l.tipo).toUpperCase() === "D");
      const cLine = lines.find((l) => String(l.tipo).toUpperCase() === "C");
      await memorizeAccountHistorico({
        userId: req.auth?.user?.id,
        portalClientId,
        text: historico,
        contaDebito: dLine ? String(dLine.conta || "").trim() || null : null,
        contaCredito: cLine ? String(cLine.conta || "").trim() || null : null,
        eventType: deriveBaixaEventType(openEntry),
      });
      return res.status(201).json({
        ok: true,
        entry: entryToResponse(result.entry),
        openEntry: entryToResponse(result.openEntry),
      });
    } catch (err) {
      log.error({ err }, "Erro ao criar baixa");
      return res.status(500).json({ error: "internal_error" });
    }
  });

  // Q47 — Baixa do INSS pela Circular. O INSS aparece como provisão SINTÉTICA (synthetic-inss-<guideId>),
  // sem AccountingEntry PROVISAO; por isso a baixa é roteada pela GUIA (não por entryId). Reusa o mesmo
  // modal genérico de baixa do DAS: template pré-preenche contas (INSS a Recolher da folha / Caixa),
  // e o POST confirma a guia como paga (selo verde) + gera a BAIXA com as contas escolhidas.

  // GET /firm/companies/:companyId/guides/:guideId/inss-baixa-template
  router.get("/guides/:guideId/inss-baixa-template", requireFirmCompanyAccess(), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const guideId = String(req.params.guideId);

    const guide = await prisma.guide.findFirst({
      where: { id: guideId, portalClientId },
      select: { id: true, tipo: true, competencia: true, valor: true },
    });
    if (!guide) return res.status(404).json({ error: "guide_not_found" });
    if (String(guide.tipo || "").toUpperCase() !== "INSS") {
      return res.status(400).json({ error: "guia_nao_e_inss" });
    }

    // Conta "INSS a Recolher" vem da folha/pró-labore da competência; caixa por hints do template de folha.
    const debitAccountCode = await resolveInssAccountFromFolha(portalClientId, guide.competencia);
    const creditAccountCode = await resolveCaixaAccount(portalClientId);
    // Baixa com juros/multa: lê o split do INSS (circular.acrescimos.INSS — SERPRO ou edição manual).
    // Se houver principal editado, ele vira o valor da linha principal; senão usa o valor da guia.
    const acrescimo = await acrescimoDoEntry(prisma, portalClientId, { subtipo: "INSS", competencia: guide.competencia });
    const valor = acrescimo?.principal > 0 ? acrescimo.principal : Number(guide.valor || 0);
    const historico = `PAGO INSS - ${formatCompetenciaLabel(guide.competencia)}`;

    if (!debitAccountCode && !creditAccountCode) {
      // Sem folha lançada → modal usa os defaults (contador preenche as contas manualmente).
      return res.json({ ok: true, template: null, acrescimo, reason: "sem_conta_folha" });
    }
    return res.json({
      ok: true,
      acrescimo,
      template: {
        debitAccountCode: debitAccountCode || "",
        creditAccountCode: creditAccountCode || "",
        valor,
        historico,
        scope: "COMPANY", // contas resolvidas da folha da própria empresa
      },
    });
  });

  // POST /firm/companies/:companyId/guides/:guideId/inss-baixa
  router.post("/guides/:guideId/inss-baixa", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const guideId = String(req.params.guideId);
    const body = req.body || {};

    const guide = await prisma.guide.findFirst({
      where: { id: guideId, portalClientId },
      select: { id: true, tipo: true },
    });
    if (!guide) return res.status(404).json({ error: "guide_not_found" });
    if (String(guide.tipo || "").toUpperCase() !== "INSS") {
      return res.status(400).json({ error: "guia_nao_e_inss" });
    }

    const data = body.data ? new Date(body.data) : null;
    const historico = String(body.historico || "").trim();
    const lines = body.lines;
    if (!data || isNaN(data.getTime())) return res.status(400).json({ error: "data_invalida" });
    if (!historico) return res.status(400).json({ error: "historico_required" });

    const validation = validateLines(lines);
    if (!validation.ok) {
      return res.status(400).json({
        error: validation.error,
        totalD: validation.totalD,
        totalC: validation.totalC,
        diferenca: validation.diferenca,
      });
    }

    try {
      // Gera a BAIXA (D INSS a Recolher / C Caixa) com as contas escolhidas no modal.
      const inssBaixa = await gerarPagamentoInssFromGuide({
        portalClientId,
        guideId,
        dataPagamento: data,
        historico,
        lines,
        userId: req.auth?.user?.id,
      });
      if (inssBaixa?.skipped) {
        // ja_baixada / sem_valor etc — não confirma pagamento nem duplica lançamento.
        return res.status(409).json({ error: inssBaixa.reason || "baixa_skipped" });
      }
      // Selo verde da Circular depende de paymentStatus=PAID: marca a guia como paga (fonte MANUAL).
      await markGuidePaidManual({ guideId, userId: req.auth?.user?.id });
      return res.status(201).json({ ok: true, inssBaixa });
    } catch (err) {
      if (err?.code === "MES_FECHADO") {
        return res.status(409).json({ error: "MES_FECHADO" });
      }
      log.error({ err }, "Erro ao criar baixa do INSS");
      return res.status(500).json({ error: "internal_error" });
    }
  });

  // POST /firm/companies/:companyId/entries/import/ofx
  // Modo preview (?preview=1 OU multipart com file): parsea OFX e casa com históricos existentes
  // Modo commit (JSON body com transactions): cria entries enriquecidos linha-a-linha + auto-save de histórico
  router.post(
    "/entries/import/ofx",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    upload.single("file"),
    async (req, res) => {
      const portalClientId = String(req.params.companyId);
      const userId = req.auth?.user?.id;
      const isPreview = req.query.preview === "1" || req.body?.preview === true || Boolean(req.file?.buffer);

      // ── Modo preview: parsea arquivo + casa com históricos ────────────────
      if (isPreview) {
        if (!req.file?.buffer) return res.status(400).json({ error: "file_required" });

        const parsed = parseOfx(req.file.buffer);
        if (!parsed.length) {
          return res.status(422).json({ error: "nenhuma_transacao_encontrada" });
        }

        // O parser chama o memo do banco de `historico`. Usamos isso como chave de match.
        const descriptions = parsed.map((t) => t.historico);
        const matches = await findHistoricoMatches({ portalClientId, userId, descriptions });

        const transactions = parsed.map((t, i) => ({
          rowIndex: i,
          data: t.data.toISOString().slice(0, 10),
          // Renomeia explicitamente: descricaoOfx é o memo do banco (chave de match).
          descricaoOfx: t.historico,
          valor: t.valor,
          sinal: t.sinal,
          trnType: t.trnType,
          fitId: t.fitId,
          match: matches[i] || null,
        }));

        return res.json({ ok: true, transactions, total: transactions.length });
      }

      // ── Modo commit: cria entries linha-a-linha + auto-saves de histórico ─
      const body = req.body || {};
      const transactions = Array.isArray(body.transactions) ? body.transactions : [];
      if (!transactions.length) return res.status(400).json({ error: "transactions_required" });

      const loteImportacao = `OFX-${Date.now()}`;
      const created = [];
      const failed = [];

      try {
        await prisma.$transaction(async (tx) => {
          for (const t of transactions) {
            const contaDebito = String(t.contaDebito || "").trim();
            const contaCredito = String(t.contaCredito || "").trim();
            const valor = Number(t.valor);
            const historico = String(t.historico || "").trim();
            const dataStr = String(t.data || "").slice(0, 10);
            // Importa com ≥1 conta preenchida; só pula quando D E C estão vazias (a outra aprende depois).
            if ((!contaDebito && !contaCredito) || !historico || !valor || !dataStr) {
              failed.push({ rowIndex: t.rowIndex, reason: "campos_obrigatorios" });
              continue;
            }
            const dataDate = new Date(`${dataStr}T00:00:00.000Z`);
            if (Number.isNaN(dataDate.getTime())) {
              failed.push({ rowIndex: t.rowIndex, reason: "data_invalida" });
              continue;
            }
            const competencia = `${dataDate.getUTCFullYear()}-${String(dataDate.getUTCMonth() + 1).padStart(2, "0")}`;
            const tipo = String(t.tipo || "DESPESA").toUpperCase();

            const entry = await tx.accountingEntry.create({
              data: {
                portalClientId,
                data: dataDate,
                competencia,
                historico,
                tipo,
                origem: "OFX",
                loteImportacao,
                status: "RASCUNHO",
                statusPagamento: "NA",
              },
            });
            await tx.accountingEntryLine.createMany({
              data: [
                { entryId: entry.id, conta: contaDebito, tipo: "D", valor, ordem: 0 },
                { entryId: entry.id, conta: contaCredito, tipo: "C", valor, ordem: 1 },
              ],
            });
            created.push({ rowIndex: t.rowIndex, entryId: entry.id });
          }
        });
      } catch (err) {
        log.error({ err }, "Erro ao importar OFX (commit)");
        return res.status(500).json({ error: "internal_error", message: err?.message });
      }

      // Auto-save de histórico (fora da transaction principal — falha por linha não derruba o batch).
      // text = descrição OFX (chave de match) | historicoSugerido = histórico contábil digitado pelo contador.
      if (userId) {
        for (const t of transactions) {
          const contaDebito = String(t.contaDebito || "").trim();
          const contaCredito = String(t.contaCredito || "").trim();
          const descricaoOfx = String(t.descricaoOfx || "").trim();
          const historico = String(t.historico || "").trim();
          if (!descricaoOfx || !contaDebito || !contaCredito) continue;
          await upsertHistoricoFromImport({
            userId,
            portalClientId,
            text: descricaoOfx,
            contaDebito,
            contaCredito,
            historicoSugerido: historico,
          });
        }
      }

      return res.status(201).json({
        ok: true,
        created: created.length,
        failed: failed.length,
        loteImportacao,
        details: { created, failed },
      });
    }
  );

  // POST /firm/companies/:companyId/entries/import/excel?preview=1
  // Preview: parsea o Excel e tenta casar cada descrição com históricos existentes.
  router.post(
    "/entries/import/excel",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    upload.single("file"),
    async (req, res) => {
      const portalClientId = String(req.params.companyId);
      const userId = req.auth?.user?.id;
      const isPreview = req.query.preview === "1" || req.body?.preview === true;

      // ── Modo preview: parsea arquivo + match ────────────────────────────
      if (isPreview) {
        if (!req.file?.buffer) return res.status(400).json({ error: "file_required" });
        let parsed;
        try {
          parsed = parseExcelBuffer(req.file.buffer);
        } catch (err) {
          if (err?.code === "EXCEL_TOO_MANY_ROWS") {
            return res.status(422).json({ error: "excel_too_many_rows", message: err.message });
          }
          log.error({ err }, "Falha ao parsear Excel");
          return res.status(422).json({ error: "excel_parse_failed", message: err?.message });
        }
        if (!parsed.length) {
          return res.status(422).json({ error: "nenhuma_transacao_encontrada" });
        }

        const matches = await findHistoricoMatches({
          portalClientId,
          userId,
          descriptions: parsed.map((t) => t.descricao),
        });

        const transactions = parsed.map((t, i) => ({
          rowIndex: t.rowIndex,
          data: t.data.toISOString().slice(0, 10),
          descricao: t.descricao,
          valor: t.valor,
          match: matches[i] || null,
        }));
        return res.json({ ok: true, transactions, total: transactions.length });
      }

      // ── Modo commit: cria entries + auto-saves de histórico ─────────────
      const body = req.body || {};
      const transactions = Array.isArray(body.transactions) ? body.transactions : [];
      if (!transactions.length) return res.status(400).json({ error: "transactions_required" });

      const loteImportacao = `EXCEL-${Date.now()}`;
      const created = [];
      const failed = [];

      try {
        await prisma.$transaction(async (tx) => {
          for (const t of transactions) {
            const contaDebito = String(t.contaDebito || "").trim();
            const contaCredito = String(t.contaCredito || "").trim();
            const valor = Number(t.valor);
            const descricao = String(t.descricao || "").trim();
            const dataStr = String(t.data || "").slice(0, 10);
            // Importa com ≥1 conta preenchida; só pula quando D E C estão vazias (a outra aprende depois).
            if ((!contaDebito && !contaCredito) || !descricao || !valor || !dataStr) {
              failed.push({ rowIndex: t.rowIndex, reason: "campos_obrigatorios" });
              continue;
            }
            const dataDate = new Date(`${dataStr}T00:00:00.000Z`);
            if (Number.isNaN(dataDate.getTime())) {
              failed.push({ rowIndex: t.rowIndex, reason: "data_invalida" });
              continue;
            }
            const competencia = `${dataDate.getUTCFullYear()}-${String(dataDate.getUTCMonth() + 1).padStart(2, "0")}`;
            const tipo = String(t.tipo || "DESPESA").toUpperCase();

            const entry = await tx.accountingEntry.create({
              data: {
                portalClientId,
                data: dataDate,
                competencia,
                historico: descricao,
                tipo,
                origem: "EXCEL",
                loteImportacao,
                status: "RASCUNHO",
                statusPagamento: "NA",
              },
            });
            await tx.accountingEntryLine.createMany({
              data: [
                { entryId: entry.id, conta: contaDebito, tipo: "D", valor, ordem: 0 },
                { entryId: entry.id, conta: contaCredito, tipo: "C", valor, ordem: 1 },
              ],
            });
            created.push({ rowIndex: t.rowIndex, entryId: entry.id });
          }
        });
      } catch (err) {
        log.error({ err }, "Erro ao importar Excel (commit)");
        return res.status(500).json({ error: "internal_error", message: err?.message });
      }

      // Auto-save de histórico (fora da transaction principal — cada falha não derruba o batch)
      if (userId) {
        for (const t of transactions) {
          const contaDebito = String(t.contaDebito || "").trim();
          const contaCredito = String(t.contaCredito || "").trim();
          const descricao = String(t.descricao || "").trim();
          if (!descricao || !contaDebito || !contaCredito) continue;
          await upsertHistoricoFromImport({
            userId, portalClientId, text: descricao, contaDebito, contaCredito,
          });
        }
      }

      return res.status(201).json({
        ok: true,
        created: created.length,
        failed: failed.length,
        loteImportacao,
        details: { created, failed },
      });
    }
  );

  // ─── Q6: Funções de Lançamento ──────────────────────────────────────────

  // GET /firm/companies/:companyId/accounting-functions  → lista GLOBAL + da empresa
  router.get("/accounting-functions", requireFirmCompanyAccess(), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    try {
      const { listAccountingFunctionsForCompany } = await import("../../application/accounting/AccountingFunctionService.js");
      const funcs = await listAccountingFunctionsForCompany(portalClientId);
      return res.json({ ok: true, data: funcs });
    } catch (err) {
      log.error({ err }, "Falha ao listar funções de lançamento");
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  // POST /firm/companies/:companyId/accounting-functions  → cria função
  router.post("/accounting-functions", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const userId = req.auth?.user?.id;
    try {
      const { createAccountingFunction } = await import("../../application/accounting/AccountingFunctionService.js");
      const func = await createAccountingFunction({ portalClientId, userId, payload: req.body || {} });
      return res.status(201).json({ ok: true, data: func });
    } catch (err) {
      const code = err?.message || "internal_error";
      const status = code === "name_required" || code === "entries_required" ? 400 : 500;
      if (status === 500) log.error({ err }, "Falha ao criar função");
      return res.status(status).json({ ok: false, error: code });
    }
  });

  // PUT /firm/companies/:companyId/accounting-functions/:functionId  → atualiza (bloqueia isSystem)
  router.put("/accounting-functions/:functionId", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const functionId = String(req.params.functionId);
    try {
      const { updateAccountingFunction } = await import("../../application/accounting/AccountingFunctionService.js");
      const func = await updateAccountingFunction({ portalClientId, functionId, payload: req.body || {} });
      return res.json({ ok: true, data: func });
    } catch (err) {
      const code = err?.message || "internal_error";
      const map = {
        function_not_found: 404,
        system_function_immutable: 403,
        function_scope_mismatch: 403,
      };
      const status = map[code] || 500;
      if (status === 500) log.error({ err }, "Falha ao atualizar função");
      return res.status(status).json({ ok: false, error: code });
    }
  });

  // DELETE /firm/companies/:companyId/accounting-functions/:functionId
  router.delete("/accounting-functions/:functionId", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const functionId = String(req.params.functionId);
    try {
      const { deleteAccountingFunction } = await import("../../application/accounting/AccountingFunctionService.js");
      await deleteAccountingFunction({ portalClientId, functionId });
      return res.json({ ok: true });
    } catch (err) {
      const code = err?.message || "internal_error";
      const map = {
        function_not_found: 404,
        system_function_immutable: 403,
        function_scope_mismatch: 403,
      };
      const status = map[code] || 500;
      if (status === 500) log.error({ err }, "Falha ao excluir função");
      return res.status(status).json({ ok: false, error: code });
    }
  });

  // POST /firm/companies/:companyId/accounting-functions/:functionId/apply
  // body: { competencia, entryValores: [{ functionEntryId, valor, data? }] }
  router.post("/accounting-functions/:functionId/apply", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const functionId = String(req.params.functionId);
    const { competencia, entryValores } = req.body || {};
    try {
      const { applyAccountingFunction } = await import("../../application/accounting/AccountingFunctionService.js");
      const result = await applyAccountingFunction({ portalClientId, functionId, competencia, entryValores });
      return res.status(201).json(result);
    } catch (err) {
      const code = err?.message || "internal_error";
      const map = {
        competencia_required: 400,
        function_not_found: 404,
        function_scope_mismatch: 403,
        company_not_found: 404,
      };
      const status = map[code] || 500;
      if (status === 500) log.error({ err }, "Falha ao aplicar função");
      return res.status(status).json({ ok: false, error: code });
    }
  });

  // ─── Q9: Parcelamentos ──────────────────────────────────────────────────

  // GET /firm/companies/:companyId/parcelamentos[?status=ATIVO|QUITADO|RESCINDIDO]
  router.get("/parcelamentos", requireFirmCompanyAccess(), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const status = req.query?.status ? String(req.query.status).toUpperCase() : null;
    try {
      const { listParcelamentos } = await import("../../application/accounting/ParcelamentoService.js");
      const data = await listParcelamentos({ portalClientId, status });
      return res.json({ ok: true, data });
    } catch (err) {
      log.error({ err }, "Falha ao listar parcelamentos");
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  // GET /firm/companies/:companyId/parcelamentos/:parcId
  router.get("/parcelamentos/:parcId", requireFirmCompanyAccess(), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const parcelamentoId = String(req.params.parcId);
    try {
      const { getParcelamento } = await import("../../application/accounting/ParcelamentoService.js");
      const data = await getParcelamento({ portalClientId, parcelamentoId });
      if (!data) return res.status(404).json({ ok: false, error: "parcelamento_not_found" });
      return res.json({ ok: true, data });
    } catch (err) {
      log.error({ err }, "Falha ao obter parcelamento");
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  // POST /firm/companies/:companyId/parcelamentos
  // body: { label, kind, templateOpeningFunctionId, templatePaymentFunctionId, templateRescisionFunctionId,
  //         numEntradas, numParcelas, principalPerParcela, principalTotal, jurosTotal,
  //         dataAbertura, competenciaInicial, diaPagamento, periodosReferenciados,
  //         sourceGuideId, linkGuideAsParcelaNum }
  router.post("/parcelamentos", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const userId = req.auth?.user?.id;
    try {
      const { createParcelamento } = await import("../../application/accounting/ParcelamentoService.js");
      const data = await createParcelamento({ ...req.body, portalClientId, userId });
      return res.status(201).json({ ok: true, data });
    } catch (err) {
      const code = err?.message || "internal_error";
      const knownErrors = [
        "portal_client_id_required", "label_required", "kind_required",
        "num_parcelas_invalid", "competencia_inicial_invalid", "principal_per_parcela_invalid",
        "company_not_found",
      ];
      const status = knownErrors.includes(code) ? 400 : 500;
      if (status === 500) log.error({ err }, "Falha ao criar parcelamento");
      return res.status(status).json({ ok: false, error: code });
    }
  });

  // Q23 — GET /firm/companies/:companyId/parcelamentos/contas-provisao?tipo=PARCSN
  // Devolve as contas memorizadas (MapaContaTributo) das linhas-padrão da provisão pra pré-preencher
  // o modal: { PARC_DAS, MULTA, JUROS, TOTAL } (string vazia quando ainda não aprendida).
  router.get("/parcelamentos/contas-provisao", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const tipoParcelamento = String(req.query.tipo || "").trim().toUpperCase();
    if (!tipoParcelamento) return res.status(400).json({ ok: false, error: "tipo_required" });
    try {
      const { resolverContasProvisao } = await import("../../application/accounting/parcelamento/ParcelamentoV2Service.js");
      const contas = await resolverContasProvisao({ portalClientId, tipoParcelamento });
      return res.json({ ok: true, contas });
    } catch (err) {
      log.error({ err }, "Falha ao resolver contas de provisão");
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  // Q28 Fase 1 — POST /firm/companies/:companyId/parcelamentos/consultar-serpro
  // Consulta um parcelamento no SERPRO por CÓDIGO (OBTERPARC164) para pré-preencher o modal de entrada.
  // body: { tipo, numeroParcelamento }. Atrás da flag INTEGRACAO_SERPRO_PARCELAMENTO (devolve 400 claro
  // enquanto desligada / não validada no sandbox). Não cria nada — só consulta e devolve o consolidado.
  router.post("/parcelamentos/consultar-serpro", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const tipo = String(req.body?.tipo || "").trim().toUpperCase();
    const numeroParcelamento = String(req.body?.numeroParcelamento || "").trim();
    if (!tipo) return res.status(400).json({ ok: false, error: "tipo_required" });
    if (!numeroParcelamento) return res.status(400).json({ ok: false, error: "numero_parcelamento_required" });
    try {
      const company = await prisma.portalClient.findUnique({ where: { id: portalClientId }, select: { cnpj: true } });
      if (!company) return res.status(404).json({ ok: false, error: "company_not_found" });
      const { getResolvedSerproCredentials } = await import("../../application/fiscal/serpro/SerproRuntimeSettings.js");
      const { SerproParcelamentoService } = await import("../../application/fiscal/serpro/SerproParcelamentoService.js");
      const runtime = await getResolvedSerproCredentials();
      const contratanteCnpj = String(runtime?.certificate?.document || "").replace(/\D+/g, "");
      const contribuinteCnpj = String(company.cnpj || "").replace(/\D+/g, "");
      const serpro = new SerproParcelamentoService({ log });
      const { dto } = await serpro.consultarParcelamento({ contratanteCnpj, contribuinteCnpj, tipo, numeroParcelamento });
      return res.json({ ok: true, parcelamento: dto });
    } catch (err) {
      const code = err?.code || "internal_error";
      if (code === "SERPRO_PARC_FLAG_OFF") {
        return res.status(400).json({ ok: false, error: code, message: "Integração SERPRO de parcelamento está desligada — ative após validar no sandbox para buscar por código." });
      }
      if (code === "SERPRO_PARC_MAP_NOT_CONFIGURED" || code === "SERPRO_PARC_COMPOSICAO_INVALIDA") {
        return res.status(400).json({ ok: false, error: code, message: err.message });
      }
      log.error({ err: err?.message || err, code }, "Falha ao consultar parcelamento no SERPRO");
      return res.status(502).json({ ok: false, error: code, message: err?.message });
    }
  });

  // Q28 Fase 2 — GET/PUT da CONFIG de lançamento (provisão + pagamento) de um parcelamento.
  // Acessível pela Circular/aba Guias pra ver/editar as contas por papel.
  router.get("/parcelamentos/:parcId/config", requireFirmCompanyAccess(), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const parcId = String(req.params.parcId);
    try {
      const p = await prisma.parcelamento.findFirst({
        where: { id: parcId, portalClientId },
        select: { id: true, label: true, tipo: true, configProvisao: true, configPagamento: true, observacoes: true },
      });
      if (!p) return res.status(404).json({ ok: false, error: "parcelamento_not_found" });
      return res.json({ ok: true, parcelamento: p });
    } catch (err) {
      log.error({ err }, "Falha ao ler config do parcelamento");
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });
  router.put("/parcelamentos/:parcId/config", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const parcId = String(req.params.parcId);
    const { configProvisao, configPagamento, observacoes } = req.body || {};
    const norm = (lines) => (Array.isArray(lines)
      ? lines
        .filter((l) => l && (l.tipoLinha || String(l.conta || "").trim()))
        .map((l) => ({ tipoLinha: String(l.tipoLinha || ""), tipo: String(l.tipo).toUpperCase() === "C" ? "C" : "D", conta: String(l.conta || "").trim() }))
      : null);
    try {
      const found = await prisma.parcelamento.findFirst({ where: { id: parcId, portalClientId }, select: { id: true } });
      if (!found) return res.status(404).json({ ok: false, error: "parcelamento_not_found" });
      const updated = await prisma.parcelamento.update({
        where: { id: parcId },
        data: {
          configProvisao: norm(configProvisao),
          configPagamento: norm(configPagamento),
          ...(observacoes !== undefined ? { observacoes: observacoes ? String(observacoes) : null } : {}),
        },
        select: { id: true, configProvisao: true, configPagamento: true, observacoes: true },
      });
      return res.json({ ok: true, parcelamento: updated });
    } catch (err) {
      log.error({ err }, "Falha ao salvar config do parcelamento");
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  // Q28 Fase 3 — Fila de conferência das parcelas (PAGA_A_CONFERIR + DIVERGENTE).
  router.get("/parcelas/conferencia", requireFirmCompanyAccess(), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    try {
      const { listarConferenciaParcelas } = await import("../../application/accounting/parcelamento/ParcelamentoV2Service.js");
      const items = await listarConferenciaParcelas({ portalClientId });
      return res.json({ ok: true, items });
    } catch (err) {
      log.error({ err }, "Falha ao listar conferência de parcelas");
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });
  // POST .../parcelas/conferencia/aprovar — body { guideIds: [...] } → CONFIRMADA + lançamentos CONFIRMADO.
  router.post("/parcelas/conferencia/aprovar", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const { guideIds } = req.body || {};
    try {
      const { aprovarConferenciaParcelas } = await import("../../application/accounting/parcelamento/ParcelamentoV2Service.js");
      const r = await aprovarConferenciaParcelas({ portalClientId, guideIds });
      return res.json({ ok: true, ...r });
    } catch (err) {
      log.error({ err }, "Falha ao aprovar conferência de parcelas");
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  // Q21 (spec v2) — POST /firm/companies/:companyId/parcelamentos/ingestao
  // Sobe uma guia MANUAL como parcela de parcelamento → cria/anexa parcelamento +
  // PROVISÃO (1ª vez) + PAGAMENTO por composição (juros LIDO). body:
  //   { guideId, header: { tipo, numeroParcelamento, quantidadeParcelas, numeroParcela,
  //                        valorPrincipal, valorMulta, valorJuros, valorTotal, dataAdesao,
  //                        anoMesParcela?, vencimento? }, tributos?: [{codigoTributo,principal,multa,juros,total}] }
  // Se `tributos` ausente, usa a composição já extraída do PDF (guide.extracted.composicao).
  router.post("/parcelamentos/ingestao", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const userId = req.auth?.user?.id;
    const { guideId, header, tributos, provisaoLines, pagamentoLines } = req.body || {};
    // Q28: guideId é OPCIONAL — caminho SERPRO cria o parcelamento sem guia (o worker traz as guias).
    if (!header?.tipo) return res.status(400).json({ ok: false, error: "tipo_required" });
    // Q23: nº do parcelamento é obrigatório (necessário pra busca automática do SERPRO).
    if (!String(header?.numeroParcelamento || "").trim()) {
      return res.status(400).json({ ok: false, error: "numero_parcelamento_required" });
    }
    try {
      let guide = null;
      if (guideId) {
        guide = await prisma.guide.findFirst({
          where: { id: String(guideId), portalClientId },
          select: { id: true, competencia: true, vencimento: true, valor: true, extracted: true },
        });
        if (!guide) return res.status(404).json({ ok: false, error: "guide_not_found" });
      }

      const { buildDTOsFromManual } = await import("../../application/accounting/parcelamento/entradaManual.js");
      const { ingestParcelamentoFromGuide } = await import("../../application/accounting/parcelamento/ParcelamentoV2Service.js");
      const { parcelamentoDTO, parcelaDTO } = buildDTOsFromManual({ guide, header, tributos });
      const data = await ingestParcelamentoFromGuide({ portalClientId, guideId: guide?.id || null, parcelamentoDTO, parcelaDTO, provisaoLines, pagamentoLines, descricao: header?.descricao, userId });
      return res.status(201).json({ ok: true, data });
    } catch (err) {
      const code = err?.code || "internal_error";
      if (code === "COMPOSICAO_INVALIDA") {
        return res.status(400).json({ ok: false, error: code, message: err.message });
      }
      log.error({ err }, "Falha na ingestão de parcelamento (v2)");
      return res.status(500).json({ ok: false, error: code });
    }
  });

  // POST /firm/companies/:companyId/parcelamentos/:parcId/link-guide
  // body: { guideId, numeroParcela }
  router.post("/parcelamentos/:parcId/link-guide", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const parcelamentoId = String(req.params.parcId);
    const { guideId, numeroParcela } = req.body || {};
    if (!guideId || !numeroParcela) {
      return res.status(400).json({ ok: false, error: "guideId_and_numeroParcela_required" });
    }
    try {
      const { linkGuideToParcela } = await import("../../application/accounting/ParcelamentoService.js");
      const data = await linkGuideToParcela({ portalClientId, guideId, parcelamentoId, numeroParcela: Number(numeroParcela) });
      return res.json({ ok: true, data });
    } catch (err) {
      const code = err?.message || "internal_error";
      const map = {
        parcelamento_not_found: 404,
        guide_not_found: 404,
        numero_parcela_out_of_range: 400,
      };
      const status = map[code] || 500;
      if (status === 500) log.error({ err }, "Falha ao linkar guia ao parcelamento");
      return res.status(status).json({ ok: false, error: code });
    }
  });

  // POST /firm/companies/:companyId/parcelamentos/:parcId/parcelas/:num/pagar
  // body: { jurosValor, dataPagamento? }
  router.post("/parcelamentos/:parcId/parcelas/:num/pagar", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const parcelamentoId = String(req.params.parcId);
    const numeroParcela = Number(req.params.num);
    const { jurosValor, dataPagamento } = req.body || {};
    const userId = req.auth?.user?.id;
    try {
      const { confirmParcelaPayment } = await import("../../application/accounting/ParcelamentoService.js");
      const data = await confirmParcelaPayment({
        portalClientId, parcelamentoId, numeroParcela,
        jurosValor: Number(jurosValor) || 0,
        dataPagamento, userId,
      });
      return res.status(201).json(data);
    } catch (err) {
      const code = err?.message || "internal_error";
      const map = {
        parcelamento_not_found: 404,
        parcelamento_not_active: 400,
        parcela_not_found: 404,
        parcela_already_paid: 400,
        payment_template_not_configured: 400,
      };
      const status = map[code] || 500;
      if (status === 500) log.error({ err }, "Falha ao confirmar pagamento de parcela");
      return res.status(status).json({ ok: false, error: code });
    }
  });

  // POST /firm/companies/:companyId/parcelamentos/:parcId/rescindir
  // body: { dataRescisao?, observacoes?, rescisaoLines? }
  // Parcelas com pagamento marcado mas SEM lançamento — alimenta o painel da aba Parcelamento.
  // A baixa da parcela saiu do "confirmar pagamento" e passou a ser ato deliberado aqui, no mesmo
  // lugar onde as parcelas são acompanhadas (espelha o que a Circular faz com os tributos).
  router.get("/parcelamentos/parcelas-pendentes-baixa", requireFirmCompanyAccess(), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    try {
      const guias = await prisma.guide.findMany({
        where: {
          portalClientId,
          parcelamentoId: { not: null },
          status: "PROCESSED",
          paymentStatus: "PAID",
          baixada: false,
          lancamentoId: null,
        },
        select: {
          id: true, tipo: true, competencia: true, valor: true, vencimento: true,
          parcelamentoId: true, extracted: true, paymentConfirmedAt: true,
        },
        orderBy: { competencia: "asc" },
        take: 100,
      });
      return res.json({
        ok: true,
        parcelas: guias.map((g) => ({
          guideId: g.id,
          competencia: g.competencia,
          valor: g.valor != null ? Number(g.valor) : null,
          vencimento: g.vencimento,
          parcelamentoId: g.parcelamentoId,
          confirmadoEm: g.paymentConfirmedAt,
          // Dados do comprovante (quando a busca no SERPRO já rodou) pra mostrar data/valores reais.
          comprovante: g.extracted && typeof g.extracted === "object" ? g.extracted.comprovante || null : null,
        })),
      });
    } catch (err) {
      log.error({ err }, "Falha ao listar parcelas pendentes de baixa");
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  // Lança a baixa de UMA parcela (a partir da guia). Mês fechado bloqueia — aqui SIM há lançamento.
  router.post("/parcelamentos/parcelas/:guideId/baixa", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const guideId = String(req.params.guideId);
    try {
      const { gerarPagamentoParcelaFromGuide } = await import(
        "../../application/accounting/parcelamento/ParcelamentoV2Service.js"
      );
      const out = await gerarPagamentoParcelaFromGuide({
        portalClientId, guideId, userId: req.auth?.user?.id,
      });
      return res.status(201).json({ ok: true, resultado: out });
    } catch (err) {
      if (err?.code === "MES_FECHADO") {
        return res.status(409).json({ ok: false, error: "MES_FECHADO", message: err.message });
      }
      log.error({ err: err?.message, guideId }, "Falha ao lançar baixa da parcela");
      return res.status(500).json({ ok: false, error: err?.code || "internal_error", message: err?.message });
    }
  });

  router.post("/parcelamentos/:parcId/rescindir", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const parcelamentoId = String(req.params.parcId);
    const userId = req.auth?.user?.id;
    try {
      const { rescindirParcelamento } = await import("../../application/accounting/ParcelamentoService.js");
      const data = await rescindirParcelamento({
        portalClientId, parcelamentoId,
        dataRescisao: req.body?.dataRescisao,
        observacoes: req.body?.observacoes,
        rescisaoLines: req.body?.rescisaoLines,
        userId,
      });
      return res.json(data);
    } catch (err) {
      const code = err?.message || "internal_error";
      const map = {
        parcelamento_not_found: 404,
        parcelamento_not_active: 400,
        rescision_template_not_configured: 400,
      };
      const status = map[code] || 500;
      if (status === 500) log.error({ err }, "Falha ao rescindir parcelamento");
      return res.status(status).json({ ok: false, error: code });
    }
  });

  // Q31 Parte D — vincula/desvincula uma provisão (competência aberta) a um parcelamento.
  // SÓ marca (seta parcelamentoId → célula amarela na Circular). NÃO altera as linhas do lançamento.
  // POST /firm/companies/:companyId/entries/:entryId/vincular-parcelamento  body: { parcelamentoId | null }
  router.post("/entries/:entryId/vincular-parcelamento", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const entryId = String(req.params.entryId);
    const parcelamentoId = req.body?.parcelamentoId ? String(req.body.parcelamentoId) : null;
    try {
      if (parcelamentoId) {
        const parc = await prisma.parcelamento.findFirst({ where: { id: parcelamentoId, portalClientId }, select: { id: true } });
        if (!parc) return res.status(404).json({ ok: false, error: "parcelamento_not_found" });
      }
      // Q31: INSS na Circular é sintético (synthetic-inss-<guideId>) — não há lançamento; roteia pela GUIA.
      if (entryId.startsWith("synthetic-inss-")) {
        const guideId = entryId.replace("synthetic-inss-", "");
        const guide = await prisma.guide.findFirst({ where: { id: guideId, portalClientId }, select: { id: true } });
        if (!guide) return res.status(404).json({ ok: false, error: "guide_not_found" });
        await prisma.guide.update({ where: { id: guideId }, data: { parcelamentoId } });
        return res.json({ ok: true, entryId, parcelamentoId });
      }
      const entry = await prisma.accountingEntry.findFirst({ where: { id: entryId, portalClientId }, select: { id: true, tipo: true } });
      if (!entry) return res.status(404).json({ ok: false, error: "entry_not_found" });
      if (entry.tipo !== "PROVISAO") return res.status(400).json({ ok: false, error: "entry_not_provisao" });
      // Só o vínculo — não toca em lines (decisão do dono: provisão permanece como está).
      await prisma.accountingEntry.update({ where: { id: entryId }, data: { parcelamentoId } });
      return res.json({ ok: true, entryId, parcelamentoId });
    } catch (err) {
      log.error({ err }, "Falha ao vincular provisão a parcelamento");
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  return router;
}
