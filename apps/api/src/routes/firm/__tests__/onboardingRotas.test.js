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
  const eventos = new Map();

  let seq = 0;
  const novoId = (p) => `${p}-${++seq}`;
  const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));

  function casa(registro, where) {
    return Object.entries(where || {}).every(([chave, valor]) => {
      if (valor && typeof valor === "object" && !Array.isArray(valor)) {
        if ('in' in valor) return valor.in.includes(registro[chave]);
        if ('notIn' in valor) return !valor.notIn.includes(registro[chave]);
        if ('path' in valor) return valor.path.reduce((v, k) => v?.[k], registro[chave]) === valor.equals;
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
        versao: 0, fontesDados: {}, origem: null, status: "RASCUNHO", origemPreenchimento: "ESCRITORIO",
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
      if (include?.eventos) saida.eventos = [...eventos.values()].filter(e => e.onboardingId === achado.id);
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
      if (include?.eventos) for (const item of lista) item.eventos = [...eventos.values()].filter(e => e.onboardingId === item.id && e.tipo === 'RETORNO_COMERCIAL').reverse().slice(0, 1);
      return lista;
    }),
    update: jest.fn(async ({ where, data }) => {
      const atual = onboardings.get(where.id);
      if (!atual) throw new Error("registro nao encontrado");
      if (where.versao !== undefined && where.versao !== atual.versao) throw Object.assign(new Error("Versão alterada"), { code: "P2025" });
      if (where.status !== undefined && where.status !== atual.status) throw Object.assign(new Error("Estado alterado"), { code: "P2025" });
      if (data.eventos?.create) {
        const evento = { id: novoId("evento"), createdAt: new Date(), onboardingId: atual.id, ...data.eventos.create };
        eventos.set(evento.id, evento);
        const { eventos: _eventos, ...campos } = data;
        data = campos;
      }
      const versao = data.versao?.increment ? atual.versao + data.versao.increment : atual.versao;
      Object.assign(atual, data, { versao, updatedAt: new Date() });
      return clone(atual);
    }),
    updateMany: jest.fn(async ({ where, data }) => {
      const encontrados = [...onboardings.values()].filter(o => casa(o, where));
      for (const atual of encontrados) Object.assign(atual, data, { versao: data.versao?.increment ? atual.versao + data.versao.increment : atual.versao });
      return { count: encontrados.length };
    }),
    delete: jest.fn(async ({ where }) => {
      const atual = onboardings.get(where.id);
      onboardings.delete(where.id);
      return clone(atual);
    }),
  };

  const onboardingEtapa = {
    findMany: jest.fn(async ({ where } = {}) => clone([...etapas.values()].filter(e => casa(e, where)))),
    findFirst: jest.fn(async ({ where }) => clone([...etapas.values()].find(e => casa(e, where)) || null)),
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
    updateMany: jest.fn(async ({ where, data }) => {
      const encontradas = [...etapas.values()].filter(e => casa(e, where));
      for (const atual of encontradas) Object.assign(atual, data);
      return { count: encontradas.length };
    }),
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
    findUnique: jest.fn(async ({ where }) => clone([...usuarios.values()].find((u) => where.id ? u.id === where.id : u.email === where.email) || null)),
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
    updateMany: jest.fn(async () => ({ count: 0 })),
    update: jest.fn(async ({ data }) => ({ ...data })),
    upsert: jest.fn(async ({ create }) => ({ ...create })),
    delete: jest.fn(async () => ({})),
    groupBy: jest.fn(async () => []),
    count: jest.fn(async () => 0),
  });

  const lerEventos = ({ where, take } = {}) => [...eventos.values()].filter(e => casa(e, where)).sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id)).slice(0, take);
  const onboardingEvento = {
    ...generico(),
    create: jest.fn(async ({ data }) => { const row = { id: novoId('evento'), createdAt: new Date(), ...data }; eventos.set(row.id, row); return clone(row); }),
    findMany: jest.fn(async args => clone(lerEventos(args))),
    findFirst: jest.fn(async args => clone(lerEventos(args)[0] || null)),
  };
  const fixos = { onboarding, onboardingEtapa, portalClient, user, onboardingEvento };
  const dinamicos = {};
  const raiz = {
    __limpar: () => {
      onboardings.clear(); etapas.clear(); portais.clear(); usuarios.clear(); usuarios.set("user-firm-1", { id: "user-firm-1", role: "contador", status: "active", accountType: "FIRM" }); eventos.clear(); seq = 0;
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

  raiz.$queryRaw = jest.fn(async () => []);
  raiz.$transaction = jest.fn(async (arg) => (typeof arg === "function" ? arg(proxy) : Promise.all(arg)));
  return { prisma: proxy };
});

jest.mock("bcryptjs", () => ({
  __esModule: true,
  default: { hash: jest.fn(async (s) => `hash:${s}`), compare: jest.fn(async () => true) },
}));

import { createFirmPortalRouter } from "../index.js";
import { prisma } from "../../../infrastructure/db/prisma.js";
import { POLITICA_COMERCIAL_C1, contextoContrato } from "../../../../../../packages/shared/src/onboarding/contratacaoComercial.js";
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

async function patchFicha(id, patch) {
  const { body } = await request(app).get(`/firm/onboardings/${id}`);
  return request(app).patch(`/firm/onboardings/${id}`).send({ versao: body.onboarding?.versao ?? 0, ...patch });
}
// R27: fixtures de clientes externos exigem justificativa e versão explícitas.
async function conversaoExterna(id) {
  const ficha = await prisma.onboarding.findUnique({ where: { id } });
  return { ...EMPRESA_VALIDA, contratacaoExterna: { confirmada: true, versao: ficha.versao, justificativa: 'Cliente contratado fora da Altan', evidencia: 'Contrato externo sintético 001' } };
}
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
  test.each(['C1-assinatura', 'C1-pagamento', 'legado-assinatura'])('leitura FIRM %s expõe fatos corretos da contratação, sem conteúdo privado', async caso => {
    usuarioAtual = { id: 'user-staff', role: 'staff', accountType: 'FIRM' };
    const criada = await request(app).post('/firm/onboardings').send({ origem: 'TRANSFERENCIA' });
    expect(criada.status).toBe(201);
    const id = criada.body.onboarding.id;
    expect(criada.body.onboarding.politicaComercial).toBe(POLITICA_COMERCIAL_C1);
    if (caso === "legado-assinatura") await prisma.onboarding.update({ where: { id }, data: { politicaComercial: null } });
    const propostas = prisma.propostaComercial.findMany.getMockImplementation();
    const contratos = prisma.contratoComercial.findMany.getMockImplementation();
    const proposta = { id: 'p', versao: 1, onboardingId: id, status: 'ACEITA', opcaoAceita: 'RECORRENTE', tokenHash: 'token-proibido', snapshot: { privado: 'snapshot-proibido' } };
    const contrato = { id: 'c', onboardingId: id, propostaId: 'p', status: 'ASSINADO_CONFERIDO', texto: 'contrato-proibido', dados: { opcao: { chave: 'RECORRENTE', recorrente: true } } };
    prisma.propostaComercial.findMany.mockResolvedValue([proposta]);
    prisma.contratoComercial.findMany.mockResolvedValue([contrato]);
    if (caso === 'C1-pagamento') await prisma.onboardingEvento.create({ data: { onboardingId: id, tipo: 'PAGAMENTO_HONORARIOS_CONFERIDO', atorId: 'user-firm-1', dados: { contratoId: contrato.id, politica: 'R35', confirmadoEm: '2026-10-25T12:00:00Z', contextoContrato: contextoContrato(proposta, contrato) } } });
    try {
      for (const destino of [`/firm/onboardings/${id}`, '/firm/onboardings?incluirRascunhos=1']) {
        const r = await request(app).get(destino);
        expect(r.status).toBe(200);
        expect(JSON.stringify(r.body)).not.toMatch(/token-proibido|snapshot-proibido|contrato-proibido|tokenHash/);
        expect((r.body.onboarding || r.body.itens.find(i => i.id === id)).comercial.contratacao).toMatchObject({ ganha: caso !== 'C1-assinatura', pagamentoConferido: caso === 'C1-pagamento' });
      }
    } finally {
      prisma.propostaComercial.findMany.mockImplementation(propostas);
      prisma.contratoComercial.findMany.mockImplementation(contratos);
    }
  });
  test('T31/T35: POST sem contratação, versão antiga e prova vazia são recusados', async () => {
    const criada = await request(app).post('/firm/onboardings').send({ origem: 'TRANSFERENCIA' });
    const id = criada.body.onboarding.id;
    const normal = await request(app).post(`/firm/onboardings/${id}/convert`).send({ ...EMPRESA_VALIDA, faseComercial: 'CONTRATADO', atorId: 'admin-inventado' });
    expect(normal.status).toBe(409); expect(normal.body.error).toBe('contratacao_necessaria');
    const valido = await conversaoExterna(id);
    for (const patch of [{ versao: -1 }, { justificativa: ' ' }, { evidencia: '' }, { confirmada: false }]) {
      const resposta = await request(app).post(`/firm/onboardings/${id}/convert`).send({ ...valido, contratacaoExterna: { ...valido.contratacaoExterna, ...patch } });
      expect(resposta.status).toBe(409); expect(resposta.body.error).toBe('contratacao_externa_invalida');
    }
    expect((await prisma.onboarding.findUnique({ where: { id } })).portalClientId).toBeNull();
    expect(prisma.__portais.size).toBe(0);
  });
  test('leitura bloqueia entrada normal sem proposta e não promove fase manual', async () => {
    const criada = await request(app).post('/firm/onboardings').send({ origem: 'TRANSFERENCIA' });
    const id = criada.body.onboarding.id;
    await prisma.onboarding.update({ where: { id }, data: { faseComercial: 'CONTRATADO', status: 'EM_TRILHA' } });
    const detalhe = await request(app).get(`/firm/onboardings/${id}`);
    expect(detalhe.status).toBe(200);
    expect(detalhe.body.onboarding.conversao).toMatchObject({ excecaoAplicavel: true, contratoConferido: false });
    expect(detalhe.body.onboarding.comercial.atual).toBe('publica');
    const lista = await request(app).get('/firm/onboardings?incluirRascunhos=1');
    expect(lista.status).toBe(200);
    expect(lista.body.itens.find(i => i.id === id).comercial.atual).toBe(detalhe.body.onboarding.comercial.atual);
  });
  test("cada passo devolve o estado esperado e a conversão fecha a ficha", async () => {
    // 1) criar
    const criada = await request(app).post("/firm/onboardings").send({ origem: "TRANSFERENCIA" });
    expect(criada.status).toBe(201);
    expect(criada.body.onboarding.status).toBe("RASCUNHO");
    const id = criada.body.onboarding.id;

    // 2) três PATCH, um por tela do wizard — o rascunho é salvo a cada passo
    const p1 = await patchFicha(id, {
      dados: { razaoSocial: "EMPRESA QUE VEM DO OUTRO CONTADOR LTDA", cnpj: "11.222.333/0001-81" },
      ultimoPasso: "identificacao",
    });
    expect(p1.status).toBe(200);
    expect(p1.body.onboarding.razaoSocial).toBe("EMPRESA QUE VEM DO OUTRO CONTADOR LTDA");
    expect(p1.body.onboarding.cnpj).toBe("11222333000181");

    const p2 = await patchFicha(id, {
      dados: {
        razaoSocial: "EMPRESA QUE VEM DO OUTRO CONTADOR LTDA",
        cnpj: "11.222.333/0001-81",
        responsavelNome: "Maria",
        responsavelEmail: "maria@empresa.com", socios: [{ nome: "Maria Teste", cpf: "52998224725" }],
      },
      ultimoPasso: "responsavel",
    });
    expect(p2.body.onboarding.responsavelEmail).toBe("maria@empresa.com");
    expect(p2.body.onboarding.emailJaCadastrado).toBe(false);

    await patchFicha(id, { ultimoPasso: "revisao" });

    // 3) finalizar — materializa a checklist
    const fim = await patchFicha(id, { finalizar: true });
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
    const conv = await request(app).post(`/firm/onboardings/${id}/convert`).send(await conversaoExterna(id));
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
    expect(body.onboarding.politicaComercial).toBe(POLITICA_COMERCIAL_C1);
    const finalizada = await patchFicha(id, { dados: { cnpj: "11222333000181", socios: [{ nome: "Pessoa Teste", cpf: "52998224725" }] }, finalizar: true });
    expect(finalizada.status).toBe(200);
    expect(finalizada.body.onboarding.cnpj).toBe("11222333000181");
    return id;
  }

  test("finalizar duas vezes NÃO duplica a checklist", async () => {
    const id = await fichaFinalizada();
    const primeira = await request(app).get(`/firm/onboardings/${id}`);
    const quantidade = primeira.body.onboarding.etapas.length;

    const segunda = await patchFicha(id, { finalizar: true });

    expect(segunda.status).toBe(200);
    expect(segunda.body.onboarding.etapas).toHaveLength(quantidade);
  });

  test("convert duas vezes → 409 onboarding_convertido com o portalClientId", async () => {
    const id = await fichaFinalizada();
    const primeira = await request(app).post(`/firm/onboardings/${id}/convert`).send(await conversaoExterna(id));
    expect(primeira.status).toBe(201);

    const segunda = await request(app).post(`/firm/onboardings/${id}/convert`).send(await conversaoExterna(id));
    expect(segunda.status).toBe(409);
    expect(segunda.body.error).toBe("onboarding_convertido");
    expect(segunda.body.portalClientId).toBe(primeira.body.portalClientId);
  });

  test("CNPJ já na carteira → 409 cnpj_ja_na_carteira, com o caminho de recuperação no corpo", async () => {
    // Uma empresa já existe com esse CNPJ (convertida por outra ficha).
    const idA = await fichaFinalizada();
    const primeira = await request(app).post(`/firm/onboardings/${idA}/convert`).send(await conversaoExterna(idA));
    expect(primeira.status).toBe(201);

    const idB = await fichaFinalizada();
    const conflito = await request(app).post(`/firm/onboardings/${idB}/convert`).send(await conversaoExterna(idB));

    expect(conflito.status).toBe(409);
    expect(conflito.body.error).toBe("cnpj_ja_na_carteira");
    expect(conflito.body.portalClientId).toBe(primeira.body.portalClientId);
    expect(conflito.body.razao).toBe("NOVA EMPRESA LTDA");
  });

  test("vincularPortalClientId fecha a ficha sem criar empresa nova", async () => {
    const idA = await fichaFinalizada();
    const primeira = await request(app).post(`/firm/onboardings/${idA}/convert`).send(await conversaoExterna(idA));
    expect(primeira.status).toBe(201);
    expect(primeira.body.onboarding.status).toBe("CONVERTIDO");
    expect(primeira.body.portalClientId).toBeTruthy();
    const portalId = primeira.body.portalClientId;
    // libera o vínculo para simular "a empresa foi criada mas o update da ficha falhou"
    await request(app).get(`/firm/onboardings/${idA}`);
    prisma.onboarding.update.mockClear();

    const idB = await fichaFinalizada();
    // a ficha A ainda ocupa o vínculo → recusa, e é o que impede duas fichas para a mesma empresa
    const recusa = await request(app)
      .post(`/firm/onboardings/${idB}/convert`)
      .send({ ...await conversaoExterna(idB), vincularPortalClientId: portalId, cnpjDefinitivo: "11222333000181" });
    expect(recusa.status).toBe(409);
    expect(recusa.body.error).toBe("portal_client_ja_vinculado");
  });

  test("ficha convertida é somente leitura: PATCH → 409", async () => {
    const id = await fichaFinalizada();
    const convertida = await request(app).post(`/firm/onboardings/${id}/convert`).send(await conversaoExterna(id));
    expect(convertida.status).toBe(201);
    expect(convertida.body.portalClientId).toBeTruthy();
    expect(convertida.body.onboarding.status).toBe("CONVERTIDO");
    const patch = await patchFicha(id, { dados: { razaoSocial: "X" } });
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
    const patch = await patchFicha(criada.body.onboarding.id, { dados: { razaoSocial: "NOME PRETENDIDO" } });
    expect(patch.status).toBe(200);
  });

  test("converter, desistir e descartar exigem admin|contador", async () => {
    const criada = await request(app).post("/firm/onboardings").send({ origem: "ABERTURA" });
    const id = criada.body.onboarding.id;

    usuarioAtual = { id: "user-staff", role: "staff", accountType: "FIRM" };
    app = montarApp();

    for (const chamada of [
      request(app).post(`/firm/onboardings/${id}/convert`).send(await conversaoExterna(id)),
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
    await patchFicha(body.onboarding.id, { dados: { socios: [{ nome: "Pessoa Teste", cpf: "52998224725" }] }, finalizar: true });

    const padrao = await request(app).get("/firm/onboardings");
    expect(padrao.status).toBe(200);
    expect(padrao.body.itens).toHaveLength(1);
    expect(padrao.body.itens[0].status).toBe("RECEBIDO");
    expect(padrao.body.itens[0].progresso.total).toBeGreaterThan(0);

    const comRascunhos = await request(app).get("/firm/onboardings?incluirRascunhos=1");
    expect(comRascunhos.status).toBe(200);
    expect(comRascunhos.body.itens).toHaveLength(2);
  });

  test("descartar só vale para rascunho", async () => {
    const { body } = await request(app).post("/firm/onboardings").send({ origem: "ABERTURA" });
    const id = body.onboarding.id;
    await patchFicha(id, { dados: { socios: [{ nome: "Pessoa Teste", cpf: "52998224725" }] }, finalizar: true });

    const recusa = await request(app).delete(`/firm/onboardings/${id}`).send({ versao: 0 });
    expect(recusa.status).toBe(409);
    expect(recusa.body.error).toBe("somente_rascunho_pode_ser_descartado");
  });
});

describe("validação do envelope", () => {
  test("prévia e exclusão de rascunho vazio exigem confirmação versionada", async () => {
    const { body } = await request(app).post("/firm/onboardings").send({ origem: "ABERTURA" });
    const id = body.onboarding.id;
    const previa = await request(app).get(`/firm/onboardings/${id}/elegibilidade-descarte`);
    expect(previa.status).toBe(200);
    expect(previa.body.elegibilidade).toMatchObject({ podeExcluir: true, versao: 0 });
    expect((await request(app).delete(`/firm/onboardings/${id}`)).status).toBe(400);
    expect((await request(app).delete(`/firm/onboardings/${id}`).send({ versao: 7 })).status).toBe(409);
    expect((await request(app).delete(`/firm/onboardings/${id}`).send({ versao: 0 })).body).toEqual({ ok: true });
    expect((await request(app).get(`/firm/onboardings/${id}`)).status).toBe(404);
  });
  test("prévia de exclusão recusa atendente mesmo em ficha própria", async () => {
    const { body } = await request(app).post("/firm/onboardings").send({ origem: "ABERTURA" });
    usuarioAtual = { id: "user-firm-1", role: "atendente", accountType: "FIRM" };
    expect((await request(app).get(`/firm/onboardings/${body.onboarding.id}/elegibilidade-descarte`)).status).toBe(403);
    expect((await request(app).post(`/firm/onboardings/${body.onboarding.id}/desistir`).send({ versao: 0 })).status).toBe(403);
    expect((await request(app).delete(`/firm/onboardings/${body.onboarding.id}`).send({ versao: 0 })).status).toBe(403);
  });
  test("prévia não revela ficha fora do escopo", async () => {
    const { body } = await request(app).post("/firm/onboardings").send({ origem: "ABERTURA" });
    usuarioAtual = { id: "outro", role: "atendente", accountType: "FIRM" };
    expect((await request(app).get(`/firm/onboardings/${body.onboarding.id}/elegibilidade-descarte`)).status).toBe(404);
    // Mutações recusam o papel antes de consultar a ficha; não revelam sua existência.
    expect((await request(app).post(`/firm/onboardings/${body.onboarding.id}/desistir`).send({ versao: 0 })).status).toBe(403);
    expect((await request(app).delete(`/firm/onboardings/${body.onboarding.id}`).send({ versao: 0 })).status).toBe(403);
  });
  test("origem desconhecida na criação → 400 validation_failed", async () => {
    const res = await request(app).post("/firm/onboardings").send({ origem: "SEI_LA" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_failed");
  });

  test("campo estranho no PATCH é recusado (schema `.strict()`)", async () => {
    const { body } = await request(app).post("/firm/onboardings").send({ origem: "ABERTURA" });
    const res = await patchFicha(body.onboarding.id, { status: "CONVERTIDO" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_failed");
  });

  test("id inexistente → 404", async () => {
    const res = await request(app).get("/firm/onboardings/nao-existe");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("onboarding_nao_encontrado");
  });
});

test('conferência salva e recarga concordam em lista, ficha e painel usado na conversa', async () => {
  const criada = await request(app).post('/firm/onboardings').send({ origem: 'TRANSFERENCIA' });
  const id = criada.body.onboarding.id;
  await patchFicha(id, { dados: { cnpj: '11222333000181', responsavelNome: 'Pessoa de teste', socios: [{ nome: 'Pessoa de teste', cpf: '52998224725' }] }, finalizar: true });
  async function conferir(atual) {
    const [lista, ficha, chat] = await Promise.all([
      request(app).get('/firm/onboardings?incluirRascunhos=1'),
      request(app).get(`/firm/onboardings/${id}`),
      request(app).get(`/firm/comercial/onboardings/${id}`),
    ]);
    expect([lista.status, ficha.status, chat.status]).toEqual([200, 200, 200]);
    expect(lista.body.itens.find(i => i.id === id).comercial.atual).toBe(atual);
    expect(ficha.body.onboarding.comercial.atual).toBe(atual);
    expect(chat.body.jornada.projecao.atual).toBe(atual);
    return ficha.body.onboarding;
  }
  const antes = await conferir('publica');
  const salva = await request(app).post(`/firm/comercial/onboardings/${id}/jornada/conferencia`).send({
    tipo: 'PUBLICA', versao: antes.versao, manual: { fonte: 'Documento sintético', evidencia: 'Dados cadastrais conferidos em documento fictício.' },
  });
  expect(salva.status).toBe(200);
  const depois = await conferir('autorizacao');
  expect(depois.versao).toBe(antes.versao + 1);
  // Outra ação persistida não apaga a evidência comercial na recarga.
  expect((await request(app).patch(`/firm/onboardings/${id}/etapas/${depois.etapas[0].id}`).send({ concluida: true })).status).toBe(200);
  await conferir('autorizacao');
});

describe("retomada pela rota real", () => {
  async function desistente() {
    const row = await prisma.onboarding.create({ data: { origem: "TRANSFERENCIA", status: "DESISTIU", versao: 4, criadoPorId: "user-firm-1", motivoDesistencia: "Motivo anterior", desistiuEm: new Date() } });
    await prisma.onboardingEvento.create({ data: { onboardingId: row.id, tipo: "DESISTIU", atorId: "user-firm-1", dados: { statusAnterior: "EM_TRILHA", motivo: "Motivo anterior" } } });
    return row;
  }
  test("retoma, preserva histórico, repete sem novo evento e recusa versão antiga", async () => {
    const row = await desistente();
    const url = `/firm/onboardings/${row.id}/retomar`;
    const body = { versao: 4, motivo: "Cliente pediu continuidade" };
    const first = await request(app).post(url).send(body);
    expect(first.status).toBe(200); expect(first.body.onboarding.status).toBe("EM_TRILHA");
    const retry = await request(app).post(url).send(body); expect(retry.status).toBe(200);
    const eventos = await prisma.onboardingEvento.findMany({ where: { onboardingId: row.id } });
    expect(eventos.filter(e => e.tipo === "ATENDIMENTO_RETOMADO")).toHaveLength(1);
    expect(eventos.find(e => e.tipo === "DESISTIU").dados.motivo).toBe("Motivo anterior");
    expect((await request(app).post(url).send({ ...body, motivo: "Outra operação" })).status).toBe(409);
  });
  test.each(["staff", "cliente"])("papel %s não retoma caso alheio", async role => {
    const row = await desistente(); usuarioAtual = { id: "outro", role, accountType: role === "cliente" ? "CLIENT" : "FIRM" };
    expect((await request(app).post(`/firm/onboardings/${row.id}/retomar`).send({ versao: 4, motivo: "Tentar" })).status).toBe(403);
    expect((await prisma.onboarding.findUnique({ where: { id: row.id } })).status).toBe("DESISTIU");
  });
  test("identidade inexistente e motivo vazio não produzem transição", async () => {
    const row = await desistente();
    expect((await request(app).post('/firm/onboardings/inexistente/retomar').send({ versao: 4, motivo: "Tentar" })).status).toBe(404);
    expect((await request(app).post(`/firm/onboardings/${row.id}/retomar`).send({ versao: 4, motivo: " " })).status).toBe(400);
    expect((await prisma.onboarding.findUnique({ where: { id: row.id } })).status).toBe("DESISTIU");
  });
});