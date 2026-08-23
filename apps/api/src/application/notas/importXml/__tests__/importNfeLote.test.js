// ⚠⚠ O TESTE QUE VALE A ENTREGA: **NOTA DE VENDA ENTRA COMO `EMIT`.**
//
// O import existe porque a base tinha 47 NF-e, 100% `DEST`, ZERO `EMIT` — e a NT 2014.002 §3 diz
// por quê: o DFe distribui os documentos *"que não tenham sido gerados por ele"*, e o §3.7 é
// literal — *"Para o emitente a NF-e não será disponibilizada nesta consulta."* Não há integração
// possível; o caminho é o lote do Fisco Fácil, subido à mão.
//
// A armadilha que anularia tudo: em `dfe/DfeParser.js` o `papel` cai em `"DEST"` no ÚLTIMO RAMO dos
// DOIS caminhos (resNFe e procNFe). Se o import reaproveitasse aquele default, as notas de venda
// entrariam rotuladas como compra e **o problema continuaria exatamente igual** — só que agora com
// um import por cima dizendo que deu certo. Daí o primeiro `describe` abaixo.
//
// ⚠ ZERO chamada externa: nenhum teste aqui fala com a SEFAZ ou com o ADN (consulta indevida
// bloqueia o CNPJ por 1 hora). Só disco temporário e a loja em memória.
//
// ⚠ CNPJs e chaves são FABRICADOS — ver `fixtures/nfeFabricada.js`.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import request from "supertest";

jest.mock("../../../../infrastructure/db/prisma.js", () => {
  // Loja em memória que HONRA a unicidade (clientId, chaveAcesso) do schema — sem isso o teste não
  // distingue "achou a linha" de "criou outra", que é a diferença entre duplicada e importada.
  const store = { notas: [], itens: [] };
  let seq = 0;

  function localizar(where) {
    if (where?.clientId_chaveAcesso) {
      const { clientId, chaveAcesso } = where.clientId_chaveAcesso;
      return store.notas.find((n) => n.clientId === clientId && n.chaveAcesso === chaveAcesso) || null;
    }
    return null;
  }

  const db = {
    portalClient: {
      findUnique: jest.fn(async () => ({ id: "p1", cnpj: "71402596000102" })),
    },
    companyMonthlyCircular: {
      findFirst: jest.fn(async () => null), // nenhuma competência fechada por padrão
    },
    portalInvoice: {
      findUnique: jest.fn(async ({ where }) => localizar(where)),
      upsert: jest.fn(async ({ where, create, update }) => {
        const achada = localizar(where);
        if (achada) {
          Object.assign(achada, update);
          return achada;
        }
        seq += 1;
        const nova = { id: `n${seq}`, ...create };
        store.notas.push(nova);
        return nova;
      }),
    },
    notaItem: {
      findMany: jest.fn(async ({ where }) => store.itens.filter((i) => i.notaId === where.notaId)),
      deleteMany: jest.fn(async ({ where }) => {
        for (let i = store.itens.length - 1; i >= 0; i -= 1) {
          if (store.itens[i].notaId === where.notaId) store.itens.splice(i, 1);
        }
        return { count: 0 };
      }),
      createMany: jest.fn(async ({ data }) => {
        store.itens.push(...data);
        return { count: data.length };
      }),
    },
    pendenciaPosFechamento: { create: jest.fn(async () => ({ id: "pend1" })) },
    $transaction: jest.fn(async (fn) => (typeof fn === "function" ? fn(db) : Promise.all(fn))),
  };
  return { prisma: db, __store: store };
});

import { prisma, __store } from "../../../../infrastructure/db/prisma.js";
import { importarLoteNfe, textoDoResultado } from "../ImportNfeLoteService.js";
import { classificarDocumentoDoLote, MOTIVO } from "../loteNfe.js";
import { createPortalInvoicesRouter } from "../../../../routes/portalInvoices.js";
import { montarZip } from "./fixtures/montarZip.js";
import { CNPJ, montarChave, xmlNfeProc, xmlEvento, xmlResumo } from "./fixtures/nfeFabricada.js";

const EMPRESA = CNPJ.EMPRESA_MATRIZ;

let dir;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "import-nfe-"));
  __store.notas.length = 0;
  __store.itens.length = 0;
  jest.clearAllMocks();
  prisma.companyMonthlyCircular.findFirst.mockResolvedValue(null);
  prisma.portalClient.findUnique.mockResolvedValue({ id: "p1", cnpj: EMPRESA });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true }).catch(() => {});
});

/** Sobe um lote pelo SERVIÇO (mesmo caminho que a rota usa). */
async function importar(entradas, { nome = "lote.zip", cnpjEmpresa = EMPRESA } = {}) {
  const caminho = join(dir, nome);
  await montarZip(caminho, entradas);
  return importarLoteNfe({
    portalClientId: "p1",
    cnpjEmpresa,
    arquivos: [{ nome, caminho }],
  });
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("⚠⚠ o papel NÃO cai no default — nota de VENDA entra como EMIT", () => {
  test("a nota que a empresa EMITIU entra com papel EMIT", async () => {
    const chave = montarChave({ cnpj: EMPRESA, numero: "000000101" });
    const r = await importar([
      { nome: "venda.xml", conteudo: xmlNfeProc({ chave, emitCnpj: EMPRESA, destCnpj: CNPJ.CLIENTE_COMPRADOR }) },
    ]);

    expect(r.importadas).toBe(1);
    expect(r.emitidas).toBe(1);
    expect(r.recebidas).toBe(0);
    expect(__store.notas).toHaveLength(1);
    expect(__store.notas[0].papel).toBe("EMIT");
    expect(__store.notas[0].type).toBe("NFE");
    expect(__store.notas[0].chaveAcesso).toBe(chave);
    // O XML completo é guardado — é o que sustenta qualquer auditoria depois.
    expect(__store.notas[0].xmlRaw).toContain("<nfeProc");
  });

  test("a nota que a empresa RECEBEU entra com papel DEST", async () => {
    const chave = montarChave({ cnpj: CNPJ.FORNECEDOR, numero: "000000900" });
    const r = await importar([
      { nome: "compra.xml", conteudo: xmlNfeProc({ chave, emitCnpj: CNPJ.FORNECEDOR, destCnpj: EMPRESA }) },
    ]);

    expect(r.importadas).toBe(1);
    expect(r.emitidas).toBe(0);
    expect(r.recebidas).toBe(1);
    expect(__store.notas[0].papel).toBe("DEST");
  });

  // ⚠ ESTE É O TESTE QUE FECHA A ARMADILHA. `parseDocZip` devolveria `papel:"DEST"` para uma nota
  // em que NENHUM dos dois CNPJs é o da empresa. O classificador do lote RECUSA — nunca rotula.
  test("nota de terceiro NÃO vira DEST: é recusada, e nada é gravado", async () => {
    const chave = montarChave({ cnpj: CNPJ.TERCEIRO, numero: "000000777" });
    const r = await importar([
      { nome: "alheia.xml", conteudo: xmlNfeProc({ chave, emitCnpj: CNPJ.TERCEIRO, destCnpj: CNPJ.FORNECEDOR }) },
    ]);

    expect(r.recusadas).toBe(1);
    expect(r.importadas).toBe(0);
    expect(r.motivos[MOTIVO.NOTA_NAO_PERTENCE]).toBe(1);
    expect(__store.notas).toHaveLength(0);
  });

  test("o classificador nunca devolve papel sem uma igualdade de CNPJ verdadeira", () => {
    const xml = xmlNfeProc({
      chave: montarChave({ cnpj: CNPJ.TERCEIRO }),
      emitCnpj: CNPJ.TERCEIRO,
      destCnpj: CNPJ.FORNECEDOR,
    });
    // sem CNPJ da empresa: nada de papel, nada de importação
    expect(classificarDocumentoDoLote(xml, { cnpjEmpresa: "" }).decisao).not.toBe("importar");
    expect(classificarDocumentoDoLote(xml, { cnpjEmpresa: EMPRESA }).papel).toBeUndefined();
    expect(classificarDocumentoDoLote(xml, { cnpjEmpresa: CNPJ.TERCEIRO }).papel).toBe("EMIT");
    expect(classificarDocumentoDoLote(xml, { cnpjEmpresa: CNPJ.FORNECEDOR }).papel).toBe("DEST");
  });

  test("sem CNPJ na empresa o lote inteiro é recusado — não se importa 'sem papel'", async () => {
    const r = await importarLoteNfe({ portalClientId: "p1", cnpjEmpresa: null, arquivos: [] });
    expect(r.ok).toBe(false);
    expect(r.erro).toBe("empresa_sem_cnpj");
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("1 ZIP → N documentos, e o que vem junto não derruba o lote", () => {
  test("o ZIP misto entra: notas gravadas, eventos e NFC-e contados e nomeados", async () => {
    const chaveVenda1 = montarChave({ cnpj: EMPRESA, numero: "000000101" });
    const chaveVenda2 = montarChave({ cnpj: EMPRESA, numero: "000000102" });
    const chaveNfce = montarChave({ cnpj: EMPRESA, modelo: "65", numero: "000000501" });

    const r = await importar([
      { nome: "101-nfe.xml", conteudo: xmlNfeProc({ chave: chaveVenda1, numero: "101" }) },
      { nome: "102-nfe.xml", conteudo: xmlNfeProc({ chave: chaveVenda2, numero: "102" }) },
      { nome: "101-procEventoNFe.xml", conteudo: xmlEvento({ chave: chaveVenda1 }) },
      { nome: "501-nfce.xml", conteudo: xmlNfeProc({ chave: chaveNfce, modelo: "65", numero: "501" }) },
      { nome: "leiame.txt", conteudo: "isto nao e xml" },
    ]);

    expect(r.ok).toBe(true);
    expect(r.documentos).toBe(5);
    expect(r.importadas).toBe(2);
    expect(r.emitidas).toBe(2);
    expect(r.ignoradas).toBe(3);
    expect(r.motivos[MOTIVO.EVENTO]).toBe(1);
    expect(r.motivos[MOTIVO.MODELO_65]).toBe(1);
    expect(r.motivos[MOTIVO.NAO_E_XML]).toBe(1);
    expect(__store.notas).toHaveLength(2);
  });

  // ⚠ O EVENTO DE CANCELAMENTO É CONTADO À PARTE — ele NÃO é aplicado nesta versão, e o dono tem
  // de VER isso. Nota cancelada depois da emissão permanece `autorizada` até a captura tratar.
  test("cancelamento vindo no lote aparece no relatório como não aplicado", async () => {
    const chave = montarChave({ cnpj: EMPRESA, numero: "000000101" });
    const r = await importar([
      { nome: "nota.xml", conteudo: xmlNfeProc({ chave }) },
      { nome: "evento.xml", conteudo: xmlEvento({ chave, tpEvento: "110111" }) },
    ]);
    expect(r.eventosDeCancelamento).toBe(1);
    expect(__store.notas[0].statusEfetivo).toBe("autorizada");
  });

  test("VÁRIOS ZIPs num envio só — o Fisco Fácil entrega 'um ou mais', conforme o volume", async () => {
    const c1 = join(dir, "lote-a.zip");
    const c2 = join(dir, "lote-b.zip");
    await montarZip(c1, [{ nome: "a.xml", conteudo: xmlNfeProc({ chave: montarChave({ cnpj: EMPRESA, numero: "000000201" }), numero: "201" }) }]);
    await montarZip(c2, [{ nome: "b.xml", conteudo: xmlNfeProc({ chave: montarChave({ cnpj: EMPRESA, numero: "000000202" }), numero: "202" }) }]);

    const r = await importarLoteNfe({
      portalClientId: "p1",
      cnpjEmpresa: EMPRESA,
      arquivos: [{ nome: "lote-a.zip", caminho: c1 }, { nome: "lote-b.zip", caminho: c2 }],
    });

    expect(r.importadas).toBe(2);
    expect(r.arquivos).toHaveLength(2);
    expect(r.arquivos.every((a) => a.tipo === "zip" && a.importadas === 1)).toBe(true);
  });

  test("XML SOLTO (fora de ZIP) também entra — o dono pode subir um arquivo só", async () => {
    const chave = montarChave({ cnpj: EMPRESA, numero: "000000303" });
    const caminho = join(dir, "nota.xml");
    await writeFile(caminho, xmlNfeProc({ chave, numero: "303" }), "utf8");

    const r = await importarLoteNfe({
      portalClientId: "p1",
      cnpjEmpresa: EMPRESA,
      arquivos: [{ nome: "nota.xml", caminho }],
    });
    expect(r.arquivos[0].tipo).toBe("xml");
    expect(r.importadas).toBe(1);
    expect(__store.notas[0].papel).toBe("EMIT");
  });

  test("resumo (resNFe) de emitente que não é a empresa NÃO vira DEST — fica ignorado e nomeado", async () => {
    const r = await importar([
      { nome: "resumo.xml", conteudo: xmlResumo({ chave: montarChave({ cnpj: CNPJ.FORNECEDOR, numero: "000000811" }) }) },
    ]);
    expect(r.importadas).toBe(0);
    expect(r.motivos[MOTIVO.RESUMO_SEM_TITULARIDADE]).toBe(1);
    expect(__store.notas).toHaveLength(0);
  });

  test("ZIP dentro de ZIP é contado, não silenciado", async () => {
    const interno = join(dir, "interno.zip");
    await montarZip(interno, [{ nome: "x.xml", conteudo: "<a/>" }]);
    const externo = join(dir, "externo.zip");
    const { readFile } = await import("node:fs/promises");
    await montarZip(externo, [{ nome: "dentro.zip", conteudo: await readFile(interno) }]);

    const r = await importarLoteNfe({
      portalClientId: "p1", cnpjEmpresa: EMPRESA,
      arquivos: [{ nome: "externo.zip", caminho: externo }],
    });
    expect(r.motivos[MOTIVO.ZIP_ANINHADO]).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("dedup e titularidade", () => {
  test("subir o MESMO lote duas vezes não cria linha nova — conta como duplicada", async () => {
    const chave = montarChave({ cnpj: EMPRESA, numero: "000000101" });
    const doc = [{ nome: "nota.xml", conteudo: xmlNfeProc({ chave }) }];

    const r1 = await importar(doc, { nome: "lote1.zip" });
    const r2 = await importar(doc, { nome: "lote2.zip" });

    expect(r1.importadas).toBe(1);
    expect(r2.importadas).toBe(0);
    expect(r2.duplicadas).toBe(1);
    expect(__store.notas).toHaveLength(1); // ⚠ UMA linha, sempre
  });

  test("a mesma chave em DOIS ZIPs do mesmo envio conta uma vez só", async () => {
    const chave = montarChave({ cnpj: EMPRESA, numero: "000000101" });
    const c1 = join(dir, "a.zip");
    const c2 = join(dir, "b.zip");
    await montarZip(c1, [{ nome: "n.xml", conteudo: xmlNfeProc({ chave }) }]);
    await montarZip(c2, [{ nome: "n.xml", conteudo: xmlNfeProc({ chave }) }]);

    const r = await importarLoteNfe({
      portalClientId: "p1", cnpjEmpresa: EMPRESA,
      arquivos: [{ nome: "a.zip", caminho: c1 }, { nome: "b.zip", caminho: c2 }],
    });
    expect(r.importadas).toBe(1);
    expect(r.duplicadas).toBe(1);
    expect(__store.notas).toHaveLength(1);
  });

  // ⚠ POR ESTABELECIMENTO: a extração do Fisco Fácil não aceita raiz de CNPJ. Lote da filial subido
  // na matriz tem motivo PRÓPRIO — "não pertence" mandaria procurar defeito onde não há.
  test("lote da FILIAL subido na matriz é recusado com motivo outro_estabelecimento", async () => {
    const chave = montarChave({ cnpj: CNPJ.EMPRESA_FILIAL, numero: "000000101" });
    const r = await importar([
      { nome: "filial.xml", conteudo: xmlNfeProc({ chave, emitCnpj: CNPJ.EMPRESA_FILIAL, destCnpj: CNPJ.CLIENTE_COMPRADOR }) },
    ]);
    expect(r.recusadas).toBe(1);
    expect(r.motivos[MOTIVO.OUTRO_ESTABELECIMENTO]).toBe(1);
    expect(r.motivos[MOTIVO.NOTA_NAO_PERTENCE]).toBeUndefined();
    expect(__store.notas).toHaveLength(0);
  });

  test("os itens da nota são gravados (NCM/CFOP/valor)", async () => {
    const chave = montarChave({ cnpj: EMPRESA, numero: "000000101" });
    await importar([{
      nome: "nota.xml",
      conteudo: xmlNfeProc({
        chave,
        itens: [
          { xProd: "PRODUTO A", ncm: "84713012", cfop: "5102", vProd: "1000.00" },
          { xProd: "PRODUTO B", ncm: "39269090", cfop: "5102", vProd: "500.00" },
        ],
      }),
    }]);
    expect(__store.itens).toHaveLength(2);
    expect(__store.itens.map((i) => i.cfop)).toEqual(["5102", "5102"]);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("o relatório é requisito — ausência nunca é resposta", () => {
  // ⚠ O lote PODE vir legitimamente vazio ("Processada sem resultado") e o portal tem ~10 dias de
  // carência. Sem isso, "não veio nada" e "deu erro" ficam idênticos na tela.
  test("lote vazio é marcado como VAZIO e a frase explica a carência", async () => {
    const r = await importar([]);
    expect(r.ok).toBe(true);
    expect(r.documentos).toBe(0);
    expect(r.loteVazio).toBe(true);
    const texto = textoDoResultado(r);
    expect(texto).toMatch(/Processada sem resultado/);
    expect(texto).toMatch(/10 dias/);
  });

  test("lote com documentos que não são notas NÃO é 'vazio' — e a frase diz o motivo", async () => {
    const r = await importar([
      { nome: "ev.xml", conteudo: xmlEvento({ chave: montarChave({ cnpj: EMPRESA }) }) },
    ]);
    expect(r.loteVazio).toBe(false);
    const texto = textoDoResultado(r);
    expect(texto).toMatch(/importadas 0/);
    expect(texto).toMatch(/evento: 1/);
  });

  test("a frase traz importadas · duplicadas · ignoradas e o par emitidas/recebidas", async () => {
    const chave = montarChave({ cnpj: EMPRESA, numero: "000000101" });
    const r = await importar([
      { nome: "nota.xml", conteudo: xmlNfeProc({ chave }) },
      { nome: "ev.xml", conteudo: xmlEvento({ chave }) },
    ]);
    const texto = textoDoResultado(r);
    expect(texto).toMatch(/importadas 1/);
    expect(texto).toMatch(/duplicadas 0/);
    expect(texto).toMatch(/ignoradas 1/);
    expect(texto).toMatch(/Emitidas 1 · recebidas 0/);
  });

  test("cada arquivo tem a própria linha no relatório", async () => {
    const r = await importar([
      { nome: "nota.xml", conteudo: xmlNfeProc({ chave: montarChave({ cnpj: EMPRESA }) }) },
    ], { nome: "lote-2026-01.zip" });
    expect(r.arquivos[0]).toMatchObject({ nome: "lote-2026-01.zip", tipo: "zip", documentos: 1, importadas: 1 });
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("a rota", () => {
  function app() {
    // ⚠ `ensureAuthorized` NÃO é a única porta. A rota chama também `ensurePortalClientAccess`
    // (`routes/middlewares/portalAccess.js`), que é IMPORTADA, não injetada — ela lê
    // `req.auth.user` e, sem usuário, responde 401 antes de qualquer coisa. Injetar o usuário
    // aqui é o que o middleware de auth faz em produção; sem isto a suíte mede 401 e não a rota.
    //
    // ⚠ `role: "ADMIN"` de propósito: `isAdminLike` corta o caminho antes das consultas de
    // vínculo (`companyClientUser`/`companyFirmAccess`), que não são o que esta suíte mede — o
    // escopo por empresa tem suíte própria. Medir aqui criaria uma segunda definição de acesso.
    return express()
      .use((req, _res, next) => {
        req.auth = { user: { id: "u1", role: "ADMIN" } };
        next();
      })
      .use("/clients/:clientId/invoices", createPortalInvoicesRouter({
        ensureAuthorized: async () => true,
        log: { info() {}, warn() {}, error() {}, debug() {} },
      }));
  }

  test("POST /import/nfe sobe o ZIP e devolve o relatório com a mensagem", async () => {
    const caminho = join(dir, "lote.zip");
    const chave = montarChave({ cnpj: EMPRESA, numero: "000000101" });
    await montarZip(caminho, [
      { nome: "nota.xml", conteudo: xmlNfeProc({ chave }) },
      { nome: "ev.xml", conteudo: xmlEvento({ chave }) },
    ]);

    const resp = await request(app())
      .post("/clients/p1/invoices/import/nfe")
      .attach("files", caminho);

    expect(resp.status).toBe(200);
    expect(resp.body.importadas).toBe(1);
    expect(resp.body.emitidas).toBe(1);
    expect(resp.body.ignoradas).toBe(1);
    expect(resp.body.mensagem).toMatch(/importadas 1/);
    expect(__store.notas[0].papel).toBe("EMIT");
  });

  test("sem arquivo → 400 files_required", async () => {
    const resp = await request(app()).post("/clients/p1/invoices/import/nfe");
    expect(resp.status).toBe(400);
    expect(resp.body.error).toBe("files_required");
  });

  test("empresa sem CNPJ → 422, e nada é gravado", async () => {
    prisma.portalClient.findUnique.mockResolvedValue({ id: "p1", cnpj: null });
    const caminho = join(dir, "lote.zip");
    await montarZip(caminho, [{ nome: "n.xml", conteudo: xmlNfeProc({ chave: montarChave({ cnpj: EMPRESA }) }) }]);
    const resp = await request(app()).post("/clients/p1/invoices/import/nfe").attach("files", caminho);
    expect(resp.status).toBe(422);
    expect(resp.body.error).toBe("empresa_sem_cnpj");
    expect(__store.notas).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("a persistência não pode voltar a ser reimplementada", () => {
  // ⚠ Guarda de TEXTO-FONTE, igual à de `ingestaoNfseUnica.test.js`. Duas gravações discordantes já
  // custaram faturamento SOMADO EM DOBRO neste projeto (NFS-e). Na NF-e de venda o custo é o mesmo
  // dinheiro. O serviço tem de delegar a `ingestaoNfe.js`, e a captura tem de usar A MESMA função.
  const fs = require("node:fs");
  const path = require("node:path");
  const raiz = path.resolve(__dirname, "../../../../..");

  test("o import chama upsertNfeFromParsed, e não faz upsert próprio", () => {
    const src = fs.readFileSync(path.join(raiz, "src/application/notas/importXml/ImportNfeLoteService.js"), "utf8");
    expect(src).toContain('from "../ingestaoNfe.js"');
    expect(src).toContain("upsertNfeFromParsed(");
    expect(src).not.toContain("portalInvoice.upsert");
  });

  test("a captura DFe usa a MESMA função — nada de persistência local", () => {
    const src = fs.readFileSync(path.join(raiz, "src/application/notas/dfe/DfeSyncService.js"), "utf8");
    expect(src).toContain('from "../ingestaoNfe.js"');
    expect(src).not.toContain("async function upsertNotaFromParsed");
  });

  test("o import NÃO fala com a SEFAZ nem com o ADN", () => {
    for (const arquivo of ["ImportNfeLoteService.js", "loteNfe.js", "zipLeitura.js"]) {
      const src = fs.readFileSync(path.join(raiz, "src/application/notas/importXml/", arquivo), "utf8");
      expect(src).not.toContain("DfeClient");
      expect(src).not.toContain("AdnNotasService");
      expect(src).not.toMatch(/\bfetch\(/);
    }
  });
});
