// UMA NOTA, UMA LINHA — E A RECAPTURA NÃO APAGA A CLASSIFICAÇÃO.
//
// Dois defeitos que se somavam na ingestão de NFS-e:
//
// 1. O import manual de XML (`routes/portalInvoices.js`) tinha uma SEGUNDA implementação da
//    persistência, com a chave de dedup invertida: gravava `chaveAcesso: null` fixo e dedupicava
//    por `clientId_idNfse`. A captura faz o oposto de propósito (chave quando há chave, `idNfse` só
//    no fallback sem-chave). O upsert do import NUNCA encontrava a linha da captura → segunda linha
//    da mesma nota, as duas `EMIT`/`autorizada` → faturamento em dobro; e a conferência do ADN
//    (`getNossoConjunto` usa `chaveAcesso || idNfse`) comparava NÚMERO contra CHAVE, acusava
//    `divergente` falso e travava `salvarFechamento`.
//
// 2. A recaptura fazia `notaItem.deleteMany` + recriação seca, apagando `tipoReceita`,
//    `anexoResolvido`, `classificadoEm` e `sujeitoFatorR` em silêncio — nos DOIS caminhos
//    (ADN e SEFAZ).
//
// CNPJs e chave são FABRICADOS (mesmo formato dos reais, dígitos inventados).

jest.mock("../../../infrastructure/db/prisma.js", () => {
  // Loja em memória que HONRA as duas unicidades do schema: (clientId, chaveAcesso) e
  // (clientId, idNfse). Sem isso o teste não distinguiria "achou a linha" de "criou outra".
  const store = { notas: [], itens: [] };

  function localizar(where) {
    if (where?.clientId_chaveAcesso) {
      const { clientId, chaveAcesso } = where.clientId_chaveAcesso;
      return store.notas.find((n) => n.clientId === clientId && n.chaveAcesso === chaveAcesso) || null;
    }
    if (where?.clientId_idNfse) {
      const { clientId, idNfse } = where.clientId_idNfse;
      return store.notas.find((n) => n.clientId === clientId && n.idNfse === idNfse) || null;
    }
    return null;
  }

  const db = {
    portalClient: {
      findUnique: jest.fn(async () => ({ id: "p1", razao: "EMPRESA TESTE LTDA", cnpj: "66233216000105", status: "ATIVA" })),
    },
    portalInvoice: {
      findUnique: jest.fn(async ({ where }) => localizar(where)),
      findFirst: jest.fn(async ({ where }) => store.notas.find((n) => (
        n.clientId === where.clientId
        && (where.idNfse === undefined || n.idNfse === where.idNfse)
        && (where.chaveAcesso === undefined || n.chaveAcesso === where.chaveAcesso)
      )) || null),
      upsert: jest.fn(async ({ where, create, update }) => {
        const existente = localizar(where);
        if (existente) { Object.assign(existente, update); return existente; }
        const row = { id: `inv-${store.notas.length + 1}`, chaveAcesso: null, idNfse: null, createdAt: new Date(), ...create };
        store.notas.push(row);
        return row;
      }),
    },
    notaItem: {
      findMany: jest.fn(async ({ where }) => store.itens.filter((i) => i.notaId === where.notaId)),
      deleteMany: jest.fn(async ({ where }) => {
        const restantes = store.itens.filter((i) => i.notaId !== where.notaId);
        store.itens.length = 0;
        store.itens.push(...restantes);
        return {};
      }),
      createMany: jest.fn(async ({ data }) => { store.itens.push(...data); return { count: data.length }; }),
      create: jest.fn(async ({ data }) => { store.itens.push(data); return data; }),
    },
    companyMonthlyCircular: { findFirst: jest.fn(async () => null) },
    pendenciaPosFechamento: { create: jest.fn(async () => ({})) },
  };
  db.$transaction = jest.fn(async (cb) => cb(db));
  return { __store: store, prisma: db };
});

jest.mock("../../../routes/middlewares/portalAccess.js", () => ({
  ensurePortalClientAccess: jest.fn(async () => ({ ok: true, user: { id: "u1", role: "admin" } })),
}));

import fs from "node:fs";
import path from "node:path";
import express from "express";
import request from "supertest";
import { __store } from "../../../infrastructure/db/prisma.js";
import { parseXmlMetadata } from "../../nfse/AdnXmlMetadata.js";
import { upsertNfseFromItem } from "../ingestaoNfse.js";
import { substituirItensPreservandoClassificacao } from "../notaItens.js";
import { createPortalInvoicesRouter } from "../../../routes/portalInvoices.js";

const EMPRESA = "66233216000105";
const CHAVE = "33045572200000000000191000000000000926088310270000";

function xmlNfse({ numero = "926", valor = "1500.00", chave = CHAVE, subst = "" } = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse">
  <infNFSe Id="NFS${chave}">
    <nNFSe>${numero}</nNFSe>
    <dhProc>2026-07-14T10:00:00-03:00</dhProc>
    <DPS><infDPS>
      <dCompet>2026-07-01</dCompet>
      ${subst}
      <prest><CNPJ>${EMPRESA}</CNPJ><xNome>EMPRESA TESTE LTDA</xNome></prest>
      <toma><CNPJ>99888777000166</CNPJ><xNome>CLIENTE X LTDA</xNome></toma>
      <serv><cServ><cTribNac>010801</cTribNac><xDescServ>Consultoria em TI</xDescServ></cServ></serv>
      <valores><vServPrest><vServ>${valor}</vServ></vServPrest></valores>
    </infDPS></DPS>
  </infNFSe>
</NFSe>`;
}

/** O que a captura do ADN faz com este XML — mesma função, mesmos argumentos. */
async function capturar(xml) {
  const { prisma } = await import("../../../infrastructure/db/prisma.js");
  return prisma.$transaction(async (tx) => upsertNfseFromItem(tx, {
    portalClientId: "p1",
    companyCnpj: EMPRESA,
    item: { NSU: "10", TipoDocumento: "NFSE" }, // o item do ADN não traz a chave; ela vem do XML
    xmlPlain: xml,
    metadata: parseXmlMetadata(xml),
  }));
}

function makeApp() {
  const app = express();
  const log = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
  app.use("/clients/:clientId/invoices", createPortalInvoicesRouter({
    ensureAuthorized: async () => true,
    log,
  }));
  return app;
}

/** Sobe o mesmo XML pela rota de import manual. */
function importar(xml, nome = "nota.xml") {
  return request(makeApp())
    .post("/clients/p1/invoices/import/xml")
    .attach("files", Buffer.from(xml, "utf-8"), nome);
}

beforeEach(() => {
  __store.notas.length = 0;
  __store.itens.length = 0;
  jest.clearAllMocks();
});

describe("defeito 1 — o import de XML não cria mais uma segunda linha", () => {
  it("importar o XML de uma nota que a captura já trouxe NÃO cria segunda linha", async () => {
    const xml = xmlNfse();
    await capturar(xml);
    expect(__store.notas).toHaveLength(1);
    expect(__store.notas[0].chaveAcesso).toBe(CHAVE);
    // A captura deixa `idNfse` NULO quando há chave — é o que fazia o upsert do import errar o alvo.
    expect(__store.notas[0].idNfse).toBeNull();

    const res = await importar(xml);
    expect(res.status).toBe(200);
    expect(__store.notas).toHaveLength(1);
    expect(res.body).toMatchObject({ created: 0, updated: 1, rejeitadas: 0 });
    expect(res.body.errors).toEqual([]);
  });

  it("a ordem inversa também converge: import primeiro, captura depois", async () => {
    const xml = xmlNfse();
    const res = await importar(xml);
    expect(res.body).toMatchObject({ created: 1, updated: 0 });
    expect(__store.notas).toHaveLength(1);
    // ⚠ O import agora grava a CHAVE — antes gravava `chaveAcesso: null` fixo, e era isso que
    // fazia a conferência do ADN comparar número contra chave e acusar divergência falsa.
    expect(__store.notas[0].chaveAcesso).toBe(CHAVE);

    await capturar(xml);
    expect(__store.notas).toHaveLength(1);
  });

  it("importar duas vezes o mesmo arquivo continua sendo uma linha só", async () => {
    const xml = xmlNfse();
    await importar(xml);
    await importar(xml);
    expect(__store.notas).toHaveLength(1);
  });

  it("nota de OUTRO CNPJ continua recusada como `nota_nao_pertence`", async () => {
    const xml = xmlNfse().replace(`<CNPJ>${EMPRESA}</CNPJ>`, "<CNPJ>11222333000144</CNPJ>");
    const res = await importar(xml, "alheia.xml");
    expect(__store.notas).toHaveLength(0);
    expect(res.body.rejeitadas).toBe(1);
    expect(res.body.errors).toEqual([{ file: "alheia.xml", reason: "nota_nao_pertence" }]);
  });

  it("o vínculo da substituição vem junto — o import não o perdia mais", async () => {
    const chSubst = "33045572200000000000191000000000000900088310270000";
    const xml = xmlNfse({ subst: `<subst><chSubstda>${chSubst}</chSubstda><xMotivo>valor incorreto</xMotivo></subst>` });
    await importar(xml);
    expect(__store.notas[0].chaveSubstituida).toBe(chSubst);
    expect(__store.notas[0].motivoSubstituicao).toBe("valor incorreto");
  });

  it("linha LEGADA sem chave não é duplicada — é contada e nomeada, nunca sobrescrita", async () => {
    // Como se o import antigo a tivesse criado: `chaveAcesso: null`, `idNfse = numeroNfse`.
    __store.notas.push({
      id: "legado-1", clientId: "p1", chaveAcesso: null, idNfse: "926",
      emitenteDoc: EMPRESA, numero: "926", createdAt: new Date(),
    });
    const res = await importar(xmlNfse(), "926.xml");
    expect(__store.notas).toHaveLength(1); // nada criado
    expect(res.body.duplicates).toBe(1);
    expect(res.body.errors[0]).toMatchObject({ reason: "duplicata_legado_sem_chave", invoiceId: "legado-1" });
  });

  it("número igual de OUTRO prestador não é lido como duplicata legada", async () => {
    __store.notas.push({
      id: "outra-1", clientId: "p1", chaveAcesso: null, idNfse: "926",
      emitenteDoc: "11222333000144", numero: "926", createdAt: new Date(),
    });
    const res = await importar(xmlNfse());
    expect(res.body).toMatchObject({ created: 1, duplicates: 0 });
    expect(__store.notas).toHaveLength(2);
  });
});

// ⚠ O CONSERTO É "UMA IMPLEMENTAÇÃO SÓ", NÃO "GRAVAR A CHAVE NAS DUAS".
// Foi reimplementar a regra que produziu a divergência; consertar mantendo as duas cópias as
// deixaria livres para divergir de novo na próxima mudança.
describe("a rota não pode voltar a ter persistência própria", () => {
  const fonte = fs.readFileSync(
    path.join(__dirname, "..", "..", "..", "routes", "portalInvoices.js"),
    "utf-8",
  );

  it("o import chama a ingestão compartilhada", () => {
    expect(fonte).toContain('from "../application/notas/ingestaoNfse.js"');
    expect(fonte).toContain("upsertNfseFromItem(");
  });

  it("a rota não dá upsert em PortalInvoice por conta própria", () => {
    expect(fonte).not.toContain("portalInvoice.upsert");
    expect(fonte).not.toContain("portalInvoice.create");
    expect(fonte).not.toContain("notaItem.");
    // A chave de dedup só pode ser citada em COMENTÁRIO (a explicação do defeito), nunca montada
    // como objeto — `clientId_idNfse: {` é a assinatura da implementação que foi removida daqui.
    expect(fonte).not.toMatch(/clientId_idNfse\s*:/);
  });
});

describe("defeito 2 — a recaptura preserva a classificação do item", () => {
  it("item classificado sobrevive a uma recaptura idêntica", async () => {
    const xml = xmlNfse();
    await capturar(xml);
    expect(__store.itens).toHaveLength(1);

    // O classificador v2 passa e marca o item.
    const classificadoEm = new Date("2026-08-01T12:00:00Z");
    Object.assign(__store.itens[0], {
      tipoReceita: "SERVICO_FATOR_R", anexoResolvido: "V", sujeitoFatorR: true, classificadoEm,
    });

    await capturar(xml);
    expect(__store.itens).toHaveLength(1);
    expect(__store.itens[0]).toMatchObject({
      tipoReceita: "SERVICO_FATOR_R", anexoResolvido: "V", sujeitoFatorR: true, classificadoEm,
    });
  });

  it("item que MUDOU DE VERDADE não herda a classificação antiga", async () => {
    await capturar(xmlNfse());
    Object.assign(__store.itens[0], { tipoReceita: "SERVICO_FATOR_R", anexoResolvido: "V" });

    // Mesma nota (mesma chave), valor corrigido: é outro item.
    await capturar(xmlNfse({ valor: "2500.00" }));
    expect(__store.itens).toHaveLength(1);
    expect(__store.itens[0].valor).toBe(2500);
    expect(__store.itens[0].tipoReceita).toBeNull();
    expect(__store.itens[0].anexoResolvido).toBeNull();
  });
});

describe("substituirItensPreservandoClassificacao — o critério de casamento", () => {
  const prismaFake = () => {
    const itens = [];
    return {
      itens,
      notaItem: {
        findMany: async ({ where }) => itens.filter((i) => i.notaId === where.notaId),
        deleteMany: async ({ where }) => {
          const restantes = itens.filter((i) => i.notaId !== where.notaId);
          itens.length = 0; itens.push(...restantes);
        },
        createMany: async ({ data }) => { itens.push(...data); },
      },
    };
  };

  it("casa por codigoServico + ncm + cfop + valor (NF-e com vários itens)", async () => {
    const tx = prismaFake();
    tx.itens.push(
      { notaId: "n1", codigoServico: null, ncm: "8471", cfop: "5102", valor: 100, tipoReceita: "REVENDA_MERCADORIA" },
      { notaId: "n1", codigoServico: null, ncm: "3004", cfop: "5405", valor: 250, tipoReceita: "REVENDA_MONOFASICO" },
    );
    await substituirItensPreservandoClassificacao(tx, {
      notaId: "n1",
      itens: [
        { ncm: "3004", cfop: "5405", valor: 250 },   // fora de ordem de propósito
        { ncm: "8471", cfop: "5102", valor: 100 },
      ],
    });
    expect(tx.itens.map((i) => i.tipoReceita)).toEqual(["REVENDA_MONOFASICO", "REVENDA_MERCADORIA"]);
  });

  it("a descrição NÃO entra na chave — mudança de texto não derruba a classificação", async () => {
    const tx = prismaFake();
    tx.itens.push({ notaId: "n1", codigoServico: "010801", ncm: null, cfop: null, valor: 100, descricao: "Consultoria", tipoReceita: "SERVICO_FATOR_R" });
    await substituirItensPreservandoClassificacao(tx, {
      notaId: "n1",
      itens: [{ codigoServico: "010801", valor: 100, descricao: "  Consultoria em TI  " }],
    });
    expect(tx.itens[0].tipoReceita).toBe("SERVICO_FATOR_R");
  });

  it("item novo, que não existia antes, nasce sem classificação", async () => {
    const tx = prismaFake();
    tx.itens.push({ notaId: "n1", codigoServico: "010801", ncm: null, cfop: null, valor: 100, tipoReceita: "SERVICO_FATOR_R" });
    await substituirItensPreservandoClassificacao(tx, {
      notaId: "n1",
      itens: [
        { codigoServico: "010801", valor: 100 },
        { codigoServico: "070201", valor: 400 },
      ],
    });
    expect(tx.itens[0].tipoReceita).toBe("SERVICO_FATOR_R");
    expect(tx.itens[1].tipoReceita).toBeNull();
  });

  it("duas linhas idênticas casam uma a uma (FIFO), sem duplicar classificação", async () => {
    const tx = prismaFake();
    tx.itens.push(
      { notaId: "n1", codigoServico: "010801", ncm: null, cfop: null, valor: 100, tipoReceita: "SERVICO_FATOR_R" },
      { notaId: "n1", codigoServico: "010801", ncm: null, cfop: null, valor: 100, tipoReceita: "SERVICO_FATOR_R" },
    );
    await substituirItensPreservandoClassificacao(tx, {
      notaId: "n1",
      itens: [{ codigoServico: "010801", valor: 100 }],
    });
    expect(tx.itens).toHaveLength(1);
    expect(tx.itens[0].tipoReceita).toBe("SERVICO_FATOR_R");
  });

  // ⚠ `flagExportacao` é derivado do CFOP pelo parser de NF-e, e o CFOP está na assinatura: dentro
  // de uma assinatura igual os dois lados valem o mesmo. O OU só recupera um `true` que NENHUM
  // caminho de ingestão escreve — a criação do item de NFS-e nunca toca o campo.
  it("flagExportacao marcada fora da ingestão sobrevive; o derivado do CFOP não é rebaixado", async () => {
    const tx = prismaFake();
    tx.itens.push({ notaId: "n1", codigoServico: "010801", ncm: null, cfop: null, valor: 100, flagExportacao: true });
    await substituirItensPreservandoClassificacao(tx, {
      notaId: "n1",
      itens: [{ codigoServico: "010801", valor: 100, flagExportacao: false }],
    });
    expect(tx.itens[0].flagExportacao).toBe(true);
  });

  it("lista vazia não apaga os itens que existem", async () => {
    const tx = prismaFake();
    tx.itens.push({ notaId: "n1", codigoServico: "010801", valor: 100, tipoReceita: "SERVICO_FATOR_R" });
    await substituirItensPreservandoClassificacao(tx, { notaId: "n1", itens: [] });
    expect(tx.itens).toHaveLength(1);
  });
});
