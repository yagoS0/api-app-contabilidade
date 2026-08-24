import { Router } from "express";
import multer from "multer";
import { prisma } from "../../infrastructure/db/prisma.js";
import { requireFirmCompanyAccess } from "../../middlewares/requireFirmCompanyAccess.js";
import { generateEntriesFromCircular, resolveRule, applyTemplate, formatCompetenciaLabel, lookupAccountsFromHistorico } from "../../application/accounting/AccountingEntryGeneratorService.js";
import { syncPgdasByCompetencia } from "../../application/fiscal/serpro/SerproPgdasDeclaracaoService.js";
import { resolvePayrollTemplate } from "../../application/accounting/payrollTemplate.js";
import { PROVISAO_TO_BAIXA_EVENT } from "./accountingEntryRules.js";
import { importChartOfAccountsFromBuffer } from "../../application/accounting/chartOfAccountsImport.js";
import { rederivarAnaliticaDoEscopo } from "../../application/accounting/chartOfAccountsAnalitica.js";
// A TRAVA DA CONTA SINTÉTICA — regra pura; a ligação com o banco é `recusaContaSintetica`, abaixo.
import {
  ERRO_CONTA_SINTETICA, resolverPlanoPorCodigo, codigosDasLinhas,
  sinteticasIntroduzidas, filhasDiretas, mensagemRecusa,
} from "../../application/accounting/lib/gateContaSintetica.js";
import { isMonthClosed } from "../../application/accounting/fechamentoContabil.js";
import { CONTA_JUROS, CONTA_MULTA, CONTAS_ACRESCIMO } from "../../application/accounting/contasAcrescimo.js";
import { tipoLinhaDaBaixa } from "../../application/accounting/tipoLinhaBaixa.js";
import { verificarLancamento, verificarLote } from "../../application/accounting/regras/MotorRegras.js";
import { carregarPlano } from "../../application/accounting/AliquotaPorLancamentosService.js";
import { SITUACAO } from "../../application/accounting/regras/contratos.js";
import { marcarSemFaturamento } from "../../application/accounting/semFaturamento.js";
import { comContextoSerpro, podeForcarSerpro } from "../../application/fiscal/serpro/serproCallContext.js";
import { dataCivilBR } from "../../utils/dataCivil.js";
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
// Saldo da provisão — mesma conta usada pelo estorno (ver `saldoProvisao.js`).
import { computeSaldoProvisao } from "../../application/accounting/saldoProvisao.js";
// O DETECTOR de "o razão discorda da circular". Derivado na leitura, nunca coluna — ver
// `divergenciaDeFonte.js` para o motivo (a coluna `hasAccountingDivergence` é guarda MORTA).
import {
  divergenciasDeFonte,
  SELECT_CIRCULAR_PARA_DIVERGENCIA,
  EVENTOS_DERIVADOS_DA_CIRCULAR,
} from "../../application/accounting/divergenciaDeFonte.js";
// ESTORNO DA BAIXA: transição administrativa nomeada, com motivo obrigatório, auditoria e
// contra-lançamento quando a competência da baixa está fechada.
import {
  previewEstorno, executarEstorno, EstornoRecusado, MOTIVO_MIN,
} from "../../application/accounting/EstornoBaixaService.js";

// Q16/Q37: memória de contas por (empresa, eventType). Grava/atualiza AccountingHistorico para que o
// próximo lançamento do mesmo evento (provisão automática OU baixa) venha com D/C pré-preenchidos —
// "último preenchido permanece". Best-effort: nunca derruba a operação principal.
// Q50: a chave é o texto NORMALIZADO ({{competencia}} no lugar de MM/AAAA / AAAA-MM) — "DAS 05/2026"
// e "DAS 06/2026" são o MESMO histórico. Além da linha da empresa, mantém uma linha GLOBAL
// (companyPortalClientId null) que serve de fallback pra empresas novas; nela as contas só são
// preenchidas quando estão vazias (a linha da empresa é que manda no caso específico).
/**
 * O PAR D/C VIOLA a natureza contábil? Se violar, ELE NÃO É MEMORIZADO.
 *
 * ⚠⚠ ESTA É A METADE QUE IMPEDE O ERRO DE SE REPETIR SOZINHO. O defeito relatado pelo dono
 * (provisão de CSLL com `D 595 / C 137`, sendo `137` uma conta de ATIVO sob INCENTIVOS FISCAIS)
 * não foi digitado todo mês: ele foi **aprendido uma vez** e passou a ser oferecido pela memória a
 * cada nova provisão. Recusar a memorização é o que quebra o ciclo.
 *
 * ⚠ **O LANÇAMENTO É GRAVADO NORMALMENTE** — decisão do dono: *"avisa forte, não bloqueia"*. Quem
 * decide contabilidade é o contador. São dois atos diferentes e só um é recusado aqui.
 *
 * ⚠ **Resolve só AS DUAS CONTAS, nunca o plano inteiro.** Este caminho roda a cada gravação de
 * lançamento; `carregarPlano` traz ~1.200 linhas e seria desperdício. A precedência é a mesma —
 * **a conta da EMPRESA vence a GLOBAL**.
 *
 * ⚠ Só julga `PROVISAO` e `BAIXA`, e só com as DUAS pernas resolvidas. Qualquer outra coisa passa:
 * o motor não tem critério, e recusar por falta de critério apagaria memória legítima.
 */
async function parViolaNatureza({ portalClientId, tipo, eventType, contaDebito, contaCredito }) {
  const t = String(tipo || "").toUpperCase();
  if (t !== "PROVISAO" && t !== "BAIXA") return false;
  const codigos = [contaDebito, contaCredito].map((c) => String(c || "").trim()).filter(Boolean);
  if (codigos.length < 2) return false;
  try {
    const contas = await prisma.chartOfAccount.findMany({
      where: {
        codigo: { in: codigos },
        OR: [{ portalClientId: String(portalClientId) }, { portalClientId: null }],
      },
      select: { portalClientId: true, codigo: true, nome: true, codigoCompleto: true },
    });
    const mapa = new Map();
    // ⚠ GLOBAIS primeiro, EMPRESA sobrescreve — a ordem do `findMany` não é garantida, então a
    // precedência não pode depender dela. Mesma disciplina de `carregarPlano`.
    for (const c of contas) if (c.portalClientId === null) mapa.set(String(c.codigo), c);
    for (const c of contas) if (c.portalClientId !== null) mapa.set(String(c.codigo), c);

    const r = verificarLancamento({
      lancamento: {
        tipo: t,
        eventType: eventType || null,
        lines: [
          { conta: String(contaDebito).trim(), tipo: "D", valor: 1 },
          { conta: String(contaCredito).trim(), tipo: "C", valor: 1 },
        ],
      },
      resolverConta: (cod) => mapa.get(String(cod)) || null,
      empresaId: String(portalClientId),
    });
    if (r.situacao !== SITUACAO.VIOLA) return false;
    log.warn(
      { portalClientId, eventType, contaDebito, contaCredito, achados: r.achados.map((a) => a.regraId) },
      "memoria de conta NAO gravada: o par viola a natureza contabil"
    );
    return true;
  } catch {
    // ⚠ FALHA ABERTO. Se a conferência não puder ser feita (plano indisponível, coluna nova), a
    // memória é gravada como sempre foi. Uma guarda que apaga memória por falha PRÓPRIA seria pior
    // que a ausência dela.
    return false;
  }
}

async function memorizeAccountHistorico({ userId, portalClientId, text, contaDebito, contaCredito, eventType, tipo = null }) {
  if (!userId || !portalClientId || !text) return;
  // (sem guard de contas: histórico só-texto também vale — alimenta o autocomplete; o POST /entries
  // sempre salvou assim.)
  const textNorm = normalizarHistorico(text);
  if (!textNorm) return;
  if (await parViolaNatureza({ portalClientId, tipo, eventType, contaDebito, contaCredito })) return;
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
// `computeSaldoProvisao`/`principalAbatidoDaBaixa` MORAVAM AQUI e foram para
// `application/accounting/saldoProvisao.js` — o ESTORNO precisa da mesma conta (o contra-lançamento
// de mês fechado tem de SUBTRAIR do abatido), e duas cópias fariam a tela de baixa e o estorno
// discordarem sobre quanto a empresa ainda deve.
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
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
/**
 * "dd/mm/aaaa" → `Date` (meio-dia local). Qualquer outra coisa vira `null`.
 *
 * ⚠ EXISTE PORQUE O DADO ESTÁ GRAVADO NO FORMATO BR dentro do JSON `extracted.comprovante`, e a
 * mesma chave é `Date` em outros pontos do código. `new Date("07/08/2026")` lê como 7 de AGOSTO
 * (formato americano) — e esse erro viraria data de lançamento contábil, em silêncio.
 * Meio-dia para não escorregar de dia por fuso.
 */
function dataBrParaDate(valor) {
  const m = String(valor || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const [, dia, mes, ano] = m;
  const d = new Date(Number(ano), Number(mes) - 1, Number(dia), 12, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d;
}

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

/**
 * A TRAVA DA CONTA SINTÉTICA — a ligação com o banco; a regra é pura, em `lib/gateContaSintetica.js`.
 *
 * ⚠ POR QUE ELA EXISTE NO SERVIDOR, se a tela já avisa: tela não é guarda. E o motivo de ter virado
 * RECUSA (era aviso) é externo — o registro I250 da ECD exige `IND_CTA = "A"`, então lançamento em
 * conta de agregação não é uma escolha do escritório: é um arquivo que o PGE do Sped Contábil
 * recusa na entrega. Permitir seria adiar a falha para o pior momento possível.
 *
 * ⚠ FICA NA ROTA, não dentro do serviço — mesmo critério do `contasInexistentes` e do `MES_FECHADO`:
 * a captura do SERPRO, os workers e os templates resolvem conta sozinhos e não podem ser derrubados
 * no meio de uma sincronia por um plano de contas ainda não reimportado.
 *
 * ⚠ `codigosAtuais` É O QUE MANTÉM A CORREÇÃO POSSÍVEL. Na EDIÇÃO só se recusa o que o payload
 * ACRESCENTA; a sintética que já estava gravada não bloqueia o `UPDATE` — senão os 6 lançamentos
 * que já existem em conta de agregação ficariam presos justamente no caminho que existe para
 * movê-los para a analítica certa. Ver `lib/gateContaSintetica.js`.
 *
 * @returns {Promise<null|object>} `null` quando passa; o corpo do 400 quando recusa.
 */
async function recusaContaSintetica(prisma, portalClientId, lines, { codigosAtuais = [] } = {}) {
  const codigos = codigosDasLinhas(lines);
  if (!codigos.length) return null;
  const contas = await prisma.chartOfAccount.findMany({
    where: { codigo: { in: codigos }, OR: [{ portalClientId }, { portalClientId: null }] },
    select: { codigo: true, nome: true, analitica: true, portalClientId: true, codigoCompleto: true },
  });
  const plano = resolverPlanoPorCodigo(contas);
  // ⚠ `=== false`, nunca `!analitica`: conta sem `codigoCompleto` sai `null` (não se sabe), e
  // recusar no desconhecido travaria todo plano ainda não reimportado.
  const achadas = sinteticasIntroduzidas(lines, codigosAtuais, plano);
  if (!achadas.length) return null;

  // As candidatas só são buscadas no caminho da RECUSA (raro), e existem para que a mensagem diga
  // o que fazer. ⚠ O escopo é o da própria conta — global com global, empresa com a própria.
  const candidatas = {};
  for (const achada of achadas) {
    const conta = plano.get(achada.codigo);
    if (!conta?.codigoCompleto) continue;
    const doEscopo = await prisma.chartOfAccount.findMany({
      where: {
        portalClientId: conta.portalClientId ?? null,
        codigoCompleto: { startsWith: conta.codigoCompleto },
      },
      select: { codigo: true, nome: true, codigoCompleto: true, analitica: true },
    });
    candidatas[achada.codigo] = filhasDiretas(conta, doEscopo)
      .map((f) => ({ codigo: f.codigo, nome: f.nome, codigoCompleto: f.codigoCompleto, analitica: f.analitica }));
  }

  return {
    error: ERRO_CONTA_SINTETICA,
    contas: achadas.map((a) => a.codigo),
    sinteticas: achadas,
    candidatas,
    message: mensagemRecusa(achadas),
  };
}

/**
 * O conjunto de códigos SINTÉTICOS usados num lote de importação (OFX/Excel) — **uma query só**.
 *
 * ⚠ POR QUE O IMPORT TAMBÉM É GUARDADO, e não só a tela de lançar: dos 6 lançamentos que hoje estão
 * em conta de agregação, **4 vieram do import de Excel** (`origem: "EXCEL"`). Travar só o `POST
 * /entries` deixaria aberta exatamente a porta por onde a maioria deles entrou.
 *
 * ⚠ A RECUSA AQUI É POR LINHA, não do lote: cada import já devolve `failed[]` com o motivo, e
 * derrubar 200 linhas boas por causa de 2 erradas seria trocar um defeito por outro.
 */
async function sinteticasDoLote(prisma, portalClientId, linhas) {
  const codigos = codigosDasLinhas(linhas);
  if (!codigos.length) return new Set();
  const contas = await prisma.chartOfAccount.findMany({
    where: { codigo: { in: codigos }, OR: [{ portalClientId }, { portalClientId: null }] },
    select: { codigo: true, nome: true, analitica: true, portalClientId: true },
  });
  const plano = resolverPlanoPorCodigo(contas);
  // ⚠ `=== false`, nunca `!analitica`: `null` (conta ainda não reimportada) nunca recusa.
  return new Set(codigos.filter((c) => plano.get(c)?.analitica === false));
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

  // ⚠ A DATA É CIVIL, NÃO É INSTANTE — e converter para o fuso do servidor tirava um dia de TODO
  // lançamento exportado.
  //
  // `AccountingEntry.data` é gravada como MEIA-NOITE UTC (`2026-05-12T00:00:00.000Z`): ela
  // representa o DIA do lançamento, não um momento. O código antigo fazia
  // `new Date(e.data).toLocaleDateString("pt-BR")`, **sem `timeZone`** — e `toLocaleDateString` usa
  // o fuso do PROCESSO. Em produção `TZ=America/Sao_Paulo`, então meia-noite UTC vira 21h do dia
  // ANTERIOR e o CSV imprimia **11/05** para o lançamento do dia **12/05**.
  //
  // Medido em 13/08/2026, relatado pelo dono ("na minha tabela não tem 26/5 nem 11/5, mas o export
  // tem"): os 621 lançamentos da base saíam com a data um dia antes, e **15 deles mudavam de MÊS**
  // (os gravados no dia 1º viravam o último dia do mês anterior). Como este CSV é consumido por
  // sistema contábil externo, isso não é cosmético: é lançamento entrando na competência errada.
  //
  // ⚠ A TABELA SEMPRE ESTEVE CERTA — ela usa `String(entry.data).slice(0, 10)`
  // (`renderAccountingEntriesParts.jsx`), que fatia a ISO sem converter fuso nenhum. Quem divergia
  // era o export. A regra vive em `utils/dataCivil.js` porque este NÃO é o único lugar: o e-mail
  // de guia ao cliente tinha o mesmo defeito com `Guide.vencimento`.
  for (const e of entries) {
    const data = dataCivilBR(e.data);
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

// O ENVIO DA GUIA, como a Circular precisa lê-lo — UM select, três consultas.
//
// A pergunta "esta guia foi enviada?" é respondida por `envios_guia` (um registro por guia × canal),
// com `emailStatus` valendo só como tolerância do legado — ver `guides/EnvioGuiaService.js`. As três
// consultas que alimentam a matriz (as provisões, as guias de INSS e as de SIMPLES) precisam da
// MESMA forma: se uma delas trouxer menos campos, a linha dela mostra menos no popover que a de
// cima, e a diferença não aparece em lugar nenhum a não ser na tela do contador.
const SELECT_ENVIO_DA_GUIA = Object.freeze({
  canal: true, status: true, destino: true, enviadoEm: true, entregueEm: true, lidoEm: true,
});

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
    // A "conta mãe": o código COMPLETO do ERP. Opcional — sem ele a conta nasce sem resposta sobre
    // sintética × analítica, que é a verdade.
    const codigoCompleto = String(body.codigoCompleto || "").trim() || null;

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
          codigoCompleto,
          status: "PENDENTE_ERP",
        },
      });
      // ⚠ A derivação é do ESCOPO, não da linha — e o escopo aqui é o plano PRÓPRIO desta empresa.
      if (codigoCompleto) await rederivarAnaliticaDoEscopo(portalClientId);
      return res.status(201).json({ ok: true, account: await prisma.chartOfAccount.findUnique({ where: { id: account.id } }) });
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
    // ⚠ `codigo` NÃO é editável por aqui, e nunca foi: `AccountingEntryLine.conta` aponta para ele
    // em texto, sem FK. `codigoCompleto` é o que se edita — a conta mãe, para análise.
    if (body.codigoCompleto !== undefined) data.codigoCompleto = String(body.codigoCompleto).trim() || null;
    if (body.status !== undefined && ["CONFIRMADA", "PENDENTE_ERP"].includes(String(body.status))) {
      data.status = String(body.status);
    }

    const updated = await prisma.chartOfAccount.update({
      where: { portalClientId_codigo: { portalClientId, codigo } },
      data,
    });
    if (data.codigoCompleto !== undefined) await rederivarAnaliticaDoEscopo(portalClientId);
    return res.json({
      ok: true,
      account: await prisma.chartOfAccount.findUnique({ where: { portalClientId_codigo: { portalClientId, codigo } } }) || updated,
    });
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
    // Excluir a ÚLTIMA filha devolve a mãe à condição de analítica — a derivação é do escopo.
    if (existing.codigoCompleto) await rederivarAnaliticaDoEscopo(portalClientId);
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
          // ⚠ AS BAIXAS VÊM COM AS LINHAS, E O LOTE VEM INTEIRO — as duas coisas por motivos
          // diferentes, e as duas quebradas pelo mesmo `select: { id: true }, take: 1` que estava
          // aqui. Esta era a ÚNICA das cinco queries de provisão do arquivo que não pedia
          // `include: { lines }` (as outras: `/entries/provisoes`, e as três da baixa/estorno).
          //
          //   1. `entryToResponse` → `computeSaldoProvisao` calcula o ABATIDO somando os débitos
          //      não-acréscimo DAS LINHAS de cada baixa. Sem `lines`, o abatido dá SEMPRE ZERO e o
          //      saldo sai pelo valor CHEIO: um IRPJ de R$ 3.000 com a 1ª quota de R$ 1.000 já paga
          //      ficava "Parcial" (azul) com o popover afirmando "Saldo a pagar R$ 3.000,00", e o
          //      "Total em aberto" do mês somava os R$ 3.000 inteiros. Sem `tipo`, o contra-
          //      lançamento de ESTORNO também deixava de ser reconhecido (`computeSaldoProvisao`
          //      separa por `tipo`) e voltava a ser contado como amortização.
          //   2. UMA GUIA TEM ATÉ TRÊS BAIXAS — principal, juros e multa são lançamentos separados
          //      (regra do dono) — e "↩ Desfazer baixa" leva o LOTE. Com `take: 1` a tela recebia
          //      uma de três: o mesmo estrago que o `Map` por `sourceGuideId` logo abaixo já teve
          //      de desmontar (lançamentos órfãos com a provisão reaberta).
          //
          // Regressão: `__tests__/circularSaldoProvisaoParcial.test.js`.
          baixas: { include: { lines: { orderBy: { ordem: "asc" } } } },
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
              envios: { select: SELECT_ENVIO_DA_GUIA },
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
          // Envio ao cliente, para a linha "Enviada ao cliente" do popover da célula. A provisão do
          // INSS é SINTÉTICA — não há lançamento contábil para ela, então o `include` das provisões
          // não a alcança e é aqui que estes dois campos têm de ser carregados. Sem eles a linha do
          // INSS afirmava "ainda não enviada" para guia já entregue.
          emailStatus: true,
          envios: { select: SELECT_ENVIO_DA_GUIA },
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
          // Envio ao cliente, para a linha "Enviada ao cliente" do popover da célula. Esta guia
          // SUBSTITUI o `sourceGuide` da provisão de DAS (`enrichDasProvisao`) e alimenta a linha
          // sintética do DAS por upload — o que não for carregado aqui não chega à tela por
          // caminho nenhum.
          emailStatus: true,
          envios: { select: SELECT_ENVIO_DA_GUIA },
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
        // sourceGuide: dados do pagamento p/ o selo ✅ (data/origem/comprovante) — E o vencimento e
        // o estado do envio, que o `include` lá em cima carrega COM comentário dizendo para que
        // servem.
        //
        // ⚠ ESTE OBJETO SUBSTITUI o `entry.sourceGuide`, não o completa. Enquanto ele saía com
        // cinco campos, a linha do DAS perdia os três — e o efeito não era um campo em branco: era
        // o popover AFIRMANDO "Enviada ao cliente: ainda não" sobre guia já entregue, a linha
        // "Vencimento" sumindo, e o valor caindo no balde `semData` (que subdimensiona o "Total
        // vencido" do mês). DARF/PIS/COFINS não passam por aqui e nunca tiveram o problema.
        //
        // ⚠ Se algum destes campos deixar de ser carregado no `select` da guia, o conserto é
        // carregá-lo — NÃO emitir o objeto pela metade. Afirmação falsa é pior que silêncio.
        sourceGuide: guide
          ? {
              id: guide.id,
              paymentStatus: guide.paymentStatus,
              paymentStatusSource: guide.paymentStatusSource,
              paymentConfirmedAt: guide.paymentConfirmedAt,
              comprovantePdfFileId: guide.comprovantePdfFileId,
              vencimento: guide.vencimento,
              emailStatus: guide.emailStatus,
              envios: guide.envios || [],
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
        // Q41: dados do pagamento confirmado pelo SERPRO (selo verde na célula) — mais o vencimento
        // e o estado do envio, os MESMOS três campos que a provisão real de DARF/PIS/COFINS já
        // entregava. Esta linha é sintética: não existe `include` que a alcance, então tudo o que a
        // tela lê dela sai daqui. Sem os três, a linha do INSS afirmava "ainda não enviada" para
        // guia entregue, ficava sem vencimento e caía no balde `semData` do rodapé.
        sourceGuide: {
          id: g.id,
          paymentStatus: g.paymentStatus,
          paymentStatusSource: g.paymentStatusSource,
          paymentConfirmedAt: g.paymentConfirmedAt,
          serproLastCheckResult: g.serproLastCheckResult,
          comprovantePdfFileId: g.comprovantePdfFileId,
          vencimento: g.vencimento,
          emailStatus: g.emailStatus,
          envios: g.envios || [],
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
          // Mesma linha da provisão sintética do INSS, e pelo mesmo motivo: nada de `include`
          // alcança esta linha, então vencimento e estado do envio saem daqui ou não saem.
          sourceGuide: {
            id: g.id,
            paymentStatus: g.paymentStatus,
            paymentStatusSource: g.paymentStatusSource,
            paymentConfirmedAt: g.paymentConfirmedAt,
            comprovantePdfFileId: g.comprovantePdfFileId,
            vencimento: g.vencimento,
            emailStatus: g.emailStatus,
            envios: g.envios || [],
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
          ...SELECT_CIRCULAR_PARA_DIVERGENCIA,
          ...CHECKLIST_SELECT,
        },
      });
      const validation = await validateFechamentoContabil(prisma, { portalClientId, competencia });
      // ⚠ O DETECTOR: o razão ainda bate com a circular? Deriva na LEITURA, não lê coluna — as
      // divergências vivas hoje foram gravadas por sincronias que já passaram, e uma coluna só é
      // reescrita quando a sincronia volta a rodar. Ver `divergenciaDeFonte.js`.
      //
      // ⚠ NÃO BLOQUEIA o fechamento, e isso é decisão, não esquecimento: corrigir valor de
      // lançamento é ato contábil do dono, e um bloqueio prenderia hoje 12 competências em 5
      // empresas — inclusive as que já estão fechadas — sem oferecer a saída. O aviso aparece
      // ANTES do clique, do mesmo jeito que `conferenciaAdn` faz para o "sem faturamento".
      const divergenciasFonte = await prisma.accountingEntry.findMany({
        where: { portalClientId, competencia, origem: "SERPRO", eventType: { in: EVENTOS_DERIVADOS_DA_CIRCULAR } },
        select: { id: true, eventType: true, origem: true, historico: true, lines: { select: { tipo: true, valor: true } } },
      })
        .then((entries) => divergenciasDeFonte(circular, entries))
        .catch(() => []);
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
        // ⚠ AVISA, NÃO BLOQUEIA — `podeFechar` acima não o consulta de propósito. Ver o comentário
        // na montagem, mais acima, e `divergenciaDeFonte.js`.
        divergenciasFonte,
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

  /**
   * A PRÉ-VERIFICAÇÃO DOS LANÇAMENTOS — "as provisões estão nas contas certas?"
   *
   * > Dono, 24/08/2026: *"quando eu vá importar ao meu sistema contábil eu não importe nas contas
   * > erradas, ou seja é uma pré-verificação de lançamentos."*
   *
   * ⚠ **SÓ LEITURA.** Não escreve, não corrige, não chama serviço externo. A regra vive em
   * `application/accounting/regras/` e é a MESMA do diagnóstico
   * (`scripts/diag-verificacao-lancamentos.mjs`) — duas leituras da mesma pergunta divergiriam na
   * primeira correção, que é literalmente o defeito que este motor existe para pegar.
   *
   * ⚠⚠ **`porRegra` É O PRODUTO, não `porLancamento`.** O contador não quer 200 linhas: quer
   * *"6 provisões de IRPJ/CSLL debitando o ramo 5"* e corrigir as seis de uma vez. `porLancamento`
   * existe para a tela conseguir marcar a linha; quem se lê é o agrupamento.
   *
   * ⚠ A conta é resolvida pelo plano A CADA LEITURA (`carregarPlano`, empresa vence global) e a
   * classificação nunca é gravada — instrução do dono: o `codigoCompleto` é imutável, o reduzido
   * não. Renumerar o reduzido se conserta sozinho.
   *
   * ⚠ **Sem `competencia` ela varre a empresa inteira**, que é o modo do relatório de
   * pré-importação. Com competência, é o que a aba Lançamentos consome.
   */
  router.get("/lancamentos/verificacao", requireFirmCompanyAccess(), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const competencia = String(req.query?.competencia || "").trim();
    if (competencia && !/^\d{4}-\d{2}$/.test(competencia)) {
      return res.status(400).json({ error: "competencia_invalida" });
    }
    try {
      // ⚠ Só PROVISAO e BAIXA: são os dois tipos que o motor sabe julgar. Trazer o resto encheria
      // a resposta de INDETERMINADO, que a tela não desenha de qualquer forma.
      const where = { portalClientId, tipo: { in: ["PROVISAO", "BAIXA"] } };
      if (competencia) where.competencia = competencia;
      const entries = await prisma.accountingEntry.findMany({
        where,
        select: {
          id: true, tipo: true, eventType: true, subtipo: true, competencia: true,
          parcelamentoId: true, historico: true,
          lines: { select: { conta: true, tipo: true, valor: true } },
        },
        orderBy: [{ competencia: "desc" }, { data: "asc" }],
      });
      if (!entries.length) {
        return res.json({
          ok: true, competencia: competencia || null,
          resumo: { total: 0, ok: 0, viola: 0, conferir: 0, indeterminado: 0, suprimidos: 0 },
          porRegra: [], porLancamento: [],
        });
      }
      const plano = await carregarPlano(portalClientId, prisma);
      const r = verificarLote({
        lancamentos: entries,
        resolverConta: (cod) => plano.get(String(cod)) || null,
        empresaId: portalClientId,
      });
      return res.json({ ok: true, competencia: competencia || null, ...r });
    } catch (err) {
      // ⚠ FALHA ABERTO NA TELA: a aba Lançamentos não pode quebrar porque a verificação falhou.
      // Ela é revisor, não portão — mesma postura de `lerSitfisPosicional`.
      log.warn({ err: err?.message, portalClientId, competencia }, "verificacao de lancamentos falhou");
      return res.status(500).json({ error: "verificacao_falhou" });
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
        // ⚠ `historicoSugerido` é o histórico CONTÁBIL que o contador digitou; `text` é só a CHAVE
        // DE MATCH (o memo do banco / a descrição da planilha, canônica com {{competencia}}). A
        // coluna existe desde o OFX e estas rotas simplesmente não a devolviam — quem consumisse a
        // busca recebia a chave de match no lugar do histórico, ou nada. As duas projeções são
        // irmãs de propósito: uma delas ficar sem o campo é como as cópias divergem.
        historicoSugerido: h.historicoSugerido || null,
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
        // ⚠ `historicoSugerido` é o histórico CONTÁBIL que o contador digitou; `text` é só a CHAVE
        // DE MATCH (o memo do banco / a descrição da planilha, canônica com {{competencia}}). A
        // coluna existe desde o OFX e estas rotas simplesmente não a devolviam — quem consumisse a
        // busca recebia a chave de match no lugar do histórico, ou nada. As duas projeções são
        // irmãs de propósito: uma delas ficar sem o campo é como as cópias divergem.
        historicoSugerido: h.historicoSugerido || null,
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

  // ⚠ `POST /entries/parcelamento` FOI REMOVIDA (F2.3).
  //
  // Ela criava um LOTE DE LANÇAMENTOS que fingia ser um parcelamento: N `AccountingEntry`
  // `tipo=PROVISAO`, `subtipo="PARC_DAS"`, um por mês, com D principal + D juros + C contrapartida.
  // Sem cabeçalho `Parcelamento`, sem card na aba Parcelamento, sem linha em `parcelas`, sem número
  // de parcelamento, sem risco de rescisão, sem baixa. Um parcelamento que o módulo de parcelamento
  // não enxergava — e cujas provisões a Circular também não sabia rotear.
  //
  // ⚠ Ela também era a ÚNICA escrita de `subtipo="PARC_DAS"` no sistema. `guideCompliance` mantinha
  // uma pré-query atrás desse valor "que quase nunca casa" (o V1 grava `PARC_SIMPLES`/`PARC_INSS`, o
  // V2 grava `PARC_<TIPO>`); em produção ela nunca casou com nada, porque esta rota nunca foi usada:
  // zero lançamentos com esse subtipo. **Essa pré-query TAMBÉM já saiu** (decisão do dono): sem
  // escritor ela era inalcançável, e custava uma varredura da carteira inteira para devolver vazio.
  // Ela reconhecia, além disso, JUROS NA ADESÃO — a forma de
  // lançamento que `linhasProvisao` abandonou de propósito, por reconhecer o encargo duas vezes.
  //
  // Quem cria parcelamento hoje é `POST /parcelamentos/ingestao` (contrato + provisão + cronograma).
  //
  // ⚠ O FRONT AINDA TEM O CAMINHO LIGADO: menu "Funções" → "+ Parcelamento Simples"
  // (`renderAccountingEntriesTab.jsx`) → `onCreateParcelamento` (`App.jsx`) →
  // `handleCreateParcelamento` (`useManageAccountingWorkspace.js`) → `createParcelamentoSimples`
  // (`api/real/realApi.js`). O botão passa a responder 404 até o front removê-lo — nunca foi
  // exercido em produção, mas está na tela.

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

    // ⚠ CONTA SINTÉTICA É RECUSADA. Num lançamento NOVO não há nada preexistente a preservar, então
    // `codigosAtuais` é vazio: qualquer conta de agregação nas linhas recusa.
    const recusa = await recusaContaSintetica(prisma, portalClientId, lines);
    if (recusa) return res.status(400).json(recusa);

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
            // O contador pode escolher "Baixa" no seletor de tipo, e toda baixa precisa de
            // `tipoLinha` (CHECK `chk_baixa_tipo_linha`). Aqui não há papel nenhum a declarar — é
            // um lançamento inteiro, digitado à mão — então vai o padrão TOTAL.
            tipoLinha: tipoLinhaDaBaixa(tipo),
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
          // ⚠ O `tipo` viaja para a memória poder conferir a natureza do par antes de aprendê-lo.
          tipo: entry?.tipo || null,
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
    // ══════════════════════════════════════════════════════════════════════════════════════════
    // ⚠ MÊS FECHADO TAMBÉM BLOQUEIA **EDITAR** — e são DUAS competências a olhar, não uma.
    // ══════════════════════════════════════════════════════════════════════════════════════════
    //
    // O `POST` recusa criar (409) e o `DELETE` recusa apagar (409, com o comentário do dono logo
    // abaixo na rota); o verbo do MEIO passava. Reproduzido no navegador: mês fechado, clique no ✎,
    // R$ 60,00 → R$ 6.000,00, "Lançamento atualizado.", rodapé recalculado — competência fechada
    // alterada **sem nenhum rastro de reabertura**.
    //
    // Editar não é mais brando que apagar. É a MESMA decisão do dono, pelo mesmo motivo — *"qualquer
    // DELETE em competência fechada corrompe um saldo que já foi reportado"* —, e aqui com a
    // agravante de a linha continuar lá, parecendo intacta, com outro número dentro.
    //
    // ⚠ POR QUE DUAS COMPETÊNCIAS: este PUT **recalcula** a competência a partir de `body.data`
    // (logo acima). Então mover a data é mover o lançamento de mês, e são dois estragos distintos:
    //   · olhar só a ATUAL deixa **entrar** lançamento no mês fechado (data movida para dentro);
    //   · olhar só a NOVA deixa **sair** lançamento do mês fechado (data movida para fora).
    // Os dois mudam um total que já foi reportado. Quando a data não muda, `competenciaNova` é nula
    // e a pergunta é uma só.
    //
    // ⚠ NADA AQUI AFROUXA — é guarda ACRESCENTADA. Os dois fluxos legítimos continuam sendo os do
    // DELETE: REABRIR a competência (o ato fica gravado em `CompanyMonthlyCircular`) e então
    // corrigir, ou ESTORNAR na competência aberta. Consequência declarada: corrigir lançamento
    // legado que esteja em conta de agregação passa a exigir reabrir o mês, se ele estiver fechado.
    //
    // ⚠ Nenhum caminho AUTOMÁTICO passa por aqui: worker e captura SERPRO escrevem pelos serviços
    // (`GuideToProvisionService`, `syncPgdasByCompetencia`, `ParcelamentoV2Service`), não por esta
    // rota HTTP — a trava não interrompe sincronia no meio.
    //
    // Regressão: `__tests__/putEntryMesFechado.test.js`.
    const competenciaAtual = existing.competencia || null;
    const competenciaNova = data.competencia && data.competencia !== competenciaAtual ? data.competencia : null;
    const fechadas = (
      await Promise.all(
        [competenciaAtual, competenciaNova].filter(Boolean).map(
          async (comp) => ((await isMonthClosed(portalClientId, comp)) ? comp : null),
        ),
      )
    ).filter(Boolean);
    if (fechadas.length) {
      const comp = fechadas[0];
      return res.status(409).json({
        error: "MES_FECHADO",
        competencia: comp,
        competenciasFechadas: fechadas,
        message: `Mês ${comp} fechado — reabra a competência ou estorne pelo caminho do estorno (contra-lançamento no mês aberto).`,
      });
    }

    if (body.historico !== undefined) data.historico = String(body.historico).trim();
    if (body.tipo !== undefined) data.tipo = String(body.tipo).toUpperCase();
    if (body.subtipo !== undefined) data.subtipo = body.subtipo ? String(body.subtipo).toUpperCase() : null;
    if (body.statusPagamento !== undefined) data.statusPagamento = String(body.statusPagamento).toUpperCase();
    if (body.status !== undefined && ["RASCUNHO", "CONFIRMADO"].includes(String(body.status))) {
      data.status = String(body.status);
    }
    // ⚠ O CHECK `chk_baixa_tipo_linha` também vale no UPDATE. Duas formas de cair nele aqui:
    // trocar o tipo de um lançamento qualquer para BAIXA, e editar uma baixa antiga que ainda
    // esteja sem papel (a migration fez o backfill, mas não custa não depender disso). Nos dois
    // casos completa com o padrão — nunca sobrescreve um papel já gravado.
    if ((data.tipo || existing.tipo) === "BAIXA" && !existing.tipoLinha) {
      data.tipoLinha = tipoLinhaDaBaixa("BAIXA");
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

        // ⚠ NA EDIÇÃO A TRAVA RECUSA SÓ O QUE O PAYLOAD ACRESCENTA — e é isto que mantém possível a
        // correção dos 6 lançamentos que já estão em conta de agregação. Recusar todo `UPDATE` que
        // TOQUE uma sintética prenderia o dono: ele não conseguiria nem mover a linha para a
        // analítica certa, porque essa correção é um `UPDATE` sobre uma linha sintética.
        // Substituir a conta faz a sintética sumir do payload → passa. Acrescentar uma → recusa.
        const linhasAtuais = await prisma.accountingEntryLine.findMany({
          where: { entryId },
          select: { conta: true },
        });
        const recusa = await recusaContaSintetica(prisma, portalClientId, lines, {
          codigosAtuais: linhasAtuais.map((l) => l.conta),
        });
        if (recusa) return res.status(400).json(recusa);
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
          tipo: updated?.tipo || null,
        });
      }

      // ⚠ AS DUAS MEMÓRIAS DE CONTA DO PARCELAMENTO — E ATÉ A F2.3 SÓ A ERRADA ERA ALIMENTADA.
      //
      // Elas são estruturas diferentes, com chaves diferentes, e cada versão do módulo lê a sua:
      //
      //   V1 — `AccountingHistorico`, chave `(empresa, "PARC_<KIND>_<ROLE>#<ordem>")`.
      //        Escrita por `memorizeParcelamentoLineAccounts`. Lida por `lookupLineConta`, que só
      //        `createParcelamento` (V1) chama. Depende da ORDEM da linha no template.
      //   V2 — `MapaContaTributo`, chave `(cliente|global, tipoParcelamento, tipoLinha, codigoTributo)`.
      //        Lida por `resolverConta` — ou seja, por TODA provisão e TODA baixa do V2, e pelo
      //        pré-preenchimento do modal (`resolverContasProvisao`). Depende do PAPEL da linha.
      //
      // O auto-save chamava só a primeira. Num lançamento V2 ela até escrevia algo (o 1º entry da
      // provisão vira role OPEN, porque é ele que `aberturaEntryId` aponta; as baixas viram
      // PAY_JUROS/PAY_PRINCIPAL pelo histórico) — mas escrevia na tabela que o V2 NUNCA LÊ. O
      // resultado é que o contador corrigia a conta de um parcelamento, o sistema dizia que
      // aprendeu, e o parcelamento seguinte vinha com o campo em branco de novo.
      //
      // `memorizeMapaContaTributo` existia para isso desde a Q21 e estava EXPORTADA SEM UM ÚNICO
      // CHAMADOR — a memória do V2 só era alimentada na ingestão, quando o modal mandava
      // `provisaoLines`; correção posterior nunca era aprendida.
      //
      // ⚠ AS DUAS CONTINUAM SENDO CHAMADAS, e nenhuma atrapalha a outra: cada uma ignora o que não
      // é dela. A do V1 só grava linha com conta e deriva o papel de `aberturaEntryId`/histórico; a
      // do V2 exige `tipoLinha` NA LINHA (`if (!conta || !tipoLinha) continue`), campo que só os
      // lançamentos do V2 preenchem — num lançamento V1 ela é no-op. Best-effort, como já eram:
      // falha aqui nunca derruba o save.
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
          log.warn({ memErr }, "Falha ao memorizar contas de parcelamento V1 (não crítico)");
        }
        try {
          const { memorizeMapaContaTributo } = await import(
            "../../application/accounting/parcelamento/ParcelamentoV2Service.js"
          );
          await memorizeMapaContaTributo({
            portalClientId,
            entry: updated,
            userId: req.auth?.user?.id,
          });
        } catch (memErr) {
          log.warn({ memErr }, "Falha ao memorizar MapaContaTributo (não crítico)");
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
    // ⚠ MÊS FECHADO TAMBÉM BLOQUEIA APAGAR — e a competência que manda é a DO LANÇAMENTO, não a de
    // hoje. Criar lançamento em mês fechado já era 409 (`POST /entries`); apagar mudava os números
    // do mês fechado sem nenhum rastro de reabertura, que é o mesmo estrago pelo caminho inverso.
    // A assimetria em relação à criação é essa: lá a competência vem da data digitada, aqui ela já
    // está gravada — perguntar pelo mês de hoje deixaria passar exatamente o caso que importa.
    //
    // ══════════════════════════════════════════════════════════════════════════════════════════
    // ⚠ ESTA TRAVA VALE PARA **TODO** LANÇAMENTO, NÃO SÓ PARA BAIXAS. É INTENCIONAL.
    // ══════════════════════════════════════════════════════════════════════════════════════════
    //
    // Decisão do dono, registrada aqui porque "consertar o escopo" desta trava parece, de fora,
    // uma correção óbvia — e não é: *"qualquer DELETE em competência fechada corrompe um saldo
    // que já foi reportado"*. Não importa se o lançamento é uma baixa, uma despesa, uma receita ou
    // uma provisão: se o mês foi fechado, os números dele saíram para fora. Apagar qualquer linha
    // depois disso muda um total que alguém já leu, sem deixar sinal nenhum de que a competência
    // foi mexida.
    //
    // Os DOIS fluxos legítimos, e nenhum deles é afrouxar isto aqui:
    //   1. REABRIR a competência (o ato fica gravado em `CompanyMonthlyCircular`) e então corrigir;
    //   2. ESTORNAR na competência ABERTA — `POST /entries/:entryId/estorno`, que em mês fechado
    //      preserva o lançamento e gera contra-lançamento no mês corrente.
    //
    // Restringir esta trava às baixas reabriria, para todos os outros tipos, exatamente o buraco
    // que ela fechou.
    if (await isMonthClosed(portalClientId, existing.competencia)) {
      return res.status(409).json({
        error: "MES_FECHADO",
        competencia: existing.competencia,
        message: `Mês ${existing.competencia} fechado — reabra a competência ou estorne pelo caminho do estorno (contra-lançamento no mês aberto).`,
      });
    }

    // ⚠ ESTORNO DE BAIXA NÃO PASSA MAIS POR AQUI — E A RECUSA É EXPLÍCITA.
    //
    // Apagar uma baixa nunca foi "excluir um lançamento": é desfazer um pagamento, reabrir uma
    // guia, devolver um passivo e mover a parcela de estado. Enquanto isso era EFEITO de um DELETE,
    // não havia onde exigir o motivo nem onde gravar quem desfez — e o mesmo verbo servia para
    // apagar uma despesa digitada errado e para desfazer a quitação de uma parcela confirmada.
    //
    // A porta é `POST /entries/:entryId/estorno`, que exige motivo e grava auditoria. Recusar aqui
    // é o que impede a exigência do motivo de ser contornável pelo verbo antigo — e a recusa chega
    // como recusa, com o caminho na resposta, nunca como um 200 silencioso.
    if (existing.tipo === "BAIXA" && (existing.openEntryId || existing.sourceGuideId)) {
      return res.status(409).json({
        error: "USE_ESTORNO",
        entryId,
        rota: `/firm/companies/${portalClientId}/entries/${entryId}/estorno`,
        motivoMinimo: MOTIVO_MIN,
        message: "Esta é uma baixa: desfazê-la é um estorno, e estorno exige motivo registrado. Use a rota de estorno (ela também mostra, antes, tudo o que será desfeito).",
      });
    }

    // ⚠ O QUE SOBRA AQUI É O DELETE DE VERDADE: lançamento comum, em mês aberto. Toda a lógica
    // de desfazer baixa (reabrir a guia, devolver o passivo, mover o estado da parcela) saiu deste
    // arquivo e virou `EstornoBaixaService`, com motivo e auditoria — ver a recusa `USE_ESTORNO`
    // acima.
    await prisma.accountingEntry.delete({ where: { id: entryId } });
    return res.json({ ok: true });
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ESTORNO DA BAIXA — a transição administrativa
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  //
  // Duas rotas, e as duas são necessárias:
  //
  //   GET  .../estorno/preview  — o que será desfeito, COM VALORES, antes de qualquer escrita
  //   POST .../estorno          — executa, exigindo motivo
  //
  // ⚠ O PREVIEW NÃO É CONVENIÊNCIA DE TELA. Estorno é ato de consequência: some um pagamento do
  // razão, um passivo volta a existir, uma parcela volta para a fila e — em mês fechado — nasce um
  // lançamento novo numa competência que ainda vai ser fechada. Quem confirma tem de ver o lote
  // inteiro (uma baixa são até três, ou quatro, lançamentos), o modo, a competência do
  // contra-lançamento e o risco de rescisão que sobra depois. O `totalEstornado` devolvido aqui é o
  // que o POST aceita de volta como conferência: se a baixa mudou entre a tela e o clique, ele
  // recusa em vez de desfazer algo diferente do que foi confirmado.
  const HTTP_POR_CODIGO = {
    lancamento_nao_encontrado: 404,
    lancamento_ja_exportado: 400,
    LOTE_JA_EXPORTADO: 409,
    NAO_E_BAIXA: 400,
    MOTIVO_OBRIGATORIO: 400,
    MES_CORRENTE_FECHADO: 409,
    CONFERENCIA_DIVERGENTE: 409,
    LOTE_MUDOU: 409,
    // F2.5 — as recusas da âncora PARCELA (baixa sem guia). As duas são conflito de estado, e as
    // duas existem para NÃO estornar pela metade: sem saber qual prestação limpar, ou com ela
    // mudada no meio, a alternativa seria lançamento estornado com prestação presa em baixada.
    PARCELA_NAO_IDENTIFICADA: 409,
    PARCELA_MUDOU: 409,
    ANCORA_SEM_REVERSOR: 409,
  };
  function responderRecusa(res, err) {
    if (!(err instanceof EstornoRecusado)) throw err;
    // Os campos extras do erro (competência, mínimo do motivo, totais divergentes) sobem junto: a
    // recusa tem de dar ao contador o que ele precisa para agir, não só um código.
    const extra = { ...err };
    delete extra.code; delete extra.name;
    return res.status(HTTP_POR_CODIGO[err.code] || 400).json({ error: err.code, message: err.message, ...extra });
  }

  // GET /firm/companies/:companyId/entries/:entryId/estorno/preview
  router.get("/entries/:entryId/estorno/preview", requireFirmCompanyAccess(), async (req, res) => {
    try {
      const preview = await previewEstorno({
        portalClientId: String(req.params.companyId),
        entryId: String(req.params.entryId),
      });
      return res.json({ ok: true, ...preview });
    } catch (err) {
      return responderRecusa(res, err);
    }
  });

  // POST /firm/companies/:companyId/entries/:entryId/estorno   { motivo, totalConferido? }
  router.post("/entries/:entryId/estorno", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const body = req.body || {};
    try {
      const out = await executarEstorno({
        portalClientId: String(req.params.companyId),
        entryId: String(req.params.entryId),
        motivo: body.motivo,
        // ⚠ O total é OPCIONAL na API e obrigatório na prática: quem passou pelo preview o tem. Não
        // é exigido porque um caminho de correção (script de remediação, por exemplo) não tem tela
        // para conferir — e recusar por falta de um número que ninguém mostrou seria trocar uma
        // guarda por um bloqueio.
        totalConferido: body.totalConferido != null ? Number(body.totalConferido) : null,
        userId: req.auth?.user?.id || null,
      });
      log?.info?.({
        msg: "estorno de baixa",
        portalClientId: String(req.params.companyId),
        entryId: String(req.params.entryId),
        modo: out.modo,
        total: out.totalEstornado,
        userId: req.auth?.user?.id || null,
      });
      return res.json(out);
    } catch (err) {
      return responderRecusa(res, err);
    }
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

    // ⚠ ERA O ÚNICO ATO CONTÁBIL SEM A TRAVA DE MÊS FECHADO. A baixa do INSS
    // (`InssPagamentoService`), a da parcela (`ParcelamentoV2Service`), o `POST /entries`, a guia
    // manual e as buscas do SERPRO já paravam aqui; esta rota, que grava até três lançamentos,
    // passava direto. A competência é a da DATA DO PAGAMENTO — a mesma leitura das outras.
    if (await isMonthClosed(portalClientId, competencia)) {
      return res.status(409).json({
        error: "MES_FECHADO",
        competencia,
        message: `Mês ${competencia} fechado — reabra a empresa antes de dar a baixa.`,
      });
    }

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
              // Q61: papel no cabeçalho — obrigatório em toda baixa (CHECK `chk_baixa_tipo_linha`).
              // Aqui não há guia (`sourceGuideId` nulo), então estas linhas ficam fora do índice
              // único; o papel entra pelo mesmo motivo que o sufixo do histórico entra: é o que
              // distingue principal de juros e multa no lote.
              tipoLinha: g.papel,
              // Q37: o eventType alimenta a memória de contas, e SÓ o lançamento do principal o
              // carrega. Isso NÃO mudou com o índice parcial — mudou só a razão de ser.
              //
              // ⚠ Antes havia DUAS razões e uma delas era o unique de competência (repetir o
              // evento nos três lançamentos do lote violava a constraint e derrubava a baixa
              // inteira). Essa razão caiu: desde
              // `20260818160000_unique_competencia_nao_morde_baixa` o índice é parcial em
              // `tipo <> 'BAIXA'` e não alcança mais nenhuma destas linhas.
              //
              // ⚠ A OUTRA RAZÃO CONTINUA DE PÉ E É A QUE MANDA: a memória D/C
              // (`AccountingHistorico`) é do par do TRIBUTO, não de juros/multa. Marcar os três
              // com o mesmo evento faria a conta de juros (501) e a de multa (506) sobrescreverem
              // a conta memorizada do tributo, e a próxima baixa viria pré-preenchida com a conta
              // errada. Não afrouxe isto "porque a constraint saiu" — é forma de lançamento, e
              // mudá-la exige pedido explícito do dono.
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
        // ⚠ Esta rota grava BAIXA — o motor confere `D obrigacao / C disponivel`.
        tipo: "BAIXA",
      });
      return res.status(201).json({
        ok: true,
        entry: entryToResponse(result.entry),
        openEntry: entryToResponse(result.openEntry),
      });
    } catch (err) {
      // ⚠ P2002 AQUI É RECUSA DE NEGÓCIO, NÃO FALHA DO SERVIDOR — e devolver 500 `internal_error`
      // é a família de defeito que este projeto já conhece pelo nome ("o botão não faz nada").
      //
      // O caso medido: o unique de competência (`portalClientId, competencia, eventType, origem`)
      // era TOTAL e mordia as baixas. Duas provisões em atraso baixadas no mesmo mês colidiam, a
      // segunda estourava aqui dentro do `$transaction`, e o contador via a palavra
      // `internal_error` — sem motivo, sem conserto, sem pista de que a DATA era o problema.
      // A migration `20260818160000_unique_competencia_nao_morde_baixa` tirou as baixas de dentro
      // daquele índice, então este ramo não deve mais acender por ela.
      //
      // ⚠ E ELE FICA MESMO ASSIM, de propósito: os outros uniques desta tabela CONTINUAM valendo
      // para baixas (`uq_baixa_guia_linha`, `uq_baixa_parcela_linha`), e um P2002 novo — de
      // qualquer um deles, ou de um índice futuro — voltaria a sair como 500 se o `catch` genérico
      // fosse a única saída. Traduzir o conflito é a correção; o índice parcial é a outra metade.
      if (err?.code === "P2002") {
        const alvo = Array.isArray(err?.meta?.target)
          ? err.meta.target.join(",")
          : String(err?.meta?.target || "");
        const tributo = openEntry.subtipo || openEntry.eventType || "provisão";

        // A colisão da tupla de competência tem conserto PRÓPRIO e ele é do contador: a data.
        // Por isso ela é nomeada à parte, em vez de cair no conflito genérico abaixo.
        if (alvo.includes("competencia")) {
          log.warn({ alvo, portalClientId, entryId, competencia }, "Baixa recusada: colisão na competência");
          return res.status(409).json({
            error: "BAIXA_DUPLICADA_NA_COMPETENCIA",
            competencia,
            tributo,
            message:
              `Já existe uma baixa de ${tributo} desta empresa lançada na competência ${competencia}. `
              + "Informe a data de pagamento REAL desta parcela — sem comprovante o modal usa a data de hoje, "
              + "e todas as provisões em atraso acabam caindo no mês corrente.",
          });
        }

        log.warn({ alvo, portalClientId, entryId, competencia }, "Baixa recusada por conflito de unicidade");
        return res.status(409).json({
          error: "BAIXA_CONFLITO_UNICIDADE",
          competencia,
          tributo,
          alvo: alvo || null,
          message:
            `Esta baixa de ${tributo} conflita com uma já gravada (${alvo || "restrição de unicidade"}). `
            + "Confira se ela não foi lançada antes — inclusive por outra sessão ou pela confirmação "
            + "automática de pagamento.",
        });
      }
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

      // Mesma guarda do Excel, pelo mesmo motivo: o import é uma porta de lançamento como outra
      // qualquer, e conta de agregação é recusada pela ECD venha ela de onde vier.
      const sinteticasLote = await sinteticasDoLote(prisma, portalClientId, [
        ...transactions.map((t) => ({ conta: t.contaDebito })),
        ...transactions.map((t) => ({ conta: t.contaCredito })),
      ]);

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
            const sinteticasDaLinha = [contaDebito, contaCredito].filter((c) => sinteticasLote.has(c));
            if (sinteticasDaLinha.length) {
              failed.push({ rowIndex: t.rowIndex, reason: "conta_sintetica", contas: sinteticasDaLinha });
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
                // `tipo` vem do payload classificado na tela e pode ser BAIXA; toda baixa precisa
                // de `tipoLinha` (CHECK `chk_baixa_tipo_linha`). Extrato não traz papel de linha.
                tipoLinha: tipoLinhaDaBaixa(tipo),
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

      // ⚠ 4 dos 6 lançamentos hoje em conta de agregação vieram DAQUI. A recusa é por LINHA.
      const sinteticasLote = await sinteticasDoLote(prisma, portalClientId, [
        ...transactions.map((t) => ({ conta: t.contaDebito })),
        ...transactions.map((t) => ({ conta: t.contaCredito })),
      ]);

      try {
        await prisma.$transaction(async (tx) => {
          for (const t of transactions) {
            const contaDebito = String(t.contaDebito || "").trim();
            const contaCredito = String(t.contaCredito || "").trim();
            const valor = Number(t.valor);
            const descricao = String(t.descricao || "").trim();
            // ⚠ COMPATIBILIDADE: payload SEM `historico` continua caindo em `historico: descricao`,
            // exatamente como antes. Cliente antigo (ou o modal ainda não atualizado) não quebra —
            // ele só deixa de aproveitar a separação. Quem manda `historico` está mandando o texto
            // que o CONTADOR viu e editou na tela; nada é gravado sem ele ver.
            const historicoDigitado = String(t.historico || "").trim();
            const historico = historicoDigitado || descricao;
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
            // Conta de agregação não recebe lançamento (ECD, registro I250) — a linha fica de fora
            // NOMEANDO a conta; o resto do lote entra.
            const sinteticasDaLinha = [contaDebito, contaCredito].filter((c) => sinteticasLote.has(c));
            if (sinteticasDaLinha.length) {
              failed.push({ rowIndex: t.rowIndex, reason: "conta_sintetica", contas: sinteticasDaLinha });
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
                // O texto CRU da planilha, ao lado do histórico contábil — não no lugar dele.
                descricaoImportacao: descricao,
                tipo,
                origem: "EXCEL",
                loteImportacao,
                status: "RASCUNHO",
                statusPagamento: "NA",
                // Mesma razão do OFX: `tipo` vem da planilha e pode ser BAIXA.
                tipoLinha: tipoLinhaDaBaixa(tipo),
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
      // text = descrição da planilha (chave de match) | historicoSugerido = histórico contábil que
      // o contador confirmou na tela. Mesmo contrato do OFX, que já gravava os dois; aqui o segundo
      // simplesmente não era passado, e por isso `historicoSugerido` estava vazio em TODOS os 230
      // registros da memória.
      if (userId) {
        for (const t of transactions) {
          const contaDebito = String(t.contaDebito || "").trim();
          const contaCredito = String(t.contaCredito || "").trim();
          const descricao = String(t.descricao || "").trim();
          const historicoDigitado = String(t.historico || "").trim();
          if (!descricao || !contaDebito || !contaCredito) continue;
          await upsertHistoricoFromImport({
            userId, portalClientId, text: descricao, contaDebito, contaCredito,
            // Sem `historico` no payload não há nada que o contador tenha escrito — gravar a
            // própria descrição aqui faria a memória sugerir a chave de match como histórico.
            historicoSugerido: historicoDigitado || null,
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

  // ⚠ As duas rotas LITERAIS abaixo têm que ficar ANTES de `/parcelamentos/:parcId` — o Express casa
  // na ordem de registro, e o curinga (que responde 404 `parcelamento_not_found`, nunca `next()`)
  // engoliria "contas-provisao" e "parcelas-pendentes-baixa" como se fossem um id. Mesmo cuidado que
  // `/companies/annual` e `/companies/fechamento` já tomam com `/companies/:companyId`.

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

  // Parcelas com pagamento marcado mas SEM lançamento — alimenta o painel da aba Parcelamento.
  // A baixa da parcela saiu do "confirmar pagamento" e passou a ser ato deliberado aqui, no mesmo
  // lugar onde as parcelas são acompanhadas (espelha o que a Circular faz com os tributos).
  router.get("/parcelamentos/parcelas-pendentes-baixa", requireFirmCompanyAccess(), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    try {
      // F2.1: ancorada na PARCELA. O filtro de pendência é o MESMO (a guia é que carrega o
      // pagamento e a baixa, e o caminho de baixa continua sendo por guia), mas a linha devolvida
      // passa a saber que prestação ela é — `numeroParcela` vinha nulo aqui porque nem era lido.
      const pendentes = await prisma.parcela.findMany({
        where: {
          portalClientId,
          guia: {
            status: "PROCESSED",
            paymentStatus: "PAID",
            baixada: false,
            lancamentoId: null,
          },
        },
        select: {
          id: true, numeroParcela: true, parcelamentoId: true,
          guia: {
            select: {
              id: true, tipo: true, competencia: true, valor: true, vencimento: true,
              extracted: true, paymentConfirmedAt: true,
            },
          },
        },
        orderBy: { guia: { competencia: "asc" } },
        take: 100,
      });
      return res.json({
        ok: true,
        parcelas: pendentes.map((p) => ({
          parcelaId: p.id,
          guideId: p.guia.id,
          numeroParcela: p.numeroParcela,
          competencia: p.guia.competencia,
          valor: p.guia.valor != null ? Number(p.guia.valor) : null,
          vencimento: p.guia.vencimento,
          parcelamentoId: p.parcelamentoId,
          confirmadoEm: p.guia.paymentConfirmedAt,
          // Dados do comprovante (quando a busca no SERPRO já rodou) pra mostrar data/valores reais.
          comprovante: p.guia.extracted && typeof p.guia.extracted === "object" ? p.guia.extracted.comprovante || null : null,
        })),
      });
    } catch (err) {
      log.error({ err }, "Falha ao listar parcelas pendentes de baixa");
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  // ⚠ A OUTRA FILA — e ela responde OUTRA PERGUNTA, de propósito.
  //
  // A de cima diz *"a guia foi paga, falta lançar"*: existe um SINAL EXTERNO (o `paymentStatus`
  // que veio do SERPRO) e ela só repete o que ele diz. Esta diz *"esta prestação venceu e não há
  // guia; você declara que foi debitada?"* — não há sinal nenhum, a evidência é a declaração do
  // contador, e é a `POST .../parcelas/:parcelaId/baixa-manual` que a recebe.
  //
  // Sem esta rota aquela baixa é inalcançável: não havia de onde tirar o `parcelaId` — a fila de
  // cima filtra por `guia`, e prestação sem guia não tem por onde entrar nela. Um contrato inteiro
  // em débito automático ficava com fila vazia para sempre, com 60 prestações não baixáveis.
  //
  // ⚠ O CRITÉRIO NÃO MORA AQUI. `whereParcelaSemGuiaPendente` + `linhaDaFilaSemGuia` vivem em
  // `recalculoParcelamento.js`, junto de `quadroDasParcelas` e do `SELECT_PARCELA_PARA_QUADRO` que
  // esta rota REUSA (com `competencia` e `valorPrevisto`, que passaram a sair de lá). Escrever o
  // filtro na rota criaria a terceira definição de atraso do módulo.
  //
  // ⚠ Devolve a linha COMPLETA (prestação, competência, valor e o contrato) numa resposta só —
  // sem isso o front faria uma chamada ao contrato por linha, e são até 60 por acordo.
  router.get("/parcelamentos/parcelas-sem-guia-pendentes", requireFirmCompanyAccess(), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    try {
      const {
        whereParcelaSemGuiaPendente, SELECT_PARCELA_FILA_SEM_GUIA, linhaDaFilaSemGuia,
      } = await import("../../application/accounting/parcelamento/recalculoParcelamento.js");
      const { conferenciaDoPassivoPorContrato } = await import(
        "../../application/accounting/parcelamento/ParcelamentoV2Service.js"
      );
      const agora = new Date();
      const pendentes = await prisma.parcela.findMany({
        where: whereParcelaSemGuiaPendente({ portalClientId, agora }),
        select: SELECT_PARCELA_FILA_SEM_GUIA,
        // A mais antiga primeiro: é a que está mais perto de contar para a regra de rescisão.
        orderBy: [{ vencimento: "asc" }, { numeroParcela: "asc" }],
        take: 200,
      });
      const linhas = pendentes.map((p) => linhaDaFilaSemGuia(p, agora));

      // ⚠ O QUE **NÃO** ESTÁ NESTA LISTA, E POR QUÊ — a ausência deixando de ser muda.
      //
      // O filtro por parcelamento RESCINDIDO continua (fila de trabalho sobre acordo morto é
      // trabalho inventado, e `quadroDasParcelas` toma a mesma decisão). O que mudou é que a fila
      // passou a CONTAR o que ela escondeu: sem isso, um contrato rescindido leva 69 prestações
      // embora de uma vez e a tela vazia fica indistinguível de "não há nada pendente" — foi
      // exatamente assim que o dono passou o dia achando que a baixa sem guia não funcionava.
      //
      // ⚠ O predicado NÃO é reescrito aqui: `whereParcelaForaDaFilaPorRescisao` é o MESMO
      // `whereParcelaSemGuiaPendente` com o status invertido, para que o número do aviso conte
      // exatamente as linhas que voltariam à fila se a rescisão fosse desfeita.
      const {
        whereParcelaForaDaFilaPorRescisao, SELECT_PARCELA_FORA_DA_FILA, resumoForaDaFilaPorRescisao,
      } = await import("../../application/accounting/parcelamento/recalculoParcelamento.js");
      const escondidas = await prisma.parcela.findMany({
        where: whereParcelaForaDaFilaPorRescisao({ portalClientId, agora }),
        select: SELECT_PARCELA_FORA_DA_FILA,
        take: 500,
      });
      const foraDaFila = resumoForaDaFilaPorRescisao(escondidas);

      // ⚠ A CONSEQUÊNCIA VIAJA JUNTO, para que ela possa ser mostrada ANTES do clique. O contador
      // pode corrigir o valor CONTRATADO da prestação (é o `valorPrevisto`, e é ele que a baixa
      // amortiza do passivo); a conferência diz quanto as prestações somam contra o principal que a
      // adesão provisionou. ⚠ INFORMATIVA — nunca bloqueia. O número certo sai do contrato, e quem
      // decide é o contador; o sistema informa e registra. Duas queries para todos os contratos.
      const conferencias = await conferenciaDoPassivoPorContrato(prisma, {
        portalClientId,
        parcelamentoIds: linhas.map((l) => l.parcelamentoId),
      });
      return res.json({
        ok: true,
        parcelas: linhas.map((l) => ({ ...l, conferenciaPassivo: conferencias[l.parcelamentoId] || null })),
        foraDaFila,
      });
    } catch (err) {
      log.error({ err }, "Falha ao listar parcelas sem guia pendentes de baixa");
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  // ⚠ `GET /parcelamentos/:parcId` FOI REMOVIDA (F2.3), e com ela o `getParcelamento` do
  // `ParcelamentoService`. Ela devolvia o MESMO objeto decorado que `GET /parcelamentos` já devolve
  // para a lista inteira, e não tinha um chamador sequer — o wrapper existia no cliente HTTP do
  // front e nenhuma tela o invocava. Enquanto existia, ela era também o curinga que engolia as
  // rotas literais de `/parcelamentos/` registradas depois dela (defeito já corrigido uma vez,
  // travado por `__tests__/parcelamentosRotasLiterais.test.js`).
  //
  // As literais acima continuam tendo de vir ANTES de qualquer rota com `:parcId`: `/config` e
  // `/rescindir` têm segmento extra e não colidem hoje, mas a ordem é a disciplina que impede a
  // colisão de voltar quando alguém registrar o próximo curinga.

  // POST /firm/companies/:companyId/parcelamentos
  // body: { label, kind, templateOpeningFunctionId, templateRescisionFunctionId,
  //         numEntradas, numParcelas, principalPerParcela, principalTotal, jurosTotal,
  //         dataAbertura, competenciaInicial, diaPagamento, periodosReferenciados,
  //         sourceGuideId, linkGuideAsParcelaNum }
  //
  // ⚠ `templatePaymentFunctionId` continua CHEGANDO no body (o modal V1 do front ainda o envia) e é
  // IGNORADO — `createParcelamento` parou de gravá-lo. O campo era write-only desde que a F2.3
  // removeu seu único leitor (`confirmParcelaPayment`); a coluna sai numa migration própria depois.
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

  // Q21 (spec v2) / F2.3 — POST /firm/companies/:companyId/parcelamentos/ingestao
  //
  // ⚠ ESTA É A PORTA DO "PARCELAMENTO-FIRST". O parcelamento é um CONTRATO de dívida que vive até
  // 60 meses; a guia é evidência MENSAL e OPCIONAL — ela não existe em débito automático, e não
  // existe em contrato migrado de outra contabilidade. Por isso `guideId` é opcional aqui, em
  // `buildDTOsFromManual` e em `ingestParcelamentoFromGuide`: os três caminhos já aceitavam a
  // ausência, e é essa cadeia inteira que sustenta criar o contrato sem documento nenhum.
  //
  // ⚠ SEM GUIA, A COMPETÊNCIA INICIAL TEM DE VIR NO HEADER (`anoMesParcela`, "YYYYMM" ou "YYYY-MM").
  // Sem ela e sem guia, o serviço grava a sentinela `1970-01` e o cronograma nasce SEM DATAS — o
  // contrato aparece como "0 de N" com risco não avaliável. Não é bug: é o que se sabe quando não
  // há data confiável (`parcelaSync.COMPETENCIA_SENTINELA`).
  //
  // body:
  //   { guideId?, parcelasJaPagas?,
  //     header: { tipo, numeroParcelamento, quantidadeParcelas, numeroParcela,
  //               valorPrincipal, valorMulta, valorJuros, valorTotal, dataAdesao,
  //               anoMesParcela?, vencimento?, descricao?,
  //               formaPagamento?  ("DEBITO_AUTOMATICO" | "GUIA_MENSAL"; ausente = NÃO DECLARADO),
  //               diaPagamento?    (1..31 — alimenta o cronograma, que é a data que decide atraso),
  //               saldoConsolidado? (INFORMATIVO — não vira lançamento),
  //               valorParcela?    (o valor CHEIO de UMA prestação — NÃO confundir com `valorTotal`,
  //                                 que é o consolidado do acordo. Sem guia e sem `tributos` ele é a
  //                                 ÚNICA fonte de `valorParcelaReferencia`; faltando, o contrato
  //                                 nasce valendo ZERO e nenhuma prestação fica baixável) },
  //     tributos?: [{codigoTributo,principal,multa,juros,total}] }
  // Se `tributos` ausente, usa a composição já extraída do PDF (guide.extracted.composicao).
  router.post("/parcelamentos/ingestao", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const userId = req.auth?.user?.id;
    const { guideId, header, tributos, provisaoLines, pagamentoLines, parcelasJaPagas } = req.body || {};
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
      const data = await ingestParcelamentoFromGuide({
        portalClientId, guideId: guide?.id || null, parcelamentoDTO, parcelaDTO,
        provisaoLines, pagamentoLines, descricao: header?.descricao,
        // F2.3: N prestações quitadas ANTES do sistema → `origemBaixa: "HISTORICO"`, sem lançamento.
        parcelasJaPagas,
        userId,
      });
      return res.status(201).json({ ok: true, data });
    } catch (err) {
      const code = err?.code || "internal_error";
      // ⚠ `PAPEL_DE_LINHA_AUSENTE` é RECUSA DE ENTRADA, não erro do servidor: a linha de provisão
      // chegou sem `tipoLinha`, e supô-lo faria o contrato nascer com o principal errado (o defeito
      // da SINTROPIA). A mensagem do serviço já traz motivo E saída — ela sobe inteira para a tela.
      if (code === "COMPOSICAO_INVALIDA" || code === "PAPEL_DE_LINHA_AUSENTE") {
        return res.status(400).json({ ok: false, error: code, message: err.message });
      }
      log.error({ err }, "Falha na ingestão de parcelamento (v2)");
      return res.status(500).json({ ok: false, error: code });
    }
  });

  // ⚠ DUAS ROTAS DO V1 FORAM REMOVIDAS AQUI (F2.3), junto com os serviços que só elas chamavam:
  //
  //   · `POST /parcelamentos/:parcId/link-guide`            → `linkGuideToParcela`
  //   · `POST /parcelamentos/:parcId/parcelas/:num/pagar`   → `confirmParcelaPayment`
  //
  // As duas operavam sobre as LINHAS LEVES `tipo="PARCELA"` que só o V1 (`createParcelamento`) cria,
  // e a segunda dependia de um `AccountingFunction kind=PARCELAMENTO_PAYMENT` configurado. Produção
  // não tem um único parcelamento V1 — e nenhuma tela chamava nenhuma das duas.
  //
  // A baixa da parcela hoje é UMA só, logo abaixo: por GUIA, com o juros LIDO da composição, e ela
  // é a que a aba Parcelamento usa. Ter duas portas para "dar baixa numa parcela", com semânticas
  // diferentes (uma pelo template, outra pelo comprovante), era o convite a lançar a mesma parcela
  // de dois jeitos.

  // Lança a baixa de UMA parcela (a partir da guia). Mês fechado bloqueia — aqui SIM há lançamento.
  //
  // ⚠ F2.6 — O BODY É OPCIONAL, E O QUE ELE CARREGA É A SAÍDA DO `sem_composicao`.
  //
  // body: { composicaoDeclarada?: { principal, juros, multa, totalConferido }, dataPagamento? }
  //
  // Guia de parcela vinda de UPLOAD chega sem `TributoParcela` e com um `extracted` que só tem
  // tipo/valor/vencimento/competência — sem `principal`, `multa` ou `juros`. A fila recusava com
  // `sem_composicao` e a baixa por declaração (`/baixa-manual`) recusa toda prestação COM guia:
  // não havia caminho nenhum. Agora o contador declara a decomposição lendo o DAS que ele tem, e
  // ela entra por ESTA rota — a mesma guia, a mesma reserva atômica, a mesma forma de lançamento.
  // Não é uma terceira porta para "dar baixa numa parcela": é a mesma porta, com o dado que
  // faltava.
  //
  // ⚠ `totalConferido` é OBRIGATÓRIO dentro de `composicaoDeclarada` — o servidor refaz
  // `principal + juros + multa` e recusa com 409 `CONFERENCIA_DIVERGENTE` se não bater. Ele NÃO
  // deriva o acréscimo por subtração, nem aqui nem em `/baixa-manual`.
  router.post("/parcelamentos/parcelas/:guideId/baixa", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const guideId = String(req.params.guideId);
    const { composicaoDeclarada = null, dataPagamento: dataDeclarada = null } = req.body || {};
    try {
      const { gerarPagamentoParcelaFromGuide } = await import(
        "../../application/accounting/parcelamento/ParcelamentoV2Service.js"
      );

      // ⚠ A DATA DO PAGAMENTO VEM DO COMPROVANTE, NÃO DO CLIQUE.
      // Sem isto a baixa caía na competência do dia em que o contador clicou: parcela paga em
      // 20/03 e lançada em 05/04 virava saída de caixa de abril — o balancete de março fechava com
      // dinheiro que já tinha saído. E o pior: a data certa já estava impressa na própria linha do
      // painel, ao lado do botão.
      //
      // ⚠ `dataArrecadacao` é gravada como STRING BR ("dd/mm/aaaa"), não ISO — `new Date()` leria
      // "07/08/2026" como 7 de agosto no formato americano, ou como Invalid Date. Por isso o parse
      // é explícito, e data ilegível vira `undefined` (o serviço cai em "hoje", como antes) em vez
      // de virar uma data errada: lançar na competência errada é pior que lançar na de hoje.
      const guiaComComprovante = await prisma.guide.findFirst({
        where: { id: guideId, portalClientId },
        select: { extracted: true },
      });
      const dataDoComprovante = dataBrParaDate(guiaComComprovante?.extracted?.comprovante?.dataArrecadacao);

      // ⚠ PROVA ANTES DE DECLARAÇÃO, TAMBÉM NA DATA. Havendo comprovante, a data dele manda — é ela
      // que decide a competência do lançamento, e foi por ignorá-la que parcela paga em 20/03 e
      // lançada em 05/04 virava saída de caixa de abril. A data declarada só é usada quando NÃO há
      // comprovante, que é exatamente o caso da guia de UPLOAD marcada como paga à mão: sem ela a
      // baixa cairia no dia do clique, e o contador não teria como dizer quando o dinheiro saiu.
      //
      // ⚠ E ela só é aceita JUNTO da composição declarada. Deixar `dataPagamento` livre no caminho
      // normal permitiria mandar uma data que contradiz o comprovante que está no próprio registro.
      const dataPagamento = dataDoComprovante
        || (composicaoDeclarada && dataDeclarada ? new Date(dataDeclarada) : null);

      const out = await gerarPagamentoParcelaFromGuide({
        portalClientId, guideId, userId: req.auth?.user?.id,
        ...(dataPagamento && !Number.isNaN(dataPagamento.getTime()) ? { dataPagamento } : {}),
        ...(composicaoDeclarada ? { composicaoDeclarada } : {}),
      });
      // ⚠ `skipped` NÃO é sucesso silencioso. O serviço recusa com `ja_baixada` quando a parcela já
      // tem lançamento — e a rota devolvia 201 `ok:true` mesmo assim, então o contador clicava, não
      // acontecia nada, e ele não recebia aviso: a linha só sumia da lista.
      if (out?.skipped) {
        return res.status(200).json({ ok: false, skipped: true, motivo: out.reason, resultado: out });
      }
      return res.status(201).json({ ok: true, resultado: out });
    } catch (err) {
      if (err?.code === "MES_FECHADO") {
        return res.status(409).json({ ok: false, error: "MES_FECHADO", message: err.message });
      }
      // ⚠ AS DUAS CONFERÊNCIAS DA COMPOSIÇÃO DECLARADA — os MESMOS códigos e os MESMOS status da
      // rota `/baixa-manual`, de propósito: é a mesma exigência ("o total tem de fechar, e o
      // servidor não deriva o acréscimo"), e dar-lhe outro nome aqui faria a tela precisar de dois
      // vocabulários para a mesma recusa.
      if (err?.code === "CONFERENCIA_DIVERGENTE") {
        return res.status(409).json({ ok: false, error: err.code, message: err.message, detalhe: err.detalhe });
      }
      if (err?.code === "CONFERENCIA_OBRIGATORIA") {
        return res.status(400).json({ ok: false, error: err.code, message: err.message, detalhe: err.detalhe });
      }
      log.error({ err: err?.message, guideId }, "Falha ao lançar baixa da parcela");
      return res.status(500).json({ ok: false, error: err?.code || "internal_error", message: err?.message });
    }
  });

  // ⚠ A BAIXA DA PARCELA **SEM GUIA** — a via da DECLARAÇÃO (débito automático).
  //
  // Rota SEPARADA da de cima, e o segmento final (`baixa-manual`) é o que a distingue — não há
  // colisão com `/parcelas/:guideId/baixa`. Duas portas porque são duas coisas diferentes: lá o
  // parâmetro é a GUIA e a composição vem do documento; aqui o parâmetro é a PARCELA (o contrato) e
  // juros/multa são DECLARADOS pelo contador, porque num débito automático não existe documento
  // nenhum de onde lê-los. O serviço recusa cada uma no terreno da outra.
  //
  // ⚠ `totalConferido` É OBRIGATÓRIO no body — ato de consequência. A rota grava `AccountingEntry`
  // a partir de números informados pelo próprio contador; o servidor recalcula
  // `valorPrevisto + juros + multa` e recusa (409 `CONFERENCIA_DIVERGENTE`) se não bater com o que
  // foi conferido na tela. Mesmo padrão que `EstornoBaixaService` já usa.
  //
  // body: { dataPagamento?, valorJuros?, valorMulta?, totalConferido }
  router.post("/parcelamentos/parcelas/:parcelaId/baixa-manual", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const parcelaId = String(req.params.parcelaId);
    const { dataPagamento, valorJuros, valorMulta, totalConferido } = req.body || {};
    try {
      const { gerarPagamentoParcelaManual } = await import(
        "../../application/accounting/parcelamento/ParcelamentoV2Service.js"
      );
      const out = await gerarPagamentoParcelaManual({
        portalClientId, parcelaId, userId: req.auth?.user?.id,
        dataPagamento, valorJuros, valorMulta, totalConferido,
      });
      // ⚠ `skipped` NÃO é sucesso silencioso — mesma lição da rota da guia logo acima, onde o 201
      // `ok:true` numa recusa fazia o contador clicar e a linha só sumir da lista. Cada motivo tem
      // o status que o descreve, para a tela poder dizer o que houve.
      if (out?.skipped) {
        const status = {
          parcela_not_found: 404,
          parcelamento_not_found: 404,
          parcela_tem_guia: 409,
          parcela_ja_baixada: 409,
          provisao_inexistente: 409,
          sem_valor_previsto: 422,
          acrescimo_negativo: 400,
          data_invalida: 400,
        }[out.reason] || 400;
        return res.status(status).json({ ok: false, skipped: true, motivo: out.reason, resultado: out });
      }
      return res.status(201).json({ ok: true, resultado: out });
    } catch (err) {
      const code = err?.code;
      if (code === "MES_FECHADO" || code === "CONFERENCIA_DIVERGENTE") {
        return res.status(409).json({ ok: false, error: code, message: err.message, detalhe: err.detalhe });
      }
      if (code === "CONFERENCIA_OBRIGATORIA") {
        return res.status(400).json({ ok: false, error: code, message: err.message, detalhe: err.detalhe });
      }
      log.error({ err: err?.message, parcelaId }, "Falha ao lançar baixa manual da parcela");
      return res.status(500).json({ ok: false, error: code || "internal_error", message: err?.message });
    }
  });

  // ⚠ CORRIGIR O VALOR **CONTRATADO** DE UMA PRESTAÇÃO — e ele NÃO é o valor pago.
  //
  // O módulo tem dois números com o mesmo apelido: o CONTRATADO (`parcelas.valorPrevisto`, o que o
  // acordo diz que a prestação vale — é ele que a baixa amortiza do passivo) e o PAGO
  // (`principal + juros + multa`, o que saiu da conta). A diferença entre os dois é informação, não
  // erro de digitação, e continua sendo expressa em juros/multa na baixa. Esta rota mexe SÓ no
  // primeiro, e por isso é uma rota própria em vez de um campo a mais no body da baixa.
  //
  // ⚠ ELA NÃO GRAVA LANÇAMENTO NENHUM. A forma do lançamento não muda: a baixa seguinte lê o valor
  // corrigido pelo mesmo `linhasPagamento` (`D PARC / D JUROS / D MULTA / C CAIXA`), e D=C continua
  // fechando no lote por construção.
  //
  // ⚠ POR QUE ELA PRECISOU EXISTIR: contrato criado pelo wizard (sem guia e sem composição por
  // tributo) nasce com todas as prestações em `valorPrevisto = 0`, e a fila devolve
  // `sem_valor_previsto` em todas — com a mensagem mandando "corrija o valor da parcela no
  // contrato", que era exatamente o que não havia como fazer.
  //
  // body: { valorPrevisto, valorAnteriorConferido }   ⚠ o segundo é o ato de consequência
  router.patch(
    "/parcelamentos/parcelas/:parcelaId/valor-previsto",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    async (req, res) => {
      const portalClientId = String(req.params.companyId);
      const parcelaId = String(req.params.parcelaId);
      const body = req.body || {};
      try {
        const { corrigirValorPrevistoParcela } = await import(
          "../../application/accounting/parcelamento/ParcelamentoV2Service.js"
        );
        const out = await corrigirValorPrevistoParcela({
          portalClientId, parcelaId, userId: req.auth?.user?.id,
          valorPrevisto: body.valorPrevisto,
          // ⚠ `undefined` (chave ausente) e `null` ("não havia valor") são DIFERENTES aqui: o
          // serviço recusa a primeira com `CONFERENCIA_OBRIGATORIA` e aceita a segunda como uma
          // conferência legítima. Usar `?? null` colapsaria as duas e mataria a exigência.
          ...("valorAnteriorConferido" in body
            ? { valorAnteriorConferido: body.valorAnteriorConferido }
            : {}),
        });
        if (out?.skipped) {
          const status = {
            parcela_not_found: 404,
            parcela_tem_guia: 409,
            parcela_ja_baixada: 409,
            valor_invalido: 400,
          }[out.reason] || 400;
          return res.status(status).json({ ok: false, skipped: true, motivo: out.reason, resultado: out });
        }
        return res.json({ ok: true, resultado: out });
      } catch (err) {
        const code = err?.code;
        if (code === "CONFERENCIA_DIVERGENTE") {
          return res.status(409).json({ ok: false, error: code, message: err.message, detalhe: err.detalhe });
        }
        if (code === "CONFERENCIA_OBRIGATORIA") {
          return res.status(400).json({ ok: false, error: code, message: err.message, detalhe: err.detalhe });
        }
        log.error({ err: err?.message, parcelaId }, "Falha ao corrigir o valor previsto da parcela");
        return res.status(500).json({ ok: false, error: code || "internal_error", message: err?.message });
      }
    },
  );

  // POST /firm/companies/:companyId/parcelamentos/:parcId/rescindir
  // body: { dataRescisao?, observacoes?, rescisaoLines? }
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
      // ⚠ A rescisão GRAVA LANÇAMENTO CONTÁBIL, então ela tem a mesma trava de mês fechado das
      // baixas — e a recusa chega com `err.code`, não pelo `message` (a mensagem é a frase que o
      // contador lê). Sem esta tradução ela viraria um 500 genérico, que na tela é
      // indistinguível de defeito.
      if (err?.code === "MES_FECHADO") {
        return res.status(409).json({
          ok: false, error: "MES_FECHADO", competencia: err.competencia, message: err.message,
        });
      }
      const code = err?.message || "internal_error";
      const map = {
        parcelamento_not_found: 404,
        parcelamento_not_active: 400,
        rescision_template_not_configured: 400,
        data_invalida: 400,
      };
      const status = map[code] || 500;
      if (status === 500) log.error({ err }, "Falha ao rescindir parcelamento");
      return res.status(status).json({ ok: false, error: code });
    }
  });

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // OS ATOS ADMINISTRATIVOS DO CONTRATO — excluir, e desfazer a rescisão
  // ══════════════════════════════════════════════════════════════════════════════════════════
  //
  // Pedido do dono: *"Devo poder excluir um parcelamento... o parcelamento estava errado"*, com a
  // régua *"deve dar autonomia ao contador"*. Autonomia aqui é precisa: o servidor **não bloqueia**
  // a decisão dele (inclusive com prestação já baixada) — ele MOSTRA O PESO, com números reais, e
  // exige MOTIVO. Ver `parcelamento/AtosParcelamentoService.js`, onde as cinco regras estão escritas.
  //
  // ⚠ Cada ato tem DUAS rotas, como o estorno: um `preview` que **não escreve nada** e a execução.
  // A confirmação precisa dos números de AGORA — só o servidor sabe quantas prestações, quantas
  // guias e quantos lançamentos existem, e um "tem certeza?" sem esses números é o oposto de dar
  // autonomia: é pedir uma decisão sem entregar a informação que a sustenta.
  //
  // ⚠ Traduções de status: as recusas de negócio nunca viram 500. `MOTIVO_OBRIGATORIO` é 400 (falta
  // dado do contador); tudo que é estado do mundo (mês fechado, lote exportado, contrato mudou) é
  // 409, com a mensagem dizendo o caminho de saída.
  const STATUS_ATO_PARCELAMENTO = {
    parcelamento_nao_encontrado: 404,
    MOTIVO_OBRIGATORIO: 400,
    CONFERENCIA_DIVERGENTE: 409,
    CONTRATO_MUDOU: 409,
    MES_CORRENTE_FECHADO: 409,
    LOTE_JA_EXPORTADO: 409,
    PARCELAMENTO_NAO_RESCINDIDO: 409,
  };
  function responderAto(res, err, contexto) {
    const code = err?.code || "internal_error";
    const status = STATUS_ATO_PARCELAMENTO[code] || 500;
    if (status === 500) log.error({ err: err?.message, ...contexto }, "Falha em ato de parcelamento");
    return res.status(status).json({
      ok: false, error: code, message: err?.message, detalhe: err?.detalhe,
      competencia: err?.competencia, entryId: err?.entryId,
    });
  }

  // GET /firm/companies/:companyId/parcelamentos/:parcId/exclusao/preview
  // O que vai acontecer, com números reais. NÃO ESCREVE NADA.
  router.get("/parcelamentos/:parcId/exclusao/preview", requireFirmCompanyAccess(), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const parcelamentoId = String(req.params.parcId);
    try {
      const { previewExclusaoParcelamento } = await import(
        "../../application/accounting/parcelamento/AtosParcelamentoService.js"
      );
      const preview = await previewExclusaoParcelamento({ portalClientId, parcelamentoId });
      return res.json({ ok: true, preview });
    } catch (err) {
      return responderAto(res, err, { parcelamentoId });
    }
  });

  // POST /firm/companies/:companyId/parcelamentos/:parcId/exclusao   { motivo, totalConferido? }
  //
  // ⚠ POST, e não DELETE, pelo mesmo motivo do estorno: isto é um ATO com motivo obrigatório e
  // corpo de conferência, não a remoção de um recurso. Um `DELETE` com body é o convite a alguém
  // chamá-lo sem body — e sem body não há motivo, que é a exigência número um.
  router.post("/parcelamentos/:parcId/exclusao", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const parcelamentoId = String(req.params.parcId);
    try {
      const { excluirParcelamento } = await import(
        "../../application/accounting/parcelamento/AtosParcelamentoService.js"
      );
      const resultado = await excluirParcelamento({
        portalClientId, parcelamentoId,
        motivo: req.body?.motivo,
        totalConferido: req.body?.totalConferido ?? null,
        userId: req.auth?.user?.id,
      });
      return res.json(resultado);
    } catch (err) {
      return responderAto(res, err, { parcelamentoId, msg: "exclusão de parcelamento" });
    }
  });

  // GET/POST .../parcelamentos/:parcId/desfazer-rescisao[/preview]
  //
  // ⚠ `rescindirParcelamento` NÃO TINHA INVERSO. Quem rescindiu o contrato errado ficava com uma
  // saída só — excluir um acordo que talvez quisesse manter, perdendo prestações e histórico junto.
  router.get("/parcelamentos/:parcId/desfazer-rescisao/preview", requireFirmCompanyAccess(), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const parcelamentoId = String(req.params.parcId);
    try {
      const { previewDesfazerRescisao } = await import(
        "../../application/accounting/parcelamento/AtosParcelamentoService.js"
      );
      const preview = await previewDesfazerRescisao({ portalClientId, parcelamentoId });
      return res.json({ ok: true, preview });
    } catch (err) {
      return responderAto(res, err, { parcelamentoId });
    }
  });

  router.post("/parcelamentos/:parcId/desfazer-rescisao", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const parcelamentoId = String(req.params.parcId);
    try {
      const { desfazerRescisaoParcelamento } = await import(
        "../../application/accounting/parcelamento/AtosParcelamentoService.js"
      );
      const resultado = await desfazerRescisaoParcelamento({
        portalClientId, parcelamentoId,
        motivo: req.body?.motivo,
        userId: req.auth?.user?.id,
      });
      return res.json(resultado);
    } catch (err) {
      return responderAto(res, err, { parcelamentoId, msg: "desfazer rescisão" });
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
