// O XML DA DPS É CONFERIDO CONTRA O XSD OFICIAL — não contra a nossa lembrança dele.
//
// ⚠⚠ POR QUE ESTE ARQUIVO EXISTE. Em 21/08/2026 três notas fiscais REAIS foram recusadas em
// PRODUÇÃO (ambiente 1) com:
//
//     E1235 - Falha no esquema XML do DF-e.
//     The element 'piscofins' in namespace 'http://www.sped.fazenda.gov.br/nfse'
//     has invalid child element 'vBcRetPisCofins' in namespace '...'
//
// `buildDpsXml` escrevia dois elementos INVENTADOS (`vBcRetPisCofins` e `vRetPisCofins`) que não
// existem em lugar nenhum do leiaute. Nenhum teste pegou, porque todos os testes de emissão
// afirmam sobre TRECHOS de string (`expect(xml).toContain(...)`) — e um `toContain` só sabe olhar
// o que alguém lembrou de escrever. Um elemento a mais, ou fora de ordem, é invisível para ele.
//
// Aqui a pergunta é outra: **o XML inteiro cabe no esquema?** O XSD oficial versionado em
// `docs/leiaute-nfse/` é lido em tempo de teste e vira um verificador; toda tag que o gerador
// escrever passa a ter de existir, estar na ordem do `xs:sequence` e caber no tipo simples.
//
// ⚠ NÃO É UM VALIDADOR XSD COMPLETO, e a diferença importa para quem confiar nele. O que ele
// confere está listado em `O QUE ESTE VERIFICADOR CONFERE`, abaixo. O que ele NÃO confere:
// `xs:attribute`, `ds:Signature` (assinatura é do `xml-crypto`), `maxOccurs > 1`, e as Regras de
// Negócio (`E####`) do Anexo I, que não são schema. Uma nota pode passar aqui e ser recusada por
// RN — o que ele impede é a classe do E1235.
//
// ⚠ NADA AQUI EMITE COISA ALGUMA: `axios` é simulado, e nenhuma chamada sai da máquina.

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

jest.mock("../nfseCertificado.js", () => ({
  resolverCertificadosDaEmpresa: jest.fn(),
}));

jest.mock("../../../infrastructure/db/prisma.js", () => {
  const serviceInvoice = {
    create: jest.fn(async ({ data }) => ({ id: "inv-1", ...data })),
    update: jest.fn(async ({ data }) => ({ id: "inv-1", ...data })),
    findUnique: jest.fn(async () => null),
  };
  const tx = { serviceInvoice, $queryRaw: jest.fn(async () => [{ rpsNumero: "42" }]) };
  return {
    __tx: tx,
    prisma: {
      company: { findUnique: jest.fn() },
      portalClient: { findUnique: jest.fn(async () => ({ id: "portal-1" })) },
      portalInvoice: { findMany: jest.fn(async () => []) },
      cadastroFiscal: { findUnique: jest.fn(async () => null) },
      serviceInvoice,
      $transaction: jest.fn(async (cb) => cb(tx)),
    },
  };
});

import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { XMLParser } from "fast-xml-parser";
import axios from "axios";
import { prisma } from "../../../infrastructure/db/prisma.js";
import { resolverCertificadosDaEmpresa } from "../nfseCertificado.js";
import { NfseService } from "../NfseService.js";

// ─────────────────────────────────────────────────────────────────────────────────────────────
// O XSD OFICIAL
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// ⚠ O caminho é PROCURADO subindo a árvore, não montado a partir do CWD: a suíte roda ora da
// raiz do monorepo, ora de `apps/api`, e um caminho relativo ao CWD acharia o schema num caso e
// não no outro — fazendo o teste "passar" por não ter o que conferir. Não achar é ERRO ALTO.
const SUFIXO = path.join(
  "docs",
  "leiaute-nfse",
  "documentacao-tecnica",
  "esquemas-xsd",
  "Schemas",
  "1.01"
);
const SCHEMAS = (() => {
  let dir = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    const tentativa = path.join(dir, SUFIXO);
    if (fs.existsSync(path.join(tentativa, "tiposComplexos_v1.01.xsd"))) return tentativa;
    const pai = path.dirname(dir);
    if (pai === dir) break;
    dir = pai;
  }
  throw new Error(
    `XSD oficial não encontrado a partir de ${process.cwd()} (esperado .../${SUFIXO}). ` +
      "Sem o schema este teste não confere NADA — falhar aqui é melhor que passar vazio."
  );
})();

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  preserveOrder: true,
  trimValues: true,
  parseTagValue: false,
});

function lerXsd(arquivo) {
  return parser.parse(fs.readFileSync(path.join(SCHEMAS, arquivo), "utf-8"));
}

/** Nós de um array `preserveOrder` cujo nome (sem prefixo `xs:`) seja `nome`. */
function filhos(no, nome) {
  const lista = Array.isArray(no) ? no : [];
  return lista.filter((n) => Object.keys(n).some((k) => k.replace(/^xs:/, "") === nome));
}
function conteudo(no, nome) {
  const chave = Object.keys(no).find((k) => k.replace(/^xs:/, "") === nome);
  return chave ? no[chave] : null;
}
function attrs(no) {
  return no[":@"] || {};
}

/**
 * Lê um `xs:sequence` / `xs:choice` e devolve as PARTÍCULAS na ordem do documento.
 * Cada partícula é `{ tipo: "elemento", nome, xsdTipo, obrigatorio }` ou
 * `{ tipo: "escolha", opcoes: [<partículas>] }`.
 */
function lerParticulas(lista) {
  const out = [];
  for (const no of lista || []) {
    const nome = Object.keys(no).find((k) => k !== ":@");
    const local = String(nome || "").replace(/^xs:/, "");
    const a = attrs(no);
    if (local === "element") {
      // ⚠ `ref="ds:Signature"` fica FORA: a assinatura é do `xml-crypto`, não do gerador, e o
      // XML que este teste inspeciona é o de ANTES de assinar (o dublê devolve o xml intacto).
      if (a["@ref"]) continue;
      out.push({
        tipo: "elemento",
        nome: a["@name"],
        xsdTipo: a["@type"],
        obrigatorio: a["@minOccurs"] !== "0",
      });
    } else if (local === "choice") {
      out.push({
        tipo: "escolha",
        obrigatorio: a["@minOccurs"] !== "0",
        opcoes: lerParticulas(no[nome]),
      });
    } else if (local === "sequence") {
      out.push(...lerParticulas(no[nome]));
    }
  }
  return out;
}

function carregarEsquema() {
  const complexos = new Map();
  const simples = new Map();

  for (const arquivo of ["tiposComplexos_v1.01.xsd", "tiposSimples_v1.01.xsd"]) {
    const raiz = conteudo(lerXsd(arquivo).find((n) => conteudo(n, "schema")), "schema");

    for (const ct of filhos(raiz, "complexType")) {
      const nome = attrs(ct)["@name"];
      if (!nome) continue;
      const corpo = conteudo(ct, "complexType");
      const seq = filhos(corpo, "sequence");
      const cho = filhos(corpo, "choice");
      const particulas = seq.length
        ? lerParticulas(conteudo(seq[0], "sequence"))
        : cho.length
          ? [
              {
                tipo: "escolha",
                obrigatorio: attrs(cho[0])["@minOccurs"] !== "0",
                opcoes: lerParticulas(conteudo(cho[0], "choice")),
              },
            ]
          : [];
      complexos.set(nome, particulas);
    }

    for (const st of filhos(raiz, "simpleType")) {
      const nome = attrs(st)["@name"];
      if (!nome) continue;
      const restricao = filhos(conteudo(st, "simpleType"), "restriction")[0];
      if (!restricao) continue;
      const facetas = conteudo(restricao, "restriction");
      simples.set(nome, {
        base: attrs(restricao)["@base"],
        padroes: filhos(facetas, "pattern").map((n) => attrs(n)["@value"]),
        enumeracoes: filhos(facetas, "enumeration").map((n) => attrs(n)["@value"]),
        maxLength: filhos(facetas, "maxLength").map((n) => Number(attrs(n)["@value"]))[0],
        minLength: filhos(facetas, "minLength").map((n) => Number(attrs(n)["@value"]))[0],
      });
    }
  }
  return { complexos, simples };
}

const { complexos, simples } = carregarEsquema();

/** Achata a cadeia de `base` de um tipo simples (TSCEP → xs:string, TSLogradouro → TSString → …). */
function facetasDe(tipo) {
  const acc = { padroes: [], enumeracoes: [], maxLength: undefined, minLength: undefined };
  let atual = tipo;
  const visto = new Set();
  while (atual && simples.has(atual) && !visto.has(atual)) {
    visto.add(atual);
    const s = simples.get(atual);
    acc.padroes.push(...s.padroes);
    if (s.enumeracoes.length) acc.enumeracoes.push(...s.enumeracoes);
    if (acc.maxLength === undefined) acc.maxLength = s.maxLength;
    if (acc.minLength === undefined) acc.minLength = s.minLength;
    atual = s.base;
  }
  return acc;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// O QUE ESTE VERIFICADOR CONFERE
//
//   1. todo elemento escrito EXISTE no `complexType` do pai (foi isto que faltou no E1235);
//   2. a ORDEM dos irmãos é uma subsequência da ordem do `xs:sequence`;
//   3. todo filho `minOccurs != 0` está presente;
//   4. `xs:choice` recebe NO MÁXIMO uma opção (e ao menos uma, quando obrigatória);
//   5. o texto das folhas casa com `pattern` / `enumeration` / `maxLength` / `minLength` do tipo.
// ─────────────────────────────────────────────────────────────────────────────────────────────
function conferir(nos, tipoComplexo, caminho, erros) {
  const particulas = complexos.get(tipoComplexo);
  if (!particulas) {
    erros.push(`${caminho}: complexType '${tipoComplexo}' não existe no XSD`);
    return;
  }

  // Mapa nome → { particula, posicao, escolhaId }
  const permitido = new Map();
  particulas.forEach((p, i) => {
    if (p.tipo === "elemento") permitido.set(p.nome, { p, pos: i, escolha: null });
    else p.opcoes.forEach((o) => permitido.set(o.nome, { p: o, pos: i, escolha: i }));
  });

  const escritos = nos
    .map((n) => Object.keys(n).find((k) => k !== ":@"))
    .filter((k) => k && k !== "#text" && k !== "?xml");

  // (1) existência
  for (const nome of escritos) {
    if (!permitido.has(nome)) {
      erros.push(
        `${caminho}/${nome}: ⚠ ELEMENTO INEXISTENTE em '${tipoComplexo}'. ` +
          `Filhos aceitos, nesta ordem: ${[...permitido.keys()].join(" · ")}`
      );
    }
  }

  // (2) ordem
  let ultima = -1;
  for (const nome of escritos) {
    const info = permitido.get(nome);
    if (!info) continue;
    if (info.pos < ultima) {
      erros.push(
        `${caminho}/${nome}: fora da ordem do xs:sequence de '${tipoComplexo}' ` +
          `(esperada: ${[...permitido.keys()].join(" · ")})`
      );
      break;
    }
    ultima = info.pos;
  }

  // (3) obrigatórios e (4) escolhas
  const presentes = new Set(escritos);
  particulas.forEach((p, i) => {
    if (p.tipo === "elemento") {
      if (p.obrigatorio && !presentes.has(p.nome)) {
        erros.push(`${caminho}/${p.nome}: obrigatório em '${tipoComplexo}' e ausente`);
      }
      return;
    }
    const usados = p.opcoes.map((o) => o.nome).filter((n) => presentes.has(n));
    if (usados.length > 1) {
      erros.push(
        `${caminho}: xs:choice #${i} de '${tipoComplexo}' aceita UM filho e recebeu ` +
          `${usados.length} (${usados.join(", ")})`
      );
    }
    if (p.obrigatorio && usados.length === 0) {
      erros.push(
        `${caminho}: xs:choice obrigatório de '${tipoComplexo}' sem nenhuma opção ` +
          `(${p.opcoes.map((o) => o.nome).join(" | ")})`
      );
    }
  });

  // (5) recursão / folhas
  for (const no of nos) {
    const nome = Object.keys(no).find((k) => k !== ":@");
    const info = permitido.get(nome);
    if (!info) continue;
    const tipo = info.p.xsdTipo;
    if (complexos.has(tipo)) {
      conferir(no[nome], tipo, `${caminho}/${nome}`, erros);
      continue;
    }
    const texto = (no[nome] || []).map((c) => c["#text"] ?? "").join("");
    const f = facetasDe(tipo);
    if (f.enumeracoes.length && !f.enumeracoes.includes(texto)) {
      erros.push(
        `${caminho}/${nome}: '${texto}' não é valor de '${tipo}' (${f.enumeracoes.join("|")})`
      );
    }
    for (const padrao of f.padroes) {
      // Padrões XSD são implicitamente ancorados. `TSSerieDPS` já traz `^`/`$` literais no
      // arquivo oficial; âncora redundante é aceita pelo motor de regex do JS.
      if (!new RegExp(`^(?:${padrao})$`).test(texto)) {
        erros.push(`${caminho}/${nome}: '${texto}' não casa com o pattern de '${tipo}' (${padrao})`);
      }
    }
    if (f.maxLength !== undefined && texto.length > f.maxLength) {
      erros.push(`${caminho}/${nome}: ${texto.length} caracteres excede maxLength ${f.maxLength}`);
    }
    if (f.minLength !== undefined && texto.length < f.minLength) {
      erros.push(`${caminho}/${nome}: ${texto.length} caracteres abaixo de minLength ${f.minLength}`);
    }
  }
}

/** Devolve a lista de recusas do XSD para um XML de DPS. Vazia = o XML cabe no esquema. */
function recusasDoXsd(xml) {
  const arvore = parser.parse(xml);
  const dps = arvore.find((n) => Object.keys(n).includes("DPS"));
  if (!dps) return ["o XML não tem elemento raiz <DPS>"];
  const erros = [];
  conferir(dps.DPS, "TCDPS", "DPS", erros);
  return erros;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// CENÁRIO DE EMISSÃO (idêntico ao de `emissaoDps.test.js`)
// ─────────────────────────────────────────────────────────────────────────────────────────────

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
  servico: { descricao: "serviços contabeis", valorServicos: 1, aliquota: 5, issRetido: false },
  totTrib: { pTotTribSN: 6 },
  competencia: new Date("2026-01-23T00:00:00Z"),
};

const PRESUMIDO = { regime: "LUCRO_PRESUMIDO" };
const CARGA = { pTotTribFed: 11.33, pTotTribEst: 0, pTotTribMun: 2.5 };

let postMock;

function montarCenario({ empresa = {}, cadastroFiscal = null } = {}) {
  prisma.company.findUnique.mockResolvedValue({ ...EMPRESA_BASE, ...empresa });
  prisma.cadastroFiscal.findUnique.mockResolvedValue(cadastroFiscal);
  postMock = jest.fn(async () => ({
    data: { status: "issued", chaveAcesso: "3".repeat(50), numeroNfse: "18" },
  }));
  axios.create.mockReturnValue({
    defaults: { baseURL: "https://sefin.producaorestrita.nfse.gov.br/SefinNacional" },
    post: postMock,
  });
}

function xmlEnviado() {
  const body = postMock.mock.calls[0][1];
  return gunzipSync(Buffer.from(body.dpsXmlGZipB64, "base64")).toString("utf-8");
}

const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

beforeEach(() => {
  jest.clearAllMocks();
  resolverCertificadosDaEmpresa.mockResolvedValue(CERT_DA_EMPRESA);
  prisma.serviceInvoice.create.mockImplementation(async ({ data }) => ({ id: "inv-1", ...data }));
  prisma.serviceInvoice.update.mockImplementation(async ({ data }) => ({ id: "inv-1", ...data }));
});

// ─────────────────────────────────────────────────────────────────────────────────────────────

describe("o verificador de XSD morde de verdade", () => {
  // ⚠ Sem esta contraprova, um bug no LEITOR do XSD faria toda a suíte passar em silêncio —
  // que é exatamente o modo de falha que este arquivo existe para acabar.
  // O `<piscofins>` abaixo é a saída LITERAL do gerador antes do conserto, no ramo do não
  // optante sem dados explícitos (os nove filhos, nesta ordem) — é o que foi para a produção.
  it("recusa os dois elementos inventados que derrubaram a produção", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<DPS xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01">
  <infDPS Id="DPS330455723925424300019100001000000000000042">
    <tpAmb>2</tpAmb><dhEmi>2026-01-23T10:00:00-03:00</dhEmi>
    <verAplic>SefinNacional_1.5.0</verAplic>
    <serie>00001</serie><nDPS>42</nDPS><dCompet>2026-01-23</dCompet>
    <tpEmit>1</tpEmit><cLocEmi>3304557</cLocEmi>
    <prest><CNPJ>39254243000191</CNPJ><regTrib><opSimpNac>1</opSimpNac><regEspTrib>0</regEspTrib></regTrib></prest>
    <serv><locPrest><cLocPrestacao>3304557</cLocPrestacao></locPrest>
      <cServ><cTribNac>171201</cTribNac><cTribMun>001</cTribMun><xDescServ>x</xDescServ></cServ></serv>
    <valores><vServPrest><vServ>1.00</vServ></vServPrest>
      <trib><tribMun><tribISSQN>1</tribISSQN><tpRetISSQN>1</tpRetISSQN></tribMun>
        <tribFed><piscofins>
          <CST>01</CST>
          <vBCPisCofins>0.00</vBCPisCofins>
          <pAliqPis>0.00</pAliqPis>
          <pAliqCofins>0.00</pAliqCofins>
          <vPis>0.00</vPis>
          <vCofins>0.00</vCofins>
          <tpRetPisCofins>2</tpRetPisCofins>
          <vBcRetPisCofins>0.00</vBcRetPisCofins>
          <vRetPisCofins>0.00</vRetPisCofins>
        </piscofins></tribFed>
        <totTrib><pTotTrib><pTotTribFed>11.33</pTotTribFed><pTotTribEst>0.00</pTotTribEst><pTotTribMun>2.50</pTotTribMun></pTotTrib></totTrib>
      </trib></valores>
  </infDPS>
</DPS>`;
    const erros = recusasDoXsd(xml);
    expect(erros.join("\n")).toMatch(/vBcRetPisCofins: ⚠ ELEMENTO INEXISTENTE/);
    expect(erros.join("\n")).toMatch(/vRetPisCofins: ⚠ ELEMENTO INEXISTENTE/);
  });

  it("lê os SETE filhos de TCTribOutrosPisCofins do XSD, nesta ordem", () => {
    // ⚠ A lista sai do ARQUIVO OFICIAL, não de uma constante nossa: se a Receita publicar um XSD
    // com outra forma, é aqui que se descobre.
    expect(complexos.get("TCTribOutrosPisCofins").map((p) => p.nome)).toEqual([
      "CST",
      "vBCPisCofins",
      "pAliqPis",
      "pAliqCofins",
      "vPis",
      "vCofins",
      "tpRetPisCofins",
    ]);
    // Só `CST` é obrigatório.
    expect(
      complexos.get("TCTribOutrosPisCofins").filter((p) => p.obrigatorio).map((p) => p.nome)
    ).toEqual(["CST"]);
    // E os dois nomes inventados não estão em NENHUM complexType do esquema.
    const todos = [...complexos.values()].flatMap((ps) =>
      ps.flatMap((p) => (p.tipo === "elemento" ? [p.nome] : p.opcoes.map((o) => o.nome)))
    );
    expect(todos).not.toContain("vBcRetPisCofins");
    expect(todos).not.toContain("vRetPisCofins");
  });
});

describe("a DPS que o gerador produz cabe no XSD oficial", () => {
  it("Simples Nacional (opSimpNac=3)", async () => {
    montarCenario({ cadastroFiscal: { regime: "SIMPLES_NACIONAL" } });
    await NfseService.issue({ data: PAYLOAD_BASE, log });
    expect(recusasDoXsd(xmlEnviado())).toEqual([]);
  });

  it("⚠⚠ Lucro Presumido, R$ 1,00 — o cenário LITERAL das três notas recusadas", async () => {
    montarCenario({ empresa: CARGA, cadastroFiscal: PRESUMIDO });
    const r = await NfseService.issue({ data: PAYLOAD_BASE, log });
    expect(r.status).toBe("issued");
    expect(recusasDoXsd(xmlEnviado())).toEqual([]);
  });

  it("com ISS retido pelo tomador", async () => {
    montarCenario({ empresa: CARGA, cadastroFiscal: PRESUMIDO });
    await NfseService.issue({
      data: { ...PAYLOAD_BASE, servico: { ...PAYLOAD_BASE.servico, issRetido: true } },
      log,
    });
    expect(recusasDoXsd(xmlEnviado())).toEqual([]);
  });

  it("com complemento de endereço e sem e-mail do tomador", async () => {
    montarCenario({ cadastroFiscal: { regime: "SIMPLES_NACIONAL" } });
    await NfseService.issue({
      data: {
        ...PAYLOAD_BASE,
        tomador: {
          ...PAYLOAD_BASE.tomador,
          email: null,
          endereco: { ...PAYLOAD_BASE.tomador.endereco, xCpl: "SALA 2" },
        },
      },
      log,
    });
    expect(recusasDoXsd(xmlEnviado())).toEqual([]);
  });

  it("tomador pessoa jurídica (CNPJ no lugar de CPF)", async () => {
    montarCenario({ cadastroFiscal: { regime: "SIMPLES_NACIONAL" } });
    await NfseService.issue({
      data: {
        ...PAYLOAD_BASE,
        tomador: { ...PAYLOAD_BASE.tomador, doc: "39254243000191", nome: "EMPRESA X LTDA" },
      },
      log,
    });
    expect(recusasDoXsd(xmlEnviado())).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ DIVERGÊNCIAS AINDA ABERTAS — MEDIDAS AQUI, **NÃO CONSERTADAS**, PENDENTES DO DONO
//
// A varredura que procurou "mais elementos inventados" (21/08/2026) não achou outro nome
// fabricado, mas achou DUAS formas de produzir o MESMO `E1235` — as duas alcançáveis hoje, pelo
// cadastro e pela tela. Elas ficam TRAVADAS aqui, com o defeito à vista, porque consertá-las é
// decisão de produto, não detalhe de implementação:
//
//   · `cTribMun` — mudar a forma exige decidir se o cadastro passa a EXIGIR 3 dígitos (e aí um
//     código municipal legítimo mais longo/curto para de ser aceito). O `apps/api/CLAUDE.md` já
//     registra que o comprimento "NÃO está provado" e é **pendente de confirmação do dono**.
//   · `xDescServ` — o conserto é ou RECUSAR a nota, ou REESCREVER o texto que vai impresso no
//     documento fiscal. Reescrever descrição de serviço por conta própria é mexer no que o
//     contribuinte declarou.
//
// ⚠ Se um destes testes começar a FALHAR, é porque alguém consertou o defeito — ótimo. Apague o
// teste e mova a linha para o histórico; não "conserte o teste".
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠ divergências abertas contra o XSD (medidas, não consertadas)", () => {
  it("⚠ cTribMun com menos de 3 dígitos vira E1235 — o cadastro aceita, o schema não", async () => {
    // `TCCodTribMun` é `[0-9]{3}` — EXATAMENTE três (tiposSimples_v1.01.xsd:568).
    // `companyProfile.validateAndNormalizeCompanyProfile` só tira a pontuação de
    // `codigoServicoMunicipal` e **não confere comprimento**; `buildDpsXml` faz `.slice(-3)`, que
    // encurta o longo mas não completa o curto. Uma empresa cadastrada com "12" emite
    // `<cTribMun>12</cTribMun>` e é recusada pelo sistema nacional.
    montarCenario({ empresa: { codigoServicoMunicipal: "12" } });
    await NfseService.issue({ data: PAYLOAD_BASE, log });
    const erros = recusasDoXsd(xmlEnviado());
    expect(erros.join("\n")).toMatch(/cTribMun.*TCCodTribMun/s);
  });

  it("⚠ endereço com traço longo/aspas curvas vira E1235 — é o que sai de um copiar-colar", async () => {
    // `xLgr`/`nro`/`xCpl`/`xBairro`/`email` são `TSString`, cujo pattern
    // (`[!-ÿ]{1}[ -ÿ]{0,}[!-ÿ]{1}|[!-ÿ]{1}`) para em `ÿ` (U+00FF): travessão (—), aspas curvas
    // (“ ”), bullet (•) e afins são RECUSADOS. Acento e cedilha passam. `escapeXml` não ajuda —
    // ele só troca & < > " '. E o validador do payload não confere charset nem comprimento.
    //
    // ⚠⚠ E `xDescServ` **NÃO** cai nisto, ao contrário do que a leitura apressada sugere: ele é
    // `TSDesc2000` → `TSStringComQuebraDeLinha`, cujo pattern usa `[\s\S…]` — e `[\s\S]` casa
    // QUALQUER caractere, então aquele tipo não restringe charset nenhum. Registrado aqui porque
    // os dois patterns são quase idênticos na tela e levam a conclusões opostas.
    montarCenario();
    await NfseService.issue({
      data: {
        ...PAYLOAD_BASE,
        tomador: {
          ...PAYLOAD_BASE.tomador,
          endereco: { ...PAYLOAD_BASE.tomador.endereco, xLgr: "RUA DAS “FLORES”" },
        },
      },
      log,
    });
    expect(recusasDoXsd(xmlEnviado()).join("\n")).toMatch(/xLgr/);

    // Contraprova 1: acento e cedilha NÃO são o problema — recusar por eles seria pior.
    montarCenario();
    await NfseService.issue({
      data: {
        ...PAYLOAD_BASE,
        tomador: {
          ...PAYLOAD_BASE.tomador,
          endereco: { ...PAYLOAD_BASE.tomador.endereco, xLgr: "AVENIDA JOÃO CONCEIÇÃO" },
        },
      },
      log,
    });
    expect(recusasDoXsd(xmlEnviado())).toEqual([]);

    // Contraprova 2: a MESMA pontuação na DESCRIÇÃO passa, porque o tipo dela é outro.
    montarCenario();
    await NfseService.issue({
      data: {
        ...PAYLOAD_BASE,
        servico: { ...PAYLOAD_BASE.servico, descricao: "Consultoria — “mensal”" },
      },
      log,
    });
    expect(recusasDoXsd(xmlEnviado())).toEqual([]);
  });
});
