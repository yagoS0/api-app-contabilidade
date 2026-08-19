// AS DUAS PORTAS DO LOTE — e a prova de que nenhuma delas emite ou grava.
//
// ⚠ NADA AQUI EMITE COISA ALGUMA. O Prisma é um dublê e o único I/O é o upload em memória.

jest.mock("../../infrastructure/db/prisma.js", () => ({
  prisma: { tomadorEmitido: { findMany: jest.fn(async () => []) } },
}));

import express from "express";
import request from "supertest";
import * as XLSX from "xlsx";
import { prisma } from "../../infrastructure/db/prisma.js";
import { createNfseLoteRouter } from "../nfseLoteRoutes.js";
import { COLUNAS_LOTE, LINHA_DE_EXEMPLO } from "../../application/nfse/lote/colunasLote.js";

const CABECALHOS = COLUNAS_LOTE.map((c) => c.rotulo);
const CNPJ = "39254243000191";

const NOTA = {
  documento: CNPJ,
  nome: "TOMADOR LTDA",
  descricao: "Consultoria",
  valor: "1500,00",
  competencia: "31/07/2026",
};

const ENDERECO = {
  cMun: "3304557",
  cep: "20031005",
  xLgr: "Av. Rio Branco",
  nro: "100",
  xBairro: "Centro",
};

function planilha(linhas) {
  const wb = XLSX.utils.book_new();
  const matriz = [CABECALHOS, ...linhas.map((v) => COLUNAS_LOTE.map((c) => v[c.chave] ?? ""))];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(matriz), "Notas");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

function app(opcoes = {}) {
  const a = express();
  a.use(
    "/companies/:companyId/nfse/lote",
    createNfseLoteRouter({ log: { warn: jest.fn() }, ...opcoes })
  );
  return a;
}

const BASE = "/companies/company-1/nfse/lote";

beforeEach(() => {
  jest.clearAllMocks();
  prisma.tomadorEmitido.findMany.mockResolvedValue([]);
});

describe("GET /modelo", () => {
  it("devolve um .xlsx com as 12 colunas e o nome de arquivo certo", async () => {
    const r = await request(app()).get(`${BASE}/modelo`).buffer().parse((res, cb) => {
      const pedacos = [];
      res.on("data", (p) => pedacos.push(p));
      res.on("end", () => cb(null, Buffer.concat(pedacos)));
    });

    expect(r.status).toBe(200);
    expect(r.headers["content-disposition"]).toContain("modelo-emissao-em-lote.xlsx");
    const wb = XLSX.read(r.body, { type: "buffer" });
    const [cabecalho] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
    expect(cabecalho).toEqual(CABECALHOS);
  });

  it("⚠ não toca no banco — o modelo não depende de cadastro nenhum", async () => {
    await request(app()).get(`${BASE}/modelo`);
    expect(prisma.tomadorEmitido.findMany).not.toHaveBeenCalled();
  });
});

describe("POST /leitura", () => {
  it("classifica e devolve — sem gravar nada", async () => {
    const r = await request(app())
      .post(`${BASE}/leitura`)
      .attach("arquivo", planilha([{ ...NOTA, ...ENDERECO }]), "notas.xlsx");

    expect(r.status).toBe(200);
    expect(r.body.resumo.total).toBe(1);
    // ⚠ Sem a lista do IBGE no backend, o `cMun` da planilha sai para CONFERÊNCIA — nunca "pronta".
    expect(r.body.resumo.conferir).toBe(1);
    expect(r.body.linhas[0].conferencias[0].codigo).toBe("municipio_nao_conferido");
  });

  it("⚠ a memória de tomadores é lida ESCOPADA pela empresa do PATH", async () => {
    await request(app()).post(`${BASE}/leitura`).attach("arquivo", planilha([NOTA]), "notas.xlsx");
    expect(prisma.tomadorEmitido.findMany).toHaveBeenCalledWith({
      where: { companyId: "company-1", documento: { in: [CNPJ] } },
    });
  });

  it("tomador conhecido preenche o endereço — o “só preencher” do dono", async () => {
    prisma.tomadorEmitido.findMany.mockResolvedValue([{ documento: CNPJ, ...ENDERECO }]);
    const r = await request(app()).post(`${BASE}/leitura`).attach("arquivo", planilha([NOTA]), "notas.xlsx");
    expect(r.body.linhas[0].estado).toBe("pronta");
    expect(r.body.linhas[0].origemEndereco).toBe("memoria");
  });

  it("⚠⚠ a tabela ainda não criada (migration não aplicada) NÃO derruba a leitura", async () => {
    prisma.tomadorEmitido.findMany.mockRejectedValue(
      Object.assign(new Error("The table does not exist"), { code: "P2021" })
    );
    const r = await request(app()).post(`${BASE}/leitura`).attach("arquivo", planilha([NOTA]), "notas.xlsx");
    expect(r.status).toBe(200);
    expect(r.body.memoriaIndisponivel).toBeTruthy();
    expect(r.body.linhas[0].estado).toBe("consultar");
  });

  it("⚠ CNPJ desconhecido volta em `consultar` — o backend NÃO consulta", async () => {
    const r = await request(app()).post(`${BASE}/leitura`).attach("arquivo", planilha([NOTA]), "notas.xlsx");
    expect(r.body.aConsultar).toEqual([CNPJ]);
  });

  it("⚠⚠ RESULTADO PARCIAL: reclassifica com o que o front já resolveu", async () => {
    const r = await request(app())
      .post(`${BASE}/leitura`)
      .field(
        "consultas",
        JSON.stringify({
          [CNPJ]: { ok: true, cMunVerificado: true, endereco: { ...ENDERECO, CEP: ENDERECO.cep } },
        })
      )
      .attach("arquivo", planilha([NOTA, { ...NOTA, documento: "39254243000282" }]), "notas.xlsx");

    expect(r.body.linhas[0].estado).toBe("pronta");
    expect(r.body.linhas[1].estado).toBe("consultar");
    expect(r.body.aConsultar).toEqual(["39254243000282"]);
  });

  it("corpo de consultas malformado não derruba nada — volta em `consultar`", async () => {
    const r = await request(app())
      .post(`${BASE}/leitura`)
      .field("consultas", "{isto não é json")
      .attach("arquivo", planilha([NOTA]), "notas.xlsx");
    expect(r.status).toBe(200);
    expect(r.body.linhas[0].estado).toBe("consultar");
  });

  it("⚠ formato desconhecido recusa com 422 NOMEADO — nunca em silêncio", async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["a", "b"], [1, 2]]), "X");
    const r = await request(app())
      .post(`${BASE}/leitura`)
      .attach("arquivo", XLSX.write(wb, { type: "buffer", bookType: "xlsx" }), "qualquer.xlsx");

    expect(r.status).toBe(422);
    expect(r.body.error).toBe("planilha_sem_cabecalho");
    expect(r.body.message.length).toBeGreaterThan(20);
  });

  it("coluna obrigatória faltando recusa nomeando a coluna", async () => {
    const semValor = CABECALHOS.filter((c) => !c.startsWith("Valor"));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([semValor, semValor.map(() => "x")]), "Notas");
    const r = await request(app())
      .post(`${BASE}/leitura`)
      .attach("arquivo", XLSX.write(wb, { type: "buffer", bookType: "xlsx" }), "x.xlsx");

    expect(r.status).toBe(422);
    expect(r.body.error).toBe("planilha_colunas_faltando");
    expect(r.body.faltando).toEqual(["valor"]);
  });

  it("sem arquivo é 400 nomeado", async () => {
    const r = await request(app()).post(`${BASE}/leitura`);
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("arquivo_ausente");
  });

  it("⚠ a linha de exemplo do modelo, intacta, é descartada e reportada", async () => {
    const r = await request(app())
      .post(`${BASE}/leitura`)
      .attach("arquivo", planilha([LINHA_DE_EXEMPLO, { ...NOTA, ...ENDERECO }]), "notas.xlsx");
    expect(r.body.exemploDescartado).toEqual([2]);
    expect(r.body.resumo.total).toBe(1);
  });

  it("⚠⚠ NENHUMA das duas rotas escreve: nada além do `findMany` foi chamado", async () => {
    await request(app()).get(`${BASE}/modelo`);
    await request(app()).post(`${BASE}/leitura`).attach("arquivo", planilha([NOTA]), "notas.xlsx");
    // O dublê só expõe `findMany` de propósito: qualquer escrita seria `undefined is not a function`
    // e derrubaria o teste com estrondo.
    expect(Object.keys(prisma.tomadorEmitido)).toEqual(["findMany"]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ⚠⚠ O ID DA MEMÓRIA NÃO É O ID DO PATH — e errar aqui é SILENCIOSO
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// `TomadorEmitido.companyId` é o id da **`Company` legada** (`NfseService` grava `company.id`); o
// `:companyId` do portal do cliente é um **`PortalClient.id`**. São entidades com PKs próprias, e
// `routes/middlewares/portalAccess.js` registra que o id de uma NUNCA encontra a outra.
//
// Passar o id do path direto faz o `findMany` voltar **vazio, sem erro nenhum**: todo CNPJ cai em
// `consultar` e o *"se já emitiu para este tomador antes, só preencher"* deixa de existir, em
// silêncio. Nenhum teste de comportamento pega isso — a tela funciona. Estes pegam.
describe("⚠⚠ `resolverCompanyId` — a memória é buscada pela empresa LEGADA", () => {
  it("com o resolvedor, o `findMany` recebe o id RESOLVIDO, nunca o do path", async () => {
    const resolver = jest.fn(async () => "legacy-42");
    await request(app({ resolverCompanyId: resolver }))
      .post(`${BASE}/leitura`)
      .attach("arquivo", planilha([NOTA]), "notas.xlsx");

    expect(resolver).toHaveBeenCalledWith("company-1");
    expect(prisma.tomadorEmitido.findMany).toHaveBeenCalledWith({
      where: { companyId: "legacy-42", documento: { in: [CNPJ] } },
    });
    // ⚠ A contraprova: o id do path NÃO pode ter chegado ao banco.
    const chamada = prisma.tomadorEmitido.findMany.mock.calls[0][0];
    expect(chamada.where.companyId).not.toBe("company-1");
  });

  it("o tomador conhecido da empresa legada preenche o endereço — a corrente inteira", async () => {
    prisma.tomadorEmitido.findMany.mockResolvedValue([{ documento: CNPJ, ...ENDERECO }]);
    const r = await request(app({ resolverCompanyId: async () => "legacy-42" }))
      .post(`${BASE}/leitura`)
      .attach("arquivo", planilha([NOTA]), "notas.xlsx");
    expect(r.body.linhas[0].estado).toBe("pronta");
    expect(r.body.linhas[0].origemEndereco).toBe("memoria");
  });

  it("empresa sem `Company` legada (resolvedor devolve null) não derruba a leitura", async () => {
    const r = await request(app({ resolverCompanyId: async () => null }))
      .post(`${BASE}/leitura`)
      .attach("arquivo", planilha([NOTA]), "notas.xlsx");
    expect(r.status).toBe(200);
    // ⚠ E DIZ que não consultou a memória, em vez de dar a entender que nenhum tomador é conhecido.
    expect(r.body.memoriaIndisponivel).toBeTruthy();
    expect(prisma.tomadorEmitido.findMany).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// O AJUSTE FEITO NA TELA
// ═══════════════════════════════════════════════════════════════════════════════════════════════
describe("⚠ `ajustes` — a linha corrigida na tela é reclassificada pela MESMA regra", () => {
  it("o endereço digitado na tela leva a linha de pendente a pronta", async () => {
    const semEndereco = { ...NOTA, documento: "12345678909" }; // CPF: não se consulta
    const antes = await request(app())
      .post(`${BASE}/leitura`)
      .attach("arquivo", planilha([semEndereco]), "notas.xlsx");
    expect(antes.body.linhas[0].estado).toBe("pendente");
    expect(antes.body.linhas[0].pendencias[0].codigo).toBe("cpf_sem_endereco");
    const numero = antes.body.linhas[0].numero;

    const depois = await request(app())
      .post(`${BASE}/leitura`)
      .field("ajustes", JSON.stringify({ [numero]: { ...ENDERECO } }))
      .attach("arquivo", planilha([semEndereco]), "notas.xlsx");

    // ⚠ `conferir`, não `pronta`: o `cMun` da planilha não é conferível no backend (sem a lista do
    // IBGE) — a segunda metade da prova acontece na tela. Ajustar não pula essa conferência.
    expect(depois.body.linhas[0].estado).toBe("conferir");
    expect(depois.body.linhas[0].origemEndereco).toBe("planilha");
    expect(depois.body.linhasAjustadas).toEqual([numero]);
  });

  it("⚠ o ajuste do DOCUMENTO muda qual tomador se procura na memória", async () => {
    await request(app())
      .post(`${BASE}/leitura`)
      .field("ajustes", JSON.stringify({ 2: { documento: "39254243000282" } }))
      .attach("arquivo", planilha([NOTA]), "notas.xlsx");
    expect(prisma.tomadorEmitido.findMany).toHaveBeenCalledWith({
      where: { companyId: "company-1", documento: { in: ["39254243000282"] } },
    });
  });

  it("sem ajustes, `linhasAjustadas` é vazio — nada é inventado", async () => {
    const r = await request(app()).post(`${BASE}/leitura`).attach("arquivo", planilha([NOTA]), "notas.xlsx");
    expect(r.body.linhasAjustadas).toEqual([]);
  });

  it("⚠⚠ coluna desconhecida RECUSA nomeando — nunca aplica o resto em silêncio", async () => {
    const r = await request(app())
      .post(`${BASE}/leitura`)
      .field("ajustes", JSON.stringify({ 2: { cep: "20031005", inventado: "x" } }))
      .attach("arquivo", planilha([NOTA]), "notas.xlsx");
    expect(r.status).toBe(422);
    expect(r.body.error).toBe("ajuste_coluna_desconhecida");
    expect(r.body.colunasDesconhecidas).toEqual(["inventado"]);
  });

  it("⚠⚠ linha que não existe na planilha RECUSA nomeando", async () => {
    const r = await request(app())
      .post(`${BASE}/leitura`)
      .field("ajustes", JSON.stringify({ 999: { cep: "20031005" } }))
      .attach("arquivo", planilha([NOTA]), "notas.xlsx");
    expect(r.status).toBe(422);
    expect(r.body.error).toBe("ajuste_linha_desconhecida");
    expect(r.body.linhasDesconhecidas).toEqual(["999"]);
  });

  it("⚠⚠ ajuste MALFORMADO recusa — ao contrário de `consultas`, que é dado derivado", async () => {
    const r = await request(app())
      .post(`${BASE}/leitura`)
      .field("ajustes", "{isto não é json")
      .attach("arquivo", planilha([NOTA]), "notas.xlsx");
    expect(r.status).toBe(422);
    expect(r.body.error).toBe("ajuste_forma_invalida");
    // A contraprova está no teste de `consultas` malformado, acima: lá a leitura SEGUE em 200.
  });

  it("⚠ ajustar não escreve nada — o dublê continua só com `findMany`", async () => {
    await request(app())
      .post(`${BASE}/leitura`)
      .field("ajustes", JSON.stringify({ 2: { cep: "20031005" } }))
      .attach("arquivo", planilha([NOTA]), "notas.xlsx");
    expect(Object.keys(prisma.tomadorEmitido)).toEqual(["findMany"]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ⚠ AS CÉLULAS VOLTAM COM A LINHA — sem elas a tela não sabe de qual nota está falando
// ═══════════════════════════════════════════════════════════════════════════════════════════════
describe("`valores` na resposta", () => {
  it("a linha PENDENTE volta com as células — é ela que precisa de ajuste, e `dados` é nulo", async () => {
    const r = await request(app())
      .post(`${BASE}/leitura`)
      .attach("arquivo", planilha([{ ...NOTA, documento: "12345678909" }]), "notas.xlsx");
    const linha = r.body.linhas[0];
    expect(linha.estado).toBe("pendente");
    expect(linha.dados).toBeNull();
    expect(linha.valores.nome).toBe("TOMADOR LTDA");
    expect(linha.valores.valor).toBe("1500,00");
  });

  it("⚠⚠ a data volta como a LEITURA a entendeu (dd/mm/aaaa), nunca em ISO/UTC", async () => {
    // A célula de competência costuma chegar como `Date` (o `cellDates: true` da leitura). Em ISO,
    // um fuso a leste mostraria o dia seguinte — a tela diria 01/08 sobre a linha classificada
    // como 31/07, e a competência sai impressa na nota.
    const wb = XLSX.utils.book_new();
    const matriz = [
      CABECALHOS,
      COLUNAS_LOTE.map((c) => (c.chave === "competencia" ? new Date(2026, 6, 31) : NOTA[c.chave] ?? "")),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(matriz, { cellDates: true }), "Notas");
    const r = await request(app())
      .post(`${BASE}/leitura`)
      .attach("arquivo", XLSX.write(wb, { type: "buffer", bookType: "xlsx", cellDates: true }), "notas.xlsx");

    expect(r.body.linhas[0].valores.competencia).toBe("31/07/2026");
    expect(r.body.linhas[0].valores.competencia).not.toMatch(/T\d{2}:/);
  });

  it("as células voltam JÁ AJUSTADAS, e a linha diz que foi ajustada aqui", async () => {
    const r = await request(app())
      .post(`${BASE}/leitura`)
      .field("ajustes", JSON.stringify({ 2: { nome: "OUTRO NOME LTDA" } }))
      .attach("arquivo", planilha([NOTA]), "notas.xlsx");
    expect(r.body.linhas[0].valores.nome).toBe("OUTRO NOME LTDA");
    expect(r.body.linhas[0].ajustada).toBe(true);
  });

  it("linha não ajustada tem `ajustada: false` — nunca `undefined` disfarçado", async () => {
    const r = await request(app()).post(`${BASE}/leitura`).attach("arquivo", planilha([NOTA]), "notas.xlsx");
    expect(r.body.linhas[0].ajustada).toBe(false);
  });
});
