// O CANCELAMENTO DE NFS-e — o `cMotivo` deixou de ser arbitrado, e a justificativa tem tamanho.
//
// ⚠⚠ O DEFEITO QUE ESTA SUÍTE TRAVA. Até 19/08/2026 `buildEventoXml` escrevia, no ramo do
// cancelamento, `<cMotivo>${escapeXml(cMotivo || "1")}</cMotivo>`. Sem `cMotivo`, o código
// declarava ao sistema nacional **"1 — Erro na emissão"** por conta própria — e quem cancelasse por
// "Serviço não prestado" declarava outra coisa, num ato fiscal irreversível. O ramo irmão
// (`e105102`) já recusava a ausência; este arbitrava, com o comentário logo acima afirmando que
// "o código é uma justificativa FISCAL e não se arbitra uma".
//
// ⚠⚠ E AS DUAS LISTAS SÃO DIFERENTES — a confusão custa uma rejeição de schema:
//   `e101101` → `TSCodJustCanc`  = "1" "2" "9"        (UM caractere)
//   `e105102` → `TSCodJustSubst` = "01"…"05" "99"     (DOIS caracteres)
// Fonte e varredura em `application/nfse/motivosDeEvento.js`.
//
// ⚠ NADA AQUI CANCELA COISA ALGUMA. `axios` é simulado; nenhuma chamada sai da máquina — e vários
// casos medem exatamente isso: que `post` NÃO foi chamado.

jest.mock("../../../config.js", () => ({
  NFSE_BASE_URL: "https://sefin.producaorestrita.nfse.gov.br/SefinNacional",
  NFSE_ENV: "homolog",
  NFSE_PATH: "/nfse",
  NFSE_CONSULT_PATH: "/nfse/consulta",
  NFSE_DPS_PATH: "/dps",
  NFSE_NFSE_PATH: "/nfse",
  NFSE_EVENT_FIELD: "pedidoRegistroEventoXmlGZipB64",
  NFSE_EVENT_FORMAT: "xml",
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock("axios", () => ({ __esModule: true, default: { create: jest.fn() } }));

// A assinatura de verdade exigiria chave privada versionada — o que não se faz. O que importa aqui
// é o XML MONTADO, e **se ele chegou a ser montado**.
// ⚠ O prefixo `mock` é exigência do jest: a fábrica do `jest.mock` sobe para o topo do arquivo e
// só pode referenciar variáveis com esse prefixo.
const mockAssinou = jest.fn();
jest.mock("xml-crypto", () => ({
  SignedXml: class {
    addReference() {}
    computeSignature(xml) {
      this._xml = xml;
      mockAssinou(xml);
    }
    getSignedXml() {
      return this._xml;
    }
  },
}));

jest.mock("../nfseCertificado.js", () => ({
  resolverCertificadosDaEmpresa: jest.fn(),
}));

jest.mock("../../../infrastructure/db/prisma.js", () => ({
  prisma: {
    company: { findUnique: jest.fn() },
    serviceInvoice: { findFirst: jest.fn(async () => null) },
  },
}));

import axios from "axios";
import { prisma } from "../../../infrastructure/db/prisma.js";
import { resolverCertificadosDaEmpresa } from "../nfseCertificado.js";
import { NfseService } from "../NfseService.js";
import { CAMADA } from "../desfechoEmissao.js";

const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
const CHAVE = "3".repeat(50);
const JUSTIFICATIVA_OK = "Servico nao foi prestado ao tomador";

let postMock;

function montarCenario({ respostaProvedor } = {}) {
  prisma.company.findUnique.mockResolvedValue({ id: "company-1", cnpj: "39254243000191" });
  resolverCertificadosDaEmpresa.mockResolvedValue({
    assinatura: { certPem: "PEM", keyPem: "KEY", certBase64: "B64" },
    transporte: { pfxBuffer: Buffer.from("pfx"), password: "s" },
    origem: "company_a1",
  });
  postMock = jest.fn(async () =>
    respostaProvedor === undefined ? { data: { ok: true } } : respostaProvedor()
  );
  axios.create.mockReturnValue({
    post: postMock,
    defaults: { baseURL: "https://sefin.producaorestrita.nfse.gov.br/SefinNacional" },
  });
}

function cancelar(over = {}) {
  return NfseService.sendEvent({
    chaveAcesso: CHAVE,
    tipoEvento: "e101101",
    justificativa: JUSTIFICATIVA_OK,
    cMotivo: "1",
    companyId: "company-1",
    log,
    ...over,
  });
}

/** O XML que FOI assinado — só existe se a montagem chegou a acontecer. */
function xmlAssinado() {
  return mockAssinou.mock.calls.at(-1)?.[0] || "";
}

beforeEach(() => {
  jest.clearAllMocks();
  montarCenario();
});

describe("⚠⚠ o `cMotivo` NÃO é mais arbitrado — e a recusa acontece ANTES de qualquer I/O", () => {
  it("sem `cMotivo`: RECUSA nomeada, e nada é assinado nem enviado", async () => {
    await expect(cancelar({ cMotivo: undefined })).rejects.toMatchObject({
      code: "NFSE_CMOTIVO_REQUIRED",
    });
    // ⚠ A PROVA de que o `|| "1"` não existe mais: `buildEventoXml` não é alcançado.
    expect(mockAssinou).not.toHaveBeenCalled();
    expect(postMock).not.toHaveBeenCalled();
  });

  it("`cMotivo` vazio conta como ausente", async () => {
    await expect(cancelar({ cMotivo: "" })).rejects.toMatchObject({ code: "NFSE_CMOTIVO_REQUIRED" });
    expect(postMock).not.toHaveBeenCalled();
  });

  it("⚠ a recusa CARREGA a lista fechada — a tela não tem como se corrigir sem ela", async () => {
    const err = await cancelar({ cMotivo: undefined }).catch((e) => e);
    expect(err.motivosAceitos.map((m) => m.codigo)).toEqual(["1", "2", "9"]);
    expect(err.motivosAceitos.map((m) => m.rotulo)).toEqual([
      "Erro na emissão",
      "Serviço não prestado",
      "Outros",
    ]);
  });
});

describe("⚠⚠ as duas listas não se misturam", () => {
  it.each(["01", "02", "05", "99"])(
    "`%s` é da SUBSTITUIÇÃO e é RECUSADO num cancelamento",
    async (codigo) => {
      await expect(cancelar({ cMotivo: codigo })).rejects.toMatchObject({
        code: "NFSE_CMOTIVO_INVALIDO",
      });
      expect(postMock).not.toHaveBeenCalled();
    }
  );

  it.each(["1", "2", "9"])("`%s` é aceito e sai NO XML como veio, sem zero à esquerda", async (codigo) => {
    await cancelar({ cMotivo: codigo });
    expect(xmlAssinado()).toContain(`<cMotivo>${codigo}</cMotivo>`);
    // ⚠ Um `padStart(2,"0")` aqui mandaria "01" — código de outra lista, rejeição de schema.
    expect(xmlAssinado()).not.toContain(`<cMotivo>0${codigo}</cMotivo>`);
  });

  it("código fora das duas listas é recusado", async () => {
    for (const codigo of ["3", "0", "10", "abc"]) {
      jest.clearAllMocks();
      montarCenario();
      await expect(cancelar({ cMotivo: codigo })).rejects.toMatchObject({
        code: "NFSE_CMOTIVO_INVALIDO",
      });
      expect(postMock).not.toHaveBeenCalled();
    }
  });
});

describe("⚠ a justificativa tem TAMANHO, e ele é conferido ANTES de assinar", () => {
  it("menos de 15 caracteres: RECUSA, sem assinar e sem enviar", async () => {
    await expect(cancelar({ justificativa: "erro" })).rejects.toMatchObject({
      code: "NFSE_JUSTIFICATIVA_CURTA",
    });
    // ⚠ O ponto inteiro da trava: sem ela, esta justificativa seria montada, ASSINADA com o A1 da
    // empresa, transmitida, e voltaria rejeitada por schema — um round-trip ao sistema nacional
    // para descobrir uma regra que está no XSD guardado no nosso disco.
    expect(mockAssinou).not.toHaveBeenCalled();
    expect(postMock).not.toHaveBeenCalled();
  });

  it("a recusa DIZ o mínimo e quanto foi digitado", async () => {
    const err = await cancelar({ justificativa: "erro" }).catch((e) => e);
    expect(err.message).toMatch(/15/);
    expect(err.message).toMatch(/tem 4/);
  });

  it("exatamente 15 passa", async () => {
    await cancelar({ justificativa: "a".repeat(15) });
    expect(postMock).toHaveBeenCalled();
  });

  it("mais de 255 recusa", async () => {
    await expect(cancelar({ justificativa: "a".repeat(256) })).rejects.toMatchObject({
      code: "NFSE_JUSTIFICATIVA_LONGA",
    });
    expect(postMock).not.toHaveBeenCalled();
  });

  it("⚠ o espaço em volta não conta — 20 espaços não são justificativa", async () => {
    // ⚠ Cai em CURTA, não em REQUIRED, e isso é medido de propósito: uma string de espaços é
    // `truthy`, então a guarda de presença não a pega — quem a pega é o `trim()` do tamanho, que
    // conta 0. O código difere; o conserto de quem lê é o mesmo (escrever a justificativa), e a
    // mensagem diz a verdade ("tem 0").
    const err = await cancelar({ justificativa: " ".repeat(20) }).catch((e) => e);
    expect(err.code).toBe("NFSE_JUSTIFICATIVA_CURTA");
    expect(err.message).toMatch(/tem 0/);
    expect(postMock).not.toHaveBeenCalled();
  });
});

describe("o XML do cancelamento", () => {
  it("é `e101101`, com o `xDesc` que o XSD enumera e a chave da nota", async () => {
    await cancelar();
    const xml = xmlAssinado();
    expect(xml).toContain("<e101101>");
    // `tiposEventos_v1.01.xsd:226-231` enumera EXATAMENTE esta string.
    expect(xml).toContain("<xDesc>Cancelamento de NFS-e</xDesc>");
    expect(xml).toContain(`<chNFSe>${CHAVE}</chNFSe>`);
    expect(xml).toContain(`<xMotivo>${JUSTIFICATIVA_OK}</xMotivo>`);
  });

  it("⚠ NÃO monta o evento de substituição", async () => {
    await cancelar();
    expect(xmlAssinado()).not.toContain("e105102");
    expect(xmlAssinado()).not.toContain("chSubstituta");
  });
});

describe("⚠ a EMPRESA vem do chamador quando ele a resolveu — e `ServiceInvoice` não é consultada", () => {
  it("com `companyId`, a nota capturada do ADN (sem linha nossa) cancela normalmente", async () => {
    prisma.serviceInvoice.findFirst.mockResolvedValue(null); // não existe emissão nossa
    await cancelar();
    expect(prisma.serviceInvoice.findFirst).not.toHaveBeenCalled();
    expect(prisma.company.findUnique).toHaveBeenCalledWith({ where: { id: "company-1" } });
    expect(postMock).toHaveBeenCalled();
  });

  it("SEM `companyId`, o caminho antigo continua: procura em `ServiceInvoice`", async () => {
    prisma.serviceInvoice.findFirst.mockResolvedValue({ id: "si-1", companyId: "company-1" });
    await cancelar({ companyId: null });
    expect(prisma.serviceInvoice.findFirst).toHaveBeenCalled();
    expect(postMock).toHaveBeenCalled();
  });

  it("sem `companyId` e sem linha nossa: `NFSE_NOT_FOUND` — o comportamento de antes, intacto", async () => {
    prisma.serviceInvoice.findFirst.mockResolvedValue(null);
    await expect(cancelar({ companyId: null })).rejects.toMatchObject({ code: "NFSE_NOT_FOUND" });
    expect(postMock).not.toHaveBeenCalled();
  });
});

describe("⚠⚠ AS TRÊS CAMADAS — e a do TRANSPORTE não convida a repetir", () => {
  function falha({ status, data } = {}) {
    const err = new Error("boom");
    if (status) err.response = { status, data };
    return () => {
      throw err;
    };
  }

  it("4xx do sistema nacional ⇒ camada RECEITA (analisou e recusou)", async () => {
    montarCenario({ respostaProvedor: falha({ status: 422, data: { erro: "E0044" } }) });
    const err = await cancelar().catch((e) => e);
    expect(err.camada).toBe(CAMADA.RECEITA);
  });

  it("5xx ⇒ camada TRANSPORTE — desfecho DESCONHECIDO, nunca recusa", async () => {
    montarCenario({ respostaProvedor: falha({ status: 503 }) });
    const err = await cancelar().catch((e) => e);
    expect(err.camada).toBe(CAMADA.TRANSPORTE);
  });

  it("timeout/rede ⇒ camada TRANSPORTE", async () => {
    montarCenario({ respostaProvedor: falha() });
    const err = await cancelar().catch((e) => e);
    expect(err.camada).toBe(CAMADA.TRANSPORTE);
  });

  it("⚠⚠ a CORREÇÃO do transporte é a do CANCELAMENTO, não a da emissão", async () => {
    montarCenario({ respostaProvedor: falha({ status: 500 }) });
    const err = await cancelar().catch((e) => e);
    // Ela manda NÃO reenviar e consultar a situação da nota…
    expect(err.correcao).toMatch(/N[ÃA]O envie o cancelamento de novo/i);
    expect(err.correcao).toMatch(/consulte a situação da nota/i);
    // …e NÃO fala de numeração: cancelar não consome número de DPS.
    expect(err.correcao).not.toMatch(/n[úu]mero novo/i);
    expect(err.correcao).not.toMatch(/buraco permanente/i);
    expect(err.correcao).not.toMatch(/Id da DPS/i);
  });
});
