// O GATE DO ADN SE MEDE POR "OLHEI", NÃO POR "RECEBI".
//
// O worker perguntava "faz mais de 1h desde `adnLastSyncAt`?" para decidir se consultava o ADN.
// Mas `adnLastSyncAt` só é gravado quando VEM DOCUMENTO (`persistCursor`, em `AdnNotasService`).
// Numa empresa que não emitiu nota nenhuma, esse campo fica parado para sempre — logo a idade
// cresce sem limite, `>= 60` é SEMPRE verdade, e o intervalo de 1 hora nunca fecha: a empresa era
// consultada a CADA CICLO do worker, que roda de minuto em minuto.
//
// Medido em produção (10/08/2026): 44 a 50 varreduras por HORA, ininterruptas desde 05/08, entre
// 13.000 e 16.000 consultas de NFS-e por dia para capturar de 9 a 32 documentos. Foi esse volume
// que produziu os HTTP 429 que apareceram na aba Notas de todas as empresas.
//
// Quem responde "quando foi a última vez que OLHEI" é `adnLastAttemptAt`, gravado em toda
// tentativa. É ele que o gate lê agora.
//
// ⚠ O SEGUNDO TESTE É O QUE IMPEDE O REMENDO DE UM DIA: o heartbeat (`adnLastSyncAt` > 7 dias)
// costumava furar o intervalo com um `||`. Numa empresa quieta, "7 dias sem receber nota" é a
// condição PERMANENTE, não uma anomalia — mantê-lo como bypass faria o laço voltar sozinho assim
// que as empresas afetadas cruzassem o limiar (estavam em 5,7 dias na medição).

const agora = Date.now();
const min = (n) => new Date(agora - n * 60000);
const dias = (n) => new Date(agora - n * 24 * 60 * 60000);

let mockEstadoDaEmpresa = {};

jest.mock("../../config.js", () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  DFE_NOTAS_WORKER_ENABLED: false,
  DFE_NOTAS_WORKER_INTERVAL_MIN: 60,
  DFE_NOTAS_HEARTBEAT_DAYS: 7,
}));

jest.mock("../../infrastructure/db/prisma.js", () => ({
  prisma: {
    portalClient: {
      findMany: jest.fn(async () => [{ id: "p1", razao: "EMPRESA QUIETA", cnpj: "53742042000164", companyId: "c1" }]),
    },
    company: {
      findMany: jest.fn(async () => [{ id: "c1", certStorageKey: "cert.pfx", certExpiresAt: null }]),
    },
    portalSyncState: { findUnique: jest.fn(async () => mockEstadoDaEmpresa) },
    notasCapturaJob: { create: jest.fn(async () => ({ id: "job1" })) },
  },
}));

jest.mock("../../application/guides/GuideLockService.js", () => ({
  tryAcquireGuideLock: jest.fn(async () => true),
  releaseGuideLock: jest.fn(async () => {}),
}));

jest.mock("../../application/notas/dfe/DfeSyncService.js", () => ({
  syncDfeForCompany: jest.fn(async () => ({ ok: true, totalDocs: 0 })),
}));

jest.mock("../../application/notas/adn/AdnNotasService.js", () => ({
  syncAdnNotasForCompany: jest.fn(async () => ({ ok: true, totalDocs: 0 })),
}));

jest.mock("../../application/notas/dfe/NfeManifestacaoService.js", () => ({
  processPendingForCompany: jest.fn(async () => ({ processed: 0 })),
}));

import { syncAdnNotasForCompany } from "../../application/notas/adn/AdnNotasService.js";
import { runDfeNotasWorkerOnce } from "../dfeNotasWorker.js";

beforeEach(() => {
  jest.clearAllMocks();
});

describe("dfeNotasWorker — intervalo do ADN", () => {
  test("empresa consultada há 5 min NÃO é consultada de novo, mesmo sem nunca ter recebido nota", async () => {
    mockEstadoDaEmpresa = {
      // "olhei agora há pouco"
      adnLastAttemptAt: min(5),
      // "nunca recebi nada" — é ESTE campo que o gate antigo lia, e por isso nunca fechava
      adnLastSyncAt: dias(6),
      dfeLastSyncAt: min(5),
      adnNsuCursor: 10n,
    };

    const r = await runDfeNotasWorkerOnce();

    expect(syncAdnNotasForCompany).not.toHaveBeenCalled();
    expect(r.adn[0]).toMatchObject({ skipped: true });
    // O "faltam N min" tem de sair da MESMA idade do gate, senão a aba Consultas mostra número negativo.
    expect(r.adn[0].reason).toBe("wait_55min");
  });

  test("passada 1h desde a última TENTATIVA, consulta de novo", async () => {
    mockEstadoDaEmpresa = {
      adnLastAttemptAt: min(61),
      adnLastSyncAt: dias(6),
      dfeLastSyncAt: min(5),
      adnNsuCursor: 10n,
    };

    await runDfeNotasWorkerOnce();

    expect(syncAdnNotasForCompany).toHaveBeenCalledTimes(1);
  });

  test("heartbeat NÃO fura o intervalo — empresa sem nota há 30 dias, olhada há 5 min, continua esperando", async () => {
    mockEstadoDaEmpresa = {
      adnLastAttemptAt: min(5),
      // muito além do limiar de 7 dias: com o `|| adnHeartbeatOverdue` isto voltava a consultar
      // a cada ciclo, que é exatamente o laço que a correção fecha
      adnLastSyncAt: dias(30),
      dfeLastSyncAt: min(5),
      adnNsuCursor: 10n,
    };

    await runDfeNotasWorkerOnce();

    expect(syncAdnNotasForCompany).not.toHaveBeenCalled();
  });

  test("empresa nunca tentada é consultada (o gate não pode prender quem nunca foi olhado)", async () => {
    mockEstadoDaEmpresa = { adnLastAttemptAt: null, adnLastSyncAt: null, dfeLastSyncAt: null, adnNsuCursor: 0n };

    await runDfeNotasWorkerOnce();

    expect(syncAdnNotasForCompany).toHaveBeenCalledTimes(1);
  });
});
