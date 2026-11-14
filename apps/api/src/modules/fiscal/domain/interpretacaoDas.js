// Interpretação legada do DAS: preservar ordem de busca, precisão e recusas.
// Recebe fatos do chamador; não realiza efeitos externos.
function parseNestedJsonString(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (!(raw.startsWith("{") || raw.startsWith("["))) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function searchValueDeep(input, matcher) {
  if (input == null) return null;
  if (Array.isArray(input)) {
    for (const item of input) {
      const found = searchValueDeep(item, matcher);
      if (found != null) return found;
    }
    return null;
  }
  if (typeof input === "string") {
    const parsed = parseNestedJsonString(input);
    if (parsed) return searchValueDeep(parsed, matcher);
    return null;
  }
  if (typeof input !== "object") return null;

  for (const [key, value] of Object.entries(input)) {
    if (matcher(key, value)) return value;
    if (typeof value === "string") {
      const parsed = parseNestedJsonString(value);
      if (parsed != null) {
        const nestedFound = searchValueDeep(parsed, matcher);
        if (nestedFound != null) return nestedFound;
      }
    }
    const found = searchValueDeep(value, matcher);
    if (found != null) return found;
  }
  return null;
}

function extractPdfBase64(payload) {
  const raw = searchValueDeep(payload, (key, value) => {
    const normalized = String(key || "").toLowerCase();
    if (!/pdf|arquivo|documento/.test(normalized)) return false;
    return typeof value === "string" && value.length > 100;
  });
  return raw ? String(raw).trim() : null;
}

function extractProviderMessages(payload) {
  if (!Array.isArray(payload?.mensagens)) return [];
  return payload.mensagens.map((item) => String(item?.texto || "").trim()).filter(Boolean);
}

function extractDateValue(payload) {
  const raw = searchValueDeep(payload, (key, value) => {
    const normalized = String(key || "").toLowerCase();
    return /venc/.test(normalized) && typeof value === "string";
  });
  return raw ? String(raw).trim() : null;
}

// ⚠ A resposta do SERPRO ECOA o envelope enviado, que contém
// `contratante.numero` / `contribuinte.numero` / `autorPedidoDados.numero` (CNPJs).
// Varrer o payload inteiro com um padrão frouxo de "numero" pegava o CNPJ do ESCRITÓRIO como se
// fosse o número do documento — foi o que gravou doc=39254243000191 em todas as guias de DAS
// (e faria o PAGTOWEB consultar o documento errado).
// Por isso: procura primeiro DENTRO de `dados` (a carga real da resposta); só então cai para o
// payload completo, aí com padrão ESTRITO (sem o "numero" solto).
// Exportado para o script de correção reextrair o número das guias já gravadas a partir do
// `extracted.rawPayload`, sem recapturar no SERPRO — a regra tem que ser a MESMA dos dois lados.
export function extractDocumentNumber(payload) {
  const casaEstrito = (key, value) => {
    const k = String(key || "").toLowerCase();
    if (typeof value === "object" || value == null) return false;
    return /(numero.*documento|numerodocumento|nosso.*numero|numerodar|numerodas|numeroguia)/.test(k);
  };

  // `dados` vem como string JSON escapada no envelope Integra Contador.
  const dadosRaw = payload && (payload.dados ?? payload.Dados);
  let dados = dadosRaw;
  if (typeof dadosRaw === "string") {
    try { dados = JSON.parse(dadosRaw); } catch { dados = null; }
  }
  if (dados && typeof dados === "object") {
    // Nome exato primeiro. Confirmado no payload real do GERARDAS12:
    // dados.detalhamentoDas.numeroDocumento = "07202619039520400". Buscar pelo nome exato evita
    // que um "numeroDeclaracao"/"numeroRecibo" qualquer vença por ordem de travessia.
    const exato = searchValueDeep(dados, casaEstrito);
    if (exato != null && String(exato).trim()) return String(exato).trim();

    const doDados = searchValueDeep(dados, (key, value) => {
      const k = String(key || "").toLowerCase();
      if (typeof value === "object" || value == null) return false;
      // Dentro de `dados` não há eco de envelope, então aqui "numero" solto é aceitável.
      return /(numero|nosso.*numero|documento)/.test(k);
    });
    if (doDados != null && String(doDados).trim()) return String(doDados).trim();
  }

  const raw = searchValueDeep(payload, casaEstrito);
  return raw == null ? null : String(raw).trim() || null;
}

function parseMoneyValue(raw) {
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const s = String(raw).trim();
  if (!s) return null;
  // Detecta separador decimal: o último '.' ou ',' é o decimal
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  let normalized;
  if (lastDot === -1 && lastComma === -1) normalized = s;
  else if (lastDot > lastComma) normalized = s.replace(/,/g, ""); // formato US: 1,234.56
  else normalized = s.replace(/\./g, "").replace(",", "."); // formato BR: 1.234,56
  const parsed = Number(normalized.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

// Extrai o valor da DAS percorrendo o payload por prioridade de chaves.
// Pula valores zero/null em níveis menos específicos para não pegar campos como "valorMulta=0".
function extractAmount(payload) {
  const PRIORITY_PATTERNS = [
    /valor.*total.*documento/i,
    /vlr.*total.*documento/i,
    /valor.*total.*pagar/i,
    /valor.*pagar.*total/i,
    /valor.*do.*documento/i,
    /^vlrtotaldocumento$/i,
    /^valortotaldocumento$/i,
    /^valortotal$/i,
    /^vlrtotal$/i,
    /^valor.*pagar$/i,
    /^valor.*principal$/i,
    /^vlrprincipal$/i,
    /^valor$/i,
  ];
  for (const pattern of PRIORITY_PATTERNS) {
    const raw = searchValueDeep(payload, (key, value) => {
      const normalized = String(key || "").toLowerCase().replace(/_/g, "");
      if (!pattern.test(normalized)) return false;
      const parsed = parseMoneyValue(value);
      return parsed != null && parsed > 0; // ignora zeros
    });
    if (raw != null) {
      const parsed = parseMoneyValue(raw);
      if (parsed != null && parsed > 0) return parsed;
    }
  }
  // Fallback: aceita zero se nenhum positivo encontrado
  const fallback = searchValueDeep(payload, (key, value) => {
    const normalized = String(key || "").toLowerCase();
    return /(valor.*total|valortotal|valor)/.test(normalized) && (typeof value === "number" || typeof value === "string");
  });
  return parseMoneyValue(fallback);
}

function extractAmountByKeys(payload, patterns) {
  const raw = searchValueDeep(payload, (key, value) => {
    const normalized = String(key || "").toLowerCase();
    return patterns.some((pattern) => pattern.test(normalized)) && (typeof value === "number" || typeof value === "string");
  });
  return parseMoneyValue(raw);
}

export function parsePossibleDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return new Date(raw);
  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return new Date(`${br[3]}-${br[2]}-${br[1]}T00:00:00.000Z`);
  // ⚠⚠ `AAAAMMDD` COMPACTO — É ASSIM QUE O SERPRO MANDA O VENCIMENTO DO DAS.
  //
  // `dados[].detalhamentoDas.dataVencimento` vem como "20260622", e `new Date("20260622")` é
  // **Invalid Date** — o `Number.isNaN` abaixo devolvia `null` e o vencimento sumia SEM ERRO.
  // Medido em 21/08/2026: `Guide.vencimento` nulo em **51 de 67** guias de SIMPLES processadas,
  // com a data presente em **51 de 51** dos payloads guardados.
  //
  // ⚠ A consequência já estava ativa e era silenciosa: `CalendarioFiscalService` FILTRA por
  // `vencimento`, então essas 51 guias de DAS **não apareciam no calendário fiscal** — sem
  // mensagem, sem contador, sem nada. Guia que não aparece é guia que não é paga.
  //
  // A faixa é conferida em vez de aceita: `new Date("20261301")` (mês 13) só falharia mais tarde,
  // e mês/dia impossíveis significam que o campo NÃO é uma data — devolver `null` ali é a
  // resposta certa, e é a mesma que o caminho antigo dava.
  const compacto = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compacto) {
    const [, ano, mes, dia] = compacto;
    const m = Number(mes);
    const d = Number(dia);
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    const data = new Date(`${ano}-${mes}-${dia}T00:00:00.000Z`);
    return Number.isNaN(data.getTime()) ? null : data;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseBrMoney(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  const normalized = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  const parsed = Number(normalized.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

// Lê o PDF da DAS e tenta achar o "Valor Total do Documento".
// Usado como fallback quando o JSON do GERARDAS12 (Normal) não traz valor.
export function extractDasValueFromText(pdfText) {
  const text = String(pdfText || "");
  const patterns = [
    /Valor\s+Total\s+do\s+Documento\s*\n\s*(\d+[\d.]*,\d{2})/i,
    /Valor\s+Total\s+do\s+Documento\s+(\d+[\d.]*,\d{2})/i,
    /Valor\s+Total\s+do\s+Documento[^\d]{0,40}(\d+[\d.]*,\d{2})/i,
  ];
  for (const p of patterns) {
    const match = p.exec(text);
    if (match?.[1]) {
      const v = parseBrMoney(match[1]);
      if (v != null && v > 0) return v;
    }
  }
  // Fallback: linha "Totais X,XX X,XX" — pega o último valor (coluna Total)
  const totaisMatch = text.match(/^Totais\s+([\d.,]+)/im);
  if (totaisMatch?.[1]) {
    const values = totaisMatch[1].match(/\d+(?:\.\d{3})*,\d{2}/g);
    if (values && values.length > 0) {
      const v = parseBrMoney(values[values.length - 1]);
      if (v != null && v > 0) return v;
    }
  }
  // Fallback: "Principal X,XX Multa X,XX Juros X,XX Total X,XX"
  const totalMatch = text.match(/Principal[^\n]*?Total\s+(\d+[\d.]*,\d{2})/i);
  if (totalMatch?.[1]) {
    const v = parseBrMoney(totalMatch[1]);
    if (v != null && v > 0) return v;
  }
  return null;
}

export function buildPgdasGuidePayload({ response, contribuinteCnpj, competencia }) {
  const pdfBase64 = extractPdfBase64(response);
  if (!pdfBase64) {
    const providerMessages = extractProviderMessages(response);
    const noDebtMessage = providerMessages.find((message) => /nao foram encontrados debitos/i.test(message));
    if (noDebtMessage) {
      const err = new Error(noDebtMessage);
      err.code = "SERPRO_PGDASD_NO_DEBTS_FOUND";
      err.details = response;
      throw err;
    }

    const noAmountDueMessage = providerMessages.find((message) => /nao foi gerado das por nao haver valor devido/i.test(message));
    if (noAmountDueMessage) {
      const err = new Error(noAmountDueMessage);
      err.code = "SERPRO_PGDASD_NO_AMOUNT_DUE";
      err.details = response;
      throw err;
    }

    const noDeclarationMessage = providerMessages.find((message) => /nao ha declaracao transmitida para o periodo informado/i.test(message));
    if (noDeclarationMessage) {
      const err = new Error(noDeclarationMessage);
      err.code = "SERPRO_PGDASD_DECLARATION_NOT_TRANSMITTED";
      err.details = response;
      throw err;
    }

    const err = new Error("serpro_pgdasd_pdf_not_found");
    err.code = "SERPRO_PGDASD_PDF_NOT_FOUND";
    err.details = response;
    throw err;
  }

  const pdfBuffer = Buffer.from(pdfBase64, "base64");
  if (!pdfBuffer.length) {
    const err = new Error("serpro_pgdasd_pdf_invalid");
    err.code = "SERPRO_PGDASD_PDF_INVALID";
    throw err;
  }

  const numeroDocumento = extractDocumentNumber(response);
  const valor = extractAmount(response);
  const receitaBruta = extractAmountByKeys(response, [/receita.*bruta/, /receita_bruta/, /receitabruta/]);
  const inssTotal = extractAmountByKeys(response, [/inss/, /dctf.*web/, /dctfweb/]);
  const vencimento = parsePossibleDate(extractDateValue(response));

  return {
    parsed: {
      cnpj: contribuinteCnpj,
      competencia,
      tipo: "SIMPLES",
      valor,
      receitaBruta,
      inssTotal,
      vencimento: vencimento ? vencimento.toISOString() : null,
    },
    pdfBuffer,
    numeroDocumento,
    rawPayload: response,
  };
}
