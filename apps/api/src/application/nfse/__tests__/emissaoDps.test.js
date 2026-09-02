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
      // ⚠ A SÉRIE PASSOU A SER LIDA DA ÚLTIMA NOTA (dono, 16/08/2026) — ver `nfseUltimaNota.js`.
      // Sem este mock a emissão RECUSA com `NFSE_LEITURA_ULTIMA_NOTA_FALHOU`, que é o comportamento
      // certo (leitura que não volta nunca vira palpite) e derrubaria esta suíte inteira. Vazio =
      // empresa sem nota = primeira emissão, que é o cenário destes testes.
      portalInvoice: { findMany: jest.fn(async () => []) },
      cadastroFiscal: { findUnique: jest.fn(async () => null) },
      serviceInvoice,
      $transaction: jest.fn(async (cb) => cb(tx)),
    },
  };
});

import { gunzipSync } from "node:zlib";
import axios from "axios";
import { prisma, __tx } from "../../../infrastructure/db/prisma.js";
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
      // ⚠ A CARGA COMPLETA ENTROU NESTA FIXTURE, e é o conserto de 18/08/2026 aparecendo: antes o
      // payload trazia SÓ `pTotTribFed` e a emissão passava, porque o portão usava `.some()`. Um
      // percentual bastava e os outros dois saíam `0.00` no XML — carga zero AFIRMADA ao tomador.
      empresa: {
        regimeTributario: "SIMPLES_NACIONAL",
        pTotTribFed: 11.33,
        pTotTribEst: 0,
        pTotTribMun: 2.5,
      },
      cadastroFiscal: { regime: "LUCRO_PRESUMIDO" },
    });
    await NfseService.issue({ data: PAYLOAD_BASE, log });
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

// ─────────────────────────────────────────────────────────────────────────────────────────────
// CARGA TRIBUTÁRIA APROXIMADA (Lei 12.741/2012) — o cadastro do contador, e o zero fabricado
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// Pedido do dono (18/08/2026): *"precisamos emitir para simples nacional também, as alíquotas
// efetivas do presumido não precisam ser calculadas a não ser o ISS que varia de município, mas
// deve ser configurado do lado do contador, no portal do contador."*
//
// ⚠⚠ O DEFEITO QUE ESTE BLOCO PRENDE: o portão usava `.some()` — UM percentual liberava a
// emissão — e o XML escrevia `?? 0` nos outros dois. O contador configurava só o municipal e a
// nota saía AFIRMANDO ao tomador carga federal 0,00% e estadual 0,00%. Zero fabricado por
// omissão, IMPRESSO no DANFSe por força da Lei da Transparência.
describe("carga tributária do não optante — vem do CADASTRO, e os três são exigidos", () => {
  const PRESUMIDO = { regime: "LUCRO_PRESUMIDO" };
  const CARGA = { pTotTribFed: 11.33, pTotTribEst: 0, pTotTribMun: 2.5 };

  it("⚠ o CADASTRO DA EMPRESA alimenta o XML — o payload não precisa trazer nada", async () => {
    montarCenario({ empresa: CARGA, cadastroFiscal: PRESUMIDO });
    const r = await NfseService.issue({ data: PAYLOAD_BASE, log });
    expect(r.status).toBe("issued");
    const xml = xmlEnviado();
    // A FORMA é a da NFS-e real versionada (`docs/leiaute-nfse/nfse-nacional-substituicao.xml`):
    // `pTotTrib` filho único de `totTrib`, com os três na ordem Fed · Est · Mun.
    expect(xml).toContain(
      "<pTotTribFed>11.33</pTotTribFed>"
    );
    expect(xml).toContain("<pTotTribEst>0.00</pTotTribEst>");
    expect(xml).toContain("<pTotTribMun>2.50</pTotTribMun>");
    expect(xml).not.toContain("vTotTrib");
  });

  it("⚠⚠ SÓ O MUNICIPAL CONFIGURADO NÃO EMITE — antes saía com federal e estadual 0,00", async () => {
    montarCenario({ empresa: { pTotTribMun: 2.5 }, cadastroFiscal: PRESUMIDO });
    const r = await NfseService.issue({ data: PAYLOAD_BASE, log });
    expect(r.codigo).toBe("MISSING_TOT_TRIB_NAO_SIMPLES");
    expect(r.camada).toBe("NOSSA");
    // Nada saiu da máquina, e o número não foi queimado.
    expect(postMock).not.toHaveBeenCalled();
  });

  it("⚠ ZERO DECLARADO EMITE — e é o que separa 0,00 conferido de 0,00 por omissão", async () => {
    // A própria NFS-e real de referência declara `pTotTribEst 0.00` e `pTotTribMun 0.00`: serviço
    // não tem ICMS. Zero é legítimo — desde que alguém o tenha digitado.
    montarCenario({
      empresa: { pTotTribFed: 11.33, pTotTribEst: 0, pTotTribMun: 0 },
      cadastroFiscal: PRESUMIDO,
    });
    const r = await NfseService.issue({ data: PAYLOAD_BASE, log });
    expect(r.status).toBe("issued");
    expect(xmlEnviado()).toContain("<pTotTribMun>0.00</pTotTribMun>");
  });

  it("o payload VENCE o cadastro, campo a campo", async () => {
    montarCenario({ empresa: CARGA, cadastroFiscal: PRESUMIDO });
    await NfseService.issue({
      data: { ...PAYLOAD_BASE, totTrib: { pTotTribFed: 9.25 } },
      log,
    });
    const xml = xmlEnviado();
    expect(xml).toContain("<pTotTribFed>9.25</pTotTribFed>");
    // ⚠ E os outros dois continuam vindo do cadastro — não viram 0,00 por o payload ser parcial.
    expect(xml).toContain("<pTotTribMun>2.50</pTotTribMun>");
  });

  it("a recusa NOMEIA quais faltam — 'falta a carga' mandaria conferir os três", async () => {
    montarCenario({ empresa: { pTotTribFed: 11.33 }, cadastroFiscal: PRESUMIDO });
    const r = await NfseService.issue({ data: PAYLOAD_BASE, log });
    expect(r.message).toContain("pTotTribEst");
    expect(r.message).toContain("pTotTribMun");
    expect(r.message).not.toContain("pTotTribFed (");
  });

  it("percentual fora de 0–100 recusa em vez de virar XML", async () => {
    montarCenario({ empresa: { ...CARGA, pTotTribFed: 1133 }, cadastroFiscal: PRESUMIDO });
    const r = await NfseService.issue({ data: PAYLOAD_BASE, log });
    expect(r.codigo).toBe("INVALID_TOT_TRIB_NAO_SIMPLES");
    expect(r.camada).toBe("NOSSA");
    expect(postMock).not.toHaveBeenCalled();
  });

  it("⚠ o SIMPLES não é afetado — ele declara pTotTribSN e ignora estas colunas", async () => {
    montarCenario({
      empresa: { pTotTribFed: null, pTotTribEst: null, pTotTribMun: null },
      cadastroFiscal: { regime: "SIMPLES_NACIONAL" },
    });
    const r = await NfseService.issue({ data: PAYLOAD_BASE, log });
    expect(r.status).toBe("issued");
    const xml = xmlEnviado();
    expect(xml).toContain("<pTotTribSN>6.00</pTotTribSN>");
    expect(xml).not.toContain("pTotTribFed");
  });

  it("⚠ valor torto NESTAS colunas não derruba a nota do SIMPLES — ela não os usa", async () => {
    // Recusar aqui bloquearia uma emissão legítima por causa de um campo que a nota não leva.
    // Quem responde pelo Simples é `pTotTribSN`, e ele tem guarda própria.
    montarCenario({
      empresa: { pTotTribFed: 1133 },
      cadastroFiscal: { regime: "SIMPLES_NACIONAL" },
    });
    const r = await NfseService.issue({ data: PAYLOAD_BASE, log });
    expect(r.status).toBe("issued");
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

  it("⚠⚠ retenção sem alíquota recusa — e desde 02/09/2026 a recusa é mais CEDO e mais precisa", async () => {
    // ⚠⚠ O CÓDIGO MUDOU, E É MELHORIA — não afrouxamento. A intenção deste caso ("retenção sem
    // alíquota NÃO vira nota") está intacta; o que mudou é QUEM recusa e ONDE:
    //
    //   antes  `NFSE_ISS_RETIDO_SEM_ALIQUOTA`, dentro de `buildDpsXml` — ou seja, DEPOIS de a
    //          numeração ter sido reservada;
    //   agora  `NFSE_PALIQ_OBRIGATORIA_AUSENTE`, no PRÉ-VOO, citando E0621/E0628 e o mínimo de
    //          1,8%, e dizendo que quem declara a alíquota é o CONTADOR, no perfil.
    //
    // ⚠ A guarda antiga NÃO foi removida: ela continua no gerador, agora lendo a alíquota EFETIVA
    // (perfil → payload). O que ela deixou de ser é a PRIMEIRA a falar.
    // ⚠ Nenhuma tela mapeia o código antigo — varrido nos dois portais, só há comentários —, e
    // recusa que a tela não conhece mostra a mensagem do servidor em vez de inventar procedimento.
    montarCenario();
    const r = await NfseService.issue({
      data: {
        ...PAYLOAD_BASE,
        servico: { ...PAYLOAD_BASE.servico, issRetido: true, aliquota: null },
      },
      log,
    });
    expect(r.codigo).toBe("NFSE_PALIQ_OBRIGATORIA_AUSENTE");
    expect(r.camada).toBe("NOSSA");
    // A prova de que foi ANTES da numeração: nenhuma linha de nota foi criada.
    expect(prisma.serviceInvoice.create).not.toHaveBeenCalled();
    // E a correção aponta para quem pode consertar.
    expect(r.correcao).toMatch(/contador|perfil de emissão|perfil/i);
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

  // ⚠⚠ ESTE LITERAL FICA FIXO DE PROPÓSITO — não o troque por `DPS_VERSAO`.
  //
  // Ele e o `dpsContraXsd.test.js` fazem perguntas OPOSTAS, e as duas precisam existir:
  //
  //   • o oráculo do XSD **segue** a constante (carrega `Schemas/${DPS_VERSAO}`), senão validaria o
  //     documento contra o esquema de outra versão — o falso-verde consertado em 01/09/2026;
  //   • este caso **não segue**, porque ele é o ANÚNCIO. Derivando da constante ele passaria sempre,
  //     e a versão do documento fiscal poderia mudar sem nada ficar vermelho.
  //
  // ⚠⚠ ELE MORDEU: em 01/09/2026 a constante subiu de `"1.00"` para `"1.01"` e este foi o único
  // vermelho da suíte — exatamente o papel dele. O literal foi trocado À MÃO, junto da decisão.
  // A INÉRCIA da troca está medida em `dpsContraXsd.test.js` (o mesmo XML cabe nos dois esquemas).
  it("versão do leiaute sai da constante única (hoje 1.01)", async () => {
    montarCenario();
    await NfseService.issue({ data: PAYLOAD_BASE, log });
    expect(xmlEnviado()).toContain('versao="1.01"');
  });

  // ── A SÉRIE AUTOMÁTICA, no caminho REAL da emissão (dono, 16/08/2026) ──────────────────────
  //
  // > *"nem sempre o usuário vai emitir pelo nosso portal"*. Aqui o teste é sobre a LIGAÇÃO: que
  // `NfseService.issue` — que não foi tocado — passa a numerar a partir da última nota que existe.
  // A regra em si está travada em `nfseNumeracao.test.js` e `nfseUltimaNota.test.js`.

  it("⚠ a série vem da ÚLTIMA NOTA, não do cadastro — inclusive de nota emitida fora do portal", async () => {
    montarCenario();
    // Uma NFS-e capturada do ADN, série 00007, nDPS 127. O cadastro diz série 1 e contador 41.
    prisma.portalInvoice.findMany.mockResolvedValueOnce([
      {
        id: "n1",
        xmlRaw: `<NFSe><infNFSe><nNFSe>900001</nNFSe><DPS><infDPS><serie>00007</serie><nDPS>127</nDPS></infDPS></DPS></infNFSe></NFSe>`,
      },
    ]);

    await NfseService.issue({ data: PAYLOAD_BASE, log });

    // A série do XML é a LIDA (00007), não a cadastrada (00001).
    expect(xmlEnviado()).toContain("<serie>00007</serie>");
    // E o piso 127 chegou ao `UPDATE … GREATEST(…) + 1` — é o que impede reusar um número já
    // emitido. (O `$queryRaw` do mock devolve sempre 42; o que se confere aqui é o PARÂMETRO.)
    const [, ...parametros] = __tx.$queryRaw.mock.calls[0];
    expect(parametros).toContain(127);
  });

  it("⚠ leitura da última nota que NÃO volta RECUSA a emissão — não chuta o próximo número", async () => {
    montarCenario();
    prisma.portalInvoice.findMany.mockRejectedValueOnce(new Error("banco fora"));

    await expect(NfseService.issue({ data: PAYLOAD_BASE, log })).rejects.toMatchObject({
      code: "NFSE_LEITURA_ULTIMA_NOTA_FALHOU",
    });
    // Nada foi enviado e nenhuma linha de nota foi criada — o número não se queima à toa.
    expect(prisma.serviceInvoice.create).not.toHaveBeenCalled();
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

// ── O CÓDIGO DE SERVIÇO DA NOTA CHEGA AO XML — E A TRAVA VEM ANTES DELE ────────────────────────
//
// ⚠ A ESCOLHA POR EMISSÃO ERA UMA PONTE ATÉ 18/08/2026: `buildDpsXml` lia
// `company.codigoServicoNacional` e mais nada, o assistente MOSTRAVA os códigos cadastrados e
// trocar era marcação no cadastro. A ponte existia para não haver seletor que parecesse funcionar
// e emitisse outro código — erro fiscal SILENCIOSO.
//
// ⚠ O QUE ESTA SUÍTE PRENDE É A TRAVA, não a funcionalidade: **o cadastro é a autoridade, nunca o
// payload**. Cada caso mede sobre o XML que SAIRIA (ou sobre o fato de nada ter saído), nunca
// sobre a intenção do código.
describe("cTribNac — a escolha da emissão, com o cadastro mandando", () => {
  it("⚠ SEM escolha e SEM lista: o comportamento de hoje, intacto — sai o cadastro", async () => {
    // É o estado das 33 empresas medidas: `codigosServicoNacional` vazio. Nenhuma emissão
    // existente pode mudar por causa desta entrega.
    montarCenario();
    await NfseService.issue({ data: PAYLOAD_BASE, log });
    expect(xmlEnviado()).toContain("<cTribNac>171201</cTribNac>");
  });

  it("código DENTRO da lista: é ELE que sai no <cTribNac> (não o singular do cadastro)", async () => {
    montarCenario({
      empresa: { codigoServicoNacional: "171201", codigosServicoNacional: ["171201", "310104"] },
    });

    const r = await NfseService.issue({
      data: { ...PAYLOAD_BASE, servico: { ...PAYLOAD_BASE.servico, codigoServicoNacional: "310104" } },
      log,
    });

    expect(r.status).toBe("issued");
    const xml = xmlEnviado();
    expect(xml).toContain("<cTribNac>310104</cTribNac>");
    expect(xml).not.toContain("<cTribNac>171201</cTribNac>");
  });

  it("⚠ código FORA da lista: recusa nomeada, e `buildDpsXml` NÃO é alcançado", async () => {
    montarCenario({
      empresa: { codigoServicoNacional: "171201", codigosServicoNacional: ["171201", "310104"] },
    });

    const r = await NfseService.issue({
      data: { ...PAYLOAD_BASE, servico: { ...PAYLOAD_BASE.servico, codigoServicoNacional: "999999" } },
      log,
    });

    expect(r.status).toBe("falha_envio");
    expect(r.camada).toBe("NOSSA");
    expect(r.codigo).toBe("NFSE_CODIGO_SERVICO_FORA_DA_LISTA");
    expect(r.correcao).toMatch(/cadastr/i);
    // Nada saiu da máquina…
    expect(postMock).not.toHaveBeenCalled();
    // …e nada foi escrito: a recusa é PRÉ-VOO, antes da reserva. Como não há inutilização na
    // NFS-e, número gasto à toa é buraco permanente.
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.serviceInvoice.create).not.toHaveBeenCalled();
  });

  it("⚠ LISTA VAZIA não é 'pode qualquer código' — escolha diferente do cadastro recusa", async () => {
    // Sem esta linha a trava estaria desligada em toda a carteira, que é onde ela mais importa.
    montarCenario({ empresa: { codigoServicoNacional: "171201", codigosServicoNacional: [] } });

    const r = await NfseService.issue({
      data: { ...PAYLOAD_BASE, servico: { ...PAYLOAD_BASE.servico, codigoServicoNacional: "310104" } },
      log,
    });

    expect(r.codigo).toBe("NFSE_CODIGO_SERVICO_FORA_DA_LISTA");
    expect(postMock).not.toHaveBeenCalled();
    expect(prisma.serviceInvoice.create).not.toHaveBeenCalled();
  });

  it("lista vazia + escolha IGUAL ao cadastro: passa, e é ele que sai", async () => {
    montarCenario({ empresa: { codigoServicoNacional: "171201", codigosServicoNacional: [] } });

    const r = await NfseService.issue({
      data: { ...PAYLOAD_BASE, servico: { ...PAYLOAD_BASE.servico, codigoServicoNacional: "171201" } },
      log,
    });

    expect(r.status).toBe("issued");
    expect(xmlEnviado()).toContain("<cTribNac>171201</cTribNac>");
  });

  it("com lista e SEM escolha, sai o singular — nunca 'o primeiro da lista'", async () => {
    montarCenario({
      empresa: { codigoServicoNacional: "310104", codigosServicoNacional: ["171201", "310104"] },
    });
    await NfseService.issue({ data: PAYLOAD_BASE, log });
    expect(xmlEnviado()).toContain("<cTribNac>310104</cTribNac>");
  });

  it("o cTribMun NÃO muda com a escolha do nacional — são códigos de listas diferentes", async () => {
    montarCenario({
      empresa: { codigosServicoNacional: ["171201", "310104"], codigoServicoMunicipal: "001" },
    });
    await NfseService.issue({
      data: { ...PAYLOAD_BASE, servico: { ...PAYLOAD_BASE.servico, codigoServicoNacional: "310104" } },
      log,
    });
    expect(xmlEnviado()).toContain("<cTribMun>001</cTribMun>");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// PIS/COFINS — os dois elementos INVENTADOS, e o que sobrou sem casa
//
// ⚠⚠ Três notas fiscais REAIS foram recusadas em PRODUÇÃO em 21/08/2026 (ALTAN CONTABILIDADE,
// VAGALO VESTUARIO, ARAUJO E SILVA 2 — R$ 1,00, emissão em LOTE):
//
//     E1235 - Falha no esquema XML do DF-e.
//     The element 'piscofins' … has invalid child element 'vBcRetPisCofins' …
//
// A conformidade do XML inteiro contra o XSD oficial mora em `dpsContraXsd.test.js`. Aqui ficam
// as decisões de COMPORTAMENTO: o que sai, o que não sai, e o que RECUSA com nome próprio.
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("PIS/COFINS (tribFed/piscofins) — o grupo não afirma o que ninguém informou", () => {
  const PRESUMIDO = { regime: "LUCRO_PRESUMIDO" };
  const CARGA = { pTotTribFed: 11.33, pTotTribEst: 0, pTotTribMun: 2.5 };

  it("⚠⚠ o cenário LITERAL das três notas: Lucro Presumido, R$ 1,00 — hoje EMITE", async () => {
    montarCenario({ empresa: CARGA, cadastroFiscal: PRESUMIDO });
    const r = await NfseService.issue({
      data: { ...PAYLOAD_BASE, servico: { ...PAYLOAD_BASE.servico, valorServicos: 1 } },
      log,
    });
    expect(r.status).toBe("issued");
    const xml = xmlEnviado();
    // Os dois nomes inventados não existem no leiaute e não voltam por caminho nenhum.
    expect(xml).not.toContain("vBcRetPisCofins");
    expect(xml).not.toContain("vRetPisCofins");
  });

  it("⚠ NÃO OPTANTE não leva <tribFed> — a NFS-e real de não optante também não leva", async () => {
    // `docs/leiaute-nfse/nfse-nacional-substituicao.xml` (`opSimpNac=1`) traz `<trib>` só com
    // `tribMun` e `totTrib`. `CST 01` + zeros AFIRMARIA que a empresa não deve PIS/COFINS.
    montarCenario({ empresa: CARGA, cadastroFiscal: PRESUMIDO });
    await NfseService.issue({ data: PAYLOAD_BASE, log });
    const xml = xmlEnviado();
    expect(xml).not.toContain("<tribFed>");
    expect(xml).not.toContain("<piscofins>");
    expect(xml).not.toContain("<CST>");
    // E o que o não optante DEVE declarar continua saindo.
    expect(xml).toContain("<pTotTribFed>11.33</pTotTribFed>");
  });

  it("Simples também não leva — comportamento de sempre, agora pelo mesmo caminho", async () => {
    montarCenario({ cadastroFiscal: { regime: "SIMPLES_NACIONAL" } });
    await NfseService.issue({ data: PAYLOAD_BASE, log });
    expect(xmlEnviado()).not.toContain("<tribFed>");
  });

  it("informado, sai na ORDEM DO XSD — e só o que foi informado", async () => {
    montarCenario({ empresa: CARGA, cadastroFiscal: PRESUMIDO });
    await NfseService.issue({
      data: {
        ...PAYLOAD_BASE,
        servico: { ...PAYLOAD_BASE.servico, valorServicos: 1000 },
        tribFed: {
          piscofins: {
            CST: "01",
            vBCPisCofins: 1000,
            pAliqPis: 0.65,
            pAliqCofins: 3,
            vPis: 6.5,
            vCofins: 30,
            tpRetPisCofins: "2",
          },
        },
      },
      log,
    });
    const xml = xmlEnviado();
    const piscofins = xml.slice(xml.indexOf("<piscofins>"), xml.indexOf("</piscofins>"));
    const tags = [...piscofins.matchAll(/<([A-Za-z]+)>/g)].map((m) => m[1]).slice(1);
    // A ordem é a do `xs:sequence` de `TCTribOutrosPisCofins`, não a de digitação.
    expect(tags).toEqual([
      "CST",
      "vBCPisCofins",
      "pAliqPis",
      "pAliqCofins",
      "vPis",
      "vCofins",
      "tpRetPisCofins",
    ]);
    expect(piscofins).toContain("<vBCPisCofins>1000.00</vBCPisCofins>");
    expect(piscofins).toContain("<pAliqPis>0.65</pAliqPis>");
  });

  it("os seis opcionais ausentes NÃO viram 0.00", async () => {
    montarCenario({ empresa: CARGA, cadastroFiscal: PRESUMIDO });
    await NfseService.issue({
      data: { ...PAYLOAD_BASE, tribFed: { piscofins: { CST: "07" } } },
      log,
    });
    const xml = xmlEnviado();
    expect(xml).toContain("<CST>07</CST>");
    expect(xml).not.toContain("vBCPisCofins");
    expect(xml).not.toContain("tpRetPisCofins");
  });

  it("⚠⚠ RETENÇÃO DECLARADA RECUSA — nunca some em silêncio (RN E0724 exige vRetCSLL)", async () => {
    // O leiaute NÃO tem campo de base de retenção. O valor retido mora em vPis/vCofins e em
    // `tribFed/vRetCSLL` — que este gerador ainda não monta. Emitir assim declararia ao fisco e
    // ao tomador que NÃO houve retenção.
    montarCenario({ empresa: CARGA, cadastroFiscal: PRESUMIDO });
    const r = await NfseService.issue({
      data: {
        ...PAYLOAD_BASE,
        tribFed: { piscofins: { CST: "01", vPis: 0.65, vCofins: 3, tpRetPisCofins: "1" } },
      },
      log,
    });
    expect(r.status).toBe("falha_envio");
    expect(r.camada).toBe("NOSSA");
    expect(r.codigo).toBe("NFSE_PIS_COFINS_RETENCAO_NAO_SUPORTADA");
    expect(r.correcao).toMatch(/vRetCSLL/);
    // Nada saiu da máquina e o número não foi queimado.
    expect(postMock).not.toHaveBeenCalled();
  });

  it("tpRetPisCofins aceita 0 a 9, não só 1/2 — '0' e '2' são os que não exigem vRetCSLL", async () => {
    for (const valor of ["0", "2"]) {
      montarCenario({ empresa: CARGA, cadastroFiscal: PRESUMIDO });
      const r = await NfseService.issue({
        data: { ...PAYLOAD_BASE, tribFed: { piscofins: { CST: "01", tpRetPisCofins: valor } } },
        log,
      });
      expect(r.status).toBe("issued");
      expect(xmlEnviado()).toContain(`<tpRetPisCofins>${valor}</tpRetPisCofins>`);
    }
    // E os que exigem `vRetCSLL` recusam, todos pelo mesmo motivo.
    for (const valor of ["3", "4", "5", "6", "7", "8", "9"]) {
      montarCenario({ empresa: CARGA, cadastroFiscal: PRESUMIDO });
      const r = await NfseService.issue({
        data: { ...PAYLOAD_BASE, tribFed: { piscofins: { CST: "01", tpRetPisCofins: valor } } },
        log,
      });
      expect(r.codigo).toBe("NFSE_PIS_COFINS_RETENCAO_NAO_SUPORTADA");
    }
  });

  it("valor fora do enum de tpRetPisCofins recusa em vez de virar XML", async () => {
    montarCenario({ empresa: CARGA, cadastroFiscal: PRESUMIDO });
    const r = await NfseService.issue({
      data: { ...PAYLOAD_BASE, tribFed: { piscofins: { CST: "01", tpRetPisCofins: "12" } } },
      log,
    });
    expect(r.codigo).toBe("NFSE_PIS_COFINS_TP_RET_INVALIDO");
    expect(postMock).not.toHaveBeenCalled();
  });

  it("⚠ os nomes inventados, se enviados, são RECUSADOS NOMEANDO-OS", async () => {
    montarCenario({ empresa: CARGA, cadastroFiscal: PRESUMIDO });
    const r = await NfseService.issue({
      data: { ...PAYLOAD_BASE, tribFed: { piscofins: { CST: "01", vBcRetPisCofins: 500 } } },
      log,
    });
    expect(r.camada).toBe("NOSSA");
    expect(r.codigo).toBe("NFSE_PIS_COFINS_CAMPO_INEXISTENTE");
    expect(r.message).toContain("vBcRetPisCofins");
    expect(postMock).not.toHaveBeenCalled();
  });

  it("grupo sem CST recusa — CST é o único filho obrigatório, e '01' não se arbitra", async () => {
    montarCenario({ empresa: CARGA, cadastroFiscal: PRESUMIDO });
    const r = await NfseService.issue({
      data: { ...PAYLOAD_BASE, tribFed: { piscofins: { vBCPisCofins: 1 } } },
      log,
    });
    expect(r.codigo).toBe("NFSE_PIS_COFINS_SEM_CST");
  });

  it("⚠ a base agora segue a RN E0677 (<= valor do serviço), sobre o campo que EXISTE", async () => {
    // RN E0677, conferida NA CÉLULA do Anexo I (aba "RN DPS_NFS-e": CAMPO=`vBCPisCofins`,
    // CÓD. ERRO=`E0677`): "O valor da BC para Pis/Cofins deve ser menor ou igual ao valor do
    // serviço informado na DPS."
    // ⚠ A validação antiga (`INVALID_PIS_COFINS_RET_BASE`) exigia `>0 e <` sobre
    // `vBcRetPisCofins`, inexistente — a faixa era a do vRetCP/vRetIRRF (E0699/E0700), no campo
    // errado — e citava `E0680`, que não existe no Anexo I.
    montarCenario({ empresa: CARGA, cadastroFiscal: PRESUMIDO });
    const r = await NfseService.issue({
      data: {
        ...PAYLOAD_BASE,
        servico: { ...PAYLOAD_BASE.servico, valorServicos: 100 },
        tribFed: { piscofins: { CST: "01", vBCPisCofins: 100.01 } },
      },
      log,
    });
    expect(r.codigo).toBe("INVALID_PIS_COFINS_BC");

    // ⚠ IGUAL ao valor do serviço PASSA — a RN é `<=`, e o `<` estrito de antes recusaria a
    // base cheia, que é o caso normal.
    montarCenario({ empresa: CARGA, cadastroFiscal: PRESUMIDO });
    const ok = await NfseService.issue({
      data: {
        ...PAYLOAD_BASE,
        servico: { ...PAYLOAD_BASE.servico, valorServicos: 100 },
        tribFed: { piscofins: { CST: "01", vBCPisCofins: 100 } },
      },
      log,
    });
    expect(ok.status).toBe("issued");
  });
});
