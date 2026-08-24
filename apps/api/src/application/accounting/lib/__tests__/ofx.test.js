// A LEITURA COMPLETA DO OFX.
//
// ⚠ O comportamento do parser em si (dialetos, encoding, separador decimal, entidades) está
// travado em `routes/firm/__tests__/ofxImportCaracterizacao.test.js`, escrito ANTES da extração e
// não editado desde. Este arquivo cobre só o que `lerOfx` ACRESCENTA:
//
//   1. a CONTA BANCÁRIA, que `parseOfx` nunca leu;
//   2. o que foi DESCARTADO, nomeado — o `.filter` do parser antigo derrubava linha em silêncio.

import {
  DESCARTE,
  FRASE_DO_DESCARTE,
  lerContaDoExtrato,
  lerOfx,
  parseOfx,
} from "../ofx";

const buf = (s) => Buffer.from(s, "utf8");

const SGML = (corpo) => `OFXHEADER:100
DATA:OFXSGML
VERSION:102
ENCODING:USASCII

<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS>
<BANKACCTFROM><BANKID>341<ACCTID>12345-6<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST>
${corpo}
</BANKTRANLIST>
</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

const TRN = ({ tipo = "DEBIT", data = "20260715", valor = "-1500.00", fit = "F1", memo = "GOOGLE CLOUD" } = {}) =>
  `<STMTTRN>
${data === null ? "" : `<DTPOSTED>${data}`}
<TRNTYPE>${tipo}
<TRNAMT>${valor}
<FITID>${fit}
<MEMO>${memo}
</STMTTRN>`;

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<?OFX OFXHEADER="200" VERSION="211"?>
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS>
<BANKACCTFROM><BANKID>001</BANKID><ACCTID>98765-4</ACCTID><ACCTTYPE>CHECKING</ACCTTYPE></BANKACCTFROM>
<BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20260701</DTPOSTED><TRNAMT>-89.90</TRNAMT><FITID>X-1</FITID><MEMO>ANTHROPIC</MEMO></STMTTRN>
</BANKTRANLIST>
</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

describe("⚠⚠ A CONTA BANCÁRIA — o que faltava para a idempotência fechar", () => {
  it("SGML: lê banco, conta e tipo", () => {
    expect(lerOfx(buf(SGML(TRN()))).conta).toEqual({
      bankId: "341",
      acctId: "12345-6",
      acctType: "CHECKING",
    });
  });

  it("XML: a MESMA leitura serve — não há uma por dialeto", () => {
    expect(lerOfx(buf(XML)).conta).toEqual({ bankId: "001", acctId: "98765-4", acctType: "CHECKING" });
  });

  it("⚠⚠ NÃO pega o `<BANKACCTTO>` de uma transferência", () => {
    // Varrer o documento atrás de `<ACCTID>` atribuiria o extrato à conta de DESTINO. Mesma
    // disciplina de `danfseDados.js`, que lê por caminho porque `CNPJ` aparece em quatro grupos.
    const comDestino = SGML(TRN()).replace(
      "<BANKTRANLIST>",
      "<BANKACCTTO><BANKID>999</BANKID><ACCTID>CONTA-DE-DESTINO</ACCTID></BANKACCTTO>\n<BANKTRANLIST>",
    );
    expect(lerOfx(buf(comDestino)).conta.acctId).toBe("12345-6");
  });

  it("⚠ bloco ausente devolve NULL, nunca um palpite", () => {
    const semBloco = SGML(TRN()).replace(/<BANKACCTFROM>[\s\S]*?<\/BANKACCTFROM>\n/, "");
    expect(lerOfx(buf(semBloco)).conta).toBeNull();
  });

  it("⚠⚠ sem `ACCTID` a conta é NULA, mesmo com BANKID — banco sozinho não identifica a conta", () => {
    const soBanco = SGML(TRN()).replace("<BANKID>341<ACCTID>12345-6<ACCTTYPE>CHECKING", "<BANKID>341");
    expect(lerOfx(buf(soBanco)).conta).toBeNull();
  });

  it("campos opcionais ausentes ficam nulos, sem derrubar a leitura", () => {
    const so = lerContaDoExtrato("<BANKACCTFROM><ACCTID>1-1</BANKACCTFROM>");
    expect(so).toEqual({ bankId: null, acctId: "1-1", acctType: null });
  });

  it("cartão de crédito (`CCACCTFROM`) é lido pela mesma regra", () => {
    // ⚠ Nenhum arquivo real de cartão foi exercido — ler a tag não fabrica nada, e a alternativa
    // seria a conta sair nula num extrato que a traz.
    expect(lerContaDoExtrato("<CCACCTFROM><ACCTID>4111********1111</CCACCTFROM>").acctId)
      .toBe("4111********1111");
  });

  it("⚠ a conta NÃO some quando o arquivo não tem transação nenhuma", () => {
    const r = lerOfx(buf(SGML("")));
    expect(r.transacoes).toHaveLength(0);
    expect(r.conta.acctId).toBe("12345-6");
  });

  it("entrada torta não explode", () => {
    expect(lerContaDoExtrato(null)).toBeNull();
    expect(lerContaDoExtrato("")).toBeNull();
  });
});

describe("⚠⚠ O QUE FOI DESCARTADO — nomeado, nunca em silêncio", () => {
  it("transação sem data volta em `descartadas`, com o motivo", () => {
    const r = lerOfx(buf(SGML([TRN({ fit: "BOA" }), TRN({ fit: "SEM-DATA", data: null })].join("\n"))));
    expect(r.transacoes.map((t) => t.fitId)).toEqual(["BOA"]);
    expect(r.descartadas).toHaveLength(1);
    expect(r.descartadas[0]).toMatchObject({ motivo: DESCARTE.SEM_DATA, fitId: "SEM-DATA" });
  });

  it("transação de valor zero também", () => {
    const r = lerOfx(buf(SGML(TRN({ valor: "0.00", fit: "ZERO" }))));
    expect(r.transacoes).toHaveLength(0);
    expect(r.descartadas[0]).toMatchObject({ motivo: DESCARTE.VALOR_ZERO, fitId: "ZERO" });
  });

  it("⚠ sem data E sem valor reporta SEM_DATA — é o defeito mais grave dos dois", () => {
    // Reportá-la como "valor zero" mandaria conferir a coluna errada do arquivo.
    const r = lerOfx(buf(SGML(TRN({ data: null, valor: "0.00" }))));
    expect(r.descartadas[0].motivo).toBe(DESCARTE.SEM_DATA);
  });

  it("⚠⚠ o CRU vai junto — quem confere precisa achar a linha no arquivo", () => {
    const r = lerOfx(buf(SGML(TRN({ valor: "0.00", memo: "TARIFA ISENTA", fit: "Z9" }))));
    expect(r.descartadas[0]).toMatchObject({
      historico: "TARIFA ISENTA",
      trnAmt: "0.00",
      dtPosted: "20260715",
    });
  });

  it("⚠ TODO motivo tem frase", () => {
    for (const m of Object.values(DESCARTE)) {
      expect(typeof FRASE_DO_DESCARTE[m]).toBe("string");
      expect(FRASE_DO_DESCARTE[m].length).toBeGreaterThan(10);
    }
  });

  it("arquivo limpo devolve lista vazia, não ausência", () => {
    // ⚠ `[]` diz "conferi e não descartei nada"; `undefined` obrigaria o consumidor a adivinhar.
    expect(lerOfx(buf(SGML(TRN()))).descartadas).toEqual([]);
  });
});

describe("⚠⚠ `parseOfx` DELEGA — não é uma segunda leitura", () => {
  it("devolve exatamente `lerOfx().transacoes`", () => {
    const b = buf(SGML([TRN({ fit: "A" }), TRN({ fit: "B", valor: "0.00" })].join("\n")));
    expect(parseOfx(b)).toEqual(lerOfx(b).transacoes);
  });

  it("⚠ e continua ESCONDENDO o descarte — é o comportamento do escritório, preservado", () => {
    const b = buf(SGML([TRN({ fit: "A" }), TRN({ fit: "B", data: null })].join("\n")));
    expect(parseOfx(b)).toHaveLength(1);
    expect(parseOfx(b)[0]).not.toHaveProperty("descartadas");
  });

  it("o parser não é duplicado na fonte", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const fonte = fs.readFileSync(path.join(__dirname, "..", "ofx.js"), "utf8")
      .replace(/\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    // Um só ponto decide SGML × XML; um segundo despacho seria a divergência começando.
    expect((fonte.match(/parseOfxXml\(text\)\s*:\s*parseOfxSgml\(text\)/g) || []).length).toBe(1);
  });
});

describe("⚠ o módulo é PURO", () => {
  it("não importa prisma e não lê o relógio", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const fonte = fs.readFileSync(path.join(__dirname, "..", "ofx.js"), "utf8")
      .replace(/\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    expect(fonte).not.toMatch(/from\s+["'].*prisma/i);
    expect(fonte).not.toMatch(/Date\.now\(/);
    expect(fonte).not.toMatch(/new Date\(\s*\)/);
  });
});
