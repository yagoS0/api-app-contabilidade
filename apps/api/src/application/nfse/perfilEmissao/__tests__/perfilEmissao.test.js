// O PERFIL DE EMISSÃO — o registro de campos, a precedência, e a guarda contra campo morto.
//
// ⚠⚠ O CASO MAIS IMPORTANTE DESTE ARQUIVO NÃO É SOBRE COMPORTAMENTO: é a varredura que exige que
// TODA coluna do Prisma esteja na lista de `campos.js`, e que TODO campo da lista tenha leitor.
// É o mecanismo que `CadastroFiscal.perfilAtividades` não teve — lá, 3 de 8 campos ficaram
// write-only e ninguém soube até uma varredura de 25/08/2026, um deles sem sequer um input.

jest.mock("../../../../infrastructure/db/prisma.js", () => {
  const model = () => ({ findUnique: jest.fn(async () => null), findMany: jest.fn(async () => []) });
  return { prisma: { portalClient: model(), company: model(), perfilEmissaoNfse: model() } };
});

import fs from "node:fs";
import path from "node:path";
import { prisma } from "../../../../infrastructure/db/prisma.js";
import {
  CAMPOS,
  CAMPOS_DE_IDENTIDADE,
  COLUNAS_TECNICAS,
  FORA_DESTA_FASE,
  IDS,
  campoPorId,
  conferirForma,
} from "../campos.js";
import {
  FONTE,
  resolverPerfilDeEmissao,
  perfilDerivadoDoCadastro,
} from "../resolverPerfilDeEmissao.js";

const PORTAL = "pc-1";

const COMPANY = {
  codigoServicoNacional: "171901",
  codigosServicoNacional: [],
  codigoServicoMunicipal: "001",
  regimeEspecialTributacao: null,
};

function cenario({ company = COMPANY, perfis = [] } = {}) {
  prisma.portalClient.findUnique.mockResolvedValue({ companyId: "co-1" });
  prisma.company.findUnique.mockResolvedValue(company);
  prisma.perfilEmissaoNfse.findMany.mockResolvedValue(perfis);
}

const PERFIL_BASE = {
  id: "pf-1",
  nome: "Consultoria",
  ativo: true,
  padrao: true,
  origem: "MANUAL",
  codigoServicoNacional: null,
  codigoServicoMunicipal: null,
  cLocPrestacao: null,
  regEspTrib: null,
  regApTribSN: null,
  tribISSQN: null,
  habilitaObra: false,
  habilitaExportacao: false,
};

beforeEach(() => jest.clearAllMocks());

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// O REGISTRO DE CAMPOS — a guarda contra o `perfilAtividades`
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe("⚠⚠ nenhuma coluna sem leitor, nenhum leitor sem coluna", () => {
  /** As colunas do model, lidas do `schema.prisma` — nunca decoradas. */
  function colunasDoModel() {
    const schema = fs.readFileSync(
      path.resolve(__dirname, "../../../../../prisma/schema.prisma"),
      "utf-8",
    );
    const bloco = /model PerfilEmissaoNfse \{([\s\S]*?)\n\}/.exec(schema);
    if (!bloco) throw new Error("model PerfilEmissaoNfse não encontrado no schema.prisma");
    return bloco[1]
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("//") && !l.startsWith("///") && !l.startsWith("@@"))
      .map((l) => l.split(/\s+/)[0])
      .filter((n) => /^[a-zA-Z]\w*$/.test(n));
  }

  it("o schema tem o model, e a varredura acha as colunas", () => {
    // Sem esta linha, um erro no regex faria as duas afirmações abaixo passarem sobre lista vazia.
    expect(colunasDoModel().length).toBeGreaterThan(10);
  });

  it("⚠⚠ toda coluna do Prisma está declarada em `campos.js`", () => {
    // É o teste que `perfilAtividades` não tinha. Coluna nova sem entrada aqui não passa.
    const conhecidas = new Set([...IDS, ...CAMPOS_DE_IDENTIDADE, ...COLUNAS_TECNICAS]);
    const orfas = colunasDoModel().filter((c) => !conhecidas.has(c));
    expect(orfas).toEqual([]);
  });

  it("⚠⚠ todo campo da lista tem LEITOR declarado — e existe no Prisma", () => {
    const colunas = new Set(colunasDoModel());
    for (const c of CAMPOS) {
      expect({ id: c.id, temLeitor: (c.leitores || []).length > 0 }).toEqual({ id: c.id, temLeitor: true });
      expect({ id: c.id, noPrisma: colunas.has(c.id) }).toEqual({ id: c.id, noPrisma: true });
    }
  });

  it("⚠ cada campo diz a TAG e o CAMINHO no XML — é o de-para que o painel mostra", () => {
    for (const c of CAMPOS) {
      expect({ id: c.id, tag: Boolean(c.tag), caminho: /^infDPS\//.test(c.caminhoNoXml) })
        .toEqual({ id: c.id, tag: true, caminho: true });
    }
  });

  it("⚠⚠ o que ficou de fora está NOMEADO, com o motivo", () => {
    // A diferença entre "não fizemos" e "esquecemos". Cada ausência é uma decisão registrada.
    for (const k of ["pAliq", "BM", "exigSusp", "tpImunidade", "tpRetISSQN", "comExt", "obra"]) {
      expect({ k, tem: Boolean(FORA_DESTA_FASE[k]) }).toEqual({ k, tem: true });
    }
  });

  it("⚠ os dois campos CRAVADOS no gerador estão marcados como tal", () => {
    // `regApTribSN` e `tribISSQN` saem hoje de constante, não de cadastro. É o que o painel precisa
    // dizer ao contador: aquele valor não veio de decisão nenhuma.
    expect(campoPorId("regApTribSN").cravadoHoje).toBe(true);
    expect(campoPorId("tribISSQN").cravadoHoje).toBe(true);
    expect(campoPorId("codigoServicoNacional").cravadoHoje).toBeUndefined();
  });
});

describe("⚠ a forma dos campos sai do XSD, não de intervalo", () => {
  it("`cTribNac` são 6 dígitos, sem padding", () => {
    expect(conferirForma("codigoServicoNacional", "171901").ok).toBe(true);
    expect(conferirForma("codigoServicoNacional", "17190").ok).toBe(false);
    expect(conferirForma("codigoServicoNacional", "1719011").ok).toBe(false);
  });

  it("⚠⚠ `cTribMun` são EXATAMENTE 3 dígitos — o gerador encurta o longo e não completa o curto", () => {
    expect(conferirForma("codigoServicoMunicipal", "001").ok).toBe(true);
    expect(conferirForma("codigoServicoMunicipal", "12").ok).toBe(false);
    expect(conferirForma("codigoServicoMunicipal", "0001").ok).toBe(false);
  });

  it("⚠ `TSRegEspTrib` não tem 7 nem 8 — conferido no XSD", () => {
    for (const v of ["0", "1", "2", "3", "4", "5", "6", "9"]) {
      expect({ v, ok: conferirForma("regEspTrib", v).ok }).toEqual({ v, ok: true });
    }
    for (const v of ["7", "8", "10"]) {
      expect({ v, ok: conferirForma("regEspTrib", v).ok }).toEqual({ v, ok: false });
    }
  });

  it("`tribISSQN` aceita a exportação (3) — que hoje é impossível de emitir", () => {
    expect(conferirForma("tribISSQN", "3").ok).toBe(true);
    expect(conferirForma("tribISSQN", "5").ok).toBe(false);
  });

  it("⚠ ausência em campo não obrigatório é VÁLIDA e vira `null`, nunca string vazia", () => {
    for (const v of [null, undefined, "", "   "]) {
      expect(conferirForma("cLocPrestacao", v)).toEqual({ ok: true, valor: null });
    }
  });

  it("ausência em campo obrigatório é recusada, nomeando", () => {
    const r = conferirForma("codigoServicoNacional", "");
    expect(r.ok).toBe(false);
    expect(r.motivo).toMatch(/obrigatório/);
  });

  it("campo desconhecido não vira campo", () => {
    expect(campoPorId("inventado")).toBeNull();
    expect(conferirForma("inventado", "x").ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// A PRECEDÊNCIA
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe("⚠⚠ sem perfil, a resposta é o comportamento de HOJE", () => {
  it("os dois cravados aparecem como CRAVADO, não como cadastro", () => {
    // É a razão de o painel existir: hoje esses valores são constantes dentro do gerador, e
    // constante em código é invisível até a nota sair.
    return resolverPerfilDeEmissao({ portalClientId: PORTAL }).then((r) => {
      expect(r.campos.regApTribSN).toMatchObject({ valor: "1", fonte: FONTE.CRAVADO });
      expect(r.campos.tribISSQN).toMatchObject({ valor: "1", fonte: FONTE.CRAVADO });
    });
  });

  it("o que vem do cadastro é marcado COMPANY", async () => {
    cenario();
    const r = await resolverPerfilDeEmissao({ portalClientId: PORTAL });
    expect(r.campos.codigoServicoNacional).toMatchObject({ valor: "171901", fonte: FONTE.COMPANY });
    expect(r.campos.codigoServicoMunicipal).toMatchObject({ valor: "001", fonte: FONTE.COMPANY });
    expect(r.temPerfil).toBe(false);
  });

  it("⚠ o que ninguém respondeu é INDEFINIDO — não é vazio, não é zero", () => {
    cenario({ company: { ...COMPANY, codigoServicoMunicipal: null } });
    return resolverPerfilDeEmissao({ portalClientId: PORTAL }).then((r) => {
      expect(r.campos.codigoServicoMunicipal).toMatchObject({ valor: null, fonte: FONTE.INDEFINIDO });
      expect(r.campos.cLocPrestacao).toMatchObject({ valor: null, fonte: FONTE.INDEFINIDO });
    });
  });
});

describe("⚠⚠ com perfil, a precedência é POR CAMPO — nunca por objeto", () => {
  it("o campo respondido vence; o vazio NÃO apaga o cadastro", async () => {
    // Um `{...cadastro, ...perfil}` faria o campo em branco do perfil apagar o valor que a empresa
    // já emite. É o defeito do `{...cadastro, ...doCompany}` do GET /cadastro-fiscal.
    cenario({ perfis: [{ ...PERFIL_BASE, tribISSQN: "3", codigoServicoMunicipal: null }] });
    const r = await resolverPerfilDeEmissao({ portalClientId: PORTAL });

    expect(r.campos.tribISSQN).toMatchObject({ valor: "3", fonte: FONTE.PERFIL });
    expect(r.campos.codigoServicoMunicipal).toMatchObject({ valor: "001", fonte: FONTE.COMPANY });
  });

  it("⚠ `mudariaComPerfil` marca só o que SAIRIA DIFERENTE", async () => {
    // O painel existe para responder "ligar a flag muda o quê?". Um perfil que repete o cadastro
    // não muda nada, e dizer que muda seria alarme falso.
    cenario({ perfis: [{ ...PERFIL_BASE, tribISSQN: "3", regApTribSN: "1" }] });
    const r = await resolverPerfilDeEmissao({ portalClientId: PORTAL });

    expect(r.campos.tribISSQN.mudariaComPerfil).toBe(true);
    expect(r.campos.regApTribSN.mudariaComPerfil).toBe(false); // já era "1"
    expect(r.campos.codigoServicoNacional.mudariaComPerfil).toBe(false);
  });

  it("⚠ `valorHoje` viaja junto — é o 'antes' que o painel compara", async () => {
    cenario({ perfis: [{ ...PERFIL_BASE, regApTribSN: "2" }] });
    const r = await resolverPerfilDeEmissao({ portalClientId: PORTAL });
    expect(r.campos.regApTribSN).toMatchObject({ valor: "2", valorHoje: "1", mudariaComPerfil: true });
  });

  it("um perfil só dispensa escolha", async () => {
    cenario({ perfis: [{ ...PERFIL_BASE, padrao: false, tribISSQN: "4" }] });
    const r = await resolverPerfilDeEmissao({ portalClientId: PORTAL });
    expect(r.temPerfil).toBe(true);
    expect(r.campos.tribISSQN.valor).toBe("4");
  });

  it("⚠⚠ com 2+ perfis e nenhum padrão, NADA do perfil entra — e a tela diz por quê", async () => {
    // Cair no primeiro faria a ordenação decidir a tributação. Sem resposta, vale o cadastro.
    cenario({
      perfis: [
        { ...PERFIL_BASE, id: "a", nome: "A", padrao: false, tribISSQN: "3" },
        { ...PERFIL_BASE, id: "b", nome: "B", padrao: false, tribISSQN: "4" },
      ],
    });
    const r = await resolverPerfilDeEmissao({ portalClientId: PORTAL });

    expect(r.temPerfil).toBe(false);
    expect(r.campos.tribISSQN).toMatchObject({ valor: "1", fonte: FONTE.CRAVADO });
    expect(r.avisos.join(" ")).toMatch(/nenhum marcado como padrão/);
  });

  it("mas o `perfilId` explícito resolve a ambiguidade", async () => {
    cenario({
      perfis: [
        { ...PERFIL_BASE, id: "a", nome: "A", padrao: false, tribISSQN: "3" },
        { ...PERFIL_BASE, id: "b", nome: "B", padrao: false, tribISSQN: "4" },
      ],
    });
    const r = await resolverPerfilDeEmissao({ portalClientId: PORTAL, perfilId: "b" });
    expect(r.campos.tribISSQN.valor).toBe("4");
  });
});

describe("⚠ as guardas que não podem sumir", () => {
  it("código fora da lista habilitada vira AVISO, com os dois lados nomeados", async () => {
    cenario({
      company: { ...COMPANY, codigosServicoNacional: ["310104", "410105"] },
      perfis: [{ ...PERFIL_BASE, codigoServicoNacional: "171901" }],
    });
    const r = await resolverPerfilDeEmissao({ portalClientId: PORTAL });
    expect(r.avisos.join(" ")).toMatch(/171901.*não está entre os habilitados/);
  });

  it("lista VAZIA não é 'pode tudo' nem acusa nada — é o estado de 33 de 33 empresas", async () => {
    cenario({ perfis: [{ ...PERFIL_BASE, codigoServicoNacional: "999999" }] });
    const r = await resolverPerfilDeEmissao({ portalClientId: PORTAL });
    expect(r.avisos).toEqual([]);
  });

  it("⚠⚠ tabela ainda não criada NÃO derruba a leitura — a migration nasce não aplicada", async () => {
    // Mesma disciplina de `buscarTomadoresEmitidos`: uma tela de configuração não pode quebrar
    // porque a fase seguinte ainda não subiu.
    prisma.portalClient.findUnique.mockResolvedValue({ companyId: "co-1" });
    prisma.company.findUnique.mockResolvedValue(COMPANY);
    prisma.perfilEmissaoNfse.findMany.mockRejectedValue(
      Object.assign(new Error("relation does not exist"), { code: "P2021" }),
    );

    const r = await resolverPerfilDeEmissao({ portalClientId: PORTAL });
    expect(r.temPerfil).toBe(false);
    expect(r.campos.codigoServicoNacional.valor).toBe("171901");
  });

  it("empresa sem `Company` legada não inventa valor", async () => {
    prisma.portalClient.findUnique.mockResolvedValue({ companyId: null });
    prisma.perfilEmissaoNfse.findMany.mockResolvedValue([]);
    const r = await resolverPerfilDeEmissao({ portalClientId: PORTAL });
    expect(r.campos.codigoServicoNacional).toMatchObject({ valor: null, fonte: FONTE.INDEFINIDO });
  });

  it("sem `portalClientId`, lança — id ausente não é empresa vazia", async () => {
    await expect(resolverPerfilDeEmissao({ portalClientId: "" })).rejects.toThrow(/obrigatório/);
  });
});

describe("⚠ o derivado do cadastro NÃO grava", () => {
  it("devolve os seis campos e a origem, sem tocar no banco", () => {
    const d = perfilDerivadoDoCadastro(COMPANY);
    expect(d.origem).toBe("DERIVADO_DO_CADASTRO");
    for (const c of CAMPOS) expect(Object.keys(d)).toContain(c.id);
    // Gravar 34 perfis "derivados" num backfill criaria configuração que ninguém afirmou.
    expect(Object.keys(prisma.perfilEmissaoNfse)).not.toContain("create");
  });
});

describe("⚠⚠ o resolvedor NÃO escreve e NÃO emite", () => {
  it("nenhum método de escrita é chamado em nenhum caminho", async () => {
    cenario({ perfis: [{ ...PERFIL_BASE, tribISSQN: "3" }] });
    await resolverPerfilDeEmissao({ portalClientId: PORTAL });
    for (const m of ["create", "update", "upsert", "delete", "createMany", "updateMany"]) {
      expect({ m, chamado: typeof prisma.perfilEmissaoNfse[m] }).toEqual({ m, chamado: "undefined" });
    }
  });

  it("o arquivo não importa nada de emissão nem de rede", () => {
    // Varredura de fonte, no molde de `emissaoLote.js` — o resolvedor é leitura, e leitura não
    // pode ganhar um caminho que emita por acidente.
    const fonte = fs.readFileSync(path.resolve(__dirname, "../resolverPerfilDeEmissao.js"), "utf-8");
    expect(fonte).not.toMatch(/NfseService|axios|fetch\(|\.issue\(/);
  });
});
