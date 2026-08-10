// A ÍNTEGRA DE UMA NOTA — `GET /notas/:notaId` — e a ordem de registro que a torna possível.
//
// ⚠ DUAS COISAS, e a segunda é a que se pode reintroduzir sem perceber:
//
// 1. A rota devolve o que a LISTA não devolve: `itens`, `xmlRaw`, `idNfse`/`idDps` e os carimbos
//    de captura. Medido em produção (10/08/2026): **16.128 de 16.128 NFS-e têm `xmlRaw` gravado**
//    e **16.127 têm item com descrição + código LC116** — dado guardado sem nenhuma rota que o
//    servisse. O ZIP em lote (`/firm/notas-download`) era o único caminho até o XML.
//
// 2. `GET /notas/:notaId` é um CURINGA e precisa ser registrado DEPOIS de `GET /notas/summary`.
//    Registrado antes, ele lê "summary" como um id de nota e responde `404 nota_nao_encontrada`
//    — o resumo da aba (as caixas Emitidas/Recebidas) morreria com uma mensagem que fala de uma
//    nota inexistente, e ninguém procuraria roteamento. É o mesmo cuidado que `/companies/annual`
//    e as literais de `/parcelamentos/` já exigiram.
//
// ⚠ AUSÊNCIA NÃO É RESPOSTA: `xml.disponivel` distingue "não temos XML" (as 29 NF-e da base, todas
//    sem `xmlRaw`) de "temos e não coube" (`truncadoPorTamanho`). Devolver `conteudo: null` nos
//    dois casos apagaria a diferença — que é justamente a que o contador precisa ver.

jest.mock("../../../middlewares/requireFirmCompanyAccess.js", () => ({
  requireFirmCompanyAccess: () => (req, res, next) => {
    req.auth = { user: { id: "u1", role: "ACCOUNTANT" } };
    next();
  },
}));

jest.mock("../../../infrastructure/db/prisma.js", () => ({
  prisma: {
    portalInvoice: { findFirst: jest.fn(), findMany: jest.fn(async () => []), count: jest.fn(async () => 0) },
    notaItem: { findMany: jest.fn(async () => []) },
    // O detalhe passou a devolver o CICLO DE VIDA junto (cancelada × substituída × substituta ×
    // "não temos o evento"), e para isso lê os eventos da nota. Vazio por padrão: é exatamente o
    // estado de produção hoje (0 linhas para 556 canceladas), e é o caso que precisa continuar
    // respondendo sem quebrar.
    portalInvoiceEvent: { findMany: jest.fn(async () => []) },
  },
}));

// Serviços que o router importa no topo — nenhum é exercido aqui.
jest.mock("../../../application/notas/CompetenciaStateMachine.js", () => ({
  ESTADOS: { ABERTO: "aberto" }, ensureCompetencia: jest.fn(), fecharCompetencia: jest.fn(), reabrirCompetencia: jest.fn(),
}));
jest.mock("../../../application/notas/CertResolver.js", () => ({ checkCertAvailability: jest.fn(), SERVICOS: {} }));
jest.mock("../../../application/notas/dfe/DfeSyncService.js", () => ({ syncDfeForCompany: jest.fn() }));
jest.mock("../../../application/notas/adn/AdnNotasService.js", () => ({ syncAdnNotasForCompany: jest.fn() }));
jest.mock("../../../application/notas/apuracao/ClassificadorAnexos.js", () => ({ classifyItemsForCompany: jest.fn() }));
jest.mock("../../../application/notas/apuracao/CalculoFiscal.js", () => ({ calcularApuracaoParaCompetencia: jest.fn() }));
jest.mock("../../../application/notas/apuracao/ApuracaoTransmissaoService.js", () => ({ transmitirApuracao: jest.fn() }));
jest.mock("../../../application/notas/apuracao/ApuracaoConferenciaService.js", () => ({ conferirApuracao: jest.fn() }));

import express from "express";
import request from "supertest";
import { prisma } from "../../../infrastructure/db/prisma.js";
import { createNotasRouter } from "../notas.js";

const log = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

function makeApp() {
  const app = express();
  app.use(express.json());
  const parent = express.Router();
  parent.use("/companies/:companyId", createNotasRouter({ log }));
  app.use("/firm", parent);
  app.use((req, res) => res.status(404).json({ ok: false, error: "no_route" }));
  return app;
}

// Decimal do Prisma: objeto com toString. `decimalToString` depende disso.
const dec = (s) => ({ toString: () => s });

function notaCompleta(over = {}) {
  return {
    id: "nota-1", clientId: "emp-1", type: "NFSE", papel: "EMIT",
    numero: "13967", serie: null,
    chaveAcesso: "33045572255387580000103000000001396726088969924159",
    idNfse: null, idDps: null,
    competencia: new Date("2026-08-01T00:00:00.000Z"),
    issueDate: new Date("2026-08-10T00:00:00.000Z"),
    status: "EMITIDA", statusEfetivo: "autorizada", total: dec("540.00"),
    emitenteNome: "EMPRESA EXEMPLO LTDA", emitenteDoc: "00000000000191",
    tomadorNome: "TOMADOR EXEMPLO LTDA", tomadorDoc: "00000000000272",
    competenciaPosFechamento: false, pdfUrl: null, xmlHash: null,
    lastSyncAt: null, createdAt: new Date("2026-08-10T15:13:15.719Z"), updatedAt: new Date("2026-08-10T15:13:15.719Z"),
    xmlRaw: "<NFSe><infNFSe>exemplo</infNFSe></NFSe>",
    itens: [{
      id: "item-1", descricao: "CURSO EAD", codigoServico: "080201", cfop: null, ncm: null,
      valor: dec("540.00"), tipoReceita: null, anexoResolvido: null,
      sujeitoFatorR: false, flagST: false, flagMonofasico: false, flagExportacao: false,
      classificadoEm: null,
    }],
    ...over,
  };
}

beforeEach(() => jest.clearAllMocks());

describe("GET /notas/:notaId — a íntegra da nota", () => {
  it("devolve itens, XML e identificadores que a LISTA não devolve", async () => {
    prisma.portalInvoice.findFirst.mockResolvedValue(notaCompleta());

    const res = await request(makeApp()).get("/firm/companies/emp-1/notas/nota-1");

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // O que a lista já tinha continua lá…
    expect(res.body.nota.numero).toBe("13967");
    expect(res.body.nota.total).toBe("540.00");
    // …e o que ela NÃO tinha é o motivo desta rota existir.
    expect(res.body.nota.itens).toHaveLength(1);
    expect(res.body.nota.itens[0].descricao).toBe("CURSO EAD");
    expect(res.body.nota.itens[0].codigoServico).toBe("080201");
    expect(res.body.nota.itens[0].valor).toBe("540.00");
    expect(res.body.nota.xml.disponivel).toBe(true);
    expect(res.body.nota.xml.conteudo).toContain("<infNFSe>");
    expect(res.body.nota.xml.truncadoPorTamanho).toBe(false);
    // Identificadores alternativos viajam mesmo nulos — a NFS-e nem sempre tem chave, e o front
    // precisa poder dizer "não temos" em vez de omitir a linha.
    expect(res.body.nota).toHaveProperty("idNfse", null);
    expect(res.body.nota).toHaveProperty("idDps", null);
  });

  it('sem XML responde `disponivel: false` — e NÃO se confunde com "temos e não coube"', async () => {
    // As 29 NF-e da base são exatamente este caso: `xmlRaw` nulo em 29 de 29.
    prisma.portalInvoice.findFirst.mockResolvedValue(
      notaCompleta({ type: "NFE", xmlRaw: null, tomadorNome: null, tomadorDoc: null, itens: [] }),
    );

    const res = await request(makeApp()).get("/firm/companies/emp-1/notas/nota-1");

    expect(res.body.nota.xml).toEqual({
      disponivel: false, bytes: null, conteudo: null, truncadoPorTamanho: false,
    });
    expect(res.body.nota.itens).toEqual([]);
    // Campo ausente viaja como null explícito, não sumindo do payload.
    expect(res.body.nota).toHaveProperty("tomadorNome", null);
  });

  it("isola por empresa — nota de outro cliente é 404", async () => {
    prisma.portalInvoice.findFirst.mockResolvedValue(null);

    const res = await request(makeApp()).get("/firm/companies/emp-2/notas/nota-1");

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("nota_nao_encontrada");
    // O where LEVA o clientId — é o que garante o isolamento multi-tenant.
    expect(prisma.portalInvoice.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "nota-1", clientId: "emp-2" } }),
    );
  });
});

describe("ORDEM DE REGISTRO — o curinga não pode engolir as literais", () => {
  it("`/notas/summary` continua sendo o RESUMO, não uma nota de id 'summary'", async () => {
    prisma.portalInvoice.findMany.mockResolvedValue([]);
    // Se a ordem quebrar, o handler do curinga responde primeiro e nunca chama next().
    prisma.portalInvoice.findFirst.mockResolvedValue(null);

    const res = await request(makeApp()).get("/firm/companies/emp-1/notas/summary");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("totals");
    expect(res.body).toHaveProperty("byMonth");
    // A prova negativa: o curinga NÃO foi consultado com "summary" como id.
    expect(prisma.portalInvoice.findFirst).not.toHaveBeenCalled();
  });
});
