// ⚠⚠ A LIGAÇÃO: O PLANEJAMENTO USA A REGRA DERIVADA, E NÃO O BOOLEANO CRU DO CADASTRO.
//
// ⚠ ESTE ARQUIVO EXISTE PORQUE O EXPERIMENTO VOLTOU ZERO. Depois de ligar a derivação, devolvi o
// serviço ao `Boolean(cadastro.usaFatorR)` de antes para contar os vermelhos — e não caiu NENHUM
// teste. A regra pura tinha 17, e a ligação tinha zero: qualquer um poderia reverter a decisão sem
// que nada acusasse. Guarda que não é medida não é guarda.
//
// O defeito original, relatado pelo dono em 25/08/2026: o Perfil fiscal da LENTE mostrava os dois
// CNAEs como "III ou V (Fator R) — sim" e o Planejamento da MESMA empresa exibia o checkbox
// desmarcado, com o anexo travado em III. Com o RBT12 dela (~R$ 718 mil), III ≈ 11,04% contra
// V ≈ 17,6%.

const prismaModel = () => ({
  findUnique: jest.fn(async () => null),
  findFirst: jest.fn(async () => null),
  findMany: jest.fn(async () => []),
  aggregate: jest.fn(async () => ({ _sum: { total: null } })),
  count: jest.fn(async () => 0),
  create: jest.fn(async () => { throw new Error("ESCRITA PROIBIDA no planejamento"); }),
  update: jest.fn(async () => { throw new Error("ESCRITA PROIBIDA no planejamento"); }),
  upsert: jest.fn(async () => { throw new Error("ESCRITA PROIBIDA no planejamento"); }),
});

jest.mock("../../../infrastructure/db/prisma.js", () => ({
  prisma: {
    portalClient: prismaModel(), company: prismaModel(), cadastroFiscal: prismaModel(),
    apuracaoSnapshot: prismaModel(), companyMonthlyCircular: prismaModel(),
    rbtExtratoCache: prismaModel(), portalInvoice: prismaModel(), accountingEntry: prismaModel(),
    cnaeAnexo: prismaModel(),
  },
}));
jest.mock("../../notas/apuracao/v2/FechamentoService.js", () => ({
  whereFaturamentoEmit: () => ({ papel: "EMIT", statusEfetivo: "autorizada" }),
}));
jest.mock("../../notas/apuracao/v2/FolhaDerivadaService.js", () => ({
  competenciasDe12Meses: () => ["2025-08"],
  derivarFolha12m: async () => ({ total: 0, mesesComLancamento: 0, porMes: [], disponivel: false }),
}));

// ⚠ O PERFIL É DUBLADO, não reimplementado: o que se afirma aqui é que o serviço o CONSULTA e
// respeita a resposta — a regra em si já tem 17 testes próprios.
const mockPerfil = jest.fn(async () => ({ candidatos: [], usaFatorR: false, temCadastro: true }));
jest.mock("../../notas/apuracao/v2/PerfilFiscalService.js", () => ({
  resolverPerfilFiscal: (...a) => mockPerfil(...a),
}));

import { prisma } from "../../../infrastructure/db/prisma.js";
import { montarDadosPlanejamento } from "../DadosPlanejamentoService.js";

const PORTAL = { id: "pc-lente", razao: "LENTE", cnpj: "24352609000198", companyId: "co-1" };
const ATV_FATOR_R = { cnae: "7319003", sujeitoFatorR: true, ativo: true, impeditivo: false };

beforeEach(() => {
  jest.clearAllMocks();
  prisma.portalClient.findUnique.mockResolvedValue(PORTAL);
  prisma.cadastroFiscal.findUnique.mockResolvedValue({ regime: "SIMPLES_NACIONAL", usaFatorR: false });
  mockPerfil.mockResolvedValue({ candidatos: [], usaFatorR: false, temCadastro: true });
});

const montar = () => montarDadosPlanejamento({ portalClientId: PORTAL.id, agora: new Date("2026-08-25T00:00:00Z") });

describe("⚠⚠ O PERFIL VENCE O BOOLEANO", () => {
  it("CNAE de Fator R com `usaFatorR: false` ⇒ o campo sai TRUE — o caso da LENTE", async () => {
    mockPerfil.mockResolvedValue({ candidatos: [ATV_FATOR_R], usaFatorR: false, temCadastro: true });
    const r = await montar();
    expect(r.campos.sujeitoFatorR).toMatchObject({ apurado: true, valor: true });
    expect(r.campos.sujeitoFatorR.origem).toMatch(/7319003/);
  });

  it("⚠ e a DIVERGÊNCIA viaja no payload, para a tela avisar", async () => {
    mockPerfil.mockResolvedValue({ candidatos: [ATV_FATOR_R], usaFatorR: false, temCadastro: true });
    const r = await montar();
    expect(r.fatorR.divergencia.codigo).toBe("CADASTRO_NAO_MARCA_FATOR_R");
    expect(r.fatorR.cnaes).toEqual(["7319003"]);
  });

  it("⚠⚠ e o ANEXO sai AUSENTE — com Fator R ele vem da folha, não do cadastro", async () => {
    // Sem isto, a tela continuaria travando o anexo em III numa empresa cujo anexo depende da folha.
    mockPerfil.mockResolvedValue({ candidatos: [ATV_FATOR_R], usaFatorR: false, temCadastro: true });
    prisma.company.findUnique.mockResolvedValue({ regimeTributario: "SIMPLES", simplesAnexo: "III" });
    const r = await montar();
    expect(r.campos.anexo.apurado).toBe(false);
    expect(r.campos.anexo.motivoAusencia).toMatch(/sai da folha/i);
  });

  it("sem atividade de Fator R e com o cadastro desmarcado ⇒ FALSE, sem divergência", async () => {
    mockPerfil.mockResolvedValue({
      candidatos: [{ cnae: "6201500", sujeitoFatorR: false, ativo: true, impeditivo: false }],
      usaFatorR: false, temCadastro: true,
    });
    const r = await montar();
    expect(r.campos.sujeitoFatorR).toMatchObject({ apurado: true, valor: false });
    expect(r.fatorR.divergencia).toBeNull();
  });
});

describe("⚠⚠ INDEFINIDO VIRA AUSENTE, NUNCA `false`", () => {
  it("sem cadastro fiscal, o campo sai NÃO APURADO com o motivo", async () => {
    // Um `false` aqui derruba a empresa no Anexo V — a alíquota MAIOR — sem ninguém ter decidido.
    prisma.cadastroFiscal.findUnique.mockResolvedValue(null);
    mockPerfil.mockResolvedValue({ candidatos: [], usaFatorR: false, temCadastro: false });
    const r = await montar();
    expect(r.campos.sujeitoFatorR.apurado).toBe(false);
    expect(r.campos.sujeitoFatorR.valor).toBeNull();
    expect(r.campos.sujeitoFatorR.motivoAusencia).toMatch(/não há como saber/i);
  });

  it("CNAE fora do catálogo também sai AUSENTE — \"não achei\" não é \"não tem\"", async () => {
    mockPerfil.mockResolvedValue({
      candidatos: [{ cnae: "9999999", sujeitoFatorR: false, ativo: true, impeditivo: true }],
      usaFatorR: false, temCadastro: true,
    });
    const r = await montar();
    expect(r.campos.sujeitoFatorR.apurado).toBe(false);
  });
});

describe("⚠ o perfil não pode derrubar a tela", () => {
  it("perfil que FALHA ⇒ resposta indefinida, e o resto do payload continua vindo", async () => {
    mockPerfil.mockRejectedValue(new Error("banco caiu"));
    const r = await montar();
    expect(r.campos.sujeitoFatorR.apurado).toBe(false);
    expect(r.empresa.razao).toBe("LENTE");
  });

  it("⚠ e o planejamento continua sem ESCREVER nada", async () => {
    mockPerfil.mockResolvedValue({ candidatos: [ATV_FATOR_R], usaFatorR: false, temCadastro: true });
    await montar();
    for (const modelo of Object.values(prisma)) {
      expect(modelo.create).not.toHaveBeenCalled();
      expect(modelo.update).not.toHaveBeenCalled();
      expect(modelo.upsert).not.toHaveBeenCalled();
    }
  });
});

describe("⚠⚠ A SUGESTÃO DA CATEGORIA DE PRESUNÇÃO VIAJA — SEM AFIRMAR NADA", () => {
  // Decisão do dono (25/08/2026): "sugerir por CNAE, você confirma". A diferença entre DERIVAR e
  // SUGERIR é o módulo inteiro — e é ela que estes testes prendem.
  it("⚠⚠ o CAMPO continua AUSENTE, mesmo havendo sugestão", async () => {
    // `apurado: true` quer dizer "veio da empresa", e a tela imprime "da empresa · …" ao lado. Uma
    // sugestão carimbada assim se leria como confirmada.
    mockPerfil.mockResolvedValue({
      candidatos: [{ cnae: "4751201", tipoReceita: "REVENDA_MERCADORIA", ativo: true }],
      usaFatorR: false, temCadastro: true,
    });
    const r = await montar();
    expect(r.campos.atividadePresumido.apurado).toBe(false);
    expect(r.campos.atividadePresumido.valor).toBeNull();
  });

  it("e a sugestão vem no bloco PRÓPRIO, com as exceções e `confirmadoPeloContador: false`", async () => {
    mockPerfil.mockResolvedValue({
      candidatos: [{ cnae: "4751201", tipoReceita: "REVENDA_MERCADORIA", ativo: true }],
      usaFatorR: false, temCadastro: true,
    });
    const r = await montar();
    expect(r.presumido.sugestao).toBe("comercio");
    expect(r.presumido.rotulo).toBe("Comércio / Indústria");
    expect(r.presumido.confianca).toBe("alta");
    expect(r.presumido.confirmadoPeloContador).toBe(false);
    expect(r.presumido.excecoes.join(" ")).toMatch(/COMBUSTÍVEL/i);
  });

  it("⚠ serviço sai com confiança MÉDIA e as exceções da lei nomeadas", async () => {
    mockPerfil.mockResolvedValue({
      candidatos: [{ cnae: "6201501", tipoReceita: "SERVICO_FATOR_R", ativo: true }],
      usaFatorR: false, temCadastro: true,
    });
    const r = await montar();
    expect(r.presumido.sugestao).toBe("servicos");
    expect(r.presumido.confianca).toBe("media");
    expect(r.presumido.excecoes.join(" ")).toMatch(/hospitalares/i);
  });

  it("⚠⚠ CNAE fora do catálogo NÃO cai em \"serviços\" — sai sem sugestão", async () => {
    // 18 dos 64 CNAEs da carteira estão fora do catálogo. Cair no default afirmaria 32% para quem
    // pode ser 8%.
    mockPerfil.mockResolvedValue({
      candidatos: [{ cnae: "6462000", tipoReceita: null, ativo: true }],
      usaFatorR: false, temCadastro: true,
    });
    const r = await montar();
    expect(r.presumido.sugestao).toBeNull();
    expect(r.campos.atividadePresumido.motivoAusencia).toMatch(/não está no catálogo/i);
  });

  it("⚠ atividades que discordam ⇒ nenhuma sugestão, com o motivo na tela", async () => {
    mockPerfil.mockResolvedValue({
      candidatos: [
        { cnae: "4751201", tipoReceita: "REVENDA_MERCADORIA", ativo: true },
        { cnae: "6201501", tipoReceita: "SERVICO_FATOR_R", ativo: true },
      ],
      usaFatorR: false, temCadastro: true,
    });
    const r = await montar();
    expect(r.presumido.sugestao).toBeNull();
    expect(r.campos.atividadePresumido.motivoAusencia).toMatch(/categorias DIFERENTES/i);
  });
});
