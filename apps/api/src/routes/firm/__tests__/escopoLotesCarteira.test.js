// O ESCOPO DOS LOTES — quem pode DISPARAR e quem pode LER um job de lote.
//
// ⚠ Dois furos distintos, consertados juntos porque são o mesmo erro em dois sentidos:
//
// 1. ESCRITA — `POST /firm/apuracao/batch` lia `portalClientIds` CRU do corpo e o repassava a
//    `criarBatchJob`. O worker (`apuracaoBatchWorker`) só confere `apuracaoSnapshot.estado ===
//    "fechada"`: valida o ESTADO da apuração, nunca DE QUEM é a empresa. Com o `run-now` logo ao
//    lado transmitindo de verdade (`indicadorTransmissao: true`), isso é ato fiscal IRREVERSÍVEL
//    numa empresa que o usuário não pode nem listar. Faltavam as duas guardas que
//    `/guides/batch-send`, `/guides/liberar-cliente` e `/guides/vazio` já tinham.
//
// 2. LEITURA — `GET /firm/notas-download` fazia `findMany({ orderBy, take: 10 })` **sem `where`**
//    (os 10 jobs mais recentes do sistema inteiro) e `/arquivo` fazia `findUnique({ where: { id } })`,
//    servindo o ZIP a quem conhecesse o jobId. Isso desfazia pelo lado da leitura a guarda
//    `idsDaCarteira` da criação: o escopo já era GRAVADO (`companyIds`, `triggeredBy`) e nunca era
//    consultado. Mesmo furo nas gêmeas (`/sitfis-download`, `/notas-captura`).
//
// ⚠ ESTES TESTES PROVAM A RECUSA, não o caminho feliz — e provam também que o caminho feliz
// continua de pé: admin/contador (que enxergam a carteira toda, `isAdminLikeUser`) passam, e o
// STAFF com `CompanyFirmAccess` em TODAS as empresas do job também.
//
// ⚠ 404, NUNCA 403, nas rotas por id: 403 confirmaria que aquele jobId existe.

jest.mock("../../../infrastructure/db/prisma.js", () => {
  const models = {};
  const raiz = {};
  const proxy = new Proxy(raiz, {
    get(alvo, prop) {
      if (typeof prop === "symbol") return alvo[prop];
      if (prop === "$transaction") return alvo.$transaction;
      if (prop === "$connect" || prop === "$disconnect") {
        if (!alvo[prop]) alvo[prop] = jest.fn(async () => {});
        return alvo[prop];
      }
      if (!models[prop]) {
        const metodos = {};
        models[prop] = new Proxy(metodos, {
          get(m, metodo) {
            if (typeof metodo === "symbol") return m[metodo];
            if (!m[metodo]) m[metodo] = jest.fn();
            return m[metodo];
          },
        });
      }
      return models[prop];
    },
  });
  raiz.$transaction = jest.fn(async (arg) => {
    if (typeof arg === "function") return arg(proxy);
    return Promise.all(arg);
  });
  return { prisma: proxy };
});

// A fila em si não é o assunto: o que se mede é O QUE CHEGA a ela e QUEM consegue rodá-la.
jest.mock("../../../workers/apuracaoBatchWorker.js", () => ({
  criarBatchJob: jest.fn(async () => ({ jobId: "job-apuracao-1", totalEmpresas: 1, ignoradas: 0 })),
  runApuracaoBatchOnce: jest.fn(async () => ({ processados: 0 })),
}));

// O cleanup varre e atualiza jobs vencidos — ruído para uma pergunta de escopo.
jest.mock("../../../application/notas/download/NotasDownloadService.js", () => {
  const real = jest.requireActual("../../../application/notas/download/NotasDownloadService.js");
  return { ...real, cleanupNotasDownloadJobs: jest.fn(async () => {}) };
});

import request from "supertest";
import express from "express";
import { createFirmPortalRouter } from "../index.js";
import { prisma } from "../../../infrastructure/db/prisma.js";
import { criarBatchJob, runApuracaoBatchOnce } from "../../../workers/apuracaoBatchWorker.js";

const MINHA = "portal-minha";
const OUTRA = "portal-de-outro-escritorio";

const STAFF = { id: "user-staff", role: "staff", accountType: "FIRM", email: "staff@escritorio.com" };
const CONTADOR = { id: "user-contador", role: "contador", accountType: "FIRM", email: "contador@escritorio.com" };
const ADMIN = { id: "user-admin", role: "admin", accountType: "FIRM", email: "admin@escritorio.com" };

// As duas empresas existem no banco; o STAFF só tem `CompanyFirmAccess` na primeira.
const EXISTEM = new Set([MINHA, OUTRA]);
const ACESSO_DO_STAFF = new Set([MINHA]);

function montarApp(usuario) {
  const app = express();
  app.use(express.json());
  app.locals.ensureAuthorized = async (req) => {
    req.auth = { user: { ...usuario } };
    return true;
  };
  const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  app.use("/firm", createFirmPortalRouter({ ensureAuthorized: app.locals.ensureAuthorized, log }));
  return app;
}

// O dublê de `portalClient.findMany` responde às DUAS formas de `where` do arquivo: a de
// `idsDaCarteira` (com `firmAccess`, o filtro de carteira) e a do enriquecimento por razão social
// (sem ele). Quem não é admin/contador só recebe de volta o que tem acesso.
function bancoDeEmpresas() {
  prisma.portalClient.findMany.mockImplementation(async ({ where }) => {
    const pedidos = where?.id?.in || [];
    const restrito = Boolean(where?.firmAccess);
    return pedidos
      .filter((id) => EXISTEM.has(id) && (!restrito || ACESSO_DO_STAFF.has(id)))
      .map((id) => ({ id, razao: `Razão de ${id}` }));
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  bancoDeEmpresas();
});

describe("A — POST /firm/apuracao/batch: transmissão em lote", () => {
  test("STAFF não dispara lote — 403, e nada entra na fila", async () => {
    const res = await request(montarApp(STAFF))
      .post("/firm/apuracao/batch")
      .send({ portalClientIds: [MINHA], competencia: "2026-07" });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("forbidden_admin_or_contador_only");
    expect(criarBatchJob).not.toHaveBeenCalled();
  });

  test("o corpo PEDE, a carteira DECIDE: id fora dela é descartado antes de virar fila", async () => {
    // Empresa que não existe na base do escritório: a interseção a deixa de fora em silêncio.
    const res = await request(montarApp(CONTADOR))
      .post("/firm/apuracao/batch")
      .send({ portalClientIds: [MINHA, "portal-inexistente"], competencia: "2026-07" });

    expect(res.status).toBe(200);
    expect(criarBatchJob).toHaveBeenCalledTimes(1);
    expect(criarBatchJob.mock.calls[0][0].portalClientIds).toEqual([MINHA]);
  });

  test("pedindo SÓ o que não é da carteira, a fila recebe lista vazia (e a rota recusa)", async () => {
    criarBatchJob.mockRejectedValueOnce(Object.assign(new Error("Sem empresas selecionadas"), { code: "NO_COMPANIES" }));

    const res = await request(montarApp(CONTADOR))
      .post("/firm/apuracao/batch")
      .send({ portalClientIds: ["portal-inexistente"], competencia: "2026-07" });

    expect(criarBatchJob.mock.calls[0][0].portalClientIds).toEqual([]);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("NO_COMPANIES");
  });

  test("caminho legítimo: contador enfileira a própria carteira", async () => {
    const res = await request(montarApp(CONTADOR))
      .post("/firm/apuracao/batch")
      .send({ portalClientIds: [MINHA, OUTRA], competencia: "2026-07" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, jobId: "job-apuracao-1" });
    expect(criarBatchJob.mock.calls[0][0].portalClientIds).toEqual([MINHA, OUTRA]);
  });
});

describe("A — POST /firm/apuracao/batch/:jobId/run-now: aqui a declaração SAI", () => {
  test("STAFF não roda a fila — 403, e nenhum ciclo é executado", async () => {
    prisma.apuracaoBatchJob.findUnique.mockResolvedValue({ id: "job-1", status: "running" });
    prisma.apuracaoBatchItem.findMany.mockResolvedValue([{ portalClientId: MINHA }]);

    const res = await request(montarApp(STAFF)).post("/firm/apuracao/batch/job-1/run-now");

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("forbidden_admin_or_contador_only");
    expect(runApuracaoBatchOnce).not.toHaveBeenCalled();
  });

  test("caminho legítimo: contador roda o lote", async () => {
    prisma.apuracaoBatchJob.findUnique.mockResolvedValue({ id: "job-1", status: "running", competencia: "2026-07" });
    prisma.apuracaoBatchItem.findMany.mockResolvedValue([{ portalClientId: MINHA }]);
    prisma.apuracaoBatchItem.count.mockResolvedValue(0); // nada pendente: o laço encerra na hora

    const res = await request(montarApp(CONTADOR)).post("/firm/apuracao/batch/job-1/run-now");

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

describe("A — GET /firm/apuracao/batch/:jobId: o progresso do lote", () => {
  beforeEach(() => {
    prisma.apuracaoBatchJob.findUnique.mockResolvedValue({ id: "job-1", status: "running", competencia: "2026-07" });
  });

  test("lote de empresa alheia responde 404 — não 403, que confirmaria o jobId", async () => {
    prisma.apuracaoBatchItem.findMany.mockResolvedValue([{ portalClientId: OUTRA, status: "pendente" }]);

    const res = await request(montarApp(STAFF)).get("/firm/apuracao/batch/job-1");

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ ok: false, error: "job_not_found" });
  });

  test("com acesso a TODAS as empresas do lote, o STAFF acompanha normalmente", async () => {
    prisma.apuracaoBatchItem.findMany.mockResolvedValue([{ portalClientId: MINHA, status: "ok" }]);

    const res = await request(montarApp(STAFF)).get("/firm/apuracao/batch/job-1");

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
  });

  // ⚠ CONTENÇÃO, NÃO INTERSEÇÃO: o progresso é do lote INTEIRO. Uma empresa alheia dentro dele
  // fecha o job todo — devolver "a parte que é sua" inventaria um lote que não existe.
  test("uma empresa alheia no meio do lote fecha o lote inteiro", async () => {
    prisma.apuracaoBatchItem.findMany.mockResolvedValue([
      { portalClientId: MINHA, status: "ok" },
      { portalClientId: OUTRA, status: "ok" },
    ]);

    const res = await request(montarApp(STAFF)).get("/firm/apuracao/batch/job-1");

    expect(res.status).toBe(404);
  });
});

describe("B — o ZIP das notas e as rotas gêmeas", () => {
  const jobDeOutro = { id: "job-zip", status: "processando", companyIds: [OUTRA], arquivoPath: null };
  const jobMeu = { id: "job-zip", status: "processando", companyIds: [MINHA], arquivoPath: null };

  test("baixar o ZIP de um lote alheio: 404", async () => {
    prisma.notasDownloadJob.findUnique.mockResolvedValue(jobDeOutro);

    const res = await request(montarApp(STAFF)).get("/firm/notas-download/job-zip/arquivo");

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ ok: false, error: "job_not_found" });
  });

  test("mesmo lote misto (uma minha, uma alheia): 404 — o ZIP é um só", async () => {
    prisma.notasDownloadJob.findUnique.mockResolvedValue({ ...jobMeu, companyIds: [MINHA, OUTRA] });

    const res = await request(montarApp(STAFF)).get("/firm/notas-download/job-zip/arquivo");

    expect(res.status).toBe(404);
  });

  // Com acesso, a guarda de escopo deixa passar e quem responde é a regra de NEGÓCIO (o zip ainda
  // está sendo gerado) — 409, não 404. É o que separa "não é seu" de "ainda não ficou pronto".
  test("com acesso, o STAFF passa da guarda e cai na regra de negócio (409 nao_concluido)", async () => {
    prisma.notasDownloadJob.findUnique.mockResolvedValue(jobMeu);

    const res = await request(montarApp(STAFF)).get("/firm/notas-download/job-zip/arquivo");

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("nao_concluido");
  });

  test("caminho legítimo do admin: ele enxerga a carteira toda e passa sem `CompanyFirmAccess`", async () => {
    prisma.notasDownloadJob.findUnique.mockResolvedValue(jobDeOutro);

    const res = await request(montarApp(ADMIN)).get("/firm/notas-download/job-zip/arquivo");

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("nao_concluido");
  });

  test("o progresso do job alheio também é 404", async () => {
    prisma.notasDownloadJob.findUnique.mockResolvedValue(jobDeOutro);

    const res = await request(montarApp(STAFF)).get("/firm/notas-download/job-zip");

    expect(res.status).toBe(404);
  });

  test("a lista de 'Downloads recentes' mostra só os lotes da carteira de quem pede", async () => {
    prisma.notasDownloadJob.findMany.mockResolvedValue([
      { id: "job-alheio", status: "concluido", companyIds: [OUTRA] },
      { id: "job-meu", status: "concluido", companyIds: [MINHA] },
    ]);

    const res = await request(montarApp(STAFF)).get("/firm/notas-download");

    expect(res.status).toBe(200);
    expect(res.body.jobs.map((j) => j.id)).toEqual(["job-meu"]);
  });

  test("a mesma lista, para o admin, continua trazendo tudo", async () => {
    prisma.notasDownloadJob.findMany.mockResolvedValue([
      { id: "job-alheio", status: "concluido", companyIds: [OUTRA] },
      { id: "job-meu", status: "concluido", companyIds: [MINHA] },
    ]);

    const res = await request(montarApp(ADMIN)).get("/firm/notas-download");

    expect(res.body.jobs.map((j) => j.id)).toEqual(["job-alheio", "job-meu"]);
  });

  test("gêmea SITFIS: o ZIP das situações fiscais alheias é 404", async () => {
    prisma.sitfisDownloadJob.findUnique.mockResolvedValue({ id: "job-sitfis", status: "processando", companyIds: [OUTRA] });

    const res = await request(montarApp(STAFF)).get("/firm/sitfis-download/job-sitfis/arquivo");

    expect(res.status).toBe(404);
  });

  test("gêmea SITFIS: com acesso, passa da guarda (409 nao_concluido)", async () => {
    prisma.sitfisDownloadJob.findUnique.mockResolvedValue({ id: "job-sitfis", status: "processando", companyIds: [MINHA] });

    const res = await request(montarApp(STAFF)).get("/firm/sitfis-download/job-sitfis/arquivo");

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("nao_concluido");
  });

  test("gêmea SITFIS: o progresso alheio é 404", async () => {
    prisma.sitfisDownloadJob.findUnique.mockResolvedValue({ id: "job-sitfis", status: "concluido", companyIds: [OUTRA] });

    const res = await request(montarApp(STAFF)).get("/firm/sitfis-download/job-sitfis");

    expect(res.status).toBe(404);
  });

  test("gêmea da CAPTURA: o job alheio (com razão social e CNPJ nos itens) é 404", async () => {
    prisma.notasCapturaJob.findUnique.mockResolvedValue({
      id: "job-captura", status: "concluido", alvos: ["NFSE"], companyIds: [OUTRA],
      itens: [{ portalClientId: OUTRA, razao: "EMPRESA ALHEIA LTDA", cnpj: "11222333000181", alvo: "NFSE", status: "capturou" }],
    });

    const res = await request(montarApp(STAFF)).get("/firm/notas-captura/job-captura");

    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain("EMPRESA ALHEIA");
  });

  test("gêmea da CAPTURA: com acesso, o job é entregue", async () => {
    prisma.notasCapturaJob.findUnique.mockResolvedValue({
      id: "job-captura", status: "concluido", alvos: ["NFSE"], companyIds: [MINHA],
      itens: [{ portalClientId: MINHA, razao: "EMPRESA DO STAFF LTDA", cnpj: "11222333000181", alvo: "NFSE", status: "capturou" }],
    });

    const res = await request(montarApp(STAFF)).get("/firm/notas-captura/job-captura");

    expect(res.status).toBe(200);
    expect(res.body.job.jobId).toBe("job-captura");
  });

  test("gêmea da CAPTURA: a lista de consultas recentes também é filtrada", async () => {
    prisma.notasCapturaJob.findMany.mockResolvedValue([
      { id: "captura-alheia", status: "concluido", alvos: ["NFSE"], companyIds: [OUTRA] },
      { id: "captura-minha", status: "concluido", alvos: ["NFSE"], companyIds: [MINHA] },
    ]);

    const res = await request(montarApp(STAFF)).get("/firm/notas-captura");

    expect(res.status).toBe(200);
    expect(res.body.jobs.map((j) => j.jobId)).toEqual(["captura-minha"]);
  });
});
