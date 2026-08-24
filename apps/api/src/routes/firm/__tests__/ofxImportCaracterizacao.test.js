// TESTE DE CARACTERIZAÇÃO DO IMPORT DE OFX DO ESCRITÓRIO.
//
// ⚠⚠ ESCRITO ANTES DE QUALQUER MUDANÇA, e é a rede de segurança do refator que vem em seguida.
//
// Medido em 24/08/2026: o parser de OFX (`accountingEntries.js`, bloco `:270-414`) e a rota
// `POST /entries/import/ofx` **não tinham nenhum teste**. A Fase B2 precisa extrair aquele parser
// para um módulo próprio — ele não é exportado, então o portal do cliente não consegue reusá-lo — e
// extrair código sem cobertura é mover no escuro.
//
// Mesma disciplina da Fase 0 do onboarding, que começou por um teste de caracterização de
// `POST /firm/companies` ("a rota mais crítica do sistema não tinha nenhum teste").
//
// ⚠ ESTE ARQUIVO DESCREVE O COMPORTAMENTO ATUAL, NÃO O DESEJADO. Onde o comportamento de hoje é
// discutível, ele está registrado como está, com o comentário dizendo o que é. Consertar vem
// depois, e deliberadamente — a graça do teste de caracterização é justamente separar as duas
// coisas.
//
// ⚠⚠ APÓS O REFATOR, ESTE ARQUIVO TEM DE PASSAR **SEM UMA ÚNICA EDIÇÃO**. Se ele precisar mudar, o
// refator não foi puro.

jest.mock("../../../middlewares/requireFirmCompanyAccess.js", () => ({
  requireFirmCompanyAccess: () => (req, res, next) => {
    req.auth = { user: { id: "u1", role: "ACCOUNTANT" } };
    next();
  },
}));

jest.mock("../../../infrastructure/db/prisma.js", () => ({
  prisma: {
    chartOfAccount: { findMany: jest.fn(async () => []) },
    accountingEntry: { findMany: jest.fn(async () => []), create: jest.fn(), count: jest.fn(async () => 0) },
    accountingEntryLine: { findMany: jest.fn(async () => []) },
    accountingHistorico: { findFirst: jest.fn(async () => null), findMany: jest.fn(async () => []) },
    $transaction: jest.fn(async (cb) => cb({})),
  },
}));

jest.mock("../../../application/accounting/fechamentoContabil.js", () => ({
  isMonthClosed: jest.fn(async () => false),
}));

import express from "express";
import request from "supertest";
import { createAccountingEntriesRouter } from "../accountingEntries.js";

const log = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

function makeApp() {
  const app = express();
  app.use(express.json());
  const parent = express.Router();
  parent.use("/companies/:companyId", createAccountingEntriesRouter({ log }));
  app.use("/firm", parent);
  return app;
}

const subir = (conteudo, nome = "extrato.ofx") =>
  request(makeApp())
    .post("/firm/companies/emp-1/entries/import/ofx")
    .attach("file", Buffer.isBuffer(conteudo) ? conteudo : Buffer.from(conteudo, "utf8"), nome);

// ── Os dois dialetos, escritos como os bancos brasileiros os emitem ───────────────────────────

const SGML = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
ENCODING:USASCII

<OFX>
<BANKMSGSRSV1><STMTTRNRS><STMTRS>
<BANKACCTFROM><BANKID>341<ACCTID>12345-6<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260715120000[-3:BRT]
<TRNAMT>-1500.00
<FITID>202607150001
<MEMO>PAGTO GOOGLE CLOUD BRASIL
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260716
<TRNAMT>2350,75
<FITID>202607160002
<MEMO>TED RECEBIDA CLIENTE
</STMTTRN>
</BANKTRANLIST>
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>`;

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<?OFX OFXHEADER="200" VERSION="211"?>
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS>
<BANKACCTFROM><BANKID>001</BANKID><ACCTID>98765-4</ACCTID></BANKACCTFROM>
<BANKTRANLIST>
<STMTTRN>
  <TRNTYPE>DEBIT</TRNTYPE>
  <DTPOSTED>20260701</DTPOSTED>
  <TRNAMT>-89.90</TRNAMT>
  <FITID>X-1</FITID>
  <MEMO>ANTHROPIC &amp; CLAUDE.AI</MEMO>
</STMTTRN>
</BANKTRANLIST>
</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

describe("o preview lê OFX nos dois dialetos", () => {
  it("SGML v1 (sem fechamento de tag simples)", async () => {
    const r = await subir(SGML);
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(2);
    expect(r.body.transactions[0]).toMatchObject({
      rowIndex: 0,
      data: "2026-07-15",
      descricaoOfx: "PAGTO GOOGLE CLOUD BRASIL",
      valor: 1500,
      sinal: "DEBITO",
      trnType: "DEBIT",
      fitId: "202607150001",
    });
  });

  it("XML v2", async () => {
    const r = await subir(XML);
    expect(r.status).toBe(200);
    expect(r.body.transactions[0]).toMatchObject({
      data: "2026-07-01",
      descricaoOfx: "ANTHROPIC & CLAUDE.AI",
      valor: 89.9,
      sinal: "DEBITO",
      fitId: "X-1",
    });
  });
});

describe("⚠ o VALOR é absoluto, e a direção vive só no `sinal`", () => {
  it("débito: valor positivo + sinal DEBITO", async () => {
    const { body } = await subir(SGML);
    expect(body.transactions[0].valor).toBe(1500);
    expect(body.transactions[0].sinal).toBe("DEBITO");
  });

  it("crédito: mesma coisa, sinal CREDITO", async () => {
    const { body } = await subir(SGML);
    expect(body.transactions[1]).toMatchObject({ valor: 2350.75, sinal: "CREDITO" });
  });
});

describe("⚠⚠ os separadores decimais dos dois mundos", () => {
  it("ponto-decimal (US) e vírgula-decimal (BR) chegam ao mesmo número", async () => {
    // ⚠ Ler errado aqui não dá um valor um pouco diferente: dá um valor 1000× maior ou menor.
    const { body } = await subir(SGML);
    expect(body.transactions[0].valor).toBe(1500); // "-1500.00"
    expect(body.transactions[1].valor).toBe(2350.75); // "2350,75"
  });
});

describe("⚠ a data é o DIA, e o fuso do arquivo é descartado", () => {
  it("`20260715120000[-3:BRT]` vira 2026-07-15", async () => {
    // ⚠ Comportamento ATUAL: o sufixo de fuso é removido e a data sai como o dia escrito no
    // arquivo. Registrado como está — mudar isto move lançamento de dia.
    const { body } = await subir(SGML);
    expect(body.transactions[0].data).toBe("2026-07-15");
  });

  it("`20260716` sem hora também", async () => {
    const { body } = await subir(SGML);
    expect(body.transactions[1].data).toBe("2026-07-16");
  });
});

describe("entidades HTML e namespace de tag", () => {
  it("`&amp;` vira `&`", async () => {
    const { body } = await subir(XML);
    expect(body.transactions[0].descricaoOfx).toBe("ANTHROPIC & CLAUDE.AI");
  });

  it("tag com prefixo de namespace é lida igual", async () => {
    const comNs = SGML.replace(/<STMTTRN>/g, "<n0:STMTTRN>").replace(/<\/STMTTRN>/g, "</n0:STMTTRN>");
    const { body } = await subir(comNs);
    expect(body.total).toBe(2);
  });
});

describe("`MEMO` e `NAME`", () => {
  it("sem MEMO, cai no NAME", async () => {
    const semMemo = SGML.replace("<MEMO>PAGTO GOOGLE CLOUD BRASIL", "<NAME>FORNECEDOR X");
    const { body } = await subir(semMemo);
    expect(body.transactions[0].descricaoOfx).toBe("FORNECEDOR X");
  });
});

describe("encoding", () => {
  it("latin-1 declarado no header é decodificado como latin-1", async () => {
    const texto = SGML.replace("PAGTO GOOGLE CLOUD BRASIL", "PAGTO SERVICOS ACUCAR ÁÇÃO");
    const { body } = await subir(Buffer.from(texto, "latin1"));
    expect(body.transactions[0].descricaoOfx).toContain("ÁÇÃO");
  });
});

describe("⚠⚠ O QUE O PARSER DESCARTA EM SILÊNCIO", () => {
  it("transação sem data some, sem aviso", async () => {
    // ⚠ Comportamento ATUAL, registrado como está: o `.filter()` no fim de `parseOfx` derruba a
    // linha e nada no retorno diz que ela existiu. Numa importação de extrato, isso é dinheiro
    // sumindo da conferência sem uma palavra.
    const semData = SGML.replace("<DTPOSTED>20260715120000[-3:BRT]\n", "");
    const { body } = await subir(semData);
    expect(body.total).toBe(1);
    expect(body.transactions[0].fitId).toBe("202607160002");
  });

  it("transação de valor ZERO some, sem aviso", async () => {
    const zerada = SGML.replace("<TRNAMT>-1500.00", "<TRNAMT>0.00");
    const { body } = await subir(zerada);
    expect(body.total).toBe(1);
  });
});

describe("⚠⚠ O QUE O PREVIEW DEVOLVE — o contrato que o front consome", () => {
  it("as chaves de cada transação, exatamente", async () => {
    const { body } = await subir(XML);
    expect(Object.keys(body.transactions[0]).sort()).toEqual(
      ["data", "descricaoOfx", "fitId", "match", "rowIndex", "sinal", "trnType", "valor"].sort(),
    );
  });

  it("⚠⚠ NÃO HÁ CONTA BANCÁRIA no retorno, embora o arquivo a traga", async () => {
    // O `<BANKACCTFROM><ACCTID>` está nos dois arquivos de teste e o parser NÃO o lê. É a lacuna
    // que a Fase B2 precisa fechar: sem a conta, duas contas da mesma empresa com o mesmo valor no
    // mesmo dia são indistinguíveis, e a idempotência do import do cliente não fecha.
    const { body } = await subir(SGML);
    expect(body.transactions[0]).not.toHaveProperty("contaBancaria");
    expect(body.transactions[0]).not.toHaveProperty("acctId");
    expect(JSON.stringify(body)).not.toContain("12345-6");
  });

  it("o `fitId` CHEGA ao preview", async () => {
    // ⚠ Ele chega aqui e é DESCARTADO no commit — `fitId` nem existe no `schema.prisma`. É por isso
    // que subir o mesmo arquivo duas vezes duplica tudo. Medido, e registrado como está.
    const { body } = await subir(SGML);
    expect(body.transactions[0].fitId).toBe("202607150001");
  });

  it("`rowIndex` é a posição, na ordem do arquivo", async () => {
    const { body } = await subir(SGML);
    expect(body.transactions.map((t) => t.rowIndex)).toEqual([0, 1]);
  });
});

describe("as recusas do preview", () => {
  it("sem arquivo → 400 file_required", async () => {
    const r = await request(makeApp())
      .post("/firm/companies/emp-1/entries/import/ofx?preview=1")
      .send({});
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("file_required");
  });

  it("arquivo sem transação → 422 nomeado", async () => {
    const r = await subir("OFXHEADER:100\n\n<OFX></OFX>");
    expect(r.status).toBe(422);
    expect(r.body.error).toBe("nenhuma_transacao_encontrada");
  });

  it("lixo que não é OFX → 422, não 500", async () => {
    const r = await subir("isto aqui nao e um extrato bancario");
    expect(r.status).toBe(422);
  });
});

describe("o commit", () => {
  it("sem transações → 400 nomeado", async () => {
    const r = await request(makeApp())
      .post("/firm/companies/emp-1/entries/import/ofx")
      .send({ transactions: [] });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("transactions_required");
  });
});
