// O PERFIL FISCAL — o serviço que decide o que a tela de atividades mostra.
//
// ⚠⚠ ELE NÃO TINHA UM ÚNICO TESTE, e é ele que responde "quais atividades esta empresa exerce, e
// qual anexo cada uma implica". A tela dele foi a que mais confundiu o dono: mostrava "Simples
// Nacional" com duas atividades ATIVAS enquanto a aba Apuração da MESMA empresa dizia que não havia
// cadastro. Medido: **28 das 34 empresas não têm linha em `cadastros_fiscais`.**

jest.mock("../../../../../infrastructure/db/prisma.js", () => {
  const model = () => ({
    findUnique: jest.fn(async () => null),
    findMany: jest.fn(async () => []),
  });
  return { prisma: { cadastroFiscal: model(), portalClient: model(), company: model(), cnaeAnexo: model() } };
});

import { prisma } from "../../../../../infrastructure/db/prisma.js";
import { resolverPerfilFiscal, anexoDeTipoReceita, normalizarPerfilConfig } from "../PerfilFiscalService.js";

const PORTAL = "pc-1";

const CATALOGO = [
  { cnae: "7319003", descricao: "Marketing direto", tipoReceitaSugerido: "SERVICO_FATOR_R", ambiguo: false },
  { cnae: "6319400", descricao: "Portais e provedores de conteúdo", tipoReceitaSugerido: "SERVICO_FATOR_R", ambiguo: false },
  { cnae: "4751201", descricao: "Comércio varejista de computadores", tipoReceitaSugerido: "REVENDA_MERCADORIA", ambiguo: false },
];

beforeEach(() => {
  jest.clearAllMocks();
  prisma.cadastroFiscal.findUnique.mockResolvedValue(null);
  prisma.portalClient.findUnique.mockResolvedValue({ companyId: "co-1" });
  prisma.company.findUnique.mockResolvedValue({
    cnaePrincipal: "7319003", cnaesSecundarios: ["6319400"],
    regimeTributario: "SIMPLES", optanteSimples: true,
  });
  prisma.cnaeAnexo.findMany.mockResolvedValue(CATALOGO);
});

describe("⚠⚠ `temCadastro` DISTINGUE O QUE ESTÁ SALVO DO QUE FOI DERIVADO", () => {
  it("sem linha em `cadastros_fiscais`, ele volta FALSE — e é o que a tela precisa dizer", async () => {
    // É o estado de 28 das 34 empresas em produção. O backend responde certo; era a tela que não
    // lia esse campo e desenhava o perfil derivado com cara de cadastro salvo.
    const r = await resolverPerfilFiscal({ portalClientId: PORTAL });
    expect(r.temCadastro).toBe(false);
    expect(r.candidatos.length).toBeGreaterThan(0);
  });

  it("com linha salva, TRUE", async () => {
    prisma.cadastroFiscal.findUnique.mockResolvedValue({
      cnaePrincipal: "7319003", cnaesSecundarios: [], regime: "SIMPLES_NACIONAL",
      usaFatorR: true, perfilAtividades: [],
    });
    expect((await resolverPerfilFiscal({ portalClientId: PORTAL })).temCadastro).toBe(true);
  });

  it("⚠ o perfil DERIVADO nasce com tudo ATIVO e nada como PADRÃO — são defaults, não escolhas", async () => {
    const r = await resolverPerfilFiscal({ portalClientId: PORTAL });
    expect(r.candidatos.every((c) => c.ativo === true)).toBe(true);
    expect(r.candidatos.every((c) => c.padrao === false)).toBe(true);
  });
});

describe("⚠⚠ SÓ ATIVIDADE ATIVA CONTA NO FATOR R — o defeito do `if` dentro do laço", () => {
  // O `temFatorR` antigo era `if (sujeitoFatorR) temFatorR = true` DENTRO do laço, antes de
  // `cfg.ativo` ser lido: um CNAE que o contador DESATIVOU continuava forçando o Fator R da empresa
  // inteira. Hoje a resposta vem de `sujeitoAoFatorR`, que filtra pelo ativo.
  it("atividade de Fator R DESATIVADA não força o Fator R da empresa", async () => {
    prisma.cadastroFiscal.findUnique.mockResolvedValue({
      cnaePrincipal: "7319003", cnaesSecundarios: ["4751201"], regime: "SIMPLES_NACIONAL",
      usaFatorR: false,
      perfilAtividades: [{ cnae: "7319003", ativo: false }, { cnae: "4751201", ativo: true }],
    });
    const r = await resolverPerfilFiscal({ portalClientId: PORTAL });
    expect(r.temFatorR).toBe(false);
    expect(r.fatorR.resposta).toBe("nao");
  });

  it("ativa, ela força — e os CNAEs saem nomeados", async () => {
    const r = await resolverPerfilFiscal({ portalClientId: PORTAL });
    expect(r.temFatorR).toBe(true);
    expect(r.fatorR.cnaes).toEqual(expect.arrayContaining(["7319003", "6319400"]));
  });

  it("⚠ e a DIVERGÊNCIA aparece quando o cadastro não marca `usaFatorR`", async () => {
    const r = await resolverPerfilFiscal({ portalClientId: PORTAL });
    expect(r.fatorR.divergencia?.codigo).toBe("CADASTRO_NAO_MARCA_FATOR_R");
  });

  it("⚠⚠ `temFatorR` só é TRUE com resposta \"sim\" — `indefinido` não é `true`", async () => {
    // CNAE fora do catálogo: o portal cobre ~10% da CNAE 2.3, e "não achei" não é "não tem".
    prisma.cnaeAnexo.findMany.mockResolvedValue([]);
    const r = await resolverPerfilFiscal({ portalClientId: PORTAL });
    expect(r.fatorR.resposta).toBe("indefinido");
    expect(r.temFatorR).toBe(false);
  });
});

describe("⚠ CNAE fora do catálogo é MARCADO, não escondido", () => {
  it("sai com `impeditivo: true` e o texto de revisão", async () => {
    prisma.cnaeAnexo.findMany.mockResolvedValue([CATALOGO[0]]);
    const r = await resolverPerfilFiscal({ portalClientId: PORTAL });
    const fora = r.candidatos.find((c) => c.cnae === "6319400");
    expect(fora.impeditivo).toBe(true);
    expect(fora.descricao).toMatch(/revisar/i);
    expect(fora.anexoLabel).toBe("—");
  });
});

describe("⚠ `anexoDeTipoReceita` — o rótulo que a tela imprime", () => {
  it("Fator R não tem anexo fixo: ele sai da folha", () => {
    const r = anexoDeTipoReceita("SERVICO_FATOR_R");
    expect(r).toMatchObject({ anexo: null, anexoLabel: "III ou V (Fator R)", sujeitoFatorR: true });
  });

  it("tipo conhecido vira anexo", () => {
    expect(anexoDeTipoReceita("REVENDA_MERCADORIA")).toMatchObject({ anexo: "I", sujeitoFatorR: false });
  });

  it("⚠ tipo AUSENTE devolve traço e pede revisão — nunca um anexo palpite", () => {
    for (const t of [null, undefined, "", "RECEITA_NAO_CLASSIFICADA"]) {
      const r = anexoDeTipoReceita(t);
      expect(r.anexo).toBeNull();
      expect(r.revisao).toBe(true);
    }
  });
});

describe("⚠ `normalizarPerfilConfig` — o que o PUT aceita", () => {
  it("mantém só os campos conhecidos e descarta ruído", () => {
    const [c] = normalizarPerfilConfig([{ cnae: "7319003", ativo: false, padrao: true, lixo: "x" }]);
    expect(c).not.toHaveProperty("lixo");
    expect(c).toMatchObject({ cnae: "7319003", ativo: false, padrao: true });
  });

  it("⚠ `ativo` ausente vira TRUE — é o default do serviço, e inverter esconderia atividade", () => {
    expect(normalizarPerfilConfig([{ cnae: "7319003" }])[0].ativo).toBe(true);
  });

  it("linha sem CNAE é descartada", () => {
    expect(normalizarPerfilConfig([{ ativo: true }, { cnae: "123" }])).toEqual([]);
  });

  it.each([null, undefined, "x", 42])("%p vira lista vazia", (v) => {
    expect(normalizarPerfilConfig(v)).toEqual([]);
  });
});

describe("⚠⚠ AS DUAS ROTAS PUBLICAM A MESMA FORMA DO FATOR R", () => {
  // `GET /planejamento` e `GET /perfil-fiscal` devolvem a resposta da MESMA regra. Se uma publicar
  // `cnaesDeFatorR` e a outra `cnaes`, a tela que lê uma delas cai na frase genérica — sem erro
  // nenhum. Foi assim que o defeito nasceu, e no navegador ele não apareceu porque o mock já usava
  // a forma certa. A amarração é TEXTUAL: os dois serviços não se importam.
  const fs = require("node:fs");
  const path = require("node:path");

  it("`perfil-fiscal` publica `cnaes` — nunca a chave interna da regra", async () => {
    const r = await resolverPerfilFiscal({ portalClientId: PORTAL });
    expect(r.fatorR).toHaveProperty("cnaes");
    expect(r.fatorR).not.toHaveProperty("cnaesDeFatorR");
  });

  it("⚠ e o serviço do planejamento publica a mesma chave", () => {
    const fonte = fs.readFileSync(
      path.resolve(__dirname, "../../../../planejamento/DadosPlanejamentoService.js"), "utf-8",
    );
    expect(fonte).toMatch(/cnaes:\s*respostaFatorR\.cnaesDeFatorR/);
  });
});
