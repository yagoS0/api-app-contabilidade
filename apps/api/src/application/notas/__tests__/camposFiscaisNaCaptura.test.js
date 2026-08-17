// A NOTA NOVA NASCE COM OS CAMPOS FISCAIS — PELO CAMINHO REAL DA CAPTURA.
//
// ─── POR QUE ESTE TESTE EXISTE ──────────────────────────────────────────────────────────────
//
// O backfill (`scripts/backfill-campos-fiscais-nota.mjs`) materializou 16.818 notas, e a CAPTURA
// não preenchia nada: durante a própria execução chegaram 14 notas novas, e elas nasceram com as
// colunas nulas — só entraram porque o script rodou outra vez. Isso transforma uma projeção viva
// numa FOTOGRAFIA, e o efeito é pior do que ficar desatualizado: como `NULL` também significa "o
// XML não traz este campo", duas semanas depois ninguém sabe se a nota está sem código de serviço
// ou se ninguém rodou o script. `camposFiscaisExtraidosEm` existe exatamente para desfazer essa
// ambiguidade — e ficava nulo justamente nas notas novas.
//
// ⚠ ELE EXERCITA O CAMINHO REAL, NÃO O EXTRATOR ISOLADO. O extrator já tem 32 testes próprios em
// `nfse/__tests__/camposFiscaisNfse.test.js`; o que faltava provar é que a LIGAÇÃO existe:
// `upsertNfseFromItem` (a captura do ADN) e `POST /import/xml` (a tela) gravam as colunas.
//
// ⚠ A FIXTURE É O XML VERSIONADO de leiaute 1.01 (`docs/leiaute-nfse/`), o mesmo do teste do
// extrator — não uma string inventada aqui, que divergiria na primeira correção de leiaute.

jest.mock("../../../infrastructure/db/prisma.js", () => {
  // Mesma loja em memória de `ingestaoNfseUnica.test.js`: HONRA as duas unicidades do schema
  // — (clientId, chaveAcesso) e (clientId, idNfse) —, senão o teste não distingue "achou a linha"
  // de "criou outra".
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
      findUnique: jest.fn(async () => ({ id: "p1", razao: "EMPRESA EXEMPLO LTDA", cnpj: "00000000000191", status: "ATIVA" })),
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

// ⚠ O EXTRATOR CONTINUA SENDO O REAL. O que este mock permite é UMA coisa só: mandar a leitura
// delegada da série/número da DPS EXPLODIR, sob comando, para provar que a captura sobrevive a uma
// exceção dentro da extração (e não só a um XML que o extrator já sabe recusar com motivo nomeado).
// Fora desse instante ele repassa a implementação de verdade.
jest.mock("../../nfse/nfseUltimaNota.js", () => {
  const real = jest.requireActual("../../nfse/nfseUltimaNota.js");
  return {
    ...real,
    lerSerieENumeroDaDps: (xml) => {
      if (global.__EXPLODIR_LEITURA_DPS) throw new Error("leiaute da DPS mudou debaixo dos pés");
      return real.lerSerieENumeroDaDps(xml);
    },
  };
});

import fs from "node:fs";
import path from "node:path";
import express from "express";
import request from "supertest";
import { __store } from "../../../infrastructure/db/prisma.js";
import { parseXmlMetadata } from "../../nfse/AdnXmlMetadata.js";
import { upsertNfseFromItem } from "../ingestaoNfse.js";
import { IDS_DOS_CAMPOS, MOTIVO } from "../../nfse/camposFiscaisNfse.js";
import { createPortalInvoicesRouter } from "../../../routes/portalInvoices.js";

const EMPRESA = "00000000000191"; // o `prest/CNPJ` da amostra versionada
const RELATIVO = "docs/leiaute-nfse/nfse-nacional-substituicao.xml";

function acharFixture() {
  let dir = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    const tentativa = path.join(dir, RELATIVO);
    if (fs.existsSync(tentativa)) return tentativa;
    dir = path.dirname(dir);
  }
  throw new Error(`Amostra de NFS-e não encontrada a partir de ${process.cwd()} (${RELATIVO}).`);
}
const XML = fs.readFileSync(acharFixture(), "utf8");

/** O que a captura do ADN faz com este XML — MESMA função, mesmos argumentos. */
async function capturar(xml, item = { NSU: "10", TipoDocumento: "NFSE" }) {
  const { prisma } = await import("../../../infrastructure/db/prisma.js");
  return prisma.$transaction(async (tx) => upsertNfseFromItem(tx, {
    portalClientId: "p1",
    companyCnpj: EMPRESA,
    item,
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

/** Sobe o mesmo XML pela rota de import manual (a tela). */
function importar(xml, nome = "nota.xml") {
  return request(makeApp())
    .post("/clients/p1/invoices/import/xml")
    .attach("files", Buffer.from(xml, "utf-8"), nome);
}

const OS_CAMPOS_DA_AMOSTRA = {
  cTribNac: "310104",
  cTribMun: "001",
  xTribNac: "Serviços técnicos em telecomunicações e congêneres.",
  xTribMun: "Serviços técnicos em telecomunicações.",
  xDescServ: "serviço de telemetria",
  cLocPrestacao: "3304557",
  issqnBaseCalculo: "198.00",
  issqnAliquota: "5.00",
  issqnValor: "9.90",
  dpsSerie: "00900",
  dpsNumero: "35",
};

beforeEach(() => {
  __store.notas.length = 0;
  __store.itens.length = 0;
  global.__EXPLODIR_LEITURA_DPS = false;
  jest.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 1. NOTA NOVA NASCE COM OS CAMPOS — pelos DOIS caminhos de entrada
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("nota nova nasce com os campos fiscais", () => {
  it("captura do ADN: a nota entra com as onze colunas preenchidas", async () => {
    await capturar(XML);
    expect(__store.notas).toHaveLength(1);
    expect(__store.notas[0]).toMatchObject(OS_CAMPOS_DA_AMOSTRA);
  });

  it("⚠ o CARIMBO vai junto — sem ele, `NULL` continuaria ambíguo", async () => {
    await capturar(XML);
    const nota = __store.notas[0];
    // A ambiguidade que este campo desfaz: "o XML não traz o campo" × "o extrator nunca passou
    // por esta linha". Sem carimbo, as duas leem-se igual daqui a duas semanas.
    expect(nota.camposFiscaisExtraidosEm).toBeInstanceOf(Date);
    expect(nota.camposFiscaisMotivo).toBeNull();
  });

  it("import manual de XML (a tela) grava exatamente as mesmas colunas", async () => {
    const res = await importar(XML);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ created: 1, rejeitadas: 0 });
    expect(__store.notas).toHaveLength(1);
    expect(__store.notas[0]).toMatchObject(OS_CAMPOS_DA_AMOSTRA);
    expect(__store.notas[0].camposFiscaisExtraidosEm).toBeInstanceOf(Date);
  });

  it("⚠ o `dpsNumero` NÃO é o `numero` da nota — são dois contadores diferentes", async () => {
    await capturar(XML);
    const nota = __store.notas[0];
    expect(nota.numero).toBe("18"); // `nNFSe`, contador do município/SEFIN
    expect(nota.dpsNumero).toBe("35"); // `nDPS`, contador da DPS
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 2. ⚠ A EXTRAÇÃO NÃO PODE DERRUBAR A CAPTURA
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// Capturar a nota é o que não pode ser perdido; o campo derivado é secundário e se reconstrói do
// `xmlRaw` a qualquer momento. Onde falhar, a coluna fica NULA e o motivo é registrado — o mesmo
// desfecho que o backfill dá a `NAO_E_NFSE` e companhia.
describe("a captura sobrevive a XML ruim", () => {
  const NADA_LIDO = Object.fromEntries(IDS_DOS_CAMPOS.map((id) => [id, null]));

  it("XML ilegível: a NOTA ENTRA, as colunas ficam nulas e o motivo é nomeado", async () => {
    const r = await capturar("nao e xml <<<", { NSU: "11", ChaveAcesso: "3".repeat(50) });
    expect(r.status).toBe("upserted"); // ⚠ a nota não foi perdida
    expect(__store.notas).toHaveLength(1);
    expect(__store.notas[0]).toMatchObject(NADA_LIDO);
    expect(__store.notas[0].camposFiscaisMotivo).toBe(MOTIVO.XML_ILEGIVEL);
    expect(__store.notas[0].camposFiscaisExtraidosEm).toBeInstanceOf(Date);
  });

  it("documento que NÃO é NFS-e chega pelo caminho da NFS-e: entra com `NAO_E_NFSE`", async () => {
    const nfe = '<?xml version="1.0"?><nfeProc versao="4.00"><NFe><infNFe Id="NFe33">'
      + "<ide><nNF>77</nNF></ide></infNFe></NFe></nfeProc>";
    const r = await capturar(nfe, { NSU: "12", ChaveAcesso: "4".repeat(50) });
    expect(r.status).toBe("upserted");
    expect(__store.notas[0]).toMatchObject(NADA_LIDO);
    expect(__store.notas[0].camposFiscaisMotivo).toBe(MOTIVO.NAO_E_NFSE);
  });

  it("⚠ a extração LANÇANDO não derruba a captura — nota gravada, motivo `EXTRACAO_LANCOU`", async () => {
    global.__EXPLODIR_LEITURA_DPS = true;
    const r = await capturar(XML);
    expect(r.status).toBe("upserted");
    expect(__store.notas).toHaveLength(1);
    // ⚠ Nem um valor "provável" nem um valor parcial: a exceção deixa TUDO nulo e diz por quê.
    expect(__store.notas[0]).toMatchObject(NADA_LIDO);
    expect(__store.notas[0].camposFiscaisMotivo).toBe(MOTIVO.EXTRACAO_LANCOU);
    expect(__store.notas[0].camposFiscaisExtraidosEm).toBeInstanceOf(Date);
    // e o que importa de verdade continua lá:
    expect(__store.notas[0].numero).toBe("18");
    expect(__store.notas[0].xmlRaw).toBe(XML);
  });

  it("o import da tela também sobrevive: arquivo de outro leiaute vira nota com motivo, não erro 500", async () => {
    // XML de provedor MUNICIPAL antigo: tem `InfNfse` (que o extrator casa, porque a navegação é
    // case-insensitive) e NENHUM dos campos do leiaute nacional. O motivo próprio `NENHUM_CAMPO`
    // existe exatamente para isto: "achei a âncora e não li nada" é sinal de LEIAUTE DIFERENTE, não
    // de nota incompleta — e some do relatório se for confundido com ausência de campo.
    const outroLeiaute = `<?xml version="1.0"?><Nfse><InfNfse><Numero>4242</Numero>`
      + `<Prestador><Cnpj>${EMPRESA}</Cnpj></Prestador></InfNfse></Nfse>`;
    const res = await importar(outroLeiaute, "outro-provedor.xml");
    expect(res.status).toBe(200);
    expect(__store.notas).toHaveLength(1);
    expect(__store.notas[0].camposFiscaisMotivo).toBe(MOTIVO.NENHUM_CAMPO);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 3. ⚠ RECAPTURA NÃO APAGA O QUE JÁ ESTÁ LÁ
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// Este projeto JÁ TEVE o defeito "a recaptura apaga a classificação das notas". A extração é pura
// sobre o XML que a MESMA escrita persiste: XML igual ⇒ colunas iguais; XML mudou ⇒ as colunas
// passam a descrever o XML novo. Não existe passo intermediário que limpe "para recalcular depois".
describe("recaptura", () => {
  const semCarimbo = (n) => Object.fromEntries(IDS_DOS_CAMPOS.map((id) => [id, n[id]]));

  it("XML idêntico duas vezes: mesma linha, mesmos valores", async () => {
    await capturar(XML);
    const antes = semCarimbo(__store.notas[0]);
    await capturar(XML);
    expect(__store.notas).toHaveLength(1);
    expect(semCarimbo(__store.notas[0])).toEqual(antes);
    expect(__store.notas[0].camposFiscaisMotivo).toBeNull();
  });

  it("XML CORRIGIDO na origem: o extrator roda de novo e a coluna acompanha", async () => {
    await capturar(XML);
    expect(__store.notas[0].cTribNac).toBe("310104");

    // Mesma nota (mesma chave), código de serviço corrigido pelo emitente.
    const corrigido = XML.replace("<cTribNac>310104</cTribNac>", "<cTribNac>140101</cTribNac>");
    await capturar(corrigido);
    expect(__store.notas).toHaveLength(1);
    expect(__store.notas[0].cTribNac).toBe("140101");
  });

  it("⚠ o import da tela por cima da captura não zera as colunas", async () => {
    await capturar(XML);
    const antes = semCarimbo(__store.notas[0]);
    const res = await importar(XML);
    expect(res.body).toMatchObject({ created: 0, updated: 1 });
    expect(__store.notas).toHaveLength(1);
    expect(semCarimbo(__store.notas[0])).toEqual(antes);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 4. ⚠ NENHUM CAMINHO DE ENTRADA DE NFS-e PODE FICAR DE FORA — e a NF-e não pode entrar
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// São TRÊS os escritores de `PortalInvoice` com `type:"NFSE"`. Dois deles passam por
// `notas/ingestaoNfse.js` (captura do ADN + import da tela); o terceiro, `sync/InvoiceSyncEngine.js`
// (rota legada `POST /clients/:id/invoices/sync/start`, montada também em `/firm` e `/client`),
// grava direto. Um caminho esquecido faz a coluna voltar a envelhecer por ele — e o defeito fica
// mais difícil de achar da segunda vez, porque as outras notas estarão certas.
describe("os caminhos de entrada estão todos ligados", () => {
  const ler = (...partes) => fs.readFileSync(path.join(__dirname, "..", "..", "..", ...partes), "utf-8");

  it("a ingestão compartilhada (ADN + import da tela) chama o extrator", () => {
    const fonte = ler("application", "notas", "ingestaoNfse.js");
    expect(fonte).toContain('from "../nfse/camposFiscaisNfse.js"');
    expect(fonte).toContain("camposFiscaisParaPersistir(xmlPlain)");
  });

  it("o motor de sync legado (`InvoiceSyncEngine`) também chama", () => {
    const fonte = ler("application", "sync", "InvoiceSyncEngine.js");
    expect(fonte).toContain('from "../nfse/camposFiscaisNfse.js"');
    expect(fonte).toContain("camposFiscaisParaPersistir(xmlRaw)");
  });

  it("⚠ a NF-e NÃO é tocada — leiaute diferente, tudo sairia nulo com carimbo de 'olhamos'", () => {
    const fonte = ler("application", "notas", "dfe", "DfeSyncService.js");
    expect(fonte).not.toContain("camposFiscaisParaPersistir");
    expect(fonte).not.toContain("camposFiscaisNfse");
  });

  it("⚠ nenhum caminho escreve as colunas por conta própria — o extrator é o ÚNICO escritor", () => {
    // Reescrever um caminho de XML em qualquer um dos ingestores produziria, na MESMA coluna, um
    // valor diferente do que o backfill gravou nas 16.818 notas que já existem.
    for (const fonte of [
      ler("application", "notas", "ingestaoNfse.js"),
      ler("application", "sync", "InvoiceSyncEngine.js"),
    ]) {
      expect(fonte).not.toContain("cTribNac");
      expect(fonte).not.toContain("pAliqAplic");
      expect(fonte).not.toContain("vISSQN");
      expect(fonte).not.toContain("DOMParser");
    }
  });
});
