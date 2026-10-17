jest.mock("../../guides/GuideLockService.js", () => ({ acquireGuideLease: jest.fn(async () => ({ assertActive: jest.fn(), release: jest.fn(async () => {}) })) }));
// UM ERRO QUE SOBREVIVE À CONSULTA QUE O DESMENTIU É INFORMAÇÃO FALSA.
//
// `adnLastError` só era zerado por `persistCursor`, e `persistCursor` só roda quando VEM DOCUMENTO.
// A empresa quieta — o caso normal — termina a captura em `NENHUM_DOCUMENTO_LOCALIZADO`, sai pelo
// `break` e retorna `ok:true` sem encostar no campo. Resultado: um erro de UM dia ficava gravado
// para sempre, e a aba Notas o reexibia em toda visita, em toda empresa.
//
// Medido em produção (10/08/2026): 13 empresas exibindo `[HTTP_429]` gravado em 09/08 entre 15:01 e
// 16:08, com o backoff de 15 min expirado havia 19 horas e capturas bem-sucedidas 30 min antes que
// não limparam nada. O dono relatou "todas as empresas que entro na aba de notas estão com esse
// erro" — e a captura estava funcionando.
//
// ⚠ A aba NÃO consulta o ADN: `GET /adn/state` é leitura de `PortalSyncState`. Por isso o sintoma
// era 100% eco, e por isso o conserto é aqui, na escrita, e não na tela.

jest.mock("../../../infrastructure/db/prisma.js", () => {
  const tx = {
    portalSyncState: { upsert: jest.fn(async () => {}) },
    portalInvoice: { findUnique: jest.fn(async () => null), upsert: jest.fn(async () => ({ id: "inv" })) },
    companyMonthlyCircular: { findFirst: jest.fn(async () => null) },
  };
  return {
    __tx: tx,
    prisma: {
      portalClient: {
        findUnique: jest.fn(async () => ({ id: "p1", razao: "EMPRESA QUIETA", cnpj: "53742042000164", status: "ATIVA" })),
      },
      portalSyncState: {
        // Estado de entrada: erro ANTIGO gravado, backoff já expirado.
        findUnique: jest.fn(async () => ({
          adnNsuCursor: 10n,
          adnBackoffUntil: new Date(Date.now() - 19 * 3600 * 1000),
          adnLastError: "[HTTP_429] ADN Nacional retornou 429. Path: /DFe/10. Body: <html>…",
        })),
        updateMany: jest.fn(async () => ({ count: 1 })),
        upsert: tx.portalSyncState.upsert,
      },
      $transaction: jest.fn(async (cb) => cb(tx)),
    },
  };
});

jest.mock("../CertResolver.js", () => ({
  SERVICOS: { NFSE: "NFSE" },
  resolveCertForCompany: jest.fn(async () => ({ source: "company_a1", pfxBuffer: Buffer.from("x"), password: "p" })),
}));

jest.mock("../../nfse/AdnXmlMetadata.js", () => ({
  parseXmlMetadata: jest.fn(() => ({ chaveAcesso: null, numeroNfse: null, cnpjPrestador: "53742042000164", cnpjTomador: "" })),
  parseNfseEvento: jest.fn(() => null),
}));

jest.mock("../adn-nacional/AdnNacionalClient.js", () => ({
  AdnNacionalClientError: class extends Error {},
  fetchDfeNFSe: jest.fn(),
}));

import { gzipSync } from "node:zlib";
import { prisma } from "../../../infrastructure/db/prisma.js";
import { fetchDfeNFSe } from "../adn-nacional/AdnNacionalClient.js";
import { resolveCertForCompany } from "../CertResolver.js";
import { syncAdnNotasForCompany } from "../adn/AdnNotasService.js";

beforeEach(() => jest.clearAllMocks());

test.each(["procuracao_escritorio", "none"])("ADN sem A1 próprio (%s) não consulta notas de outro certificado", async (source) => {
  resolveCertForCompany.mockResolvedValueOnce({ source, procuracaoId: "proc-teste" });
  expect(await syncAdnNotasForCompany({ portalClientId: "p1" })).toMatchObject({ ok: false, reason: "NO_COMPANY_CERT" });
  expect(fetchDfeNFSe).not.toHaveBeenCalled();
});

/** Só as escritas que apagam o erro — a marcação de tentativa também usa `upsert`. */
function limpezasDeErro() {
  return prisma.portalSyncState.updateMany.mock.calls
    .filter(([arg]) => arg?.data && "adnLastError" in arg.data && arg.data.adnLastError === null);
}

describe("adnLastError não sobrevive a uma captura bem-sucedida", () => {
  test("captura SEM nota nova apaga o erro antigo e o backoff", async () => {
    fetchDfeNFSe.mockResolvedValue({ status: "NENHUM_DOCUMENTO_LOCALIZADO", items: [], errors: [] });

    const r = await syncAdnNotasForCompany({ portalClientId: "p1" });

    expect(r.ok).toBe(true);
    expect(r.totalDocs).toBe(0);

    const limpezas = limpezasDeErro();
    expect(limpezas.length).toBeGreaterThan(0);
    expect(limpezas[0][0].data).toMatchObject({ adnLastError: null, adnBackoffUntil: null });
  });

  test("captura COM nota também termina sem erro gravado", async () => {
    fetchDfeNFSe
      .mockResolvedValueOnce({
        status: "DOCUMENTOS_LOCALIZADOS",
        items: [{ NSU: "11", ArquivoXml: Buffer.from("<n/>").toString("base64"), TipoDocumento: "NFSE" }],
        errors: [],
      })
      .mockResolvedValue({ status: "NENHUM_DOCUMENTO_LOCALIZADO", items: [], errors: [] });

    const r = await syncAdnNotasForCompany({ portalClientId: "p1" });

    expect(r.ok).toBe(true);
    expect(limpezasDeErro().length).toBeGreaterThan(0);
  });

  test("⚠ consulta que FALHA não apaga nada — o erro novo tem de ficar", async () => {
    const boom = new Error("429");
    boom.code = "HTTP_429";
    fetchDfeNFSe.mockRejectedValue(boom);

    const r = await syncAdnNotasForCompany({ portalClientId: "p1" });

    expect(r.ok).toBe(false);
    expect(limpezasDeErro()).toHaveLength(0);
  });
});
import { __tx } from "../../../infrastructure/db/prisma.js";
import { acquireGuideLease } from "../../guides/GuideLockService.js";

const lote = (count = 1) => ({ status: "DOCUMENTOS_LOCALIZADOS", errors: [], items: Array.from({ length: count }, (_, i) => ({ NSU: String(11 + i), ArquivoXml: Buffer.from("<n/>").toString("base64"), TipoDocumento: "NFSE" })) });

test("rollback do primeiro lote nunca informa documentos confirmados", async () => {
  fetchDfeNFSe.mockResolvedValueOnce(lote());
  prisma.$transaction.mockImplementationOnce(async cb => { await cb(__tx); throw new Error("commit failed"); });
  const r = await syncAdnNotasForCompany({ portalClientId: "p1" });
  expect(r).toMatchObject({ ok: false, totalDocs: 0, newCursor: "10", byStatus: { upserted: 0 } });
  expect(limpezasDeErro()).toHaveLength(0);
  expect(r.backoffUntil).toBeInstanceOf(Date);
});

test("lote confirmado seguido de 429 preserva progresso e espera solicitada", async () => {
  const start = Date.now();
  fetchDfeNFSe.mockResolvedValueOnce(lote(50)).mockRejectedValueOnce(Object.assign(new Error("Limite da consulta"), { code: "HTTP_429", retryAfterSec: 3600 }));
  const r = await syncAdnNotasForCompany({ portalClientId: "p1" });
  expect(r).toMatchObject({ ok: true, partial: true, reason: "HTTP_429", totalDocs: 50, newCursor: "60" });
  expect(r.backoffUntil.getTime()).toBeGreaterThanOrEqual(start + 3600000);
  expect(limpezasDeErro()).toHaveLength(0);
  expect(prisma.portalSyncState.upsert.mock.calls.at(-1)[0].update.adnBackoffUntil).toEqual(r.backoffUntil);
});

test("lease ocupada impede transporte e consulta de cursor", async () => {
  acquireGuideLease.mockResolvedValueOnce(null);
  expect(await syncAdnNotasForCompany({ portalClientId: "p1" })).toMatchObject({ ok: false, reason: "ADN_SYNC_IN_PROGRESS" });
  expect(fetchDfeNFSe).not.toHaveBeenCalled();
  expect(prisma.portalSyncState.findUnique).not.toHaveBeenCalled();
});

test("perda da lease depois do transporte impede persistir lote", async () => {
  const lease = { assertActive: jest.fn().mockImplementationOnce(() => {}).mockImplementation(() => { throw Object.assign(new Error("lost"), { code: "GUIDE_LEASE_LOST" }); }), release: jest.fn(async () => {}) };
  acquireGuideLease.mockResolvedValueOnce(lease);
  fetchDfeNFSe.mockResolvedValueOnce(lote());
  await expect(syncAdnNotasForCompany({ portalClientId: "p1" })).rejects.toMatchObject({ code: "GUIDE_LEASE_LOST" });
  expect(prisma.$transaction).not.toHaveBeenCalled();
  expect(lease.release).toHaveBeenCalledTimes(1);
});

test("rollback posterior não soma documentos não confirmados", async () => {
  fetchDfeNFSe.mockResolvedValueOnce(lote(50)).mockResolvedValueOnce(lote(2));
  prisma.$transaction.mockImplementationOnce(async cb => cb(__tx)).mockImplementationOnce(async cb => { await cb(__tx); throw new Error("commit failed"); });
  const r = await syncAdnNotasForCompany({ portalClientId: "p1" });
  expect(r).toMatchObject({ ok: true, partial: true, totalDocs: 50, newCursor: "60" });
});

test("duas execuções simultâneas consultam uma única vez", async () => {
  let busy = false;
  const acquire = async () => {
    if (busy) return null;
    busy = true;
    return { assertActive() {}, async release() { busy = false; } };
  };
  acquireGuideLease.mockImplementationOnce(acquire).mockImplementationOnce(acquire);
  fetchDfeNFSe.mockResolvedValueOnce({ status: "NENHUM_DOCUMENTO_LOCALIZADO", items: [] });
  const resultados = await Promise.all([syncAdnNotasForCompany({ portalClientId: "p1" }), syncAdnNotasForCompany({ portalClientId: "p1" })]);
  expect(resultados.map(r => r.ok).sort()).toEqual([false, true]);
  expect(fetchDfeNFSe).toHaveBeenCalledTimes(1);
  expect(busy).toBe(false);
});

test("rejeição do ADN não expõe JSON do provedor", async () => {
  fetchDfeNFSe.mockResolvedValueOnce({ status: "REJEICAO", items: [], errors: [{ detail: "<html>private provider detail</html>" }] });
  const r = await syncAdnNotasForCompany({ portalClientId: "p1" });
  expect(r).toMatchObject({ ok: false, reason: "ADN_REJEICAO", totalDocs: 0 });
  expect(JSON.stringify(r)).not.toMatch(/html|private|provider detail/);
});

test("50 páginas completas retornam parcial sem repetir nem afirmar sincronização completa", async () => {
  const compressedXml = gzipSync(Buffer.from("<n/>")).toString("base64");
  const realTimeout = global.setTimeout;
  const timer = jest.spyOn(global, "setTimeout").mockImplementation((fn, ms, ...args) => {
    if (ms !== 1100) return realTimeout(fn, ms, ...args);
    queueMicrotask(() => fn(...args));
    return 0;
  });
  try {
    let page = 0;
    fetchDfeNFSe.mockImplementation(async () => {
      const items = lote(50).items.map((item, i) => ({ ...item, ArquivoXml: compressedXml, NSU: String(11 + (page * 50) + i) }));
      page++;
      return { status: "DOCUMENTOS_LOCALIZADOS", items };
    });
    const r = await syncAdnNotasForCompany({ portalClientId: "p1" });
    expect(r).toMatchObject({ ok: true, partial: true, reason: "ADN_LIMITE_PAGINACAO", iterations: 50, totalDocs: 2500, newCursor: "2510" });
    expect(fetchDfeNFSe).toHaveBeenCalledTimes(50);
    expect(timer.mock.calls.filter(([, ms]) => ms === 1100)).toHaveLength(49);
    expect(limpezasDeErro()).toHaveLength(0);
  } finally { timer.mockRestore(); }
});
