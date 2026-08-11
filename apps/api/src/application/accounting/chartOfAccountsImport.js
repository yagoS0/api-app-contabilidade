import { prisma } from "../../infrastructure/db/prisma.js";
import { rederivarAnaliticaDoEscopo } from "./chartOfAccountsAnalitica.js";

/**
 * Importação compartilhada de plano de contas (PDF ou CSV).
 * Suporta tanto escopo COMPANY (portalClientId = "<id>") quanto GLOBAL (portalClientId = null).
 *
 * Devido à limitação do Prisma de não permitir nulls em composite unique keys via upsert,
 * a função usa findFirst+update/create em vez de upsert direto.
 *
 * ⚠ A IDENTIDADE É O CÓDIGO REDUZIDO, E O IMPORT NUNCA A TROCA.
 * `AccountingEntryLine.conta` guarda o código como TEXTO, sem FK. Se o import "corrigisse" o
 * reduzido de uma conta, todo lançamento existente apontaria para um código que não existe mais —
 * sem erro na tela, sem exceção, sem nada. Por isso o casamento é POR `codigo` e o que a coluna
 * nova traz (`codigoCompleto`) é ACRÉSCIMO.
 *
 * ⚠ A ARMADILHA DAS DUAS COLUNAS DE CÓDIGO — a razão de o formato ser DECLARADO e não inferido.
 * No arquivo real do ERP (`completo;nome;reduzido;…`) **42 códigos existem NAS DUAS colunas e 41
 * apontam para contas DIFERENTES**:
 *
 *     "5" como reduzido → CAIXA - MATRIZ        "5" como completo → (-) IRPJ/CSLL (reduzida 590)
 *     "2" como reduzido → ATIVO CIRCULANTE      "2" como completo → PASSIVO
 *
 * As duas colunas são só dígitos, nos dois sentidos. Lê-las na ordem errada mapeia 41 contas para o
 * lugar errado **sem dar erro nenhum**. `detectFormat` DECLARA a ordem pela forma da linha inteira;
 * nada aqui adivinha coluna por coluna.
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

export function parseCsvBuffer(buffer) {
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

    let codigo, nome, tipo, natureza, codigoCompleto;
    if (formato === "exportado") {
      // ⚠ A ORDEM DAS COLUNAS É DECLARADA AQUI, e é a única coisa que separa `CAIXA - MATRIZ` de
      // `(-) IRPJ/CSLL`. Ver a armadilha das duas colunas no topo do arquivo.
      // ⚠ O arquivo real do ERP tem SEIS colunas (`completo;nome;reduzido;0;0;0`) — as três últimas
      // vêm zeradas e não são lidas: significado desconhecido, e ler dado que não se entende é
      // pior que ignorá-lo.
      const [codigoPadrao, nomeRaw, codigoReduzido] = cols;
      if (!codigoPadrao || !nomeRaw || !codigoReduzido) continue;
      if (!/^\d+$/.test(codigoReduzido)) continue;
      codigo = codigoReduzido;
      nome = nomeRaw;
      tipo = tipoFromCodigoPadrao(codigoPadrao);
      natureza = naturezaFromTipo(tipo);
      codigoCompleto = codigoPadrao;
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
    // ⚠ `codigoCompleto` só viaja quando o formato o TEM. `undefined` aqui quer dizer "este arquivo
    // não fala sobre isso" — e o upsert traduz isso em "não toca na coluna", nunca em apagá-la.
    accounts.push({ codigo, nome, tipo, natureza, codigoCompleto });
  }
  return accounts;
}

async function upsertAccount({ portalClientId, codigo, nome, tipo, natureza, codigoCompleto, defaultStatus = "PENDENTE_ERP" }) {
  // Semântica: per-empresa SEMPRE tem prioridade sobre global.
  // Cada escopo (global ou empresa) é independente — códigos podem coexistir entre escopos
  // sem conflito; na leitura, empresa vence (dedupe na rota GET).
  // Prisma não suporta composite unique com null, então fazemos findFirst + update/create.
  const isGlobal = portalClientId == null;
  const existing = await prisma.chartOfAccount.findFirst({
    where: { portalClientId: isGlobal ? null : portalClientId, codigo },
  });
  // ⚠ Arquivo sem a coluna não APAGA a conta mãe já conhecida — só não fala sobre ela.
  const acrescimo = codigoCompleto ? { codigoCompleto: String(codigoCompleto) } : {};
  if (existing) {
    // ⚠ `codigo` NÃO está no `data`, e isso é a garantia, não o descuido: ele é a identidade a que
    // `AccountingEntryLine.conta` aponta em texto.
    return prisma.chartOfAccount.update({
      where: { id: existing.id },
      data: { nome, tipo, natureza, ...acrescimo },
    });
  }
  return prisma.chartOfAccount.create({
    data: { portalClientId: isGlobal ? null : portalClientId, codigo, nome, tipo, natureza, ...acrescimo, status: defaultStatus },
  });
}

/**
 * Leva `codigoCompleto` do arquivo para as contas PRÓPRIAS das empresas — casando pelo REDUZIDO,
 * e só nele. Decisão do dono: *"atualiza tudo, mantém"* — o import atualiza o escopo global E as
 * contas próprias das empresas.
 *
 * ⚠ SÓ ACRESCENTA `codigoCompleto`. Nome, tipo e natureza da conta PRÓPRIA de uma empresa são dela;
 * o arquivo global não é autoridade sobre eles, e sobrescrevê-los apagaria em silêncio a
 * customização que motivou a empresa a ter conta própria.
 *
 * ⚠ NÃO CRIA CONTA NENHUMA. Conta do arquivo que a empresa não tem continua não existindo lá —
 * criar despejaria as 593 contas globais dentro de cada empresa, transformando um plano
 * compartilhado em 30 cópias.
 *
 * @returns {Promise<Set<string>>} os `portalClientId` que tiveram alguma conta tocada
 */
async function propagarCodigoCompletoParaEmpresas(parsed) {
  const comCompleto = parsed.filter((a) => a.codigoCompleto);
  if (comCompleto.length === 0) return new Set();

  const escoposTocados = new Set();
  for (const acc of comCompleto) {
    const alvos = await prisma.chartOfAccount.findMany({
      where: { codigo: acc.codigo, portalClientId: { not: null } },
      select: { id: true, portalClientId: true, codigoCompleto: true },
    });
    const desatualizadas = alvos.filter((a) => a.codigoCompleto !== String(acc.codigoCompleto));
    if (desatualizadas.length === 0) {
      for (const a of alvos) escoposTocados.add(a.portalClientId);
      continue;
    }
    await prisma.chartOfAccount.updateMany({
      where: { id: { in: desatualizadas.map((a) => a.id) } },
      data: { codigoCompleto: String(acc.codigoCompleto) },
    });
    for (const a of alvos) escoposTocados.add(a.portalClientId);
  }
  return escoposTocados;
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

  // ⚠ O QUE JÁ ESTAVA NO BANCO E NÃO ESTÁ NO ARQUIVO É **MANTIDO COMO ESTÁ** (decisão do dono).
  // Nada é apagado, inativado ou zerado — e a contagem é RELATADA, porque silêncio aqui é o
  // defeito: um arquivo parcial passaria por completo.
  const antes = await prisma.chartOfAccount.findMany({
    where: { portalClientId: portalClientId ?? null },
    select: { codigo: true },
  });
  const noArquivo = new Set(parsed.map((a) => String(a.codigo)));
  const mantidas = antes.filter((a) => !noArquivo.has(String(a.codigo))).map((a) => a.codigo);
  const existentes = new Set(antes.map((a) => String(a.codigo)));

  const created = [];
  const skipped = [];
  const errors = [];
  const novas = [];
  for (const acc of parsed) {
    try {
      const result = await upsertAccount({ portalClientId, ...acc, defaultStatus });
      created.push(result);
      if (!existentes.has(String(acc.codigo))) novas.push(acc.codigo);
    } catch (err) {
      // Se conflito com global (no caso de import per-company), pular
      if (err?.code === "P2002") skipped.push(acc.codigo);
      else errors.push({ codigo: acc.codigo, reason: err?.message });
    }
  }

  // ⚠ A PROPAGAÇÃO SÓ SAI DO IMPORT **GLOBAL**. O arquivo global é o plano do escritório e é
  // autoridade sobre a conta mãe; o CSV que uma empresa sobe é dela, e deixá-lo reescrever o plano
  // global (e o das outras 30 empresas) faria um upload de uma empresa mudar o de todas.
  const escoposEmpresa = portalClientId == null
    ? await propagarCodigoCompletoParaEmpresas(parsed)
    : new Set();

  // A derivação, escopo por escopo — nunca cruzando planos.
  const derivacao = { escopo: await rederivarAnaliticaDoEscopo(portalClientId ?? null), empresas: [] };
  for (const empresaId of escoposEmpresa) {
    derivacao.empresas.push({ portalClientId: empresaId, ...(await rederivarAnaliticaDoEscopo(empresaId)) });
  }

  if (errors.length > 0) {
    // Log do primeiro erro no servidor para facilitar debug
    // eslint-disable-next-line no-console
    console.error(
      `[chartOfAccountsImport] portalClientId=${portalClientId ?? "GLOBAL"} parsed=${parsed.length} created=${created.length} skipped=${skipped.length} errors=${errors.length}`,
      "\nPrimeiro erro:", errors[0]
    );
  }

  return {
    ok: true,
    created: created.length,
    skipped: skipped.length,
    errors,
    // ⚠ Relatório, não enfeite: sem ele o import parcial fica indistinguível do completo.
    novas: novas.length,
    atualizadas: created.length - novas.length,
    mantidas: mantidas.length,
    mantidasCodigos: mantidas.slice(0, 20),
    semCodigoCompleto: derivacao.escopo.semResposta,
    derivacao,
  };
}
