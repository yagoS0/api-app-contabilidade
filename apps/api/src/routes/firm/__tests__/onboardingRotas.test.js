// Rotas do funil, contra o `createFirmPortalRouter` REAL (o mesmo motivo do teste de
// caracterização: um mini-router testaria uma cópia). O Prisma é um dublê em memória com um `Map`
// por tabela — assim o percurso criar → PATCH → finalizar → etapa → convert acontece de verdade,
// incluindo o unique de `(onboardingId, chave)` que torna o "finalizar" reexecutável.

import request from "supertest";
import express from "express";

jest.mock("../../../infrastructure/db/prisma.js", () => {
  const onboardings = new Map();
  const etapas = new Map();
  const portais = new Map();
  const usuarios = new Map();

  let seq = 0;
  const novoId = (p) => `${p}-${++seq}`;
  const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));

  function casa(registro, where) {
    return Object.entries(where || {}).every(([chave, valor]) => {
      if (valor && typeof valor === "object" && !Array.isArray(valor)) {
        if ("not" in valor) return registro[chave] !== valor.not;
        if ("contains" in valor) {
          return String(registro[chave] || "").toLowerCase().includes(String(valor.contains).toLowerCase());
        }
      }
      return registro[chave] === valor;
    });
  }

  const onboarding = {
    create: jest.fn(async ({ data }) => {
      const registro = {
        id: novoId("onb"),
        origem: null, status: "RASCUNHO", origemPreenchimento: "ESCRITORIO",
        cnpj: null, razaoSocial: null, responsavelNome: null, responsavelEmail: null,
        responsavelTelefone: null, emailJaCadastrado: false, dados: {}, ultimoPasso: null,
        enviadoEm: null, criadoPorId: null, portalClientId: null, convertidoEm: null,
        convertidoPorId: null, desistiuEm: null, motivoDesistencia: null,
        createdAt: new Date(), updatedAt: new Date(),
        ...data,
      };
      onboardings.set(registro.id, registro);
      return clone(registro);
    }),
    findUnique: jest.fn(async ({ where, include }) => {
      let achado = null;
      if (where?.id) achado = onboardings.get(where.id) || null;
      else if ("portalClientId" in (where || {})) {
        achado = [...onboardings.values()].find((o) => o.portalClientId === where.portalClientId) || null;
      }
      if (!achado) return null;
      const saida = clone(achado);
      if (include?.etapas) {
        saida.etapas = [...etapas.values()]
          .filter((e) => e.onboardingId === achado.id)
          .sort((a, b) => a.ordem - b.ordem)
          .map(clone);
      }
      return saida;
    }),
    findMany: jest.fn(async ({ where, include } = {}) => {
      let lista = [...onboardings.values()].filter((o) => {
        const { OR, ...resto } = where || {};
        if (!casa(o, resto)) return false;
        if (Array.isArray(OR) && OR.length) return OR.some((cond) => casa(o, cond));
        return true;
      });
      lista = lista.sort((a, b) => b.updatedAt - a.updatedAt).map(clone);
      if (include?.etapas) {
        for (const item of lista) {
          item.etapas = [...etapas.values()].filter((e) => e.onboardingId === item.id).map(clone);
        }
      }
      return lista;
    }),
    update: jest.fn(async ({ where, data }) => {
      const atual = onboardings.get(where.id);
      if (!atual) throw new Error("registro nao encontrado");
      Object.assign(atual, data, { updatedAt: new Date() });
      return clone(atual);
    }),
    delete: jest.fn(async ({ where }) => {
      const atual = onboardings.get(where.id);
      onboardings.delete(where.id);
      return clone(atual);
    }),
  };

  const onboardingEtapa = {
    createMany: jest.fn(async ({ data, skipDuplicates }) => {
      let count = 0;
      for (const linha of data) {
        const existe = [...etapas.values()].some(
          (e) => e.onboardingId === linha.onboardingId && e.chave === linha.chave
        );
        // O unique `(onboardingId, chave)` do schema, implementado de verdade — é ele que torna o
        // "finalizar" reexecutável, e um dublê que ignorasse isso não exerceria a regra.
        if (existe) {
          if (skipDuplicates) continue;
          throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
        }
        const registro = {
          id: novoId("et"), concluidaEm: null, concluidaPorId: null, observacao: null,
          createdAt: new Date(), updatedAt: new Date(), ...linha,
        };
        etapas.set(registro.id, registro);
        count += 1;
      }
      return { count };
    }),
    findUnique: jest.fn(async ({ where }) => clone(etapas.get(where.id) || null)),
    update: jest.fn(async ({ where, data }) => {
      const atual = etapas.get(where.id);
      Object.assign(atual, data, { updatedAt: new Date() });
      return clone(atual);
    }),
  };

  const portalClient = {
    findUnique: jest.fn(async ({ where }) => {
      if (where?.id) return clone(portais.get(where.id) || null);
      if (where?.cnpj) return clone([...portais.values()].find((p) => p.cnpj === where.cnpj) || null);
      return null;
    }),
    create: jest.fn(async ({ data }) => {
      const registro = { id: novoId("portal"), ...data };
      portais.set(registro.id, registro);
      return clone(registro);
    }),
    findMany: jest.fn(async () => [...portais.values()].map((p) => ({ id: p.id }))),
  };

  const user = {
    findUnique: jest.fn(async ({ where }) => clone([...usuarios.values()].find((u) => u.email === where.email) || null)),
    create: jest.fn(async ({ data }) => {
      const registro = { id: novoId("user"), ...data };
      usuarios.set(registro.id, registro);
      return clone(registro);
    }),
  };

  const generico = () => ({
    findUnique: jest.fn(async () => null),
    findMany: jest.fn(async () => []),
    findFirst: jest.fn(async () => null),
    create: jest.fn(async ({ data }) => ({ id: novoId("x"), ...data })),
    createMany: jest.fn(async () => ({ count: 0 })),
    update: jest.fn(async ({ data }) => ({ ...data })),
    upsert: jest.fn(async ({ create }) => ({ ...create })),
    delete: jest.fn(async () => ({})),
    groupBy: jest.fn(async () => []),
    count: jest.fn(async () => 0),
  });

  const fixos = { onboarding, onboardingEtapa, portalClient, user };
  const dinamicos = {};
  const raiz = {
    __limpar: () => {
      onboardings.clear(); etapas.clear(); portais.clear(); usuarios.clear(); seq = 0;
    },
    __portais: portais,
  };

  const proxy = new Proxy(raiz, {
    get(alvo, prop) {
      if (typeof prop === "symbol") return alvo[prop];
      if (prop in alvo) return alvo[prop];
      if (fixos[prop]) return fixos[prop];
      if (!dinamicos[prop]) dinamicos[prop] = generico();
      return dinamicos[prop];
    },
  });

  raiz.$transaction = jest.fn(async (arg) => (typeof arg === "function" ? arg(proxy) : Promise.all(arg)));
  return { prisma: proxy };
});

jest.mock("bcryptjs", () => ({
  __esModule: true,
  default: { hash: jest.fn(async (s) => `hash:${s}`), compare: jest.fn(async () => true) },
}));

import { createFirmPortalRouter } from "../index.js";
import { prisma } from "../../../infrastructure/db/prisma.js";
import { etapasDaOrigem } from "../../../application/onboarding/etapasTemplate.js";

let usuarioAtual = { id: "user-firm-1", role: "contador", accountType: "FIRM" };

function montarApp() {
  const app = express();
  app.use(express.json());
  app.locals.ensureAuthorized = async (req) => {
    req.auth = { user: { ...usuarioAtual } };
    return true;
  };
  const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  app.use("/firm", createFirmPortalRouter({ ensureAuthorized: app.locals.ensureAuthorized, log }));
  return app;
}

const EMPRESA_VALIDA = {
  ownerEmail: "dono@nova.com",
  ownerName: "Dono",
  ownerPassword: "Senha@Forte1",
  company: {
    razaoSocial: "NOVA EMPRESA LTDA",
    cnpj: "11.222.333/0001-81",
    regimeTributario: "SIMPLES",
    cnaePrincipal: "6201-5/01",
    endereco: {
      rua: "Rua A", numero: "1", bairro: "Centro", cidade: "São Paulo", uf: "SP", cep: "01001-000",
    },
  },
};

let app;
beforeEach(() => {
  prisma.__limpar();
  usuarioAtual = { id: "user-firm-1", role: "contador", accountType: "FIRM" };
  app = montarApp();
  // Plano de contas global configurado — pré-requisito do provisionamento.
  prisma.chartOfAccount.groupBy.mockResolvedValue(
    ["ATIVO", "PASSIVO", "RECEITA", "DESPESA", "PATRIMONIO"].map((tipo) => ({ tipo, _count: { _all: 1 } }))
  );
});

describe("percurso completo: criar → PATCH → finalizar → etapa → convert", () => {
  test("cada passo devolve o estado esperado e a conversão fecha a ficha", async () => {
    // 1) criar
    const criada = await request(app).post("/firm/onboardings").send({ origem: "TRANSFERENCIA" });
    expect(criada.status).toBe(201);
    expect(criada.body.onboarding.status).toBe("RASCUNHO");
    const id = criada.body.onboarding.id;

    // 2) três PATCH, um por tela do wizard — o rascunho é salvo a cada passo
    const p1 = await request(app).patch(`/firm/onboardings/${id}`).send({
      dados: { razaoSocial: "EMPRESA QUE VEM DO OUTRO CONTADOR LTDA", cnpj: "11.222.333/0001-81" },
      ultimoPasso: "identificacao",
    });
    expect(p1.status).toBe(200);
    expect(p1.body.onboarding.razaoSocial).toBe("EMPRESA QUE VEM DO OUTRO CONTADOR LTDA");
    expect(p1.body.onboarding.cnpj).toBe("11222333000181");

    const p2 = await request(app).patch(`/firm/onboardings/${id}`).send({
      dados: {
        razaoSocial: "EMPRESA QUE VEM DO OUTRO CONTADOR LTDA",
        cnpj: "11.222.333/0001-81",
        responsavelNome: "Maria",
        responsavelEmail: "maria@empresa.com",
      },
      ultimoPasso: "responsavel",
    });
    expect(p2.body.onboarding.responsavelEmail).toBe("maria@empresa.com");
    expect(p2.body.onboarding.emailJaCadastrado).toBe(false);

    await request(app).patch(`/firm/onboardings/${id}`).send({ ultimoPasso: "revisao" });

    // 3) finalizar — materializa a checklist
    const fim = await request(app).patch(`/firm/onboardings/${id}`).send({ finalizar: true });
    expect(fim.status).toBe(200);
    expect(fim.body.onboarding.status).toBe("RECEBIDO");
    expect(fim.body.onboarding.enviadoEm).toBeTruthy();
    expect(fim.body.onboarding.etapas).toHaveLength(etapasDaOrigem("TRANSFERENCIA").length);
    // título e descrição são CÓPIA do template, não leitura viva
    expect(fim.body.onboarding.etapas[0].titulo).toBe(etapasDaOrigem("TRANSFERENCIA")[0].titulo);

    // 4) concluir a primeira etapa → promove sozinha para EM_TRILHA
    const etapaId = fim.body.onboarding.etapas[0].id;
    const etapa = await request(app)
      .patch(`/firm/onboardings/${id}/etapas/${etapaId}`)
      .send({ concluida: true, observacao: "conferido por telefone" });
    expect(etapa.status).toBe(200);
    expect(etapa.body.onboarding.status).toBe("EM_TRILHA");
    expect(etapa.body.etapa.concluidaEm).toBeTruthy();
    expect(etapa.body.etapa.concluidaPorId).toBe("user-firm-1");

    // 5) converter
    const conv = await request(app).post(`/firm/onboardings/${id}/convert`).send(EMPRESA_VALIDA);
    expect(conv.status).toBe(201);
    expect(conv.body.portalClientId).toBeTruthy();
    expect(conv.body.onboarding.status).toBe("CONVERTIDO");
    expect(conv.body.onboarding.portalClientId).toBe(conv.body.portalClientId);
    expect(conv.body.onboarding.convertidoEm).toBeTruthy();
  });
});

describe("idempotência e 409", () => {
  async function fichaFinalizada(origem = "TRANSFERENCIA") {
    const { body } = await request(app).post("/firm/onboardings").send({ origem });
    const id = body.onboarding.id;
    await request(app).patch(`/firm/onboardings/${id}`).send({ finalizar: true });
    return id;
  }

  test("finalizar duas vezes NÃO duplica a checklist", async () => {
    const id = await fichaFinalizada();
    const primeira = await request(app).get(`/firm/onboardings/${id}`);
    const quantidade = primeira.body.onboarding.etapas.length;

    const segunda = await request(app).patch(`/firm/onboardings/${id}`).send({ finalizar: true });

    expect(segunda.status).toBe(200);
    expect(segunda.body.onboarding.etapas).toHaveLength(quantidade);
  });

  test("convert duas vezes → 409 onboarding_convertido com o portalClientId", async () => {
    const id = await fichaFinalizada();
    const primeira = await request(app).post(`/firm/onboardings/${id}/convert`).send(EMPRESA_VALIDA);
    expect(primeira.status).toBe(201);

    const segunda = await request(app).post(`/firm/onboardings/${id}/convert`).send(EMPRESA_VALIDA);
    expect(segunda.status).toBe(409);
    expect(segunda.body.error).toBe("onboarding_convertido");
    expect(segunda.body.portalClientId).toBe(primeira.body.portalClientId);
  });

  test("CNPJ já na carteira → 409 cnpj_ja_na_carteira, com o caminho de recuperação no corpo", async () => {
    // Uma empresa já existe com esse CNPJ (convertida por outra ficha).
    const idA = await fichaFinalizada();
    const primeira = await request(app).post(`/firm/onboardings/${idA}/convert`).send(EMPRESA_VALIDA);
    expect(primeira.status).toBe(201);

    const idB = await fichaFinalizada();
    const conflito = await request(app).post(`/firm/onboardings/${idB}/convert`).send(EMPRESA_VALIDA);

    expect(conflito.status).toBe(409);
    expect(conflito.body.error).toBe("cnpj_ja_na_carteira");
    expect(conflito.body.portalClientId).toBe(primeira.body.portalClientId);
    expect(conflito.body.razao).toBe("NOVA EMPRESA LTDA");
  });

  test("vincularPortalClientId fecha a ficha sem criar empresa nova", async () => {
    const idA = await fichaFinalizada();
    const primeira = await request(app).post(`/firm/onboardings/${idA}/convert`).send(EMPRESA_VALIDA);
    const portalId = primeira.body.portalClientId;
    // libera o vínculo para simular "a empresa foi criada mas o update da ficha falhou"
    await request(app).get(`/firm/onboardings/${idA}`);
    prisma.onboarding.update.mockClear();

    const idB = await fichaFinalizada();
    // a ficha A ainda ocupa o vínculo → recusa, e é o que impede duas fichas para a mesma empresa
    const recusa = await request(app)
      .post(`/firm/onboardings/${idB}/convert`)
      .send({ vincularPortalClientId: portalId });
    expect(recusa.status).toBe(409);
    expect(recusa.body.error).toBe("portal_client_ja_vinculado");
  });

  test("ficha convertida é somente leitura: PATCH → 409", async () => {
    const id = await fichaFinalizada();
    await request(app).post(`/firm/onboardings/${id}/convert`).send(EMPRESA_VALIDA);
    const patch = await request(app).patch(`/firm/onboardings/${id}`).send({ dados: { razaoSocial: "X" } });
    expect(patch.status).toBe(409);
    expect(patch.body.error).toBe("onboarding_convertido");
  });
});

describe("gates", () => {
  test("preencher e marcar etapa ficam liberados a qualquer FIRM (STAFF passa)", async () => {
    usuarioAtual = { id: "user-staff", role: "staff", accountType: "FIRM" };
    app = montarApp();

    const criada = await request(app).post("/firm/onboardings").send({ origem: "ABERTURA" });
    expect(criada.status).toBe(201);
    const patch = await request(app)
      .patch(`/firm/onboardings/${criada.body.onboarding.id}`)
      .send({ dados: { razaoSocial: "NOME PRETENDIDO" } });
    expect(patch.status).toBe(200);
  });

  test("converter, desistir e descartar exigem admin|contador", async () => {
    const criada = await request(app).post("/firm/onboardings").send({ origem: "ABERTURA" });
    const id = criada.body.onboarding.id;

    usuarioAtual = { id: "user-staff", role: "staff", accountType: "FIRM" };
    app = montarApp();

    for (const chamada of [
      request(app).post(`/firm/onboardings/${id}/convert`).send(EMPRESA_VALIDA),
      request(app).post(`/firm/onboardings/${id}/desistir`).send({ motivo: "x" }),
      request(app).delete(`/firm/onboardings/${id}`),
    ]) {
      const res = await chamada;
      expect(res.status).toBe(403);
      expect(res.body.error).toBe("forbidden_admin_or_contador_only");
    }
  });

  // ⚠ A regressão que este teste guarda: usar `requireFirmCompanyAccess` daria 400
  // `company_id_required` em TODAS as rotas deste arquivo, porque nenhuma tem `companyId`.
  test("nenhuma rota do funil responde company_id_required", async () => {
    usuarioAtual = { id: "user-staff", role: "staff", accountType: "FIRM" };
    app = montarApp();
    const lista = await request(app).get("/firm/onboardings");
    expect(lista.status).toBe(200);
    expect(lista.body.error).toBeUndefined();
  });
});

describe("lista", () => {
  test("rascunho fica fora por padrão e volta com incluirRascunhos=1", async () => {
    await request(app).post("/firm/onboardings").send({ origem: "ABERTURA" });
    const { body } = await request(app).post("/firm/onboardings").send({ origem: "INATIVA" });
    await request(app).patch(`/firm/onboardings/${body.onboarding.id}`).send({ finalizar: true });

    const padrao = await request(app).get("/firm/onboardings");
    expect(padrao.body.itens).toHaveLength(1);
    expect(padrao.body.itens[0].status).toBe("RECEBIDO");
    expect(padrao.body.itens[0].progresso.total).toBeGreaterThan(0);

    const comRascunhos = await request(app).get("/firm/onboardings?incluirRascunhos=1");
    expect(comRascunhos.body.itens).toHaveLength(2);
  });

  test("descartar só vale para rascunho", async () => {
    const { body } = await request(app).post("/firm/onboardings").send({ origem: "ABERTURA" });
    const id = body.onboarding.id;
    await request(app).patch(`/firm/onboardings/${id}`).send({ finalizar: true });

    const recusa = await request(app).delete(`/firm/onboardings/${id}`);
    expect(recusa.status).toBe(409);
    expect(recusa.body.error).toBe("somente_rascunho_pode_ser_descartado");
  });
});

describe("validação do envelope", () => {
  test("origem desconhecida na criação → 400 validation_failed", async () => {
    const res = await request(app).post("/firm/onboardings").send({ origem: "SEI_LA" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_failed");
  });

  test("campo estranho no PATCH é recusado (schema `.strict()`)", async () => {
    const { body } = await request(app).post("/firm/onboardings").send({ origem: "ABERTURA" });
    const res = await request(app)
      .patch(`/firm/onboardings/${body.onboarding.id}`)
      .send({ status: "CONVERTIDO" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_failed");
  });

  test("id inexistente → 404", async () => {
    const res = await request(app).get("/firm/onboardings/nao-existe");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("onboarding_nao_encontrado");
  });
});
