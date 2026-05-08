import { prisma } from "../../infrastructure/db/prisma.js";

/**
 * Importação compartilhada de plano de contas (PDF ou CSV).
 * Suporta tanto escopo COMPANY (portalClientId = "<id>") quanto GLOBAL (portalClientId = null).
 *
 * Devido à limitação do Prisma de não permitir nulls em composite unique keys via upsert,
 * a função usa findFirst+update/create em vez de upsert direto.
 */

function tipoFromContaPdf(conta) {
  if (/^4[.\s]|^4$/.test(conta)) return "DESPESA";
  if (/^3[.\s]|^3$/.test(conta)) return "RECEITA";
  if (/^2\.4/.test(conta)) return "PATRIMONIO";
  if (/^2[.\s]|^2$/.test(conta)) return "PASSIVO";
  if (/^1[.\s]|^1$/.test(conta)) return "ATIVO";
  return "DESPESA";
}

function tipoFromCodigoPadrao(cod) {
  const first = String(cod || "").charAt(0);
  if (first === "1") return "ATIVO";
  if (first === "2") {
    if (/^24/.test(cod)) return "PATRIMONIO";
    return "PASSIVO";
  }
  if (first === "3") return "RECEITA";
  if (first === "4" || first === "5") return "DESPESA";
  return "DESPESA";
}

function naturezaFromTipo(tipo) {
  return ["PASSIVO", "RECEITA", "PATRIMONIO"].includes(tipo) ? "CREDORA" : "DEVEDORA";
}

function parsePdfBuffer(rawText) {
  const ROW_RE = /^(\d{1,6})\s+([\d.]+)\s+(.+?)\s+\d\s*$/;
  const ROW_RE2 = /^(\d{1,6})\s+(.+)$/;
  const textLines = rawText.split(/\n/).map((l) => l.trim()).filter(Boolean);
  const accounts = [];
  for (const line of textLines) {
    let m = ROW_RE.exec(line);
    if (m) {
      const [, reduzido, conta, nome] = m;
      const tipo = tipoFromContaPdf(conta);
      accounts.push({ codigo: reduzido, nome: nome.trim(), tipo, natureza: naturezaFromTipo(tipo) });
      continue;
    }
    m = ROW_RE2.exec(line);
    if (m) {
      const [, reduzido, rest] = m;
      const contaM = /^([\d.]{3,})\s+(.+)$/.exec(rest);
      if (contaM) {
        const tipo = tipoFromContaPdf(contaM[1]);
        accounts.push({ codigo: reduzido, nome: contaM[2].trim(), tipo, natureza: naturezaFromTipo(tipo) });
      }
    }
  }
  return accounts;
}

function detectSeparator(line) {
  // Conta ocorrências e escolhe o mais frequente entre ; , e \t
  const counts = { ";": 0, ",": 0, "\t": 0 };
  for (const ch of line) {
    if (counts[ch] !== undefined) counts[ch]++;
  }
  let best = ";";
  for (const sep of Object.keys(counts)) {
    if (counts[sep] > counts[best]) best = sep;
  }
  return counts[best] > 0 ? best : ";";
}

function splitCols(line, sep) {
  return line.split(sep).map((s) => s.replace(/^"(.*)"$/, "$1").trim());
}

function parseCsvBuffer(buffer) {
  // Detecta encoding: UTF-8 → fallback latin1 se houver replacement chars
  const utf8Attempt = buffer.toString("utf-8");
  let text = utf8Attempt.includes("�") ? buffer.toString("latin1") : utf8Attempt;
  // Remove BOM (UTF-8 BOM = U+FEFF) se presente
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  // Detecta separador a partir da primeira linha não-vazia
  const sep = detectSeparator(lines[0]);

  function isHeader(cols) {
    if (!cols.length) return false;
    const c0 = cols[0].toLowerCase();
    return c0 === "codigo" || c0 === "código" || c0 === "code";
  }

  function detectFormat(rows) {
    for (const line of rows) {
      const cols = splitCols(line, sep);
      if (cols.length < 2) continue;
      if (isHeader(cols)) return "padrao";
      // Formato exportado: col[2] é número puro (código reduzido sequencial)
      if (cols.length >= 3 && /^\d+$/.test(cols[2])) return "exportado";
      // Padrão: col[0] é o código (numérico ou estruturado)
      if (/^[\d.]+$/.test(cols[0])) return "padrao";
      return "padrao";
    }
    return "padrao";
  }

  const formato = detectFormat(lines);
  const accounts = [];
  for (const line of lines) {
    const cols = splitCols(line, sep);
    if (cols.length < 2) continue;
    if (isHeader(cols)) continue;

    let codigo, nome, tipo, natureza;
    if (formato === "exportado") {
      const [codigoPadrao, nomeRaw, codigoReduzido] = cols;
      if (!codigoPadrao || !nomeRaw || !codigoReduzido) continue;
      if (!/^\d+$/.test(codigoReduzido)) continue;
      codigo = codigoReduzido;
      nome = nomeRaw;
      tipo = tipoFromCodigoPadrao(codigoPadrao);
      natureza = naturezaFromTipo(tipo);
    } else {
      [codigo, nome, tipo = "DESPESA", natureza = "DEVEDORA"] = cols;
      if (!codigo || !nome) continue;
      tipo = String(tipo).toUpperCase();
      natureza = String(natureza).toUpperCase();
      // Se tipo não for válido, deriva do código quando possível
      if (!["ATIVO", "PASSIVO", "RECEITA", "DESPESA", "PATRIMONIO"].includes(tipo)) {
        tipo = tipoFromCodigoPadrao(codigo);
        natureza = naturezaFromTipo(tipo);
      }
    }
    if (!codigo || !nome) continue;
    accounts.push({ codigo, nome, tipo, natureza });
  }
  return accounts;
}

async function upsertAccount({ portalClientId, codigo, nome, tipo, natureza, defaultStatus = "PENDENTE_ERP" }) {
  // Semântica: per-empresa SEMPRE tem prioridade sobre global.
  // Cada escopo (global ou empresa) é independente — códigos podem coexistir entre escopos
  // sem conflito; na leitura, empresa vence (dedupe na rota GET).
  // Prisma não suporta composite unique com null, então fazemos findFirst + update/create.
  const isGlobal = portalClientId == null;
  const existing = await prisma.chartOfAccount.findFirst({
    where: { portalClientId: isGlobal ? null : portalClientId, codigo },
  });
  if (existing) {
    return prisma.chartOfAccount.update({
      where: { id: existing.id },
      data: { nome, tipo, natureza },
    });
  }
  return prisma.chartOfAccount.create({
    data: { portalClientId: isGlobal ? null : portalClientId, codigo, nome, tipo, natureza, status: defaultStatus },
  });
}

/**
 * Processa o arquivo enviado e retorna { ok, created, skipped, errors } ou error code.
 * @param {Object} opts
 * @param {string|null} opts.portalClientId - ID da empresa, ou null para escopo global
 * @param {Buffer} opts.buffer - conteúdo do arquivo
 * @param {string} [opts.filename] - nome original (usado para detectar PDF)
 * @param {string} [opts.mimeType]
 * @param {string} [opts.defaultStatus] - status default das contas criadas (PENDENTE_ERP por padrão; CONFIRMADA para PDF do ERP)
 */
export async function importChartOfAccountsFromBuffer({ portalClientId, buffer, filename, mimeType, defaultStatus }) {
  if (!buffer?.length) return { ok: false, error: "file_required" };
  const isPdf = mimeType === "application/pdf" || filename?.endsWith(".pdf");

  let parsed;
  if (isPdf) {
    try {
      const pdfParse = (await import("pdf-parse")).default;
      const pdfData = await pdfParse(buffer);
      const rawText = String(pdfData?.text || "");
      parsed = parsePdfBuffer(rawText);
    } catch (err) {
      return { ok: false, error: "pdf_import_failed", message: err?.message };
    }
    if (parsed.length === 0) {
      return {
        ok: false,
        error: "pdf_no_accounts_found",
        hint: "Nenhuma conta reconhecida no PDF. Verifique se o arquivo é o Relatório de Plano de Contas exportado do ERP, ou use um CSV (código;nome;tipo;natureza).",
      };
    }
    // PDF do ERP: contas já confirmadas no ERP
    defaultStatus = defaultStatus || "CONFIRMADA";
  } else {
    parsed = parseCsvBuffer(buffer);
    defaultStatus = defaultStatus || "PENDENTE_ERP";
  }

  const created = [];
  const skipped = [];
  const errors = [];
  for (const acc of parsed) {
    try {
      const result = await upsertAccount({ portalClientId, ...acc, defaultStatus });
      created.push(result);
    } catch (err) {
      // Se conflito com global (no caso de import per-company), pular
      if (err?.code === "P2002") skipped.push(acc.codigo);
      else errors.push({ codigo: acc.codigo, reason: err?.message });
    }
  }

  if (errors.length > 0) {
    // Log do primeiro erro no servidor para facilitar debug
    // eslint-disable-next-line no-console
    console.error(
      `[chartOfAccountsImport] portalClientId=${portalClientId ?? "GLOBAL"} parsed=${parsed.length} created=${created.length} skipped=${skipped.length} errors=${errors.length}`,
      "\nPrimeiro erro:", errors[0]
    );
  }

  return { ok: true, created: created.length, skipped: skipped.length, errors };
}
