// O PERFIL DE EMISSÃO CHEGANDO AO XML — e a prova de que ligar a flag não mexe em quem não configurou.
//
// ⚠⚠ O CASO QUE AUTORIZA A FASE É O PRIMEIRO: **perfil derivado do cadastro + flag LIGADA produz XML
// BYTE-IDÊNTICO ao da flag desligada.** Se ele falhar, ou o resolvedor está errado, ou uma decisão
// fiscal foi tomada sem ninguém dizer — e a diferença apareceria como nota fiscal diferente em
// produção, sem nada na tela denunciando.
//
// ⚠ A flag é lida no CARREGAMENTO do módulo, então cada cenário roda com o registry do Jest
// resetado e um `import()` novo. Sem isso o segundo cenário leria a flag do primeiro e o teste
// passaria por engano.

const XML_ENVIADO = [];

function montarMocks({ flagLigada, perfil }) {
  jest.doMock("../../../config.js", () => ({
    INTEGRACAO_PERFIL_EMISSAO_NFSE: flagLigada,
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

  jest.doMock("../perfilEmissao/resolverPerfilDeEmissao.js", () => ({
    resolverPerfilDeEmissao: jest.fn(async () => ({
      temPerfil: Boolean(perfil),
      perfil: perfil || null,
      perfisAtivos: perfil ? 1 : 0,
      campos: {},
      avisos: [],
    })),
  }));

  jest.doMock("xml-crypto", () => ({
    SignedXml: class {
      addReference() {}
      computeSignature(xml) { this._xml = xml; }
      getSignedXml() { return this._xml; }
    },
  }));

  jest.doMock("../nfseCertificado.js", () => ({
    // ⚠ A FORMA É A DO SERVIÇO, e ela é `pfxBuffer`/`password` — não `pfx`/`passphrase`. Com as
    // chaves erradas o `buildAxiosClient` recusa e a emissão morre em `NO_COMPANY_CERT`, ANTES do
    // POST: o XML sai vazio e as comparações "byte-idêntico" passam comparando "" com "". Foi o
    // `expect(hoje).toBeTruthy()` do primeiro caso que denunciou — sem ele, cinco testes teriam
    // passado sobre nada.
    resolverCertificadosDaEmpresa: jest.fn(async () => ({
      assinatura: {
        pfxBuffer: Buffer.from("pfx"), password: "s",
        certPem: "PEM", keyPem: "KEY", certBase64: "B64",
      },
      transporte: { pfxBuffer: Buffer.from("pfx"), password: "s" },
    })),
  }));

  jest.doMock("axios", () => ({
    __esModule: true,
    default: {
      create: () => ({
        // ⚠ `defaults.baseURL` é lido pelo serviço; sem ele a emissão morre em
        // `TRANSPORTE_DESCONHECIDO` e o XML nunca sai. Mesma forma do `dpsContraXsd.test.js`.
        defaults: { baseURL: "https://sefin.producaorestrita.nfse.gov.br/SefinNacional" },
        post: jest.fn(async (_url, body) => {
          // ⚠ O XML sai do corpo REAL enviado — gzip+base64 —, não de um retorno de conveniência.
          // É o único jeito de a comparação ser sobre o que a Receita receberia.
          const { gunzipSync } = require("node:zlib");
          XML_ENVIADO.push(gunzipSync(Buffer.from(body.dpsXmlGZipB64, "base64")).toString("utf-8"));
          return { data: { status: "issued", chaveAcesso: "3".repeat(50), numeroNfse: "18" } };
        }),
        get: jest.fn(async () => ({ status: 200, data: {} })),
        head: jest.fn(async () => ({ status: 200 })),
      }),
    },
  }));

  const serviceInvoice = {
    create: jest.fn(async ({ data }) => ({ id: "inv-1", ...data })),
    update: jest.fn(async ({ data }) => ({ id: "inv-1", ...data })),
    findUnique: jest.fn(async () => null),
  };
  const tx = { serviceInvoice, $queryRaw: jest.fn(async () => [{ rpsNumero: "41" }]) };
  jest.doMock("../../../infrastructure/db/prisma.js", () => ({
    prisma: {
      company: { findUnique: jest.fn(async () => COMPANY) },
      portalClient: { findUnique: jest.fn(async () => ({ id: "portal-1" })) },
      portalInvoice: { findMany: jest.fn(async () => []) },
      cadastroFiscal: { findUnique: jest.fn(async () => ({ regime: "SIMPLES_NACIONAL" })) },
      tomadorEmitido: { findUnique: jest.fn(async () => null), create: jest.fn(), update: jest.fn() },
      serviceInvoice,
      $transaction: jest.fn(async (cb) => cb(tx)),
    },
  }));
}

const COMPANY = {
  id: "co-1",
  cnpj: "39254243000191",
  inscricaoMunicipal: "12345",
  codigoMunicipioIbge: "3304557",
  codigoServicoNacional: "171901",
  codigosServicoNacional: [],
  codigoServicoMunicipal: "001",
  rpsSerie: "1",
  regimeTributario: "SIMPLES",
  regimeEspecialTributacao: null,
};

const PAYLOAD = {
  companyId: "co-1",
  // ⚠ O endereço é TUDO-OU-NADA e o serviço o exige: sem ele a emissão para em
  // `MISSING_TOMADOR_ADDRESS`, antes do POST, e o XML sai vazio.
  tomador: {
    cnpjCpf: "12219079724",
    nome: "Fulano",
    endereco: { cMun: "3304557", CEP: "20000000", xLgr: "Rua A", nro: "1", xBairro: "Centro" },
  },
  servico: { descricao: "serviços contábeis", valorServicos: 100, issRetido: false },
  competencia: "2026-01-23",
  totTrib: { pTotTribSN: 6 },
};

/** O perfil que o botão "Criar a partir do cadastro" produz — os mesmos valores que já saem hoje. */
const PERFIL_DERIVADO = {
  id: "pf-1",
  nome: "Derivado",
  codigoServicoNacional: "171901",
  codigoServicoMunicipal: "001",
  cLocPrestacao: null,
  regEspTrib: "0",
  regApTribSN: "1",
  tribISSQN: "1",
};

/** Emite uma vez, num registry limpo, e devolve o XML que foi enviado. */
async function emitirCom({ flagLigada, perfil }) {
  XML_ENVIADO.length = 0;
  jest.resetModules();
  montarMocks({ flagLigada, perfil });
  const { NfseService } = await import("../NfseService.js");
  const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  await NfseService.issue({ data: PAYLOAD, log });
  return XML_ENVIADO[0] || "";
}

/** O XML sem o que muda a cada emissão por natureza (data/hora e assinatura). */
function semOVolatil(xml) {
  return String(xml).replace(/<dhEmi>[^<]*<\/dhEmi>/g, "<dhEmi>FIXO</dhEmi>");
}

afterEach(() => jest.resetModules());

// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe("⚠⚠ A PROVA DE ACEITE DA FASE: ligar a flag não mexe em quem não mudou nada", () => {
  it("perfil DERIVADO do cadastro + flag ligada ⇒ XML byte-idêntico ao de hoje", async () => {
    const hoje = await emitirCom({ flagLigada: false, perfil: null });
    const comPerfil = await emitirCom({ flagLigada: true, perfil: PERFIL_DERIVADO });

    expect(hoje).toBeTruthy();
    expect(semOVolatil(comPerfil)).toBe(semOVolatil(hoje));
  });

  it("⚠ a flag LIGADA e SEM perfil também não muda nada", async () => {
    // O caso de 33 das 34 empresas no dia em que a flag for ligada: ninguém configurou perfil, e
    // nada pode mudar para elas.
    const hoje = await emitirCom({ flagLigada: false, perfil: null });
    const semPerfil = await emitirCom({ flagLigada: true, perfil: null });
    expect(semOVolatil(semPerfil)).toBe(semOVolatil(hoje));
  });

  it("⚠⚠ com a flag DESLIGADA, um perfil que mudaria tudo é IGNORADO", async () => {
    // A trava da flag. Se o perfil vazasse com ela desligada, a fase 1 teria mudado documento
    // fiscal em produção sem ninguém decidir.
    const hoje = await emitirCom({ flagLigada: false, perfil: null });
    const comPerfilIgnorado = await emitirCom({
      flagLigada: false,
      perfil: { ...PERFIL_DERIVADO, tribISSQN: "3", regApTribSN: "2", regEspTrib: "5" },
    });
    expect(semOVolatil(comPerfilIgnorado)).toBe(semOVolatil(hoje));
  });
});

describe("⚠ e com a flag ligada, o perfil MANDA — nos dois campos que eram constante", () => {
  it("`tribISSQN` deixa de ser cravado — a exportação passa a ser declarável", async () => {
    const xml = await emitirCom({ flagLigada: true, perfil: { ...PERFIL_DERIVADO, tribISSQN: "3" } });
    expect(xml).toContain("<tribISSQN>3</tribISSQN>");
    expect(xml).not.toContain("<tribISSQN>1</tribISSQN>");
  });

  it("⚠⚠ `regApTribSN` deixa de ser cravado — o caso do sublimite passa a ser declarável", async () => {
    const xml = await emitirCom({ flagLigada: true, perfil: { ...PERFIL_DERIVADO, regApTribSN: "2" } });
    expect(xml).toContain("<regApTribSN>2</regApTribSN>");
  });

  it("`regEspTrib` vem do perfil, e não do cadastro", async () => {
    const xml = await emitirCom({ flagLigada: true, perfil: { ...PERFIL_DERIVADO, regEspTrib: "5" } });
    expect(xml).toContain("<regEspTrib>5</regEspTrib>");
  });

  it("`cLocPrestacao` do perfil vence a queda para o município do emissor", async () => {
    const xml = await emitirCom({ flagLigada: true, perfil: { ...PERFIL_DERIVADO, cLocPrestacao: "3550308" } });
    expect(xml).toContain("<cLocPrestacao>3550308</cLocPrestacao>");
  });

  it("`cTribMun` do perfil vence o do cadastro", async () => {
    const xml = await emitirCom({ flagLigada: true, perfil: { ...PERFIL_DERIVADO, codigoServicoMunicipal: "007" } });
    expect(xml).toContain("<cTribMun>007</cTribMun>");
  });
});

describe("⚠⚠ campo NULO no perfil NÃO apaga o cadastro", () => {
  it("perfil com tudo nulo produz o mesmo XML de hoje", async () => {
    // `{...cadastro, ...perfil}` faria o campo em branco APAGAR o que a empresa já emite. É o
    // defeito do `{...cadastro, ...doCompany}` do GET /cadastro-fiscal, e aqui ele sairia numa
    // nota fiscal.
    const hoje = await emitirCom({ flagLigada: false, perfil: null });
    const nulos = await emitirCom({
      flagLigada: true,
      perfil: {
        id: "pf-2", nome: "Vazio",
        codigoServicoNacional: "171901",
        codigoServicoMunicipal: null, cLocPrestacao: null,
        regEspTrib: null, regApTribSN: null, tribISSQN: null,
      },
    });
    expect(semOVolatil(nulos)).toBe(semOVolatil(hoje));
  });

  it("⚠ string VAZIA conta como não respondido, igual a `null`", async () => {
    const hoje = await emitirCom({ flagLigada: false, perfil: null });
    const vazios = await emitirCom({
      flagLigada: true,
      perfil: {
        id: "pf-3", nome: "Vazio",
        codigoServicoNacional: "171901",
        codigoServicoMunicipal: "  ", cLocPrestacao: "",
        regEspTrib: "", regApTribSN: "  ", tribISSQN: "",
      },
    });
    expect(semOVolatil(vazios)).toBe(semOVolatil(hoje));
  });
});

describe("⚠⚠ o cadastro continua sendo a AUTORIDADE do código de serviço", () => {
  it("perfil com código fora da lista habilitada é RECUSADO antes de reservar numeração", async () => {
    XML_ENVIADO.length = 0;
    jest.resetModules();
    montarMocks({
      flagLigada: true,
      perfil: { ...PERFIL_DERIVADO, codigoServicoNacional: "999999" },
    });
    const { prisma } = await import("../../../infrastructure/db/prisma.js");
    prisma.company.findUnique.mockResolvedValue({ ...COMPANY, codigosServicoNacional: ["171901"] });

    const { NfseService } = await import("../NfseService.js");
    const r = await NfseService.issue({ data: PAYLOAD, log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } });

    expect(r.status).not.toBe("issued");
    // ⚠ Nada saiu para a Receita, e nenhum número foi queimado — não existe inutilização na NFS-e.
    expect(XML_ENVIADO).toHaveLength(0);
    expect(prisma.serviceInvoice.create).not.toHaveBeenCalled();
  });
});
