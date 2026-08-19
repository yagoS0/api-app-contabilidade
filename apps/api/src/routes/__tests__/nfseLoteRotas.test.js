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

function app() {
  const a = express();
  a.use("/companies/:companyId/nfse/lote", createNfseLoteRouter({ log: { warn: jest.fn() } }));
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
