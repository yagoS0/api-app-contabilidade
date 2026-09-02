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

function montarMocks({ flagLigada, perfil, ibscbsLigada = false, regimeDoCadastro = "SIMPLES_NACIONAL" }) {
  jest.doMock("../../../config.js", () => ({
    INTEGRACAO_PERFIL_EMISSAO_NFSE: flagLigada,
    INTEGRACAO_NFSE_IBSCBS: ibscbsLigada,
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
        // ⚠ A retenção federal é VEDADA no Simples, então o cenário dela exige outro regime.
      cadastroFiscal: { findUnique: jest.fn(async () => ({ regime: regimeDoCadastro })) },
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
async function emitirCom({ flagLigada, perfil, ibscbsLigada = false }) {
  const { xml } = await emitirDetalhado({ flagLigada, perfil, ibscbsLigada });
  return xml;
}

/**
 * Emite e devolve o XML **e** o desfecho.
 *
 * ⚠ As recusas de pré-voo NÃO lançam: `issue` devolve um objeto de falha. Medir a recusa pelo
 * `serviceInvoice.create` **não ter sido chamado** é o que prova que ela aconteceu ANTES de
 * reservar numeração — e não existe inutilização na NFS-e.
 */
async function emitirDetalhado({ flagLigada, perfil, ibscbsLigada = false }) {
  XML_ENVIADO.length = 0;
  jest.resetModules();
  montarMocks({ flagLigada, perfil, ibscbsLigada });
  const { NfseService } = await import("../NfseService.js");
  const { prisma } = await import("../../../infrastructure/db/prisma.js");
  const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const r = await NfseService.issue({ data: PAYLOAD, log });
  return { xml: XML_ENVIADO[0] || "", resultado: r, prisma };
}

/** O perfil derivado, mais o que o cenário quiser. */
const comPerfil = (extra) => ({ ...PERFIL_DERIVADO, ...extra });

/**
 * A ÚNICA combinação que o ANEXO VIII autoriza para o item **17.19** — que é o item embutido no
 * `cTribNac` 171901 desta suíte. ⚠ Não é valor inventado para o teste: sai da tabela gerada.
 */
const DO_ANEXO_VIII = { cIndOp: "100301", cClassTrib: "200052" };
/** Um NBS TERMINAL de verdade (9 dígitos depois de tirar os pontos). */
const NBS_TERMINAL = "1.1502.10.00";

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

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// O `cNBS` E O BLOCO `IBSCBS` (02/09/2026)
//
// ⚠⚠ AS DUAS METADES SE PROVAM DE MANEIRAS DIFERENTES, e é de propósito: o `cNBS` nasce desligado
// pelo **DADO** (a coluna do perfil é nula em todo mundo), e o bloco IBS/CBS nasce desligado por
// **FLAG** — porque ele é estrutural e traz a E0322 junto. Um perfil com os três campos de IBS/CBS
// preenchidos e a flag OFF não produz bloco nenhum: é o SERVIDOR que não escreve, não a tela que
// esconde. Há caso para isso abaixo.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe("⚠⚠ o `cNBS` — nasce desligado pelo DADO, não por flag", () => {
  it("perfil SEM `codigoNbs` não escreve a tag — e é o estado de 100% dos perfis hoje", async () => {
    const xml = await emitirCom({ flagLigada: true, perfil: PERFIL_DERIVADO });
    expect(xml).toMatch(/<xDescServ>/);
    expect(xml).not.toMatch(/cNBS/);
  });

  it("com `codigoNbs` terminal, sai com NOVE DÍGITOS e no lugar certo do `xs:sequence`", async () => {
    const xml = await emitirCom({
      flagLigada: true,
      perfil: comPerfil({ codigoNbs: NBS_TERMINAL }),
    });
    // ⚠ A coluna guarda a forma PONTUADA; a DPS leva os dígitos. A conversão é o contrato.
    expect(xml).toMatch(/<cNBS>115021000<\/cNBS>/);
    expect(xml).not.toMatch(/1\.1502\.10\.00/);
    // `TCCServ` é `cTribNac · cTribMun? · xDescServ · cNBS? · cIntContrib?` — ordem é contrato.
    expect(xml.indexOf("<cNBS>")).toBeGreaterThan(xml.indexOf("</xDescServ>"));
    expect(xml.indexOf("<cNBS>")).toBeLessThan(xml.indexOf("</cServ>"));
  });

  it("⚠⚠ código NÃO TERMINAL recusa ANTES de reservar numeração — e diz para onde ir", async () => {
    const { xml, resultado, prisma } = await emitirDetalhado({
      flagLigada: true,
      perfil: comPerfil({ codigoNbs: "1.0101" }),
    });
    expect(resultado.codigo).toBe("NFSE_NBS_NAO_TERMINAL");
    expect(xml).toBe("");
    // A prova de que a recusa foi no PRÉ-VOO: nenhum número foi reservado. Não existe
    // inutilização na NFS-e — número gasto à toa é buraco permanente na série.
    expect(prisma.serviceInvoice.create).not.toHaveBeenCalled();
    // ⚠ A recusa tem SAÍDA: ela nomeia os códigos mais específicos.
    expect(resultado.correcao).toMatch(/1\.0101\.11\.00/);
    // ⚠ E NÃO chama o código de "inválido" — ele é publicado, descrito e correto.
    expect(resultado.message).not.toMatch(/inválido|invalido/i);
  });
});

describe("⚠⚠ o bloco IBS/CBS — o SERVIDOR não escreve; não é a tela que esconde", () => {
  const ibscbsDoPerfil = (extra = {}) => ({
    ibscbsCIndOp: DO_ANEXO_VIII.cIndOp,
    ibscbsCst: "200",
    ibscbsCClassTrib: DO_ANEXO_VIII.cClassTrib,
    ...extra,
  });
  const PERFIL_IBSCBS = comPerfil({ codigoNbs: NBS_TERMINAL, ...ibscbsDoPerfil() });

  it("⚠⚠ flag DESLIGADA: perfil com os três campos preenchidos NÃO produz o bloco", async () => {
    const xml = await emitirCom({ flagLigada: true, ibscbsLigada: false, perfil: PERFIL_IBSCBS });
    expect(xml).toMatch(/<infDPS/);
    expect(xml).not.toMatch(/IBSCBS/);
    // ⚠ O `cNBS` continua saindo: ele é campo próprio, e não depende do IBS/CBS.
    expect(xml).toMatch(/<cNBS>115021000<\/cNBS>/);
  });

  it("flag LIGADA: o bloco sai com os cinco campos, na ordem do `xs:sequence`", async () => {
    const xml = await emitirCom({ flagLigada: true, ibscbsLigada: true, perfil: PERFIL_IBSCBS });
    expect(xml).toMatch(/<IBSCBS>/);
    expect(xml).toMatch(/<finNFSe>0<\/finNFSe>/);
    expect(xml).toMatch(/<cIndOp>100301<\/cIndOp>/);
    expect(xml).toMatch(/<indDest>0<\/indDest>/);
    expect(xml).toMatch(/<CST>200<\/CST>/);
    expect(xml).toMatch(/<cClassTrib>200052<\/cClassTrib>/);
    const ordem = ["<finNFSe>", "<cIndOp>", "<indDest>", "<CST>", "<cClassTrib>"]
      .map((t) => xml.indexOf(t));
    expect(ordem).toEqual([...ordem].sort((a, b) => a - b));
    // ⚠ `IBSCBS` é o ÚLTIMO filho de `TCInfDPS` — vem depois do grupo `valores`.
    expect(xml.indexOf("<IBSCBS>")).toBeGreaterThan(xml.indexOf("</valores>"));
    expect(xml.indexOf("<IBSCBS>")).toBeLessThan(xml.indexOf("</infDPS>"));
  });

  it("⚠⚠ `indDest` é 0 PORQUE o gerador nunca monta `dest` — e isso é varrido", async () => {
    // E0910: "O destinatário só deve ser identificado quando indDest for 1." Nosso `indDest` é
    // DERIVADO desse fato, não escolhido. Se alguém passar a montar `<dest>`, as duas coisas têm de
    // mudar juntas — e este caso cai antes.
    const xml = await emitirCom({ flagLigada: true, ibscbsLigada: true, perfil: PERFIL_IBSCBS });
    expect(xml).not.toMatch(/<dest>/);
    expect(xml).toMatch(/<indDest>0<\/indDest>/);
  });

  it("⚠⚠ E0322: IBS/CBS sem NBS recusa no pré-voo, citando a regra", async () => {
    const { resultado, prisma } = await emitirDetalhado({
      flagLigada: true,
      ibscbsLigada: true,
      perfil: comPerfil(ibscbsDoPerfil()), // sem `codigoNbs`
    });
    expect(resultado.codigo).toBe("NFSE_IBSCBS_SEM_NBS");
    expect(resultado.message).toMatch(/E0322/);
    expect(prisma.serviceInvoice.create).not.toHaveBeenCalled();
  });

  it("⚠⚠ combinação que o ANEXO VIII não autoriza recusa — e DIZ quais valem", async () => {
    const { resultado } = await emitirDetalhado({
      flagLigada: true,
      ibscbsLigada: true,
      perfil: comPerfil({
        codigoNbs: NBS_TERMINAL,
        ...ibscbsDoPerfil({ ibscbsCClassTrib: "000001" }),
      }),
    });
    expect(resultado.codigo).toBe("NFSE_IBSCBS_COMBINACAO_NAO_AUTORIZADA");
    // Recusa sem saída manda o contador adivinhar.
    expect(resultado.correcao).toMatch(/100301\/200052/);
  });

  it("meio bloco recusa — os três são obrigatórios no XSD", async () => {
    const { resultado } = await emitirDetalhado({
      flagLigada: true,
      ibscbsLigada: true,
      perfil: comPerfil({ codigoNbs: NBS_TERMINAL, ibscbsCIndOp: DO_ANEXO_VIII.cIndOp }),
    });
    expect(resultado.codigo).toBe("NFSE_IBSCBS_INCOMPLETO");
    expect(resultado.message).toMatch(/CST/);
  });

  it("⚠ perfil sem nenhum campo de IBS/CBS não recusa nada — só não escreve o bloco", async () => {
    const xml = await emitirCom({ flagLigada: true, ibscbsLigada: true, perfil: PERFIL_DERIVADO });
    expect(xml).toMatch(/<infDPS/);
    expect(xml).not.toMatch(/IBSCBS/);
  });
});

describe("⚠⚠ o bloco IBS/CBS conferido contra o XSD 1.01 — lido do arquivo", () => {
  // ⚠ Por que a conferência mora AQUI e não em `dpsContraXsd.test.js`: aquele oráculo lê a flag no
  // carregamento do módulo, e este arquivo é o único com o harness que a liga (registry resetado +
  // `import()` novo por cenário). Mover o oráculo inteiro para um helper compartilhado é
  // refatoração à parte — nomeada, não feita. O que se faz aqui é o recorte que importa: a ORDEM e
  // a OBRIGATORIEDADE dos filhos dos dois `complexType` que o bloco novo usa, tiradas do arquivo
  // oficial, nunca de memória.
  const fs = require("node:fs");
  const path = require("node:path");

  function schema1_01() {
    let dir = __dirname;
    while (dir !== path.dirname(dir)) {
      const t = path.join(dir, "docs/leiaute-nfse/documentacao-tecnica/esquemas-xsd/Schemas/1.01");
      if (fs.existsSync(t)) return fs.readFileSync(path.join(t, "tiposComplexos_v1.01.xsd"), "utf-8");
      dir = path.dirname(dir);
    }
    throw new Error("XSD 1.01 não encontrado");
  }

  /** Os filhos de um `complexType`, na ordem do `xs:sequence`, com a obrigatoriedade. */
  function filhosDe(xsd, tipo) {
    const bloco = new RegExp(`<xs:complexType name="${tipo}">[\\s\\S]*?\\n  </xs:complexType>`).exec(xsd);
    return [...bloco[0].matchAll(/<xs:element name="(\w+)"([^>]*)/g)].map((m) => ({
      nome: m[1],
      obrigatorio: !/minOccurs="0"/.test(m[2]),
    }));
  }

  it("os filhos que escrevemos existem, são obrigatórios e saem NA ORDEM do `xs:sequence`", async () => {
    const xml = await emitirCom({
      flagLigada: true,
      ibscbsLigada: true,
      perfil: comPerfil({
        codigoNbs: NBS_TERMINAL,
        ibscbsCIndOp: DO_ANEXO_VIII.cIndOp,
        ibscbsCst: "200",
        ibscbsCClassTrib: DO_ANEXO_VIII.cClassTrib,
      }),
    });
    const xsd = schema1_01();

    // ── `TCRTCInfoIBSCBS` — o grupo `IBSCBS` de `infDPS` ────────────────────────────────────
    const doGrupo = filhosDe(xsd, "TCRTCInfoIBSCBS");
    const obrigatorios = doGrupo.filter((f) => f.obrigatorio).map((f) => f.nome);
    // ⚠ Se o leiaute passar a exigir um filho novo, este caso cai — e é assim que se descobre,
    // em vez de por rejeição do sistema nacional.
    expect(obrigatorios).toEqual(["finNFSe", "cIndOp", "indDest", "valores"]);
    for (const nome of obrigatorios) {
      if (nome === "valores") continue; // conferido pelo subtipo, abaixo
      expect(xml).toMatch(new RegExp(`<${nome}>`));
    }
    // A ordem no documento tem de ser a mesma do `xs:sequence`.
    const posGrupo = ["finNFSe", "cIndOp", "indDest"].map((n) => xml.indexOf(`<${n}>`));
    expect(posGrupo).toEqual([...posGrupo].sort((a, b) => a - b));
    // ⚠ E nada que o gerador não escreve pode ter aparecido: `dest` é o caso que sustenta
    // `indDest = 0` (E0910).
    expect(xml).not.toMatch(/<dest>/);

    // ── `TCRTCInfoTributosSitClas` — o `gIBSCBS` ────────────────────────────────────────────
    const doSitClas = filhosDe(xsd, "TCRTCInfoTributosSitClas");
    expect(doSitClas.filter((f) => f.obrigatorio).map((f) => f.nome)).toEqual(["CST", "cClassTrib"]);
    expect(xml.indexOf("<CST>")).toBeLessThan(xml.indexOf("<cClassTrib>"));

    // ── O caminho completo, elo a elo ───────────────────────────────────────────────────────
    // `IBSCBS > valores > trib > gIBSCBS > CST` — se algum elo faltar, o documento é recusado por
    // schema, e um `toContain` de tag solta não perceberia.
    expect(xml).toMatch(
      /<IBSCBS>[\s\S]*<valores>[\s\S]*<trib>[\s\S]*<gIBSCBS>[\s\S]*<CST>[\s\S]*<cClassTrib>/,
    );
  });

  it("⚠ `finNFSe` só tem UM valor no XSD, e é o que escrevemos", async () => {
    // `TSRTCFinNFSe` enumera apenas "0" (NFS-e regular). Não é escolha nossa — e se a Receita
    // acrescentar valores, este caso cai e alguém decide.
    let dir = __dirname;
    while (dir !== path.dirname(dir)) {
      const t = path.join(dir, "docs/leiaute-nfse/documentacao-tecnica/esquemas-xsd/Schemas/1.01");
      if (fs.existsSync(t)) { dir = t; break; }
      dir = path.dirname(dir);
    }
    const simples = fs.readFileSync(path.join(dir, "tiposSimples_v1.01.xsd"), "utf-8");
    const bloco = /<xs:simpleType name="TSRTCFinNFSe">[\s\S]*?<\/xs:simpleType>/.exec(simples)[0];
    const valores = [...bloco.matchAll(/<xs:enumeration value="([^"]*)"/g)].map((m) => m[1]);
    expect(valores).toEqual(["0"]);
  });
});

describe("⚠⚠ as recusas novas são da camada NOSSA — e isso já esteve errado", () => {
  it("recusa de NBS/IBS-CBS diz que o número é reutilizável, não que o desfecho é desconhecido", async () => {
    // ⚠⚠ DEFEITO REAL, ACHADO POR ESTE TESTE: os códigos novos não estavam em `CODIGOS_NOSSOS`
    // (`desfechoEmissao.js`), então caíam no ramo do TRANSPORTE. O `codigo` chegava certo e a
    // `correcao` dizia *"não se sabe se a DPS chegou a ser processada; NÃO reemita"* — mandando o
    // contador procurar no sistema nacional uma nota que nunca saiu da máquina, e marcando
    // `numeroReutilizavel: false`. É a orientação exatamente invertida.
    const { resultado } = await emitirDetalhado({
      flagLigada: true,
      perfil: comPerfil({ codigoNbs: "1.0101" }),
    });
    expect(resultado.camada).toBe("NOSSA");
    expect(resultado.numeroReutilizavel).toBe(true);
    expect(resultado.correcao).not.toMatch(/não se sabe|NÃO reemita/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// A ALÍQUOTA DO ISSQN (`tribMun/pAliq`) — 02/09/2026
//
// ⚠⚠ ELA ERA COLETADA, VALIDADA E JOGADA FORA. O serviço exigia alíquota quando havia retenção
// (`NFSE_ISS_RETIDO_SEM_ALIQUOTA`), gravava em `ServiceInvoice.aliquota` — e `tribMun` escrevia só
// `tribISSQN` e `tpRetISSQN`. O número nunca chegou à DPS.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe("⚠⚠ o `pAliq` — sai só onde a norma PROVA", () => {
  const RETIDO = { ...PAYLOAD, servico: { ...PAYLOAD.servico, issRetido: true } };

  async function emitirRetido({ perfil, ibscbsLigada = false }) {
    XML_ENVIADO.length = 0;
    jest.resetModules();
    montarMocks({ flagLigada: true, perfil, ibscbsLigada });
    const { NfseService } = await import("../NfseService.js");
    const { prisma } = await import("../../../infrastructure/db/prisma.js");
    const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const r = await NfseService.issue({ data: RETIDO, log });
    return { xml: XML_ENVIADO[0] || "", resultado: r, prisma };
  }

  it("Simples + apuração pelo SN + ISS retido ⇒ a alíquota do PERFIL vai ao XML", async () => {
    const { xml } = await emitirRetido({ perfil: comPerfil({ pAliq: "3.5" }) });
    expect(xml).toMatch(/<pAliq>3\.50<\/pAliq>/);
    // ⚠ NO 1.01 O `pAliq` É O ÚLTIMO FILHO de `TCTribMunicipal` — no 1.00 ele vinha ANTES do
    // `tpRetISSQN`. Escrever a ordem de uma versão num documento que declara a outra é a classe do
    // E1235, e é por isso que a subida de versão teve de vir primeiro.
    expect(xml.indexOf("<pAliq>")).toBeGreaterThan(xml.indexOf("<tpRetISSQN>"));
    expect(xml.indexOf("<pAliq>")).toBeLessThan(xml.indexOf("</tribMun>"));
  });

  it("⚠⚠ SEM retenção o campo NÃO sai — mesmo com a alíquota declarada no perfil", async () => {
    // E0625/E0631: informar a alíquota aqui é REJEIÇÃO. Ter a coluna preenchida não quer dizer que
    // ela vai à nota — e é por isso que o perfil não decide sozinho.
    const xml = await emitirCom({ flagLigada: true, perfil: comPerfil({ pAliq: "3.5" }) });
    expect(xml).toMatch(/<tpRetISSQN>1<\/tpRetISSQN>/);
    expect(xml).not.toMatch(/pAliq/);
  });

  it("⚠⚠ com retenção e SEM alíquota no perfil, recusa ANTES de reservar numeração", async () => {
    const { xml, resultado, prisma } = await emitirRetido({ perfil: PERFIL_DERIVADO });
    expect(resultado.codigo).toBe("NFSE_PALIQ_OBRIGATORIA_AUSENTE");
    expect(resultado.camada).toBe("NOSSA");
    expect(xml).toBe("");
    expect(prisma.serviceInvoice.create).not.toHaveBeenCalled();
    // ⚠ A correção nomeia QUEM declara — a alíquota é da empresa, não da nota.
    expect(resultado.correcao).toMatch(/contador/i);
  });

  it("⚠ abaixo de 1,8% recusa, citando o mínimo da própria regra", async () => {
    const { resultado } = await emitirRetido({ perfil: comPerfil({ pAliq: "1.5" }) });
    expect(resultado.codigo).toBe("NFSE_PALIQ_ABAIXO_DO_MINIMO");
  });

  it("⚠⚠ o PERFIL vence o payload — o número é do contador, a caixa é do cliente", async () => {
    // Decisão do dono, 01/09/2026. Se o payload vencesse, um valor preso no formulário do cliente
    // sobrescreveria em silêncio a correção do contador — a mesma razão de `pTotTribFed/Est/Mun`
    // nunca viajarem.
    XML_ENVIADO.length = 0;
    jest.resetModules();
    montarMocks({ flagLigada: true, perfil: comPerfil({ pAliq: "4.00" }) });
    const { NfseService } = await import("../NfseService.js");
    const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    await NfseService.issue({
      data: { ...RETIDO, servico: { ...RETIDO.servico, aliquota: 2 } },
      log,
    });
    expect(XML_ENVIADO[0]).toMatch(/<pAliq>4\.00<\/pAliq>/);
    expect(XML_ENVIADO[0]).not.toMatch(/<pAliq>2\.00<\/pAliq>/);
  });

  it("⚠⚠ com apuração FORA do Simples Nacional o campo NÃO sai — e não recusa", async () => {
    // `regApTribSN` 2 ou 3: E0635 proíbe se o convênio do município estiver ativo e E0640 exige se
    // não estiver. O status do convênio não está neste projeto, então o comportamento é o de hoje
    // — sem alíquota — e o risco fica NOMEADO na regra, nunca resolvido por chute.
    const { xml, resultado } = await emitirRetido({
      perfil: comPerfil({ regApTribSN: "2", pAliq: "3.5" }),
    });
    expect(resultado.status).toBe("issued");
    expect(xml).toMatch(/<regApTribSN>2<\/regApTribSN>/);
    expect(xml).not.toMatch(/pAliq/);
  });

  it("⚠ sem perfil, nada muda — nem a recusa, nem a tag", async () => {
    // O estado de 100% das empresas hoje. Sem perfil, a alíquota vem do payload e o caminho é o de
    // sempre: o `pAliq` não sai (Simples sem perfil ⇒ `regApTribSN = 1`, e com retenção a regra
    // exigiria o campo — por isso a recusa acontece, e é a MESMA do caso acima).
    const { resultado } = await emitirRetido({ perfil: null });
    expect(resultado.codigo).toBe("NFSE_PALIQ_OBRIGATORIA_AUSENTE");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// A RETENÇÃO FEDERAL (`trib/tribFed`) — 02/09/2026
//
// ⚠⚠ ESTE GRUPO ERA `return ""` EM 100% DAS EMISSÕES, e toda retenção declarada era RECUSADA
// (`NFSE_PIS_COFINS_RETENCAO_NAO_SUPORTADA`), porque o gerador não montava o `vRetCSLL` que a RN
// E0724 exige. Agora ele monta — e a recusa passou a fazer a pergunta da própria regra.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe("⚠⚠ o `tribFed` — três condições, e só uma é do perfil", () => {
  // ⚠ O tomador é PJ (a retenção do art. 30 só existe PJ → PJ) e a carga tributária dos TRÊS
  // percentuais está preenchida: fora do Simples o gerador a EXIGE (`MISSING_TOT_TRIB_NAO_SIMPLES`),
  // e sem ela a emissão morre antes do POST — o XML sairia vazio e as asserções sobre ele passariam
  // comparando "" com "". Foi o que aconteceu na primeira versão destes casos.
  const PJ = {
    ...PAYLOAD,
    // ⚠ `doc` é o campo do payload VALIDADO, que é o que `buildDpsXml` lê. O `cnpjCpf` é a
    // forma de entrada, normalizada por `validateNfsePayload` — e esta suíte chama `issue`
    // direto, sem passar pela porta.
    tomador: { ...PAYLOAD.tomador, cnpjCpf: "39254243000191", doc: "39254243000191", nome: "TOMADOR LTDA" },
    totTrib: { pTotTribSN: 6, pTotTribFed: 11.33, pTotTribEst: 0, pTotTribMun: 0 },
    // ⚠⚠ R$ 1.000, e NÃO os R$ 100 do payload base: 4,65% de 100 é **R$ 4,65**, que a Lei
    // 10.833/2003, art. 31, § 3º DISPENSA (piso de R$ 10,00). A primeira versão deste cenário caiu
    // exatamente nisso — e a regra estava certa: era o teste que pedia retenção num valor
    // dispensado. ⚠ O piso é sobre o VALOR RETIDO, não sobre o valor da nota.
    servico: { ...PAYLOAD.servico, valorServicos: 1000 },
  };
  const COM_RETENCAO = { retencaoFederalArt30: true, cstPisCofins: "01" };

  async function emitirPJ({ perfil, data = PJ }) {
    XML_ENVIADO.length = 0;
    jest.resetModules();
    montarMocks({ flagLigada: true, perfil });
    const { NfseService } = await import("../NfseService.js");
    const { prisma } = await import("../../../infrastructure/db/prisma.js");
    const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const r = await NfseService.issue({ data, log });
    return { xml: XML_ENVIADO[0] || "", resultado: r, prisma };
  }

  it("⚠ sem a declaração do contador, o grupo NÃO sai — é o estado de todo perfil hoje", async () => {
    const { xml } = await emitirPJ({ perfil: PERFIL_DERIVADO });
    expect(xml).toMatch(/<infDPS/);
    expect(xml).not.toMatch(/tribFed/);
  });

  it("⚠⚠ no SIMPLES é VEDADA por lei — e a nota sai CERTA sem o grupo", async () => {
    // A empresa desta suíte é do Simples (`cadastroFiscal` mocado). Declarar o serviço do art. 30
    // no perfil não faz a retenção aparecer: Lei 10.833/2003, art. 32, III. ⚠ Não é recusa — a
    // nota sem retenção é a nota correta, e o que seria errado é sair COM ela.
    const { xml, resultado } = await emitirPJ({ perfil: comPerfil(COM_RETENCAO) });
    expect(resultado.status).toBe("issued");
    expect(xml).not.toMatch(/tribFed/);
  });

  it("⚠⚠ fora do Simples e com tomador PJ, o grupo sai com as alíquotas do art. 31", async () => {
    XML_ENVIADO.length = 0;
    jest.resetModules();
    montarMocks({ flagLigada: true, perfil: comPerfil(COM_RETENCAO), regimeDoCadastro: "LUCRO_PRESUMIDO" });
    const { NfseService } = await import("../NfseService.js");
    const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    await NfseService.issue({ data: PJ, log });
    const xml = XML_ENVIADO[0] || "";

    expect(xml).toMatch(/<tribFed>/);
    expect(xml).toMatch(/<CST>01<\/CST>/);
    expect(xml).toMatch(/<pAliqPis>0\.65<\/pAliqPis>/);
    expect(xml).toMatch(/<pAliqCofins>3\.00<\/pAliqCofins>/);
    // ⚠⚠ `tpRetPisCofins = 3` (PIS/COFINS/CSLL Retidos) — a única posição que os 4,65% do art. 31
    // são. As parciais (5 = só PIS, 6 = só COFINS…) não têm fonte neste projeto.
    expect(xml).toMatch(/<tpRetPisCofins>3<\/tpRetPisCofins>/);
    // ⚠⚠ E o `vRetCSLL`, que a RN E0724 torna OBRIGATÓRIO — era a AUSÊNCIA dele que fazia o
    // gerador recusar toda retenção declarada.
    expect(xml).toMatch(/<vRetCSLL>10\.00<\/vRetCSLL>/); // 1% de 1.000
    expect(xml).toMatch(/<vPis>6\.50<\/vPis>/);
    expect(xml).toMatch(/<vCofins>30\.00<\/vCofins>/);
    expect(xml).toMatch(/<vBCPisCofins>1000\.00<\/vBCPisCofins>/);
    // ⚠ A ordem de `TCTribFederal` é `piscofins? · vRetCP? · vRetIRRF? · vRetCSLL?`.
    expect(xml.indexOf("<vRetCSLL>")).toBeGreaterThan(xml.indexOf("</piscofins>"));
  });

  it("⚠⚠ `vRetIRRF` e `vRetCP` NÃO saem — não há alíquota versionada para nenhum dos dois", async () => {
    XML_ENVIADO.length = 0;
    jest.resetModules();
    montarMocks({ flagLigada: true, perfil: comPerfil(COM_RETENCAO), regimeDoCadastro: "LUCRO_PRESUMIDO" });
    const { NfseService } = await import("../NfseService.js");
    await NfseService.issue({ data: PJ, log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } });
    expect(XML_ENVIADO[0]).toMatch(/<tribFed>/);
    expect(XML_ENVIADO[0]).not.toMatch(/vRetIRRF|vRetCP/);
  });

  it("⚠ tomador PESSOA FÍSICA não retém — nem fora do Simples", async () => {
    XML_ENVIADO.length = 0;
    jest.resetModules();
    montarMocks({ flagLigada: true, perfil: comPerfil(COM_RETENCAO), regimeDoCadastro: "LUCRO_PRESUMIDO" });
    const { NfseService } = await import("../NfseService.js");
    await NfseService.issue({
      data: { ...PJ, tomador: { ...PJ.tomador, cnpjCpf: "12219079724", doc: "12219079724", nome: "Fulano" } },
      log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    });
    expect(XML_ENVIADO[0]).toMatch(/<infDPS/);
    expect(XML_ENVIADO[0]).not.toMatch(/tribFed/);
  });

  it("⚠⚠ declarou retenção e não declarou CST: RECUSA antes de reservar numeração", async () => {
    XML_ENVIADO.length = 0;
    jest.resetModules();
    montarMocks({
      flagLigada: true,
      perfil: comPerfil({ retencaoFederalArt30: true }),
      regimeDoCadastro: "LUCRO_PRESUMIDO",
    });
    const { NfseService } = await import("../NfseService.js");
    const { prisma } = await import("../../../infrastructure/db/prisma.js");
    const r = await NfseService.issue({
      data: PJ, log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    });
    expect(r.codigo).toBe("NFSE_RETENCAO_FEDERAL_SEM_CST");
    expect(r.camada).toBe("NOSSA");
    expect(prisma.serviceInvoice.create).not.toHaveBeenCalled();
  });
});
