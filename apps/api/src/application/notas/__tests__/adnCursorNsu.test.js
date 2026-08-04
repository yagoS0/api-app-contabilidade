// O CURSOR NSU DO ADN — o bug que fazia nota emitida sumir sem deixar erro.
//
// `ultNSU` quer dizer "último NSU que eu JÁ TENHO", e o ADN devolve os documentos POSTERIORES a ele
// (exclusivo). O código guardava `maxNSU + 1` e mandava isso como `ultNSU`: pedia "depois do
// próximo", e o documento exatamente naquele NSU nunca voltava. A resposta era um
// `NENHUM_DOCUMENTO_LOCALIZADO` legítimo, então não havia erro, não havia log, e `adnLastError`
// ficava nulo — indistinguível de "não há nota".
//
// Medido contra o ADN de produção (ARAUJO BARRETO, 04/08/2026), com 7 documentos no banco e cursor
// em 8:
//     ultNSU=6 -> DOCUMENTOS_LOCALIZADOS, NSUs 7 e 8
//     ultNSU=7 -> DOCUMENTOS_LOCALIZADOS, NSU 8
//     ultNSU=8 -> NENHUM_DOCUMENTO_LOCALIZADO
//
// O ADN falso abaixo implementa ESSA semântica. Se alguém voltar a somar 1 ao cursor, o primeiro
// teste falha.

jest.mock("../../../infrastructure/db/prisma.js", () => {
  const tx = {
    portalSyncState: { upsert: jest.fn(async ({ update }) => { estado.cursor = update.adnNsuCursor; }) },
    portalInvoice: { findUnique: jest.fn(async () => null), upsert: jest.fn(async () => ({ id: "inv" })) },
    companyMonthlyCircular: { findFirst: jest.fn(async () => null) },
  };
  const estado = { cursor: 0n };
  return {
    __estado: estado,
    __tx: tx,
    prisma: {
      portalClient: { findUnique: jest.fn(async () => ({ id: "p1", razao: "ARAUJO BARRETO", cnpj: "53742042000164", status: "ATIVA" })) },
      portalSyncState: {
        findUnique: jest.fn(async () => ({ adnNsuCursor: estado.cursor, adnBackoffUntil: null })),
        updateMany: jest.fn(async () => ({})),
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
  parseXmlMetadata: jest.fn(() => ({
    chaveAcesso: null, numeroNfse: null, cnpjPrestador: "53742042000164", cnpjTomador: "",
    competencia: null, dataEmissao: null, situacao: null,
  })),
  parseNfseEvento: jest.fn(() => null),
}));

jest.mock("../adn-nacional/AdnNacionalClient.js", () => ({
  AdnNacionalClientError: class extends Error {},
  fetchDfeNFSe: jest.fn(),
}));

import { prisma, __estado } from "../../../infrastructure/db/prisma.js";
import { fetchDfeNFSe } from "../adn-nacional/AdnNacionalClient.js";
import { parseXmlMetadata } from "../../nfse/AdnXmlMetadata.js";
import { syncAdnNotasForCompany } from "../adn/AdnNotasService.js";

/** ADN falso com a semântica REAL: devolve os documentos com NSU ESTRITAMENTE MAIOR que `ultNSU`. */
function adnCom(nsusExistentes) {
  fetchDfeNFSe.mockImplementation(async ({ ultNSU }) => {
    const de = BigInt(ultNSU);
    const items = nsusExistentes
      .filter((n) => BigInt(n) > de)
      .map((n) => ({ NSU: String(n), ArquivoXml: Buffer.from("<n/>").toString("base64"), TipoDocumento: "NFSE" }));
    return items.length
      ? { status: "DOCUMENTOS_LOCALIZADOS", items, errors: [] }
      : { status: "NENHUM_DOCUMENTO_LOCALIZADO", items: [], errors: [] };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  __estado.cursor = 0n;
  parseXmlMetadata.mockReturnValue({
    chaveAcesso: null, numeroNfse: null, cnpjPrestador: "53742042000164", cnpjTomador: "",
    competencia: null, dataEmissao: null, situacao: null,
  });
});

describe("cursor NSU do ADN", () => {
  it("o cursor guarda o ÚLTIMO NSU recebido, nunca o seguinte", async () => {
    adnCom([1, 2, 3]);
    const r = await syncAdnNotasForCompany({ portalClientId: "p1" });
    expect(r.ok).toBe(true);
    expect(r.totalDocs).toBe(3);
    // Com `maxNSU + 1` isto daria "4" — e o documento do NSU 4 nunca mais apareceria.
    expect(r.newCursor).toBe("3");
  });

  it("o documento seguinte ao último capturado NÃO se perde na proxima varredura", async () => {
    // É exatamente o caso da ARAUJO BARRETO: 7 documentos capturados, e a nota nova no NSU 8.
    adnCom([1, 2, 3, 4, 5, 6, 7]);
    const primeira = await syncAdnNotasForCompany({ portalClientId: "p1" });
    expect(primeira.newCursor).toBe("7");

    adnCom([1, 2, 3, 4, 5, 6, 7, 8]);
    const segunda = await syncAdnNotasForCompany({ portalClientId: "p1" });
    expect(segunda.totalDocs).toBe(1);   // com o bug: 0, e sem erro nenhum
    expect(segunda.newCursor).toBe("8");
  });

  it("nada novo NÃO mexe no cursor (e não inventa avanço)", async () => {
    adnCom([1, 2]);
    await syncAdnNotasForCompany({ portalClientId: "p1" });
    const r = await syncAdnNotasForCompany({ portalClientId: "p1" });
    expect(r.totalDocs).toBe(0);
    expect(r.newCursor).toBe("2");
  });

  it("lote sem NSU utilizável para o laço em vez de girar", async () => {
    // Sem NSU não há como avançar. O `+1` antigo mascarava isso avançando às cegas — e pulando
    // documento. Parar deixa a próxima execução tentar do mesmo ponto.
    fetchDfeNFSe.mockResolvedValue({
      status: "DOCUMENTOS_LOCALIZADOS",
      items: [{ ArquivoXml: Buffer.from("<n/>").toString("base64"), TipoDocumento: "NFSE" }],
      errors: [],
    });
    const r = await syncAdnNotasForCompany({ portalClientId: "p1" });
    expect(r.ok).toBe(true);
    expect(r.iterations).toBe(1);
    expect(r.newCursor).toBe("0");
  });
});
