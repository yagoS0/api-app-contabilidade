// Unitários do funil: `extrairColunas`, reset por troca de origem, `finalizar` idempotente,
// promoção RECEBIDO → EM_TRILHA e as duas travas de "convertido é somente leitura".

jest.mock("../../../infrastructure/db/prisma.js", () => {
  const models = {};
  const raiz = {};
  const proxy = new Proxy(raiz, {
    get(alvo, prop) {
      if (typeof prop === "symbol") return alvo[prop];
      if (prop === "$transaction") return alvo.$transaction;
      if (!models[prop]) {
        const metodos = {};
        models[prop] = new Proxy(metodos, {
          get(m, metodo) {
            if (typeof metodo === "symbol") return m[metodo];
            if (!m[metodo]) m[metodo] = jest.fn();
            return m[metodo];
          },
        });
      }
      return models[prop];
    },
  });
  raiz.$transaction = jest.fn(async (arg) => (typeof arg === "function" ? arg(proxy) : Promise.all(arg)));
  return { prisma: proxy };
});

import { prisma } from "../../../infrastructure/db/prisma.js";
import {
  OnboardingError,
  atualizar,
  concluirEtapa,
  converter,
  criar,
  descartar,
  extrairColunas,
  listar,
} from "../OnboardingService.js";
import { etapasDaOrigem, ETAPAS_POR_ORIGEM } from "../etapasTemplate.js";

function fichaSalva(over = {}) {
  return {
    id: "onb-1",
    origem: "TRANSFERENCIA",
    status: "RASCUNHO",
    origemPreenchimento: "ESCRITORIO",
    cnpj: null,
    razaoSocial: null,
    responsavelNome: null,
    responsavelEmail: null,
    responsavelTelefone: null,
    emailJaCadastrado: false,
    dados: {},
    ultimoPasso: null,
    enviadoEm: null,
    portalClientId: null,
    etapas: [],
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  prisma.user.findUnique.mockResolvedValue(null);
  prisma.onboardingEtapa.createMany.mockResolvedValue({ count: 0 });
});

describe("extrairColunas — uma fonte só para coluna e JSON", () => {
  test("promove os cinco campos e normaliza CNPJ e e-mail", () => {
    const colunas = extrairColunas("TRANSFERENCIA", {
      cnpj: "11.222.333/0001-81",
      razaoSocial: "  EMPRESA TESTE LTDA ",
      responsavelNome: "Maria",
      responsavelEmail: "  Maria@Empresa.COM ",
      responsavelTelefone: "11 99999-0000",
      campoQualquerDaSpec: "fica só no JSON",
    });

    expect(colunas).toEqual({
      cnpj: "11222333000181",
      razaoSocial: "EMPRESA TESTE LTDA",
      responsavelNome: "Maria",
      responsavelEmail: "maria@empresa.com",
      responsavelTelefone: "11 99999-0000",
    });
  });

  // ⚠ Abertura não tem CNPJ. CNPJ pela metade (o contador digitando) não pode virar coluna: a
  // busca por CNPJ acharia lixo, e o pré-check da conversão compararia contra um número que não é
  // de ninguém.
  test("CNPJ incompleto ou ausente vira null, nunca string parcial", () => {
    expect(extrairColunas("ABERTURA", {}).cnpj).toBeNull();
    expect(extrairColunas("ABERTURA", { cnpj: "112223" }).cnpj).toBeNull();
    expect(extrairColunas("ABERTURA", { cnpj: "" }).cnpj).toBeNull();
  });

  test("campo em branco vira null, não string vazia", () => {
    const colunas = extrairColunas("INATIVA", { razaoSocial: "   ", responsavelNome: "" });
    expect(colunas.razaoSocial).toBeNull();
    expect(colunas.responsavelNome).toBeNull();
  });
});

describe("atualizar — troca de origem zera `dados` no SERVIDOR", () => {
  test("origem diferente ignora o `dados` do body e grava {}", async () => {
    prisma.onboarding.findUnique.mockResolvedValue(fichaSalva({ origem: "ABERTURA", dados: { socios: [{ nome: "A" }] } }));
    prisma.onboarding.update.mockResolvedValue(fichaSalva({ origem: "TRANSFERENCIA", dados: {} }));

    await atualizar("onb-1", {
      origem: "TRANSFERENCIA",
      // Um PATCH atrasado da origem antiga: os sócios NÃO podem sobreviver à troca.
      dados: { socios: [{ nome: "A" }, { nome: "B" }], razaoSocial: "DA ORIGEM ANTIGA" },
    });

    const { data } = prisma.onboarding.update.mock.calls[0][0];
    expect(data.origem).toBe("TRANSFERENCIA");
    expect(data.dados).toEqual({});
    expect(data.ultimoPasso).toBeNull();
    // e as colunas foram LIMPAS junto — promovê-las a partir do body descartado deixaria a lista
    // exibindo o nome da origem antiga ao lado de uma ficha vazia.
    expect(data.razaoSocial).toBeNull();
    expect(data.cnpj).toBeNull();
    expect(data.responsavelEmail).toBeNull();
  });

  test("mesma origem preserva o fluxo normal e SUBSTITUI `dados`", async () => {
    prisma.onboarding.findUnique.mockResolvedValue(
      fichaSalva({ origem: "TRANSFERENCIA", dados: { razaoSocial: "VELHA", responsavelNome: "Some" } })
    );
    prisma.onboarding.update.mockResolvedValue(fichaSalva());

    await atualizar("onb-1", { origem: "TRANSFERENCIA", dados: { razaoSocial: "NOVA" } });

    const { data } = prisma.onboarding.update.mock.calls[0][0];
    // substituição, não merge: `responsavelNome` desapareceu porque não veio no payload
    expect(data.dados).toEqual({ razaoSocial: "NOVA" });
    expect(data.razaoSocial).toBe("NOVA");
    expect(data.responsavelNome).toBeNull();
  });

  test("origem inválida é recusada antes de qualquer escrita", async () => {
    prisma.onboarding.findUnique.mockResolvedValue(fichaSalva());
    await expect(atualizar("onb-1", { origem: "QUALQUER" })).rejects.toMatchObject({
      code: "origem_invalida",
      status: 400,
    });
    expect(prisma.onboarding.update).not.toHaveBeenCalled();
  });

  test("e-mail já cadastrado é sinalizado, nunca bloqueia", async () => {
    prisma.onboarding.findUnique.mockResolvedValue(fichaSalva());
    prisma.onboarding.update.mockResolvedValue(fichaSalva());
    prisma.user.findUnique.mockResolvedValue({ id: "user-ja-existe" });

    await atualizar("onb-1", { dados: { responsavelEmail: "dono@empresa.com" } });

    const { data } = prisma.onboarding.update.mock.calls[0][0];
    expect(data.emailJaCadastrado).toBe(true);
  });
});

describe("finalizar — idempotente", () => {
  test("promove a RECEBIDO, carimba enviadoEm e materializa a checklist com skipDuplicates", async () => {
    prisma.onboarding.findUnique.mockResolvedValue(fichaSalva({ status: "RASCUNHO" }));
    prisma.onboarding.update.mockResolvedValue(fichaSalva({ id: "onb-1", status: "RECEBIDO" }));

    await atualizar("onb-1", { finalizar: true });

    const { data } = prisma.onboarding.update.mock.calls[0][0];
    expect(data.status).toBe("RECEBIDO");
    expect(data.enviadoEm).toBeInstanceOf(Date);

    const chamada = prisma.onboardingEtapa.createMany.mock.calls[0][0];
    expect(chamada.skipDuplicates).toBe(true);
    expect(chamada.data).toHaveLength(ETAPAS_POR_ORIGEM.TRANSFERENCIA.length);
    expect(chamada.data.every((e) => e.onboardingId === "onb-1")).toBe(true);
  });

  // Repetir o "finalizar" com a ficha já EM_TRILHA não pode rebaixar o status nem reescrever a
  // data de envio — seria o clique duplo desfazendo o trabalho já registrado.
  test("repetir com a ficha já EM_TRILHA não mexe em status nem em enviadoEm", async () => {
    prisma.onboarding.findUnique.mockResolvedValue(
      fichaSalva({ status: "EM_TRILHA", enviadoEm: new Date("2026-01-01") })
    );
    prisma.onboarding.update.mockResolvedValue(fichaSalva({ status: "EM_TRILHA" }));

    await atualizar("onb-1", { finalizar: true });

    const { data } = prisma.onboarding.update.mock.calls[0][0];
    expect(data.status).toBeUndefined();
    expect(data.enviadoEm).toBeUndefined();
    // a checklist continua sendo reenviada — é o `skipDuplicates` que a torna inofensiva
    expect(prisma.onboardingEtapa.createMany).toHaveBeenCalledTimes(1);
  });
});

describe("etapasDaOrigem", () => {
  test("numera a ordem a partir da posição e cobre as três origens", () => {
    for (const origem of ["ABERTURA", "TRANSFERENCIA", "INATIVA"]) {
      const etapas = etapasDaOrigem(origem);
      expect(etapas.length).toBeGreaterThan(0);
      expect(etapas.map((e) => e.ordem)).toEqual(etapas.map((_, i) => i + 1));
      expect(new Set(etapas.map((e) => e.chave)).size).toBe(etapas.length);
    }
  });

  test("origem desconhecida devolve lista vazia, não uma trilha inventada", () => {
    expect(etapasDaOrigem("SEI_LA")).toEqual([]);
    expect(etapasDaOrigem(null)).toEqual([]);
  });

  // Toda etapa com efeito colateral precisa de PortalClient — logo, a origem que a oferece precisa
  // ter um passo de CONVERSAO na trilha, senão o botão nunca habilita.
  test("toda origem com etapa de efeito colateral tem também a etapa de conversão", () => {
    for (const origem of ["ABERTURA", "TRANSFERENCIA", "INATIVA"]) {
      const acoes = etapasDaOrigem(origem).map((e) => e.acao).filter(Boolean);
      const temEfeito = acoes.some((a) => ["SITFIS", "CERTIFICADO_A1", "DOCUMENTOS"].includes(a));
      if (temEfeito) expect(acoes).toContain("CONVERSAO");
    }
  });
});

describe("concluirEtapa", () => {
  test("a primeira etapa concluída promove RECEBIDO → EM_TRILHA sozinha", async () => {
    prisma.onboarding.findUnique.mockResolvedValue(fichaSalva({ status: "RECEBIDO" }));
    prisma.onboardingEtapa.findUnique.mockResolvedValue({ id: "et-1", onboardingId: "onb-1" });
    prisma.onboardingEtapa.update.mockResolvedValue({ id: "et-1", concluidaEm: new Date() });

    await concluirEtapa("onb-1", "et-1", { concluida: true, atorId: "user-1" });

    expect(prisma.onboarding.update).toHaveBeenCalledWith({
      where: { id: "onb-1" },
      data: { status: "EM_TRILHA" },
    });
  });

  test("desmarcar limpa data e autor (não deixa 'concluída por X' sem conclusão)", async () => {
    prisma.onboarding.findUnique.mockResolvedValue(fichaSalva({ status: "EM_TRILHA" }));
    prisma.onboardingEtapa.findUnique.mockResolvedValue({ id: "et-1", onboardingId: "onb-1" });
    prisma.onboardingEtapa.update.mockResolvedValue({ id: "et-1" });

    await concluirEtapa("onb-1", "et-1", { concluida: false });

    const { data } = prisma.onboardingEtapa.update.mock.calls[0][0];
    expect(data.concluidaEm).toBeNull();
    expect(data.concluidaPorId).toBeNull();
    expect(prisma.onboarding.update).not.toHaveBeenCalled();
  });

  test("etapa de outro onboarding é 404, não edição cruzada", async () => {
    prisma.onboarding.findUnique.mockResolvedValue(fichaSalva());
    prisma.onboardingEtapa.findUnique.mockResolvedValue({ id: "et-9", onboardingId: "outro" });

    await expect(concluirEtapa("onb-1", "et-9", { concluida: true })).rejects.toMatchObject({
      code: "etapa_nao_encontrada",
      status: 404,
    });
    expect(prisma.onboardingEtapa.update).not.toHaveBeenCalled();
  });
});

describe("convertido é SOMENTE LEITURA", () => {
  test("atualizar → 409 onboarding_convertido", async () => {
    prisma.onboarding.findUnique.mockResolvedValue(fichaSalva({ status: "CONVERTIDO" }));
    await expect(atualizar("onb-1", { dados: { razaoSocial: "X" } })).rejects.toMatchObject({
      code: "onboarding_convertido",
      status: 409,
    });
  });

  test("concluirEtapa → 409 onboarding_convertido", async () => {
    prisma.onboarding.findUnique.mockResolvedValue(fichaSalva({ status: "CONVERTIDO" }));
    await expect(concluirEtapa("onb-1", "et-1", { concluida: true })).rejects.toMatchObject({
      code: "onboarding_convertido",
      status: 409,
    });
  });

  test("converter de novo → 409 com o portalClientId já gravado", async () => {
    prisma.onboarding.findUnique.mockResolvedValue(
      fichaSalva({ status: "CONVERTIDO", portalClientId: "portal-9" })
    );
    await expect(converter("onb-1", {}, { atorId: "u1" })).rejects.toMatchObject({
      code: "onboarding_convertido",
      status: 409,
      extra: { portalClientId: "portal-9" },
    });
  });
});

describe("converter — pré-check de CNPJ e recuperação por vínculo", () => {
  test("CNPJ já na carteira → 409 cnpj_ja_na_carteira com o id e a razão da empresa existente", async () => {
    prisma.onboarding.findUnique.mockResolvedValue(fichaSalva({ status: "EM_TRILHA" }));
    prisma.portalClient.findUnique.mockResolvedValue({ id: "portal-7", razao: "JA EXISTE LTDA" });

    await expect(
      converter("onb-1", { company: { cnpj: "11.222.333/0001-81" } }, { atorId: "u1" })
    ).rejects.toMatchObject({
      code: "cnpj_ja_na_carteira",
      status: 409,
      extra: { portalClientId: "portal-7", razao: "JA EXISTE LTDA" },
    });
  });

  test("vincularPortalClientId grava o vínculo sem criar empresa nenhuma", async () => {
    prisma.onboarding.findUnique
      .mockResolvedValueOnce(fichaSalva({ status: "EM_TRILHA" })) // carregar
      .mockResolvedValueOnce(null) // nenhum outro onboarding usa esse portal
      .mockResolvedValue(fichaSalva({ status: "CONVERTIDO", portalClientId: "portal-7" }));
    prisma.portalClient.findUnique.mockResolvedValue({ id: "portal-7", cnpj: "1", razao: "R" });
    prisma.onboarding.update.mockResolvedValue({});

    const out = await converter("onb-1", { vincularPortalClientId: "portal-7" }, { atorId: "u1" });

    expect(out.vinculado).toBe(true);
    expect(out.portalClientId).toBe("portal-7");
    expect(prisma.company.create).not.toHaveBeenCalled();
    expect(prisma.portalClient.create).not.toHaveBeenCalled();
    const { data } = prisma.onboarding.update.mock.calls[0][0];
    expect(data).toMatchObject({ portalClientId: "portal-7", status: "CONVERTIDO", convertidoPorId: "u1" });
  });

  test("empresa já vinculada a OUTRA ficha → 409, para não haver dois onboardings da mesma empresa", async () => {
    prisma.onboarding.findUnique
      .mockResolvedValueOnce(fichaSalva({ status: "EM_TRILHA" }))
      .mockResolvedValueOnce({ id: "onb-outra" });
    prisma.portalClient.findUnique.mockResolvedValue({ id: "portal-7", cnpj: "1", razao: "R" });

    await expect(
      converter("onb-1", { vincularPortalClientId: "portal-7" }, { atorId: "u1" })
    ).rejects.toMatchObject({ code: "portal_client_ja_vinculado", status: 409 });
    expect(prisma.onboarding.update).not.toHaveBeenCalled();
  });
});

describe("listar e descartar", () => {
  test("rascunho fica fora da lista por padrão", async () => {
    prisma.onboarding.findMany.mockResolvedValue([]);
    await listar({});
    expect(prisma.onboarding.findMany.mock.calls[0][0].where.status).toEqual({ not: "RASCUNHO" });
  });

  test("incluirRascunhos abre a bandeja", async () => {
    prisma.onboarding.findMany.mockResolvedValue([]);
    await listar({ incluirRascunhos: true });
    expect(prisma.onboarding.findMany.mock.calls[0][0].where.status).toBeUndefined();
  });

  test("progresso conta as etapas concluídas e não vaza a lista crua", async () => {
    prisma.onboarding.findMany.mockResolvedValue([
      { id: "a", etapas: [{ id: "1", concluidaEm: new Date() }, { id: "2", concluidaEm: null }] },
    ]);
    const out = await listar({});
    expect(out[0].progresso).toEqual({ total: 2, concluidas: 1 });
    expect(out[0].etapas).toBeUndefined();
  });

  test("só RASCUNHO pode ser descartado", async () => {
    prisma.onboarding.findUnique.mockResolvedValue(fichaSalva({ status: "EM_TRILHA" }));
    await expect(descartar("onb-1")).rejects.toMatchObject({
      code: "somente_rascunho_pode_ser_descartado",
      status: 409,
    });
    expect(prisma.onboarding.delete).not.toHaveBeenCalled();
  });

  test("rascunho é apagado", async () => {
    prisma.onboarding.findUnique.mockResolvedValue(fichaSalva({ status: "RASCUNHO" }));
    prisma.onboarding.delete.mockResolvedValue({});
    await expect(descartar("onb-1")).resolves.toEqual({ ok: true });
  });
});

describe("criar", () => {
  test("nasce RASCUNHO, ESCRITORIO e com `dados` vazio", async () => {
    prisma.onboarding.create.mockResolvedValue({ id: "onb-novo" });
    await criar({ origem: "abertura", criadoPorId: "u1" });
    const { data } = prisma.onboarding.create.mock.calls[0][0];
    expect(data).toEqual({
      origem: "ABERTURA",
      status: "RASCUNHO",
      origemPreenchimento: "ESCRITORIO",
      dados: {},
      criadoPorId: "u1",
    });
  });

  test("origem inválida é OnboardingError, não crash", async () => {
    await expect(criar({ origem: "OUTRA" })).rejects.toBeInstanceOf(OnboardingError);
    expect(prisma.onboarding.create).not.toHaveBeenCalled();
  });
});
