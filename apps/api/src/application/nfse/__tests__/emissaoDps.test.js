// O XML DA DPS TEM DE DIZER A VERDADE SOBRE A EMPRESA — E RECUSAR QUANDO NÃO SOUBER.
//
// Exercita `NfseService.issue` de ponta a ponta (com o mundo externo simulado) e olha o XML que
// SAIRIA. Os quatro defeitos medidos no `buildDpsXml` estão travados aqui:
//
//   1. `cLocEmi` saía `"0000000"` — os campos `codigoMunicipioIbge`/`codigoMunicipio` não existiam
//      no model `Company`, a cadeia caía num env não definido e o `padStart` fabricava os zeros;
//   2. `opSimpNac="3"` cravado — toda empresa declarada Simples ME/EPP, inclusive as do Presumido;
//   3. `tpRetISSQN` cravado em `1` — a retenção era calculada em três variáveis MORTAS;
//   4. o certificado era um PFX GLOBAL, sem conferir de quem era.
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

jest.mock("axios", () => ({
  __esModule: true,
  default: { create: jest.fn() },
}));

// Assinatura real exigiria uma chave privada de verdade versionada — o que não se faz. O que este
// teste precisa ver é o XML MONTADO; a assinatura em si é do `xml-crypto`.
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

jest.mock("../nfseCertificado.js", () => ({
  resolverCertificadosDaEmpresa: jest.fn(),
}));

jest.mock("../../../infrastructure/db/prisma.js", () => {
  const serviceInvoice = {
    create: jest.fn(async ({ data }) => ({ id: "inv-1", ...data })),
    update: jest.fn(async ({ data }) => ({ id: "inv-1", ...data })),
    findUnique: jest.fn(async () => null),
  };
  const tx = {
    serviceInvoice,
    $queryRaw: jest.fn(async () => [{ rpsNumero: "42" }]),
  };
  return {
    __tx: tx,
    prisma: {
      company: { findUnique: jest.fn() },
      portalClient: { findUnique: jest.fn(async () => ({ id: "portal-1" })) },
      cadastroFiscal: { findUnique: jest.fn(async () => null) },
      serviceInvoice,
      $transaction: jest.fn(async (cb) => cb(tx)),
    },
  };
});

import { gunzipSync } from "node:zlib";
import axios from "axios";
import { prisma } from "../../../infrastructure/db/prisma.js";
import { resolverCertificadosDaEmpresa } from "../nfseCertificado.js";
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

let postMock;

function montarCenario({ empresa = {}, cadastroFiscal = null, respostaProvedor } = {}) {
  prisma.company.findUnique.mockResolvedValue({ ...EMPRESA_BASE, ...empresa });
  prisma.cadastroFiscal.findUnique.mockResolvedValue(cadastroFiscal);
  postMock = jest.fn(async () =>
    respostaProvedor === undefined
      ? { data: { status: "issued", chaveAcesso: "3".repeat(50), numeroNfse: "18" } }
      : respostaProvedor()
  );
  axios.create.mockReturnValue({
    defaults: { baseURL: "https://sefin.producaorestrita.nfse.gov.br/SefinNacional" },
    post: postMock,
  });
}

/** XML que teria ido para o sistema nacional. */
function xmlEnviado() {
  const body = postMock.mock.calls[0][1];
  return gunzipSync(Buffer.from(body.dpsXmlGZipB64, "base64")).toString("utf-8");
}

beforeEach(() => {
  jest.clearAllMocks();
  resolverCertificadosDaEmpresa.mockResolvedValue(CERT_DA_EMPRESA);
  prisma.serviceInvoice.create.mockImplementation(async ({ data }) => ({ id: "inv-1", ...data }));
  prisma.serviceInvoice.update.mockImplementation(async ({ data }) => ({ id: "inv-1", ...data }));
});

describe("certificado — sem o A1 da empresa NADA é enviado", () => {
  it("⚠ recusa antes de reservar número e antes de qualquer POST", async () => {
    montarCenario();
    const err = new Error("Esta empresa não tem certificado A1 próprio (E0718).");
    err.code = "NO_COMPANY_CERT";
    resolverCertificadosDaEmpresa.mockRejectedValue(err);

    const r = await NfseService.issue({ data: PAYLOAD_BASE, log });

    expect(r.status).toBe("falha_envio");
    expect(r.camada).toBe("NOSSA");
    expect(r.codigo).toBe("NO_COMPANY_CERT");
    // ⚠ Nunca cai no certificado do escritório: não há POST nenhum.
    expect(axios.create).not.toHaveBeenCalled();
    // E não queima numeração: como não há inutilização na NFS-e, número gasto à toa é buraco.
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.serviceInvoice.create).not.toHaveBeenCalled();
  });

  it("com A1 da empresa, é ELE que assina e ELE que faz o mTLS", async () => {
    montarCenario();
    await NfseService.issue({ data: PAYLOAD_BASE, log });
    expect(resolverCertificadosDaEmpresa).toHaveBeenCalledWith("company-1");
    expect(axios.create).toHaveBeenCalledWith(
      expect.objectContaining({ httpsAgent: expect.anything() })
    );
  });
});

describe("município emissor (cLocEmi)", () => {
  it("⚠ sem código IBGE, RECUSA — não emite '0000000'", async () => {
    montarCenario({ empresa: { codigoMunicipioIbge: null } });

    const r = await NfseService.issue({ data: PAYLOAD_BASE, log });

    expect(r.status).toBe("falha_envio");
    expect(r.camada).toBe("NOSSA");
    expect(r.codigo).toBe("NFSE_MUNICIPIO_NAO_CONFIGURADO");
    expect(r.correcao).toMatch(/IBGE/);
    expect(postMock).not.toHaveBeenCalled();
  });

  it("código com menos de 7 dígitos também recusa (o padStart fabricava o resto)", async () => {
    montarCenario({ empresa: { codigoMunicipioIbge: "3304" } });
    const r = await NfseService.issue({ data: PAYLOAD_BASE, log });
    expect(r.codigo).toBe("NFSE_MUNICIPIO_NAO_CONFIGURADO");
  });

  it("com o código, ele entra no XML e no Id da DPS", async () => {
    montarCenario();
    await NfseService.issue({ data: PAYLOAD_BASE, log });
    const xml = xmlEnviado();
    expect(xml).toContain("<cLocEmi>3304557</cLocEmi>");
    // Id = DPS + cLocEmi(7) + tpInsc(1) + inscFed(14) + serie(5) + nDPS(15)
    expect(xml).toContain('Id="DPS3304557239254243000191' + "00001" + "000000000000042" + '"');
  });
});

describe("regime tributário — opSimpNac vem do dado", () => {
  it("Simples: opSimpNac=3, com regApTribSN e pTotTribSN", async () => {
    montarCenario({ cadastroFiscal: { regime: "SIMPLES_NACIONAL" } });
    await NfseService.issue({ data: PAYLOAD_BASE, log });
    const xml = xmlEnviado();
    expect(xml).toContain("<opSimpNac>3</opSimpNac>");
    expect(xml).toContain("<regApTribSN>1</regApTribSN>");
    expect(xml).toContain("<pTotTribSN>6.00</pTotTribSN>");
  });

  it("⚠ Lucro Presumido: opSimpNac=1, SEM regApTribSN — antes saía 3 (declarado Simples)", async () => {
    montarCenario({ cadastroFiscal: { regime: "LUCRO_PRESUMIDO" } });
    const r = await NfseService.issue({
      data: {
        ...PAYLOAD_BASE,
        totTrib: { pTotTribFed: 11.33, pTotTribEst: 0, pTotTribMun: 5 },
      },
      log,
    });
    expect(r.status).toBe("issued");
    const xml = xmlEnviado();
    expect(xml).toContain("<opSimpNac>1</opSimpNac>");
    expect(xml).not.toContain("regApTribSN");
    // E a carga tributária é a INFORMADA, não `0.00` cravado (que afirmava carga zero).
    expect(xml).toContain("<pTotTribFed>11.33</pTotTribFed>");
    expect(xml).not.toContain("vTotTribFed");
  });

  it("⚠ o CadastroFiscal é a autoridade — vence Company.regimeTributario", async () => {
    montarCenario({
      empresa: { regimeTributario: "SIMPLES_NACIONAL" },
      cadastroFiscal: { regime: "LUCRO_PRESUMIDO" },
    });
    await NfseService.issue({
      data: { ...PAYLOAD_BASE, totTrib: { pTotTribFed: 11.33 } },
      log,
    });
    expect(xmlEnviado()).toContain("<opSimpNac>1</opSimpNac>");
  });

  it("⚠ regime AUSENTE recusa — não vira 3 por omissão", async () => {
    montarCenario({ empresa: { regimeTributario: null }, cadastroFiscal: null });
    const r = await NfseService.issue({ data: PAYLOAD_BASE, log });
    expect(r.camada).toBe("NOSSA");
    expect(r.codigo).toBe("NFSE_REGIME_INDEFINIDO");
    expect(postMock).not.toHaveBeenCalled();
  });

  it("⚠ MEI recusa — o valor 2 não tem evidência no projeto", async () => {
    montarCenario({ cadastroFiscal: { regime: "MEI" } });
    const r = await NfseService.issue({ data: PAYLOAD_BASE, log });
    expect(r.codigo).toBe("NFSE_REGIME_INDEFINIDO");
  });

  it("não optante SEM a carga informada recusa em vez de declarar 0,00", async () => {
    montarCenario({ cadastroFiscal: { regime: "LUCRO_PRESUMIDO" } });
    const r = await NfseService.issue({ data: { ...PAYLOAD_BASE, totTrib: {} }, log });
    expect(r.codigo).toBe("MISSING_TOT_TRIB_NAO_SIMPLES");
  });
});

describe("retenção de ISSQN — chega ao XML", () => {
  it("sem retenção: tpRetISSQN=1 (o valor de hoje, inalterado)", async () => {
    montarCenario();
    await NfseService.issue({ data: PAYLOAD_BASE, log });
    expect(xmlEnviado()).toContain("<tpRetISSQN>1</tpRetISSQN>");
  });

  it("⚠ com retenção: tpRetISSQN=2 — antes era descartada e saía 1", async () => {
    montarCenario();
    await NfseService.issue({
      data: { ...PAYLOAD_BASE, servico: { ...PAYLOAD_BASE.servico, issRetido: true } },
      log,
    });
    expect(xmlEnviado()).toContain("<tpRetISSQN>2</tpRetISSQN>");
  });

  it("retenção sem alíquota recusa (E0625) em vez de emitir retenção sem base", async () => {
    montarCenario();
    const r = await NfseService.issue({
      data: {
        ...PAYLOAD_BASE,
        servico: { ...PAYLOAD_BASE.servico, issRetido: true, aliquota: null },
      },
      log,
    });
    expect(r.codigo).toBe("NFSE_ISS_RETIDO_SEM_ALIQUOTA");
  });
});

describe("local da prestação", () => {
  it("ausente: assume o emissor (LC 116/2003, art. 3º, caput) e REGISTRA a suposição", async () => {
    montarCenario();
    await NfseService.issue({ data: PAYLOAD_BASE, log });
    expect(xmlEnviado()).toContain("<cLocPrestacao>3304557</cLocPrestacao>");
    expect(log.info).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringMatching(/local da prestação não informado/i)
    );
  });

  it("informado: vai o informado, e a suposição NÃO é registrada", async () => {
    montarCenario();
    await NfseService.issue({
      data: { ...PAYLOAD_BASE, servico: { ...PAYLOAD_BASE.servico, cLocPrestacao: "3106200" } },
      log,
    });
    expect(xmlEnviado()).toContain("<cLocPrestacao>3106200</cLocPrestacao>");
    expect(xmlEnviado()).toContain("<cLocEmi>3304557</cLocEmi>");
  });
});

describe("numeração na emissão", () => {
  it("o número usado no XML é o RESERVADO na transação, não o lido do cadastro", async () => {
    // O contador do cadastro diz 41; a reserva devolveu 42. O XML tem de trazer 42 — antes o
    // número saía de `company.rpsNumero` e o incremento vinha depois, fora de transação.
    montarCenario();
    await NfseService.issue({ data: PAYLOAD_BASE, log });
    expect(xmlEnviado()).toContain("<nDPS>42</nDPS>");
    expect(xmlEnviado()).toContain("<serie>00001</serie>");
  });

  it("⚠ não existe mais o `company.update` de incremento fora da transação", async () => {
    montarCenario();
    await NfseService.issue({ data: PAYLOAD_BASE, log });
    expect(prisma.company).not.toHaveProperty("update.mock.calls.length", expect.anything());
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("versão do leiaute sai da constante única (hoje 1.00)", async () => {
    montarCenario();
    await NfseService.issue({ data: PAYLOAD_BASE, log });
    expect(xmlEnviado()).toContain('versao="1.00"');
  });
});

describe("desfecho — o motivo é gravado, e a camada distingue os casos", () => {
  it("recusa da Receita: status rejected, código E#### na linha", async () => {
    montarCenario({
      respostaProvedor: () => {
        const err = new Error("Request failed");
        err.response = { status: 400, data: { codigo: "E0014", message: "já existe" } };
        throw err;
      },
    });

    const r = await NfseService.issue({ data: PAYLOAD_BASE, log });

    expect(r.status).toBe("rejected");
    expect(r.camada).toBe("RECEITA");
    expect(r.codigo).toBe("E0014");
    expect(r.numeroReutilizavel).toBe(true);
    expect(prisma.serviceInvoice.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ falhaCamada: "RECEITA", falhaCodigo: "E0014" }),
      })
    );
  });

  it("⚠ timeout NÃO vira 'rejected' e NÃO libera o número", async () => {
    montarCenario({
      respostaProvedor: () => {
        const err = new Error("timeout of 15000ms exceeded");
        err.code = "ECONNABORTED";
        throw err;
      },
    });

    const r = await NfseService.issue({ data: PAYLOAD_BASE, log });

    expect(r.status).toBe("falha_envio");
    expect(r.camada).toBe("TRANSPORTE");
    expect(r.numeroReutilizavel).toBe(false);
    expect(r.correcao).toMatch(/consulte/i);
  });
});

describe("reemissão reusa a linha e o número — não queima numeração", () => {
  it("reaproveita a ServiceInvoice anterior quando a falha LIBEROU o número", async () => {
    montarCenario();
    prisma.serviceInvoice.findUnique.mockResolvedValue({
      id: "inv-antiga",
      companyId: "company-1",
      rpsSerie: "00001",
      rpsNumero: "42",
      falhaCamada: "RECEITA",
    });

    const r = await NfseService.issue({ data: PAYLOAD_BASE, log, retryInvoiceId: "inv-antiga" });

    expect(r.status).toBe("issued");
    // Nenhuma reserva nova: o número 42 é o mesmo.
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(xmlEnviado()).toContain("<nDPS>42</nDPS>");
  });

  it("⚠ falha de TRANSPORTE bloqueia a reemissão com o mesmo número", async () => {
    montarCenario();
    prisma.serviceInvoice.findUnique.mockResolvedValue({
      id: "inv-antiga",
      companyId: "company-1",
      rpsSerie: "00001",
      rpsNumero: "42",
      falhaCamada: "TRANSPORTE",
    });

    await expect(
      NfseService.issue({ data: PAYLOAD_BASE, log, retryInvoiceId: "inv-antiga" })
    ).rejects.toMatchObject({ code: "NFSE_NUMERO_EM_ESTADO_INDETERMINADO" });
  });
});
