// O PARSER DE OFX — SGML v1 e XML v2.
//
// ⚠⚠ EXTRAÍDO DE `routes/firm/accountingEntries.js` (bloco `:270-414`) EM 24/08/2026, SEM UMA
// LINHA DE MUDANÇA DE COMPORTAMENTO. O código abaixo é o que estava lá, movido.
//
// ## Por que saiu de lá
//
// Ele não era exportado, e `accountingEntries.js` é uma fábrica de router de 4.848 linhas que
// carrega Prisma, o motor de regras e o resto do módulo contábil. O portal do CLIENTE precisa do
// MESMO parser: reescrevê-lo daria duas leituras do mesmo extrato, e elas divergiriam na primeira
// correção de separador decimal — que é onde um erro não dá "um valor um pouco diferente", dá um
// valor 1000× maior ou menor.
//
// ## ⚠ O que este módulo NÃO conserta (de propósito, e está medido)
//
// A extração é pura. Os defeitos abaixo são REAIS, estão registrados em
// `routes/firm/__tests__/ofxImportCaracterizacao.test.js` (21 testes escritos ANTES deste
// movimento) e serão tratados deliberadamente, não de carona num refator:
//
//   1. ⚠⚠ `parseOfx` DESCARTA EM SILÊNCIO a transação sem data e a de valor zero (o `.filter` no
//      fim). Numa importação de extrato isso é dinheiro sumindo da conferência sem uma palavra.
//   2. ⚠⚠ ELE NÃO LÊ `<BANKACCTFROM><ACCTID>`, embora todo arquivo o traga. Sem a conta bancária,
//      duas contas da mesma empresa com o mesmo valor no mesmo dia são indistinguíveis — e a
//      idempotência do import não fecha.
//   3. O `fitId` é lido, chega ao preview e é DESCARTADO no commit: ele nem existe no
//      `schema.prisma`. É por isso que subir o mesmo arquivo duas vezes duplica tudo.
//
// ⚠ ESTE MÓDULO É PURO: nenhum Prisma, nenhum I/O, nenhum relógio. Recebe um Buffer, devolve
// transações.

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

export function parseOfx(buffer) {
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
