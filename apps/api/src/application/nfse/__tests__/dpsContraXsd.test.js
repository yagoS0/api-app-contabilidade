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
import { NfseService, DPS_VERSAO } from "../NfseService.js";

// ─────────────────────────────────────────────────────────────────────────────────────────────
// O XSD OFICIAL
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// ⚠ O caminho é PROCURADO subindo a árvore, não montado a partir do CWD: a suíte roda ora da
// raiz do monorepo, ora de `apps/api`, e um caminho relativo ao CWD acharia o schema num caso e
// não no outro — fazendo o teste "passar" por não ter o que conferir. Não achar é ERRO ALTO.
// ⚠⚠ A VERSÃO SAI DE `DPS_VERSAO`, NUNCA DE UM LITERAL AQUI — e isto é o conserto de um
// FALSO-VERDE que estava vivo.
//
// Até 01/09/2026 este arquivo fixava `"1.01"` no caminho e nos nomes dos arquivos, enquanto
// `NfseService.js` emitia `versao="1.00"`. **O oráculo validava o documento contra o esquema de
// outra versão.** Hoje isso é inofensivo — conferido: `TCInfoPrestador`, `TCInfoValores`,
// `TCInfoPessoa`, `TCRegTrib`, `TCTribFederal`, `TCTribOutrosPisCofins`, `TCTotTrib`, `TCCServ` e
// `TCEndereco` são idênticos nas duas versões, e o único acréscimo do 1.01 em `TCInfDPS` é o grupo
// `IBSCBS` (`minOccurs=0`), que não emitimos.
//
// ⚠⚠ MAS `TCTribMunicipal` REORDENOU OS FILHOS ENTRE AS DUAS VERSÕES:
//
//   1.00: tribISSQN · cPaisResult? · BM? · exigSusp? · tpImunidade? · pAliq? · tpRetISSQN
//   1.01: tribISSQN · cPaisResult? · tpImunidade? · exigSusp? · BM? · tpRetISSQN · pAliq?
//
// `xs:sequence` faz a ORDEM ser contrato. Hoje o gerador escreve só `tribISSQN` + `tpRetISSQN`, e
// esse par mantém a ordem relativa nas duas — por isso o XML atual passa em ambas e o desalinhamento
// não doía. **No instante em que `pAliq` ou `BM` entrarem, a ordem passa a depender da versão
// declarada**, e um oráculo apontado para o esquema errado APROVARIA a ordem trocada. É a classe
// exata do E1235 que recusou três notas reais em 21/08/2026 — com o agravante de que o único teste
// escrito para impedir essa classe seria justamente o que diria que está tudo bem.
const SUFIXO = path.join(
  "docs",
  "leiaute-nfse",
  "documentacao-tecnica",
  "esquemas-xsd",
  "Schemas",
  DPS_VERSAO
);
const ARQUIVO_TIPOS_COMPLEXOS = `tiposComplexos_v${DPS_VERSAO}.xsd`;
const ARQUIVO_TIPOS_SIMPLES = `tiposSimples_v${DPS_VERSAO}.xsd`;
const SCHEMAS = (() => {
  let dir = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    const tentativa = path.join(dir, SUFIXO);
    if (fs.existsSync(path.join(tentativa, ARQUIVO_TIPOS_COMPLEXOS))) return tentativa;
    const pai = path.dirname(dir);
    if (pai === dir) break;
    dir = pai;
  }
  throw new Error(
    `XSD oficial da versão ${DPS_VERSAO} não encontrado a partir de ${process.cwd()} `
      + `(esperado .../${SUFIXO}/${ARQUIVO_TIPOS_COMPLEXOS}). `
      + "Sem o schema DA VERSÃO QUE EMITIMOS este teste não confere NADA — falhar aqui é melhor "
      + "que passar vazio, e é melhor ainda que passar conferindo contra outra versão."
  );
})();

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  preserveOrder: true,
  trimValues: true,
  parseTagValue: false,
});

function lerXsd(arquivo, dir = SCHEMAS) {
  return parser.parse(fs.readFileSync(path.join(dir, arquivo), "utf-8"));
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

function carregarEsquema(versao = DPS_VERSAO) {
  const complexos = new Map();
  const simples = new Map();
  const dir = path.join(path.dirname(SCHEMAS), versao);

  for (const arquivo of [`tiposComplexos_v${versao}.xsd`, `tiposSimples_v${versao}.xsd`]) {
    const raiz = conteudo(lerXsd(arquivo, dir).find((n) => conteudo(n, "schema")), "schema");

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

const ESQUEMA = carregarEsquema();
const { complexos, simples } = ESQUEMA;

/** Achata a cadeia de `base` de um tipo simples (TSCEP → xs:string, TSLogradouro → TSString → …). */
function facetasDe(tipo, esq = ESQUEMA) {
  const acc = { padroes: [], enumeracoes: [], maxLength: undefined, minLength: undefined };
  let atual = tipo;
  const visto = new Set();
  while (atual && esq.simples.has(atual) && !visto.has(atual)) {
    visto.add(atual);
    const s = esq.simples.get(atual);
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
function conferir(nos, tipoComplexo, caminho, erros, esq = ESQUEMA) {
  const particulas = esq.complexos.get(tipoComplexo);
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
    if (esq.complexos.has(tipo)) {
      conferir(no[nome], tipo, `${caminho}/${nome}`, erros, esq);
      continue;
    }
    const texto = (no[nome] || []).map((c) => c["#text"] ?? "").join("");
    const f = facetasDe(tipo, esq);
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
function recusasDoXsd(xml, esq = ESQUEMA) {
  const arvore = parser.parse(xml);
  const dps = arvore.find((n) => Object.keys(n).includes("DPS"));
  if (!dps) return ["o XML não tem elemento raiz <DPS>"];
  const erros = [];
  conferir(dps.DPS, "TCDPS", "DPS", erros, esq);
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

describe("⚠⚠ o oráculo confere a versão que a gente EMITE — e nada mais", () => {
  it("o esquema carregado é o de `DPS_VERSAO`", () => {
    // A trava do falso-verde. Se alguém trocar `DPS_VERSAO` e não houver esquema daquela versão, o
    // `SCHEMAS` já lança na carga do módulo; aqui se prende o par para que ninguém volte a fixar a
    // versão neste arquivo.
    expect(path.basename(SCHEMAS)).toBe(DPS_VERSAO);
    expect(ARQUIVO_TIPOS_COMPLEXOS).toBe(`tiposComplexos_v${DPS_VERSAO}.xsd`);
    expect(ARQUIVO_TIPOS_SIMPLES).toBe(`tiposSimples_v${DPS_VERSAO}.xsd`);
    expect(fs.existsSync(path.join(SCHEMAS, ARQUIVO_TIPOS_COMPLEXOS))).toBe(true);
    expect(fs.existsSync(path.join(SCHEMAS, ARQUIVO_TIPOS_SIMPLES))).toBe(true);
  });

  it("nenhuma versão de esquema fica FIXADA no texto deste arquivo", () => {
    // ⚠ É a guarda de verdade: as asserções acima continuariam verdes se alguém reintroduzisse um
    // literal em OUTRO ponto do arquivo. Aqui se varre o texto inteiro atrás de `_v1.NN.xsd` e de
    // `Schemas/1.NN` escritos à mão. Comentários são o único lugar onde citar a versão é legítimo —
    // e é exatamente onde a explicação do reordenamento precisa citá-las.
    const fonte = fs.readFileSync(__filename, "utf-8");
    const semComentarios = fonte
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join("\n");
    expect(semComentarios).not.toMatch(/tipos(Complexos|Simples)_v\d\.\d\d\.xsd/);
    expect(semComentarios).not.toMatch(/["']Schemas["']\s*,\s*["']\d\.\d\d["']/);
  });

  it("⚠⚠ as duas versões do esquema EXISTEM — o impedimento para migrar não é mais a falta do XSD", () => {
    // A frase "o projeto não tem o XSD versionado" vivia em `NfseService.js` e em `dpsCodigos.js`
    // como justificativa escrita para NÃO migrar. Ela é falsa desde 19/08/2026. Este caso a mantém
    // falsa: se alguém apagar um dos pacotes, ele cai e a afirmação volta a ser verificável.
    const raizSchemas = path.dirname(SCHEMAS);
    for (const v of ["1.00", "1.01"]) {
      expect(fs.existsSync(path.join(raizSchemas, v, `tiposComplexos_v${v}.xsd`))).toBe(true);
    }
  });

  it("⚠⚠ `TCTribMunicipal` REORDENOU entre 1.00 e 1.01 — é por isso que a versão importa", () => {
    // O motivo de existir desta seção inteira, medido na fonte em vez de argumentado. Se um dia as
    // duas ordens coincidirem, este caso cai — e aí a amarração pode ser reavaliada com dado.
    const ordemDe = (v) => {
      const raiz = conteudo(
        parser
          .parse(
            fs.readFileSync(
              path.join(path.dirname(SCHEMAS), v, `tiposComplexos_v${v}.xsd`),
              "utf-8",
            ),
          )
          .find((n) => conteudo(n, "schema")),
        "schema",
      );
      const ct = filhos(raiz, "complexType").find((n) => attrs(n)["@name"] === "TCTribMunicipal");
      const seq = filhos(conteudo(ct, "complexType"), "sequence")[0];
      return conteudo(seq, "sequence")
        .map((n) => attrs(n)["@name"])
        .filter(Boolean);
    };

    const a = ordemDe("1.00");
    const b = ordemDe("1.01");

    // Mesmos filhos, ordem diferente — a distinção que um `xs:sequence` transforma em contrato.
    expect([...a].sort()).toEqual([...b].sort());
    expect(a).not.toEqual(b);

    // E as posições exatas, para o dia em que alguém for montar `pAliq`/`BM` e precisar do de-para.
    expect(a).toEqual([
      "tribISSQN", "cPaisResult", "BM", "exigSusp", "tpImunidade", "pAliq", "tpRetISSQN",
    ]);
    expect(b).toEqual([
      "tribISSQN", "cPaisResult", "tpImunidade", "exigSusp", "BM", "tpRetISSQN", "pAliq",
    ]);
  });

  it("⚠ o par que o gerador escreve HOJE mantém a ordem relativa nas DUAS — por isso ninguém sentiu", () => {
    // É a explicação de por que o desalinhamento passou despercebido, e a medida de quanto tempo
    // resta: enquanto `tribMun` tiver só estes dois filhos, as duas versões concordam.
    const soOsDois = (ordem) => ordem.filter((n) => n === "tribISSQN" || n === "tpRetISSQN");
    const em100 = ["tribISSQN", "cPaisResult", "BM", "exigSusp", "tpImunidade", "pAliq", "tpRetISSQN"];
    const em101 = ["tribISSQN", "cPaisResult", "tpImunidade", "exigSusp", "BM", "tpRetISSQN", "pAliq"];
    expect(soOsDois(em100)).toEqual(["tribISSQN", "tpRetISSQN"]);
    expect(soOsDois(em100)).toEqual(soOsDois(em101));
  });
});

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
// ⚠⚠ A INÉRCIA DA MIGRAÇÃO 1.00 → 1.01 — a evidência que AUTORIZA subir `DPS_VERSAO`
//
// A migração é UMA LINHA (`DPS_VERSAO`), e é por isso que ela precisa de prova, não de argumento:
// uma linha é fácil de subir e o efeito dela é um documento fiscal com outra versão declarada.
// A prova aqui é a mais forte que este oráculo consegue dar — **o MESMO XML emitido é validado
// contra os DOIS pacotes de esquema**, com a checagem inteira (existência, ordem do `xs:sequence`,
// obrigatórios, `xs:choice` e as facetas dos tipos simples). Não é "gerar duas vezes e comparar":
// é o documento que sai hoje cabendo nas duas.
//
// ⚠⚠ DOZE TIPOS COMPLEXOS MUDARAM entre as versões, e CINCO deles o gerador escreve. Isto
// contraria a leitura anterior deste projeto, que dizia que só o `TCTribMunicipal` havia mudado:
//
//   TCInfDPS         +IBSCBS? no fim                    → inerte (opcional, não escrevemos)
//   TCServ           −lsadppu? −explRod?                → inerte (não escrevemos nenhum dos dois)
//   TCLocPrest       o grupo podia casar com o VAZIO      → inerte SÓ porque sempre escrevemos
//                    e passou a exigir UMA opção            `cLocPrestacao`; ver o caso próprio
//   TCEndereco       idem, com outra codificação          → inerte SÓ porque sempre escrevemos
//                                                           `endNac` no endereço do tomador
//   TCTribMunicipal  reordenou os 7 filhos              → inerte SÓ porque escrevemos 2 deles,
//                                                         e esse par mantém a ordem relativa
//
// ⚠ "Inerte por acidente feliz" é diferente de "inerte por construção", e os TRÊS últimos são do
// primeiro tipo. É exatamente por isso que a inércia é MEDIDA a cada execução, e não anotada.
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe("⚠⚠ o MESMO XML emitido cabe nas DUAS versões do esquema", () => {
  const OUTRA_VERSAO = DPS_VERSAO === "1.00" ? "1.01" : "1.00";
  const esquemaDaOutra = carregarEsquema(OUTRA_VERSAO);

  const CENARIOS = [
    ["Simples Nacional", { cadastroFiscal: { regime: "SIMPLES_NACIONAL" } }, PAYLOAD_BASE],
    ["Lucro Presumido com carga tributária", { empresa: CARGA, cadastroFiscal: PRESUMIDO }, PAYLOAD_BASE],
    [
      "com ISS retido pelo tomador",
      { empresa: CARGA, cadastroFiscal: PRESUMIDO },
      { ...PAYLOAD_BASE, servico: { ...PAYLOAD_BASE.servico, issRetido: true } },
    ],
  ];

  for (const [nome, cenario, payload] of CENARIOS) {
    it(`${nome} — cabe em ${DPS_VERSAO} E em ${OUTRA_VERSAO}`, async () => {
      montarCenario(cenario);
      await NfseService.issue({ data: payload, log });
      const xml = xmlEnviado();
      // ⚠ A guarda que impede o falso-verde do falso-verde: comparar `[]` com `[]` passaria com um
      // XML vazio, e este projeto já pagou por isso (ver `perfilNaEmissao.test.js`).
      expect(xml).toMatch(/<infDPS/);
      expect(recusasDoXsd(xml)).toEqual([]);
      expect(recusasDoXsd(xml, esquemaDaOutra)).toEqual([]);
    });
  }

  it("⚠⚠ DOIS grupos que podiam ficar VAZIOS na 1.00 passaram a exigir UMA opção na 1.01", () => {
    // O achado mais perto de um bloqueio real que esta migração tem — e o que quase virou alarme
    // falso, porque uma primeira leitura por regex não enxergou o `xs:choice` e reportou os filhos
    // como "opcionais → obrigatórios".
    //
    // ⚠⚠ E O APERTO ESTÁ CODIFICADO DE DUAS FORMAS DIFERENTES, para a MESMA mudança de efeito:
    //   TCLocPrest  → o `xs:choice` sempre foi obrigatório; o que mudou foi o `minOccurs="0"` das
    //                 DUAS OPÇÕES sumir (choice obrigatório cujas opções são todas opcionais casa
    //                 com o vazio — por isso 1.00 aceitava o grupo sem filho nenhum);
    //   TCEndereco  → o `minOccurs="0"` estava no PRÓPRIO `xs:choice`, e sumiu.
    // Ler só um dos dois lugares dá a resposta errada sobre o outro.
    //
    // Passamos nos dois porque `buildDpsXml` sempre escreve `<cLocPrestacao>` (ausente, cai para o
    // `cLocEmi`) e sempre escreve `<endNac>` no endereço do tomador. ⚠ Quem tornar qualquer um dos
    // dois condicional precisa escrever o IRMÃO (`cPaisPrestacao` / `endExt`): deixar os dois de
    // fora é DPS recusada na 1.01 — e ACEITA na 1.00, então o defeito não apareceria antes da troca.
    // ⚠ EXPERIMENTO EXECUTADO (tirando o `<cLocPrestacao>` do gerador): os TRÊS cenários ficam
    // vermelhos, e nos DOIS esquemas — não só no 1.01. O motivo é que `conferir` exige uma opção
    // sempre que o `xs:choice` é obrigatório, sem olhar o `minOccurs="0"` das opções; ou seja, o
    // oráculo é mais ESTRITO que o 1.00 neste ponto. É desvio na direção segura (recusa o que o
    // 1.00 aceitaria, nunca o contrário), e por isso não produz falso-verde — mas quem for medir a
    // diferença entre as versões precisa saber que a separação limpa vem do caso abaixo, não do
    // resultado da emissão.
    const grupoDe = (esq, tipo) => {
      const p = esq.complexos.get(tipo).find((x) => x.tipo === "escolha");
      return {
        grupoObrigatorio: p.obrigatorio,
        opcoes: p.opcoes.map((o) => o.nome),
        opcoesObrigatorias: p.opcoes.map((o) => o.obrigatorio),
      };
    };
    const v100 = carregarEsquema("1.00");
    const v101 = carregarEsquema("1.01");

    // ── TCLocPrest: o aperto está nas OPÇÕES ──────────────────────────────────────────────────
    const loc100 = grupoDe(v100, "TCLocPrest");
    const loc101 = grupoDe(v101, "TCLocPrest");
    expect(loc100.opcoes).toEqual(["cLocPrestacao", "cPaisPrestacao"]);
    expect(loc101.opcoes).toEqual(loc100.opcoes);
    expect(loc100.grupoObrigatorio).toBe(true);
    expect(loc101.grupoObrigatorio).toBe(true);
    expect(loc100.opcoesObrigatorias).toEqual([false, false]); // ⇒ casava com o vazio
    expect(loc101.opcoesObrigatorias).toEqual([true, true]); // ⇒ exige exatamente uma

    // ── TCEndereco: o aperto está no PRÓPRIO choice ───────────────────────────────────────────
    const end100 = grupoDe(v100, "TCEndereco");
    const end101 = grupoDe(v101, "TCEndereco");
    expect(end100.opcoes).toEqual(["endNac", "endExt"]);
    expect(end101.opcoes).toEqual(end100.opcoes);
    expect(end100.grupoObrigatorio).toBe(false);
    expect(end101.grupoObrigatorio).toBe(true);
  });

  it("⚠ os tipos que DIFEREM entre as versões — medição travada, não anotação", () => {
    // Se o pacote de esquema for atualizado, esta lista muda e o caso cai. Ele existe para que a
    // atualização passe por uma leitura humana em vez de escorregar para dentro da emissão.
    const a = carregarEsquema("1.00").complexos;
    const b = carregarEsquema("1.01").complexos;
    const iguais = (x, y) => JSON.stringify(x) === JSON.stringify(y);

    const mudaram = [...a.keys()].filter((n) => b.has(n) && !iguais(a.get(n), b.get(n))).sort();
    expect(mudaram).toEqual([
      "TCAtvEvento",
      "TCBeneficioMunicipal",
      "TCEnderObraEvento",
      "TCEndereco",
      "TCInfDPS",
      "TCInfNFSe",
      "TCInfoCompl",
      "TCInfoObra",
      "TCLocPrest",
      "TCServ",
      "TCTribMunicipal",
      "TCValoresNFSe",
    ]);

    // ⚠ Os dois que a 1.01 APAGOU. `TCServ` perdeu os elementos que os referenciavam, e é isso que
    // torna a remoção inofensiva para nós: o gerador nunca escreveu `lsadppu` nem `explRod`.
    expect([...a.keys()].filter((n) => !b.has(n)).sort()).toEqual([
      "TCExploracaoRodoviaria",
      "TCLocacaoSublocacao",
    ]);
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
