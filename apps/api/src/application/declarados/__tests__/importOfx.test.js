// O IMPORT DE EXTRATO OFX DO CLIENTE.
//
// ⚠⚠ O bloco "SUBIR O MESMO ARQUIVO DUAS VEZES" é o motivo deste arquivo existir. Ele responde,
// com um Prisma em memória que guarda estado de verdade, a pergunta que o dono fez: *"temos alguma
// proteção caso o cliente queira importar vários, sendo mesmo?"*
//
// ⚠ A REGRA da identidade tem teste próprio em `lib/__tests__/dedupeOfx.test.js`; a leitura do
// arquivo, em `accounting/lib/__tests__/ofx.test.js`. O que se prende AQUI é a orquestração.

jest.mock("../../../infrastructure/db/prisma.js", () => ({ prisma: {} }));

import { ESTADO, ORIGEM_PAGAMENTO } from "../lib/estadosDeclarado.js";
import { ANOMALIA } from "../lib/dedupeOfx.js";
import { RECUSA_DO_IMPORT, importarOfxDoCliente } from "../ImportOfxService.js";

const AGORA = new Date("2026-08-24T10:00:00.000Z");

const TRN = ({ data = "20260715", valor = "-1500.00", fit = "F1", memo = "GOOGLE CLOUD", tipo = "DEBIT" } = {}) =>
  `<STMTTRN>
<TRNTYPE>${tipo}
${data === null ? "" : `<DTPOSTED>${data}`}
<TRNAMT>${valor}
${fit === null ? "" : `<FITID>${fit}`}
<MEMO>${memo}
</STMTTRN>`;

const OFX = (corpo, { conta = "<BANKACCTFROM><BANKID>341<ACCTID>12345-6</BANKACCTFROM>" } = {}) =>
  Buffer.from(
    `OFXHEADER:100
DATA:OFXSGML
VERSION:102
ENCODING:USASCII

<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS>
${conta}
<BANKTRANLIST>
${corpo}
</BANKTRANLIST>
</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`,
    "utf8",
  );

/** ⚠ Um Prisma em memória que HONRA o `@@unique(portalClientId, hashDedupe)` — é ele quem prova. */
function bancoEmMemoria() {
  const declarados = [];
  const imports = [];
  return {
    declarados,
    imports,
    client: {
      ofxImport: {
        create: jest.fn(async ({ data }) => {
          const linha = { id: `imp-${imports.length + 1}`, ...data };
          imports.push(linha);
          return linha;
        }),
        update: jest.fn(async ({ where, data }) => {
          const l = imports.find((i) => i.id === where.id);
          Object.assign(l, data);
          return l;
        }),
        findFirst: jest.fn(async ({ where }) =>
          [...imports].reverse().find(
            (i) => i.portalClientId === where.portalClientId && i.hashArquivo === where.hashArquivo,
          ) || null,
        ),
      },
      lancamentoDeclarado: {
        create: jest.fn(async ({ data }) => {
          // ⚠⚠ ESTE `if` É O `@@unique` DO BANCO. Sem ele o teste passaria com a proteção removida.
          if (declarados.some((d) => d.portalClientId === data.portalClientId && d.hashDedupe === data.hashDedupe)) {
            const e = new Error("unique");
            e.code = "P2002";
            throw e;
          }
          const linha = { id: `d-${declarados.length + 1}`, ...data };
          declarados.push(linha);
          return linha;
        }),
        findFirst: jest.fn(async ({ where }) =>
          declarados.find((d) => d.portalClientId === where.portalClientId && d.hashDedupe === where.hashDedupe) || null,
        ),
      },
    },
  };
}

const importar = (client, buffer, extra = {}) =>
  importarOfxDoCliente({
    portalClientId: "emp-1",
    buffer,
    nomeArquivo: "extrato.ofx",
    criadoPor: "u-1",
    agora: AGORA,
    client,
    ...extra,
  });

describe("⚠⚠ SUBIR O MESMO ARQUIVO DUAS VEZES", () => {
  const arquivo = OFX([TRN({ fit: "A" }), TRN({ fit: "B", valor: "-99.90" })].join("\n"));

  it("a primeira importa tudo; a segunda importa ZERO e diz que já estavam lá", async () => {
    const { client, declarados } = bancoEmMemoria();
    const um = await importar(client, arquivo);
    const dois = await importar(client, arquivo);

    expect(um).toMatchObject({ transacoesLidas: 2, criados: 2, jaImportadas: 0 });
    expect(dois).toMatchObject({ transacoesLidas: 2, criados: 0, jaImportadas: 2 });
    expect(declarados).toHaveLength(2);
  });

  it("⚠ e a segunda DIZ que o arquivo já tinha sido subido — não só 'zero novas'", async () => {
    // Sem o hash do arquivo, um extrato de período já importado e um arquivo repetido dariam
    // exatamente a mesma resposta.
    const { client } = bancoEmMemoria();
    await importar(client, arquivo);
    const dois = await importar(client, arquivo);
    expect(dois.arquivoJaImportado).toMatchObject({ criadosNaquela: 2 });
    expect(dois.arquivoJaImportado.em).toBe(AGORA);
  });

  it("⚠ a primeira NÃO diz isso", async () => {
    const { client } = bancoEmMemoria();
    expect((await importar(client, arquivo)).arquivoJaImportado).toBeNull();
  });
});

describe("⚠⚠ SOBREPOSIÇÃO DE PERÍODOS — o caso NORMAL, não a exceção", () => {
  it("01–31/jan e depois 15/jan–15/fev: só as novas entram", async () => {
    const { client, declarados } = bancoEmMemoria();
    const janeiro = OFX([TRN({ fit: "J1" }), TRN({ fit: "J2" }), TRN({ fit: "J3" })].join("\n"));
    const meioAFevereiro = OFX([TRN({ fit: "J2" }), TRN({ fit: "J3" }), TRN({ fit: "F1" }), TRN({ fit: "F2" })].join("\n"));

    await importar(client, janeiro);
    const segundo = await importar(client, meioAFevereiro);

    expect(segundo).toMatchObject({ criados: 2, jaImportadas: 2 });
    expect(declarados).toHaveLength(5);
  });

  it("⚠⚠ DUAS TARIFAS IGUAIS no mesmo dia continuam sendo DUAS, e a reimportação não as duplica", async () => {
    // Uma impressão digital sem ordinal descartaria a segunda como duplicata — dinheiro real
    // sumindo da conferência, em silêncio.
    const { client, declarados } = bancoEmMemoria();
    const tarifa = () => TRN({ fit: null, valor: "-29.90", memo: "TARIFA PACOTE SERVICOS" });
    const arquivo = OFX([tarifa(), tarifa()].join("\n"));

    expect(await importar(client, arquivo)).toMatchObject({ criados: 2 });
    expect(await importar(client, arquivo)).toMatchObject({ criados: 0, jaImportadas: 2 });
    expect(declarados).toHaveLength(2);
  });

  it("⚠ base com UMA e arquivo com DUAS ⇒ entra UMA", async () => {
    const { client, declarados } = bancoEmMemoria();
    const tarifa = () => TRN({ fit: null, valor: "-29.90", memo: "TARIFA" });
    await importar(client, OFX(tarifa()));
    const dois = await importar(client, OFX([tarifa(), tarifa()].join("\n")));
    expect(dois).toMatchObject({ criados: 1, jaImportadas: 1 });
    expect(declarados).toHaveLength(2);
  });
});

describe("⚠⚠ O DÉBITO DO EXTRATO É O PAGAMENTO", () => {
  it("nasce A_CONFERIR, com a data do arquivo e procedência de PROVA", async () => {
    const { client, declarados } = bancoEmMemoria();
    await importar(client, OFX(TRN()));
    expect(declarados[0]).toMatchObject({
      origem: "OFX_CLIENTE",
      estado: ESTADO.A_CONFERIR,
      origemPagamento: ORIGEM_PAGAMENTO.OFX,
      valor: 1500,
    });
    expect(declarados[0].dataPagamento.toISOString()).toBe("2026-07-15T00:00:00.000Z");
  });

  it("⚠⚠ a data vem do ARQUIVO, nunca do relógio", async () => {
    const { client, declarados } = bancoEmMemoria();
    await importar(client, OFX(TRN()));
    expect(declarados[0].dataPagamento).not.toEqual(AGORA);
  });

  it("⚠ a competência é DERIVADA da data — e o precedente é o import do ESCRITÓRIO", async () => {
    // Diferente da NOTA, onde deduzir é proibido: a nota TEM competência própria. O extrato não
    // tem nenhuma, e o import do escritório já a deriva assim (`accountingEntries.js`).
    const { client, declarados } = bancoEmMemoria();
    await importar(client, OFX(TRN({ data: "20260715" })));
    expect(declarados[0].competencia).toBe("2026-07");
  });

  it("⚠ a conta bancária e o `fitId` são gravados — são a identidade da transação", async () => {
    const { client, declarados } = bancoEmMemoria();
    await importar(client, OFX(TRN({ fit: "X-9" })));
    expect(declarados[0]).toMatchObject({ contaBancariaRef: "12345-6", fitId: "X-9" });
    expect(declarados[0].hashDedupe).toBe("OFX:12345-6:X-9#1");
  });

  it("⚠ o `ofxImportId` liga a linha ao arquivo que a trouxe", async () => {
    const { client, declarados, imports } = bancoEmMemoria();
    await importar(client, OFX(TRN()));
    expect(declarados[0].ofxImportId).toBe(imports[0].id);
  });
});

describe("⚠⚠ SÓ DÉBITO ENTRA — e o crédito é CONTADO, não sumido", () => {
  it("crédito fica fora do escopo, com o número na resposta", async () => {
    // Esta fila é de DESPESA: a forma do lançamento de ENTRADA não foi medida, e criar item de
    // fila que ninguém consegue resolver é beco sem saída.
    const { client, declarados } = bancoEmMemoria();
    const r = await importar(
      client,
      OFX([TRN({ fit: "D1" }), TRN({ fit: "C1", valor: "2350.00", tipo: "CREDIT" })].join("\n")),
    );
    expect(r).toMatchObject({ criados: 1, foraDoEscopo: 1 });
    expect(declarados).toHaveLength(1);
    expect(declarados[0].fitId).toBe("D1");
  });
});

describe("⚠⚠ NADA SOME EM SILÊNCIO", () => {
  it("transação sem data é DESCARTADA e CONTADA, com o motivo", async () => {
    const { client } = bancoEmMemoria();
    const r = await importar(client, OFX([TRN({ fit: "A" }), TRN({ fit: "B", data: null })].join("\n")));
    expect(r).toMatchObject({ transacoesLidas: 1, criados: 1 });
    // ⚠ `descartadas` volta com o MOTIVO de cada uma e o dado CRU do arquivo — um número sozinho
    // diria que algo sumiu sem dizer o quê, e quem confere precisa achar a linha no extrato.
    expect(r.descartadas).toHaveLength(1);
    expect(r.descartadas[0]).toMatchObject({ motivo: "sem_data", fitId: "B", trnAmt: "-1500.00" });
  });

  it("⚠ arquivo SEM CONTA BANCÁRIA avisa que o dedupe ficou mais frouxo", async () => {
    const { client } = bancoEmMemoria();
    const r = await importar(client, OFX(TRN(), { conta: "" }));
    expect(r.conta).toBeNull();
    expect(r.anomalias.map((a) => a.codigo)).toContain(ANOMALIA.SEM_CONTA_BANCARIA);
  });

  it("⚠ transações sem `fitId` também avisam", async () => {
    const { client } = bancoEmMemoria();
    const r = await importar(client, OFX(TRN({ fit: null })));
    expect(r.anomalias.map((a) => a.codigo)).toContain(ANOMALIA.SEM_FITID);
  });

  it("⚠ o registro do import guarda o relatório congelado", async () => {
    const { client, imports } = bancoEmMemoria();
    await importar(client, OFX([TRN({ fit: "A" }), TRN({ fit: "C", valor: "10.00", tipo: "CREDIT" })].join("\n")));
    expect(imports[0]).toMatchObject({
      contaBancaria: "12345-6",
      bancoId: "341",
      criados: 1,
      foraDoEscopo: 1,
      nomeArquivo: "extrato.ofx",
      criadoPor: "u-1",
    });
  });
});

describe("as recusas", () => {
  it("arquivo vazio recusa NOMEANDO", async () => {
    const { client } = bancoEmMemoria();
    await expect(importar(client, Buffer.alloc(0))).rejects.toMatchObject({
      codigo: RECUSA_DO_IMPORT.ARQUIVO_VAZIO,
    });
  });

  it("arquivo que não é OFX recusa NOMEANDO", async () => {
    const { client } = bancoEmMemoria();
    await expect(importar(client, Buffer.from("isto nao e um extrato", "utf8"))).rejects.toMatchObject({
      codigo: RECUSA_DO_IMPORT.NENHUMA_TRANSACAO,
    });
  });

  it("⚠ arquivo em que TODAS foram descartadas NÃO recusa — há o que relatar", async () => {
    // Engolir isso num erro genérico esconderia exatamente o motivo de cada descarte.
    const { client } = bancoEmMemoria();
    const r = await importar(client, OFX(TRN({ data: null })));
    expect(r).toMatchObject({ transacoesLidas: 0, criados: 0 });
    expect(r.descartadas).toHaveLength(1);
  });

  it("⚠ uma transação recusada não derruba o extrato — vira linha nomeada", async () => {
    const { client } = bancoEmMemoria();
    client.lancamentoDeclarado.create.mockImplementationOnce(async () => {
      throw new Error("disco cheio");
    });
    const r = await importar(client, OFX([TRN({ fit: "A" }), TRN({ fit: "B" })].join("\n")));
    expect(r.criados).toBe(1);
    expect(r.recusadas).toHaveLength(1);
    expect(r.recusadas[0].motivo).toMatch(/disco cheio/);
  });
});

describe("⚠ o serviço não lê o relógio", () => {
  it("`agora` é injetado", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const fonte = fs.readFileSync(path.join(__dirname, "..", "ImportOfxService.js"), "utf8")
      .replace(/\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    expect(fonte).not.toMatch(/Date\.now\(/);
    expect(fonte).not.toMatch(/new Date\(\s*\)/);
  });

  it("⚠ e é SEQUENCIAL — sem `Promise.all` sobre as criações", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const fonte = fs.readFileSync(path.join(__dirname, "..", "ImportOfxService.js"), "utf8");
    expect(fonte).not.toMatch(/Promise\.all/);
  });
});
