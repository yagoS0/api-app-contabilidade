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

import { prisma } from "../../../infrastructure/db/prisma.js";
import { fetchDfeNFSe } from "../adn-nacional/AdnNacionalClient.js";
import { syncAdnNotasForCompany } from "../adn/AdnNotasService.js";

beforeEach(() => jest.clearAllMocks());

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
