// O EVENTO DE CANCELAMENTO PARA DE SER DESTRUÍDO NA HORA EM QUE É APLICADO.
//
// Até 10/08/2026 `applyNfseEvento` escrevia duas colunas (`statusEfetivo`/`status`) e jogava fora
// todo o resto: a data do fato, o motivo, a sequência e — no e105102 — a chave da nota substituta.
// Medido em produção: **556 NFS-e marcadas canceladas e 0 linhas em `PortalInvoiceEvent`**.
//
// Estes testes travam as três coisas que aquele defeito custava:
//   1. o evento é GRAVADO antes de virar rótulo;
//   2. cancelamento (101101) e cancelamento por substituição (105102) NÃO viram o mesmo registro;
//   3. `statusEfetivo` continua com dois valores — a distinção não vaza para o campo de dinheiro.
//
// Chaves e CNPJ são FABRICADOS (mesmo formato dos reais, dígitos inventados).

const CH_VELHA = "33045572200000000000191000000000000926088310270000";
const CH_NOVA = "33045572200000000000191000000000001026088310271111";

jest.mock("../../../infrastructure/db/prisma.js", () => {
  const estado = { eventos: [], updates: [], cursor: 0n };
  const tx = {
    portalSyncState: { upsert: jest.fn(async ({ update }) => { estado.cursor = update.adnNsuCursor; }) },
    portalInvoice: {
      findFirst: jest.fn(async () => ({ id: "nota-velha" })),
      findUnique: jest.fn(async () => null),
      upsert: jest.fn(async () => ({ id: "inv" })),
      update: jest.fn(async ({ data }) => { estado.updates.push(data); return { id: "nota-velha" }; }),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    portalInvoiceEvent: {
      findFirst: jest.fn(async ({ where }) => estado.eventos.find(
        (e) => e.invoiceId === where.invoiceId && e.type === where.type && e.nSeqEvento === where.nSeqEvento,
      ) || null),
      create: jest.fn(async ({ data }) => { estado.eventos.push(data); return data; }),
    },
    notaItem: { deleteMany: jest.fn(async () => ({})), create: jest.fn(async () => ({})) },
    companyMonthlyCircular: { findFirst: jest.fn(async () => null) },
    pendenciaPosFechamento: { create: jest.fn(async () => ({})) },
  };
  return {
    __estado: estado,
    prisma: {
      portalClient: { findUnique: jest.fn(async () => ({ id: "p1", razao: "EMPRESA TESTE LTDA", cnpj: "00000000000191", status: "ATIVA" })) },
      portalSyncState: {
        findUnique: jest.fn(async () => ({ adnNsuCursor: 0n, adnBackoffUntil: null })),
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

jest.mock("../adn-nacional/AdnNacionalClient.js", () => ({
  AdnNacionalClientError: class extends Error {},
  fetchDfeNFSe: jest.fn(),
}));

import { __estado } from "../../../infrastructure/db/prisma.js";
import { fetchDfeNFSe } from "../adn-nacional/AdnNacionalClient.js";
import { syncAdnNotasForCompany } from "../adn/AdnNotasService.js";

// O ADN entrega o evento como documento próprio, com TipoDocumento="EVENTO".
function loteComEvento(xml) {
  return {
    status: "DOCUMENTOS_LOCALIZADOS",
    items: [{ NSU: "10", TipoDocumento: "EVENTO", ArquivoXml: Buffer.from(xml, "utf-8").toString("base64") }],
  };
}

const xmlCancelamento = `<?xml version="1.0" encoding="utf-8"?>
<evento versao="1.01" xmlns="http://www.sped.fazenda.gov.br/nfse">
  <infEvento Id="EVT${CH_VELHA}101101001"><nSeqEvento>1</nSeqEvento>
    <pedRegEvento><infPedReg Id="PRE${CH_VELHA}101101">
      <dhEvento>2026-08-05T12:45:00-03:00</dhEvento><chNFSe>${CH_VELHA}</chNFSe>
      <e101101><xDesc>Cancelamento de NFS-e</xDesc><cMotivo>99</cMotivo>
        <xMotivo>erro na emissao</xMotivo></e101101>
    </infPedReg></pedRegEvento>
  </infEvento></evento>`;

const xmlSubstituicao = `<?xml version="1.0" encoding="utf-8"?>
<evento versao="1.01" xmlns="http://www.sped.fazenda.gov.br/nfse">
  <infEvento Id="EVT${CH_VELHA}105102001"><nSeqEvento>1</nSeqEvento>
    <pedRegEvento><infPedReg Id="PRE${CH_VELHA}105102">
      <dhEvento>2026-08-05T13:29:00-03:00</dhEvento><chNFSe>${CH_VELHA}</chNFSe>
      <e105102><xDesc>Cancelamento de NFS-e por Substituição</xDesc><cMotivo>99</cMotivo>
        <xMotivo>valor da nota esta incorreto</xMotivo>
        <chSubstituta>${CH_NOVA}</chSubstituta></e105102>
    </infPedReg></pedRegEvento>
  </infEvento></evento>`;

beforeEach(() => {
  __estado.eventos.length = 0;
  __estado.updates.length = 0;
  jest.clearAllMocks();
});

describe("applyNfseEvento — o fato fica gravado, não só o rótulo", () => {
  it("grava o cancelamento com data, motivo e código — e marca a nota", async () => {
    fetchDfeNFSe
      .mockResolvedValueOnce(loteComEvento(xmlCancelamento))
      .mockResolvedValue({ status: "NENHUM_DOCUMENTO_LOCALIZADO", items: [] });

    const r = await syncAdnNotasForCompany({ portalClientId: "p1" });
    expect(r.ok).toBe(true);
    expect(r.byStatus.evento_cancelou).toBe(1);

    expect(__estado.eventos).toHaveLength(1);
    const ev = __estado.eventos[0];
    expect(ev.type).toBe("cancelamento");
    expect(ev.tpEvento).toBe("101101");
    expect(ev.nSeqEvento).toBe(1);
    expect(ev.reason).toBe("erro na emissao");
    expect(ev.date).toBeInstanceOf(Date);
    // ⚠ O XML CRU VAI JUNTO. É o que faltou nos 556 cancelamentos anteriores: sem ele, qualquer
    // campo que ainda não tenha coluna é irrecuperável.
    expect(ev.payloadRaw.xml).toContain("e101101");

    expect(__estado.updates).toEqual([{ statusEfetivo: "cancelada", status: "CANCELADA" }]);
  });

  it("cancelamento por SUBSTITUIÇÃO é outro fato, e guarda a chave da substituta", async () => {
    fetchDfeNFSe
      .mockResolvedValueOnce(loteComEvento(xmlSubstituicao))
      .mockResolvedValue({ status: "NENHUM_DOCUMENTO_LOCALIZADO", items: [] });

    const r = await syncAdnNotasForCompany({ portalClientId: "p1" });
    expect(r.byStatus.evento_substituiu).toBe(1);

    const ev = __estado.eventos[0];
    expect(ev.type).toBe("canc_por_substituicao");
    expect(ev.tpEvento).toBe("105102");
    expect(ev.chaveSubstituta).toBe(CH_NOVA);
  });

  // ⚠ A DISTINÇÃO NÃO PODE VAZAR PARA O CAMPO DE DINHEIRO. `statusEfetivo` tem dois valores; um
  // terceiro ("substituida") faria a nota reaparecer na aba, entrar no total do resumo e continuar
  // fora do faturamento — duas telas discordando sobre a mesma nota.
  it("NÃO escreve statusEfetivo='substituida' — o dinheiro não muda", async () => {
    fetchDfeNFSe
      .mockResolvedValueOnce(loteComEvento(xmlSubstituicao))
      .mockResolvedValue({ status: "NENHUM_DOCUMENTO_LOCALIZADO", items: [] });

    await syncAdnNotasForCompany({ portalClientId: "p1" });
    expect(__estado.updates).toEqual([{ statusEfetivo: "cancelada", status: "CANCELADA" }]);
    for (const u of __estado.updates) expect(u.statusEfetivo).not.toBe("substituida");
  });

  it("é idempotente: o mesmo evento recapturado não vira linha nova", async () => {
    fetchDfeNFSe
      .mockResolvedValueOnce(loteComEvento(xmlCancelamento))
      .mockResolvedValue({ status: "NENHUM_DOCUMENTO_LOCALIZADO", items: [] });
    await syncAdnNotasForCompany({ portalClientId: "p1" });

    fetchDfeNFSe
      .mockResolvedValueOnce(loteComEvento(xmlCancelamento))
      .mockResolvedValue({ status: "NENHUM_DOCUMENTO_LOCALIZADO", items: [] });
    await syncAdnNotasForCompany({ portalClientId: "p1" });

    expect(__estado.eventos).toHaveLength(1);
  });
});
