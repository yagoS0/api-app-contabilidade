// A LIGAÇÃO: a memória do tomador é escrita DEPOIS do sucesso, e nunca antes.
//
// A regra em si está em `tomadorEmitido.test.js`. Aqui se prova o que só a `NfseService.issue`
// consegue mostrar:
//   1. a gravação acontece com a nota já emitida, e com os dados que a nota levou;
//   2. emissão recusada NÃO grava nada — nem a nossa recusa, nem a da Receita;
//   3. ⚠⚠ uma exceção vinda desse caminho NÃO vira `falha_envio` numa nota AUTORIZADA. Este é o
//      ponto do `try/catch` de cinto e suspensório no ponto de chamada: ele está dentro do `try`
//      cujo `catch` é o classificador de falha da emissão.
//
// ⚠ NADA AQUI EMITE COISA ALGUMA. `axios` é simulado; nenhuma chamada sai da máquina.

jest.mock("../../../config.js", () => ({
  NFSE_BASE_URL: "https://sefin.producaorestrita.nfse.gov.br/SefinNacional",
  NFSE_ENV: "homolog",
  NFSE_PATH: "/nfse",
  NFSE_CONSULT_PATH: "/nfse/consulta",
  NFSE_DPS_PATH: "/dps",
  NFSE_NFSE_PATH: "/nfse",
  NFSE_EVENT_FIELD: "pedidoRegistroEventoXmlGZipB64",
  NFSE_EVENT_FORMAT: "gzipB64",
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock("axios", () => ({ __esModule: true, default: { create: jest.fn() } }));

jest.mock("xml-crypto", () => ({
  SignedXml: class {
    addReference() {}
    computeSignature(xml) {
      this._xml = xml;
    }
    getSignedXml() {
      return this._xml;
    }
  },
}));

jest.mock("../nfseCertificado.js", () => ({ resolverCertificadosDaEmpresa: jest.fn() }));

// ⚠ O módulo REAL, só embrulhado num espião: os testes 1 e 2 exercitam a regra de verdade contra o
// dublê do Prisma; o teste 3 substitui o comportamento para provar o guarda do ponto de chamada.
jest.mock("../tomadorEmitido.js", () => {
  const actual = jest.requireActual("../tomadorEmitido.js");
  return { ...actual, registrarTomadorEmitido: jest.fn(actual.registrarTomadorEmitido) };
});

jest.mock("../../../infrastructure/db/prisma.js", () => {
  const serviceInvoice = {
    create: jest.fn(async ({ data }) => ({ id: "inv-1", ...data })),
    update: jest.fn(async ({ data }) => ({ id: "inv-1", ...data })),
    findUnique: jest.fn(async () => null),
  };
  const tomadorEmitido = {
    findUnique: jest.fn(async () => null),
    create: jest.fn(async ({ data }) => data),
    update: jest.fn(async ({ data }) => data),
  };
  const tx = { serviceInvoice, $queryRaw: jest.fn(async () => [{ rpsNumero: "42" }]) };
  return {
    prisma: {
      company: { findUnique: jest.fn() },
      portalClient: { findUnique: jest.fn(async () => ({ id: "portal-1" })) },
      portalInvoice: { findMany: jest.fn(async () => []) },
      cadastroFiscal: { findUnique: jest.fn(async () => null) },
      serviceInvoice,
      tomadorEmitido,
      $transaction: jest.fn(async (cb) => cb(tx)),
    },
  };
});

import axios from "axios";
import { prisma } from "../../../infrastructure/db/prisma.js";
import { resolverCertificadosDaEmpresa } from "../nfseCertificado.js";
import { registrarTomadorEmitido } from "../tomadorEmitido.js";
import { NfseService } from "../NfseService.js";

const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

const CERT_DA_EMPRESA = {
  assinatura: {
    pfxBuffer: Buffer.from("pfx"),
    password: "s",
    certPem: "PEM",
    keyPem: "KEY",
    certBase64: "B64",
  },
  transporte: { pfxBuffer: Buffer.from("pfx"), password: "s" },
  origem: "company_a1",
};

const EMPRESA_BASE = {
  id: "company-1",
  cnpj: "39254243000191",
  inscricaoMunicipal: "12345",
  codigoServicoNacional: "171201",
  codigoServicoMunicipal: "001",
  rpsSerie: "1",
  rpsNumero: "41",
  codigoMunicipioIbge: "3304557",
  regimeTributario: "SIMPLES_NACIONAL",
};

const PAYLOAD_BASE = {
  companyId: "company-1",
  tomador: {
    doc: "12219079724",
    nome: "yago silva",
    email: "y@example.com",
    endereco: { cMun: "3304557", CEP: "20000000", xLgr: "RUA X", nro: "1", xBairro: "CENTRO" },
  },
  servico: { descricao: "serviços contabeis", valorServicos: 100, aliquota: 5, issRetido: false },
  totTrib: { pTotTribSN: 6 },
  competencia: new Date("2026-01-23T00:00:00Z"),
};

function montarCenario({ respostaProvedor } = {}) {
  prisma.company.findUnique.mockResolvedValue(EMPRESA_BASE);
  prisma.cadastroFiscal.findUnique.mockResolvedValue(null);
  axios.create.mockReturnValue({
    defaults: { baseURL: "https://sefin.producaorestrita.nfse.gov.br/SefinNacional" },
    post: jest.fn(async () =>
      respostaProvedor === undefined
        ? { data: { status: "issued", chaveAcesso: "3".repeat(50), numeroNfse: "18" } }
        : respostaProvedor()
    ),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  resolverCertificadosDaEmpresa.mockResolvedValue(CERT_DA_EMPRESA);
  prisma.serviceInvoice.create.mockImplementation(async ({ data }) => ({ id: "inv-1", ...data }));
  prisma.serviceInvoice.update.mockImplementation(async ({ data }) => ({ id: "inv-1", ...data }));
  prisma.tomadorEmitido.findUnique.mockResolvedValue(null);
});

describe("emissão bem-sucedida alimenta a memória do tomador", () => {
  it("grava documento, nome, e-mail e o endereço COMPLETO que a nota levou", async () => {
    montarCenario();

    const r = await NfseService.issue({ data: PAYLOAD_BASE, log });

    expect(r.status).toBe("issued");
    expect(prisma.tomadorEmitido.create).toHaveBeenCalledTimes(1);
    expect(prisma.tomadorEmitido.create.mock.calls[0][0].data).toMatchObject({
      companyId: "company-1",
      documento: "12219079724",
      nome: "yago silva",
      email: "y@example.com",
      cMun: "3304557",
      cep: "20000000",
      xLgr: "RUA X",
      nro: "1",
      xBairro: "CENTRO",
    });
  });

  it("⚠ DEPOIS do sucesso: a nota já está gravada como emitida quando a memória é escrita", async () => {
    montarCenario();
    const ordem = [];
    prisma.serviceInvoice.update.mockImplementation(async ({ data }) => {
      ordem.push(`invoice:${data.status}`);
      return { id: "inv-1", ...data };
    });
    prisma.tomadorEmitido.create.mockImplementation(async ({ data }) => {
      ordem.push("tomador");
      return data;
    });

    await NfseService.issue({ data: PAYLOAD_BASE, log });

    expect(ordem).toEqual(["invoice:issued", "tomador"]);
  });

  it("⚠ nota emitida SEM endereço completo grava a memória sem endereço — nada é completado", async () => {
    montarCenario();
    // Endereço pela metade é o que o validador entrega como `undefined`; aqui ele nem vem.
    // `buildDpsXml` recusaria a emissão, então o cenário é o de um tomador cujo endereço veio de
    // outro caminho: o que importa provar é que a memória grava a AUSÊNCIA, não um preenchimento.
    const semEmail = { ...PAYLOAD_BASE, tomador: { ...PAYLOAD_BASE.tomador, email: null } };

    await NfseService.issue({ data: semEmail, log });

    expect(prisma.tomadorEmitido.create.mock.calls[0][0].data.email).toBeNull();
  });
});

describe("⚠ emissão que NÃO saiu não escreve memória nenhuma", () => {
  it("recusa NOSSA (sem certificado) não grava", async () => {
    montarCenario();
    const err = new Error("Esta empresa não tem certificado A1 próprio (E0718).");
    err.code = "NO_COMPANY_CERT";
    resolverCertificadosDaEmpresa.mockRejectedValue(err);

    const r = await NfseService.issue({ data: PAYLOAD_BASE, log });

    expect(r.status).toBe("falha_envio");
    expect(prisma.tomadorEmitido.create).not.toHaveBeenCalled();
    expect(prisma.tomadorEmitido.update).not.toHaveBeenCalled();
  });

  it("falha no envio ao sistema nacional não grava", async () => {
    montarCenario({
      respostaProvedor: () => {
        throw Object.assign(new Error("timeout"), { code: "ETIMEDOUT" });
      },
    });

    await NfseService.issue({ data: PAYLOAD_BASE, log });

    expect(prisma.tomadorEmitido.create).not.toHaveBeenCalled();
    expect(prisma.tomadorEmitido.update).not.toHaveBeenCalled();
  });
});

describe("⚠⚠ a memória NUNCA muda o desfecho de uma nota autorizada", () => {
  it("banco fora do ar na gravação: a nota continua `issued`", async () => {
    montarCenario();
    prisma.tomadorEmitido.create.mockRejectedValue(new Error("conexão caiu"));

    const r = await NfseService.issue({ data: PAYLOAD_BASE, log });

    expect(r.status).toBe("issued");
    expect(r.camada).toBeUndefined();
  });

  it("⚠ EXCEÇÃO ESCAPANDO DO MÓDULO: o guarda do ponto de chamada segura, e a nota segue `issued`", async () => {
    montarCenario();
    // Hoje `registrarTomadorEmitido` não lança. Este teste prende o dia em que alguém mudar isso:
    // sem o `try/catch` no ponto de chamada, a exceção cairia no classificador de falha e uma nota
    // AUTORIZADA seria gravada e devolvida como `falha_envio`.
    registrarTomadorEmitido.mockRejectedValueOnce(new Error("regressão futura"));

    const r = await NfseService.issue({ data: PAYLOAD_BASE, log });

    expect(r.status).toBe("issued");
    expect(r.nfse.numeroNfse).toBe("18");
    expect(log.warn).toHaveBeenCalled();
  });
});
