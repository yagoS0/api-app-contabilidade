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

/**
 * O CONTRATO ANTIGO, intacto: só as transações que sobreviveram ao filtro.
 *
 * ⚠⚠ ELE DELEGA A `lerOfx` — não é uma segunda leitura do arquivo. Duas implementações do mesmo
 * parse divergiriam na primeira correção de separador decimal, e ali o erro não dá "um valor um
 * pouco diferente": dá um valor 1000× maior ou menor.
 *
 * ⚠ Quem chama isto **não fica sabendo o que foi descartado** — é o comportamento de hoje do import
 * do escritório, preservado de propósito (mudá-lo é outro trabalho, e é o dele). Código novo deve
 * usar `lerOfx`.
 */
export function parseOfx(buffer) {
  return lerOfx(buffer).transacoes;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// A LEITURA COMPLETA — `lerOfx`
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// ⚠⚠ `parseOfx` ACIMA NÃO MUDA, e isso é deliberado. Ele tem um chamador em produção (o import do
// escritório) com 21 testes de caracterização em cima; mexer na forma do retorno dele seria mudar
// aquele caminho de carona num trabalho que é do portal do cliente. Ele passa a delegar, e devolve
// exatamente o que sempre devolveu.
//
// O que `lerOfx` acrescenta são as duas coisas que faltavam para o import do CLIENTE ser honesto:
//
//   1. **A CONTA BANCÁRIA.** Sem ela, dois extratos de contas diferentes da mesma empresa, com o
//      mesmo valor no mesmo dia, são indistinguíveis — e a idempotência do import não fecha.
//   2. **O QUE FOI DESCARTADO, NOMEADO.** O `.filter` de `parseOfx` derruba a transação sem data e
//      a de valor zero **sem uma palavra**. Numa importação de extrato isso é dinheiro sumindo da
//      conferência: quem confere não tem como saber se o arquivo tinha 23 linhas ou 25.

/** ⚠ Por que uma transação do arquivo não virou transação lida. Vocabulário FECHADO. */
export const DESCARTE = Object.freeze({
  SEM_DATA: "sem_data",
  VALOR_ZERO: "valor_zero",
});

export const FRASE_DO_DESCARTE = Object.freeze({
  [DESCARTE.SEM_DATA]: "A transação não traz data de lançamento (DTPOSTED).",
  [DESCARTE.VALOR_ZERO]: "A transação tem valor zero (TRNAMT).",
});

/**
 * A conta de onde veio o extrato.
 *
 * ⚠ SÓ dentro do bloco `<BANKACCTFROM>`/`<CCACCTFROM>`. Varrer o documento inteiro atrás de
 * `<ACCTID>` pegaria o `<BANKACCTTO>` de uma transferência — e aí o extrato seria atribuído à conta
 * de DESTINO. É a mesma disciplina de `danfseDados.js`, que lê por caminho justamente porque
 * `CNPJ` aparece em quatro grupos do XML da NFS-e.
 *
 * ⚠ Bloco ausente ou ilegível devolve `null`, nunca um palpite. Ausência é resposta; conta errada
 * não é.
 *
 * ⚠ `CCACCTFROM` (cartão de crédito) é lido pela mesma regra, mas **nenhum arquivo real de cartão
 * foi exercido** — está aqui porque ler uma tag não fabrica nada, e a alternativa seria a conta sair
 * nula num extrato que a traz. Marque como verificado quando um arquivo de cartão passar por aqui.
 */
export function lerContaDoExtrato(text) {
  const bloco = new RegExp(
    `<${NS}(?:BANKACCTFROM|CCACCTFROM)>([\\s\\S]*?)<\\/${NS}(?:BANKACCTFROM|CCACCTFROM)>`,
    "i",
  ).exec(String(text || ""));
  if (!bloco) return null;

  // ⚠ `[^<\n\r]*` serve aos DOIS dialetos: no XML ele para no `</TAG>`, no SGML para na quebra de
  // linha. Uma segunda leitura por dialeto divergiria na primeira correção.
  const get = (tag) => {
    const m = new RegExp(`<${NS}${tag}>([^<\\n\\r]*)`, "i").exec(bloco[1]);
    const v = m ? decodeHtmlEntities(m[1].trim()) : "";
    return v || null;
  };

  const bankId = get("BANKID");
  const acctId = get("ACCTID");
  const acctType = get("ACCTTYPE");
  // ⚠ Sem `ACCTID` não há conta: o banco sozinho não identifica de qual conta é o extrato.
  if (!acctId) return null;
  return { bankId, acctId, acctType };
}

/**
 * A leitura COMPLETA de um arquivo OFX.
 *
 * @returns {{conta: {bankId: string|null, acctId: string, acctType: string|null}|null,
 *            transacoes: Array<object>,
 *            descartadas: Array<{motivo: string, frase: string, fitId: string|null, historico: string, dtPosted: string|null, trnAmt: string|null}>}}
 */
export function lerOfx(buffer) {
  const text = decodeOfxBuffer(buffer);
  const headerSlice = text.slice(0, 800);
  const isXml = /<\?xml/i.test(headerSlice) || /<\?OFX/i.test(headerSlice);
  const raw = isXml ? parseOfxXml(text) : parseOfxSgml(text);

  const transacoes = [];
  const descartadas = [];

  for (const t of raw) {
    const amount = parseOfxAmount(t.trnAmt);
    const data = parseOfxDate(t.dtPosted);
    const valor = Math.abs(amount);

    // ⚠ A ORDEM IMPORTA: sem data é o defeito mais grave dos dois, e uma transação pode ter os dois
    // problemas. Reportá-la como "valor zero" mandaria conferir a coluna errada.
    const motivo = !data ? DESCARTE.SEM_DATA : valor > 0 ? null : DESCARTE.VALOR_ZERO;
    if (motivo) {
      descartadas.push({
        motivo,
        frase: FRASE_DO_DESCARTE[motivo],
        // ⚠ O CRU vai junto: quem confere precisa achar a linha no arquivo, e o valor já parseado
        // seria justamente o número em que não se pode confiar.
        fitId: t.fitId || null,
        historico: t.memo || "",
        dtPosted: t.dtPosted || null,
        trnAmt: t.trnAmt || null,
      });
      continue;
    }

    transacoes.push({
      fitId: t.fitId || null,
      trnType: String(t.trnType || "").toUpperCase(),
      data,
      valor,
      // Convenção bancária: TRNAMT < 0 = saída (DEBITO no extrato), > 0 = entrada (CREDITO no extrato)
      sinal: amount < 0 ? "DEBITO" : "CREDITO",
      historico: t.memo || "",
    });
  }

  return { conta: lerContaDoExtrato(text), transacoes, descartadas };
}
