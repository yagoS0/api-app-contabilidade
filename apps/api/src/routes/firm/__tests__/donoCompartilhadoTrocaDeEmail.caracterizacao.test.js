// A CONTA COMPARTILHADA E A TROCA DE E-MAIL DO RESPONSÁVEL — `PATCH /firm/companies/:id`.
//
// ⚠⚠ O DEFEITO QUE ESTE ARQUIVO EXISTE PARA TRANCAR (achado em produção em 19/08/2026):
// o dono entrou no portal do cliente com UM login e enxergou NOVE empresas.
//
// A origem está no bloco do responsável desta rota. Ao salvar a empresa com um e-mail de
// responsável novo, o código pegava o usuário `OWNER` DAQUELA empresa e fazia
// `tx.user.update({ data: { email } })` — ou seja, RENOMEAVA A CONTA. Ele nunca perguntava se
// aquela conta era compartilhada com outras empresas. Como o mesmo e-mail havia sido cadastrado
// em várias empresas (e `CompanyProvisioningService` REUSA o `User` quando o e-mail já existe —
// `let ownerUser = await tx.user.findUnique({ where: { email: ownerEmail } })`), todas apontavam
// para UMA única conta. Trocar o e-mail de UMA delas renomeava a conta compartilhada e LEVAVA OS
// NOVE VÍNCULOS JUNTO: o resultado é o oposto do esperado — em vez de a empresa editada se
// separar, as OUTRAS passaram a pertencer ao login novo.
//
// A guarda `owner_email_already_in_use` que já existia ali NÃO cobre este caso: ela só recusa
// colisão com um usuário DIFERENTE. Conta compartilhada é o mesmo usuário, e passa reto.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ POR QUE ESTE TESTE TEM UM BANCO DE MENTIRA COM ESTADO, e não só `jest.fn()` soltos
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// O defeito é INVISÍVEL numa asserção sobre argumentos. `tx.user.update` é chamado UMA vez, com
// UM id — nada no argumento diz "isto acabou de mudar o dono de outras oito empresas". O arrasto
// acontece porque os vínculos apontam para o `userId`, não para o e-mail: renomear a conta move
// todo mundo de graça, sem nenhuma query que apareça no mock.
//
// Por isso o `banco` abaixo guarda `users` e `vinculos` de verdade, e as asserções perguntam a
// coisa que o contador perguntaria: **de quem é o login de cada uma destas empresas?**
// (`donoDe`). É a única forma de a asserção "as outras oito não mudam de dono" significar
// alguma coisa.
//
// ⚠ ESTE ARQUIVO FOI ESCRITO E RODADO CONTRA O CÓDIGO NÃO CORRIGIDO. Cada caso que MUDOU traz o
// comportamento medido ANTES escrito no comentário, em cima da asserção que vale DEPOIS. Os casos
// marcados "PRESERVADO" passavam idênticos antes e depois — é isso que eles provam.

import request from "supertest";
import express from "express";

jest.mock("../../../infrastructure/db/prisma.js", () => {
  const models = {};
  const raiz = {};
  const proxy = new Proxy(raiz, {
    get(alvo, prop) {
      if (typeof prop === "symbol") return alvo[prop];
      if (prop === "$transaction") return alvo.$transaction;
      if (prop === "$connect" || prop === "$disconnect") {
        if (!alvo[prop]) alvo[prop] = jest.fn(async () => {});
        return alvo[prop];
      }
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
  raiz.$transaction = jest.fn(async (arg) => {
    if (typeof arg === "function") return arg(proxy);
    return Promise.all(arg);
  });
  return { prisma: proxy };
});

jest.mock("../../../application/guides/guideCompliance.js", () => {
  const real = jest.requireActual("../../../application/guides/guideCompliance.js");
  return { ...real, computeGuideComplianceMap: jest.fn(async () => new Map()) };
});

// bcrypt é lento de propósito; aqui ele só precisa ser determinístico e não gastar 300ms por caso.
jest.mock("bcryptjs", () => ({
  __esModule: true,
  default: {
    hash: jest.fn(async (valor) => `hash:${valor}`),
    compare: jest.fn(async () => true),
    hashSync: jest.fn((valor) => `hash:${valor}`),
    compareSync: jest.fn(() => true),
  },
}));

import { createFirmPortalRouter } from "../index.js";
import { prisma as prismaMock } from "../../../infrastructure/db/prisma.js";

const PORTAL_EDITADA = "portal-editada";
const LEGACY_EDITADA = "company-legacy-editada";
const CLIENT_LEGACY = "client-legacy-1";
const CNPJ = "11222333000181";

const EMAIL_ANTIGO = "dono@empresa.com";
const EMAIL_NOVO = "novo@empresa.com";

const USUARIO_LOGADO = {
  id: "user-firm-1",
  role: "contador",
  accountType: "FIRM",
  email: "contador@escritorio.com",
};

// ── Banco de mentira com ESTADO ────────────────────────────────────────────────────────────────
const banco = { users: new Map(), vinculos: [], clients: new Map(), seqUser: 0, seqVinculo: 0 };

function resetBanco() {
  banco.users = new Map();
  banco.vinculos = [];
  banco.clients = new Map();
  banco.seqUser = 0;
  banco.seqVinculo = 0;
}

function semearUsuario({ id, email, name = "Dono da Empresa" }) {
  banco.users.set(id, { id, email, name, passwordHash: "hash:antiga", role: "user", status: "active", accountType: "CLIENT" });
  return banco.users.get(id);
}

function semearVinculo({ companyId, userId, role = "OWNER", status = "ACTIVE" }) {
  const v = { id: `ccu-${++banco.seqVinculo}`, companyId, userId, role, status, createdAt: new Date(2026, 0, banco.seqVinculo) };
  banco.vinculos.push(v);
  return v;
}

/** A pergunta do contador: de quem é o login desta empresa? Resolve vínculo ACTIVE OWNER → e-mail. */
function donoDe(companyId) {
  const v = banco.vinculos
    .filter((x) => x.companyId === companyId && x.role === "OWNER" && x.status === "ACTIVE")
    .sort((a, b) => a.createdAt - b.createdAt)[0];
  if (!v) return null;
  return { userId: v.userId, email: banco.users.get(v.userId)?.email || null };
}

function combina(v, where = {}) {
  if (where.companyId !== undefined && v.companyId !== where.companyId) return false;
  if (where.userId !== undefined && v.userId !== where.userId) return false;
  if (where.role !== undefined && v.role !== where.role) return false;
  if (where.status !== undefined && v.status !== where.status) return false;
  return true;
}

function ligarPrismaAoBanco() {
  prismaMock.user.findUnique.mockImplementation(async ({ where }) => {
    if (where?.id) return banco.users.get(where.id) || null;
    if (where?.email) return [...banco.users.values()].find((u) => u.email === where.email) || null;
    return null;
  });
  prismaMock.user.update.mockImplementation(async ({ where, data }) => {
    const u = banco.users.get(where.id);
    if (!u) throw new Error(`user ${where.id} inexistente`);
    Object.assign(u, data);
    return { ...u };
  });
  prismaMock.user.create.mockImplementation(async ({ data }) => {
    const id = `user-novo-${++banco.seqUser}`;
    banco.users.set(id, { id, ...data });
    return { ...banco.users.get(id) };
  });

  prismaMock.companyClientUser.findFirst.mockImplementation(async ({ where, include }) => {
    const v = banco.vinculos.filter((x) => combina(x, where)).sort((a, b) => a.createdAt - b.createdAt)[0];
    if (!v) return null;
    return include?.user ? { ...v, user: banco.users.get(v.userId) || null } : { ...v };
  });
  prismaMock.companyClientUser.count.mockImplementation(async ({ where }) =>
    banco.vinculos.filter((x) => combina(x, where)).length
  );
  prismaMock.companyClientUser.findMany.mockImplementation(async ({ where }) =>
    banco.vinculos.filter((x) => combina(x, where)).map((x) => ({ ...x }))
  );
  prismaMock.companyClientUser.create.mockImplementation(async ({ data }) => semearVinculo(data));
  prismaMock.companyClientUser.update.mockImplementation(async ({ where, data }) => {
    const v = banco.vinculos.find((x) => x.id === where.id);
    Object.assign(v, data);
    return { ...v };
  });
  prismaMock.companyClientUser.upsert.mockImplementation(async ({ where, create, update }) => {
    const chave = where.companyId_userId || {};
    const v = banco.vinculos.find((x) => x.companyId === chave.companyId && x.userId === chave.userId);
    if (v) { Object.assign(v, update); return { ...v }; }
    return semearVinculo(create);
  });

  // ⚠⚠ O BANCO DE MENTIRA PASSOU A HONRAR OS DOIS `@unique` DE `Client` (`email` e `login`).
  //   Sem isso o defeito de 02/09/2026 era INVISIVEL aqui: a rota chamava `client.update` com um
  //   e-mail ja usado, o dubla aceitava de bom grado, e o teste passava sobre um caminho que em
  //   producao estourava P2002 e derrubava a transacao inteira.
  prismaMock.client.update.mockImplementation(async ({ where, data }) => {
    const c = banco.clients.get(where.id);
    if (!c) throw new Error(`client ${where.id} inexistente`);
    for (const campo of ["email", "login"]) {
      if (data?.[campo] === undefined) continue;
      const colide = [...banco.clients.values()].some((o) => o.id !== where.id && o[campo] === data[campo]);
      if (colide) {
        const err = new Error(
          `Unique constraint failed on the fields: (\`${campo}\`)`
        );
        err.code = "P2002";
        err.meta = { target: [campo] };
        throw err;
      }
    }
    Object.assign(c, data);
    return { ...c };
  });
  prismaMock.client.findFirst.mockImplementation(async ({ where }) => {
    const alvos = Array.isArray(where?.OR) ? where.OR : [];
    const excluido = where?.NOT?.id;
    const achado = [...banco.clients.values()].find(
      (c) => c.id !== excluido && alvos.some((o) => (o.email && c.email === o.email) || (o.login && c.login === o.login))
    );
    return achado ? { ...achado } : null;
  });
  prismaMock.client.create.mockImplementation(async ({ data }) => {
    const id = `client-novo-${banco.clients.size + 1}`;
    banco.clients.set(id, { id, ...data });
    return { ...banco.clients.get(id) };
  });
  prismaMock.client.findUnique.mockImplementation(async ({ where }) => {
    if (where?.id) return banco.clients.get(where.id) || null;
    if (where?.email) return [...banco.clients.values()].find((c) => c.email === where.email) || null;
    return null;
  });
  prismaMock.company.count.mockImplementation(async ({ where }) => {
    // Quantas Companies legadas apontam para este Client. O cenário base tem UMA.
    const c = banco.clients.get(where?.clientId);
    return c ? c.quantasCompanies ?? 1 : 0;
  });

  // ⚠ O ator é `contador`, não `admin`, de propósito: `admin` faz curto-circuito em
  // `requireFirmCompanyAccess` e o teste passaria sem nunca tocar o vínculo do escritório.
  // Com `contador` os DOIS portões da rota são exercidos — o do middleware e o
  // `["admin","contador"].includes(appRole)` de dentro dela.
  prismaMock.companyFirmAccess.findUnique.mockResolvedValue({ role: "FIRM_ADMIN", status: "ACTIVE", scopes: ["*"] });

  prismaMock.portalClient.findUnique.mockResolvedValue({ id: PORTAL_EDITADA, companyId: LEGACY_EDITADA, cnpj: CNPJ });
  prismaMock.portalClient.update.mockImplementation(async ({ data }) => ({
    id: PORTAL_EDITADA, companyId: LEGACY_EDITADA, cnpj: CNPJ, ...data,
  }));
  prismaMock.company.update.mockImplementation(async ({ data }) => ({ id: LEGACY_EDITADA, clientId: CLIENT_LEGACY, ...data }));
  prismaMock.company.findUnique.mockResolvedValue({ id: LEGACY_EDITADA, clientId: CLIENT_LEGACY });
  prismaMock.guide.findMany.mockResolvedValue([]);
}

function montarApp() {
  const app = express();
  app.use(express.json());
  app.locals.ensureAuthorized = async (req) => {
    req.auth = { user: { ...USUARIO_LOGADO } };
    return true;
  };
  const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  app.use("/firm", createFirmPortalRouter({ ensureAuthorized: app.locals.ensureAuthorized, log }));
  return app;
}

function payload(extra = {}) {
  return {
    company: {
      razaoSocial: "EMPRESA TESTE LTDA",
      cnpj: CNPJ,
      regimeTributario: "SIMPLES",
      cnaePrincipal: "6201501",
      endereco: {
        rua: "Rua das Flores",
        numero: "100",
        bairro: "Centro",
        cidade: "Rio de Janeiro",
        uf: "RJ",
        cep: "20000-000",
      },
    },
    ...extra,
  };
}

const salvar = (app, extra) => request(app).patch(`/firm/companies/${PORTAL_EDITADA}`).send(payload(extra));

describe("PATCH /firm/companies/:id — troca do e-mail do responsável e a conta compartilhada", () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    resetBanco();
    ligarPrismaAoBanco();
    banco.clients.set(CLIENT_LEGACY, { id: CLIENT_LEGACY, email: EMAIL_ANTIGO, login: EMAIL_ANTIGO, name: "Dono", quantasCompanies: 1 });
    app = montarApp();
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // PRESERVADO — o caso comum, que NÃO pode mudar
  // ───────────────────────────────────────────────────────────────────────────────────────────

  test("PRESERVADO: conta de UMA empresa só → renomeia a conta (o caso comum)", async () => {
    semearUsuario({ id: "user-dono", email: EMAIL_ANTIGO });
    semearVinculo({ companyId: PORTAL_EDITADA, userId: "user-dono" });

    const res = await salvar(app, { ownerEmail: EMAIL_NOVO });

    expect(res.status).toBe(200);
    // A MESMA conta, com o e-mail novo — nenhuma conta criada.
    expect(donoDe(PORTAL_EDITADA)).toEqual({ userId: "user-dono", email: EMAIL_NOVO });
    expect(prismaMock.user.create).not.toHaveBeenCalled();
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "user-dono" }, data: expect.objectContaining({ email: EMAIL_NOVO }) })
    );
    // E o `Client` legado desta empresa (que também é dela e só dela) acompanha.
    expect(banco.clients.get(CLIENT_LEGACY)).toMatchObject({ email: EMAIL_NOVO, login: EMAIL_NOVO });
  });

  test("PRESERVADO: só o nome, sem e-mail → renomeia o nome e não mexe em vínculo nenhum", async () => {
    semearUsuario({ id: "user-dono", email: EMAIL_ANTIGO, name: "Nome Velho" });
    semearVinculo({ companyId: PORTAL_EDITADA, userId: "user-dono" });

    const res = await salvar(app, { ownerName: "Nome Novo" });

    expect(res.status).toBe(200);
    expect(banco.users.get("user-dono")).toMatchObject({ name: "Nome Novo", email: EMAIL_ANTIGO });
    expect(prismaMock.user.create).not.toHaveBeenCalled();
    expect(banco.vinculos).toHaveLength(1);
  });

  // ═════════════════════════════════════════════════════════════════════════════════════════
  // ⚠⚠ OS DOIS TESTES ABAIXO FORAM **INVERTIDOS** EM 30/08/2026 — NÃO APAGADOS.
  //
  // Eles travavam a RECUSA `owner_email_already_in_use`, preservada em 19/08 com este motivo:
  //   *"reaproveitar a conta alheia é como este problema começou. A confirmação abaixo autoriza
  //    CRIAR conta, nunca ASSUMIR a de outro."*
  //
  // **O dono revogou a recusa em 30/08/2026**, com a tela na frente, depois de levar o erro ao
  // salvar a ALESSANDRO: *"podemos usar o mesmo email para mais de uma empresa, assim damos o
  // acesso da mesma pessoa a todas as suas empresas"*.
  //
  // ⚠ O motivo antigo NÃO era burocracia, e é por isso que a recusa virou um CAMINHO COM
  // CONFIRMAÇÃO, e não um sumiço: o que ele impedia era assumir a conta de outro **em silêncio**.
  // Sem confirmação, isto reabriria o defeito de 19/08 por outra porta.
  //
  // ⚠ E a assimetria que a revogação fecha estava medida: `CompanyProvisioningService` SEMPRE
  // reusou o `User` existente ao CRIAR empresa. Vincular era permitido pela porta da criação e
  // recusado pela porta da edição — o mesmo ato, dois vereditos.
  //
  // Medido em produção no mesmo dia: a carteira JÁ tem dono compartilhado legítimo
  // (`vssouzaempreiteira@gmail.com` → 3 empresas; outro → 2).
  // ═════════════════════════════════════════════════════════════════════════════════════════

  test("INVERTIDO (dono, 30/08/2026): e-mail de OUTRO usuário → 409 pedindo CONFIRMAÇÃO, e nada é escrito", async () => {
    semearUsuario({ id: "user-dono", email: EMAIL_ANTIGO });
    semearUsuario({ id: "user-alheio", email: EMAIL_NOVO, name: "Outra Pessoa" });
    semearVinculo({ companyId: PORTAL_EDITADA, userId: "user-dono" });

    const res = await salvar(app, { ownerEmail: EMAIL_NOVO });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("owner_email_conta_existente");
    // ⚠ A CONFIRMAÇÃO REPETE OS DADOS: de quem é a conta, para o contador decidir vendo.
    expect(res.body.emailNovo).toBe(EMAIL_NOVO);
    expect(res.body.nomeDaContaDestino).toBe("Outra Pessoa");
    // ⚠⚠ A METADE QUE **NÃO** MUDOU, e é a que importa: sem confirmar, NADA foi escrito.
    // O `throw` aborta a transação inteira — nem o cadastro da empresa é salvo.
    expect(donoDe(PORTAL_EDITADA)).toEqual({ userId: "user-dono", email: EMAIL_ANTIGO });
    expect(banco.vinculos.filter((v) => v.userId === "user-alheio")).toHaveLength(0);
  });

  test("INVERTIDO (dono, 30/08/2026): CONFIRMANDO, a empresa é VINCULADA à conta existente", async () => {
    semearUsuario({ id: "user-dono", email: EMAIL_ANTIGO });
    semearUsuario({ id: "user-alheio", email: EMAIL_NOVO });
    semearVinculo({ companyId: PORTAL_EDITADA, userId: "user-dono" });
    semearVinculo({ companyId: "portal-outra", userId: "user-dono" });

    const res = await salvar(app, { ownerEmail: EMAIL_NOVO, confirmarNovoAcesso: true });

    expect(res.status).toBe(200);
    // ⚠ A empresa editada passa a pertencer à conta que JÁ EXISTIA.
    expect(donoDe(PORTAL_EDITADA)).toEqual({ userId: "user-alheio", email: EMAIL_NOVO });
    // ⚠⚠ NENHUMA CONTA É CRIADA — é o que separa este caminho do `CRIAR_ACESSO_PROPRIO`.
    expect(prismaMock.user.create).not.toHaveBeenCalled();
    // ⚠⚠ E A CONTA DESTINO NÃO É RENOMEADA: ela atende outras empresas, e renomeá-la seria o
    // arrasto de 19/08/2026 entrando por outra porta.
    expect(banco.users.get("user-alheio")).toMatchObject({ email: EMAIL_NOVO });
    // ⚠ A OUTRA empresa da conta antiga fica exatamente onde estava.
    expect(donoDe("portal-outra")).toEqual({ userId: "user-dono", email: EMAIL_ANTIGO });
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // O DEFEITO — conta compartilhada
  // ───────────────────────────────────────────────────────────────────────────────────────────

  test("conta de VÁRIAS empresas, SEM confirmação → recusa e nomeia a consequência (não salva nada)", async () => {
    // ⚠ ANTES DO CONSERTO: respondia 200 e renomeava a conta compartilhada em silêncio.
    //   `donoDe("portal-outra")` virava `{ userId: "user-dono", email: "novo@empresa.com" }`.
    semearUsuario({ id: "user-dono", email: EMAIL_ANTIGO });
    semearVinculo({ companyId: PORTAL_EDITADA, userId: "user-dono" });
    semearVinculo({ companyId: "portal-outra", userId: "user-dono" });

    const res = await salvar(app, { ownerEmail: EMAIL_NOVO });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("owner_email_conta_compartilhada");
    // A tela precisa dos DADOS para repetir o ato ao contador, não de "tem certeza?".
    expect(res.body.emailAtual).toBe(EMAIL_ANTIGO);
    expect(res.body.emailNovo).toBe(EMAIL_NOVO);
    expect(res.body.empresasDaConta).toBe(2);
    expect(res.body.outrasEmpresas).toBe(1);
    expect(res.body.contaNovaSemSenha).toBe(true);
    // ⚠ NADA foi escrito: a recusa é ANTES do ato, não um desfazer depois.
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(prismaMock.user.create).not.toHaveBeenCalled();
    expect(donoDe(PORTAL_EDITADA)).toEqual({ userId: "user-dono", email: EMAIL_ANTIGO });
    expect(donoDe("portal-outra")).toEqual({ userId: "user-dono", email: EMAIL_ANTIGO });
  });

  test("conta de VÁRIAS empresas, COM confirmação → a editada ganha acesso PRÓPRIO e a outra não muda de dono", async () => {
    // ⚠ ANTES DO CONSERTO: a conta compartilhada era renomeada e a OUTRA empresa passava a
    //   pertencer ao login novo — o oposto do que o contador pediu.
    semearUsuario({ id: "user-dono", email: EMAIL_ANTIGO });
    semearVinculo({ companyId: PORTAL_EDITADA, userId: "user-dono" });
    semearVinculo({ companyId: "portal-outra", userId: "user-dono" });

    const res = await salvar(app, { ownerEmail: EMAIL_NOVO, ownerName: "Responsável Novo", confirmarNovoAcesso: true });

    expect(res.status).toBe(200);

    // A EDITADA: conta nova, e-mail novo.
    const editada = donoDe(PORTAL_EDITADA);
    expect(editada.email).toBe(EMAIL_NOVO);
    expect(editada.userId).not.toBe("user-dono");

    // A OUTRA: mesmíssimo usuário, mesmíssimo e-mail. Este é o caso do defeito.
    expect(donoDe("portal-outra")).toEqual({ userId: "user-dono", email: EMAIL_ANTIGO });

    // ⚠ A conta COMPARTILHADA não foi tocada de forma nenhuma — nem e-mail, nem nome.
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(banco.users.get("user-dono")).toMatchObject({ email: EMAIL_ANTIGO, name: "Dono da Empresa" });
  });

  test("a conta nova nasce SEM SENHA UTILIZÁVEL, ativa, e o corpo aponta para a ação que define uma", async () => {
    semearUsuario({ id: "user-dono", email: EMAIL_ANTIGO });
    semearVinculo({ companyId: PORTAL_EDITADA, userId: "user-dono" });
    semearVinculo({ companyId: "portal-outra", userId: "user-dono" });

    const res = await salvar(app, { ownerEmail: EMAIL_NOVO, ownerPassword: "Senha@Forte1", confirmarNovoAcesso: true });

    expect(res.status).toBe(200);
    expect(prismaMock.user.create).toHaveBeenCalledTimes(1);
    const { data } = prismaMock.user.create.mock.calls[0][0];

    expect(data.email).toBe(EMAIL_NOVO);
    // ⚠ `status: "active"` é MEDIDO, não escolhido por gosto: `definirSenhaPeloEscritorio`
    // (`application/auth/SenhaDoPortalService.js`) NÃO mexe em `status`, e `routes/auth.js`
    // recusa login com `user_not_active`. Nascer "pending" faria a senha definida pelo contador
    // não servir para nada, e ninguém descobriria o motivo.
    expect(data.status).toBe("active");
    expect(data.accountType).toBe("CLIENT");
    expect(data.role).toBe("user");
    // ⚠ NENHUMA senha do payload vira a senha da conta nova. Senha do portal só nasce pela porta
    // própria, que audita, revoga sessão e exibe UMA vez.
    expect(data.passwordHash).not.toContain("Senha@Forte1");
    expect(String(data.passwordHash).length).toBeGreaterThan(10);

    // E a tela precisa saber disso ANTES de o contador desligar o telefone com o cliente.
    expect(res.body.acessoNovo).toMatchObject({ email: EMAIL_NOVO, semSenha: true });
    expect(res.body.acessoNovo.userId).toEqual(expect.any(String));
  });

  test("o vínculo da conta compartilhada com a empresa EDITADA sai (REMOVED); os das outras ficam intactos", async () => {
    semearUsuario({ id: "user-dono", email: EMAIL_ANTIGO });
    const daEditada = semearVinculo({ companyId: PORTAL_EDITADA, userId: "user-dono" });
    const daOutra = semearVinculo({ companyId: "portal-outra", userId: "user-dono" });

    await salvar(app, { ownerEmail: EMAIL_NOVO, confirmarNovoAcesso: true });

    // Sem isto o login ANTIGO continuaria enxergando a empresa editada — o defeito pela metade.
    expect(daEditada.status).toBe("REMOVED");
    // ⚠ E a outra não encosta: mesmo id, mesmo status, mesmo papel.
    expect(daOutra).toMatchObject({ companyId: "portal-outra", userId: "user-dono", role: "OWNER", status: "ACTIVE" });
  });

  test("Client legado COMPARTILHADO não é renomeado; o de uma empresa só continua sendo", async () => {
    // ⚠ MESMA CLASSE DE DEFEITO NA TABELA LEGADA: `Client` tem `companies Company[]`, e
    // `CompanyProvisioningService` REUSA o `Client` por e-mail — então N empresas podem apontar
    // para um `Client` só, e `tx.client.update({ data: { email, login } })` renomeava o de todas.
    // Medido: nada em `routes/auth.js` autentica contra `Client` (a única leitura é
    // `ClientRepository`), então isto é dado, não login — mas dado errado para N-1 empresas.
    semearUsuario({ id: "user-dono", email: EMAIL_ANTIGO });
    semearVinculo({ companyId: PORTAL_EDITADA, userId: "user-dono" });
    banco.clients.get(CLIENT_LEGACY).quantasCompanies = 3;

    const res = await salvar(app, { ownerEmail: EMAIL_NOVO });

    expect(res.status).toBe(200);
    // ANTES DO CONSERTO: `email`/`login` viravam `novo@empresa.com` para as três empresas.
    expect(banco.clients.get(CLIENT_LEGACY)).toMatchObject({ email: EMAIL_ANTIGO, login: EMAIL_ANTIGO });
    expect(prismaMock.client.update).not.toHaveBeenCalled();
    // A conta do portal (que é de UMA empresa) continua sendo renomeada normalmente.
    expect(donoDe(PORTAL_EDITADA)).toEqual({ userId: "user-dono", email: EMAIL_NOVO });
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // A REPRODUÇÃO DO CASO REAL — nove vínculos
  // ───────────────────────────────────────────────────────────────────────────────────────────

  test("REPRODUÇÃO: um login com NOVE empresas — troca em uma, e as outras OITO não mudam de dono", async () => {
    // ⚠ ANTES DO CONSERTO, este mesmo cenário terminava com as NOVE empresas pertencendo a
    //   `novo@empresa.com` — que é literalmente o que o dono viu ao entrar no portal do cliente.
    semearUsuario({ id: "user-dono", email: EMAIL_ANTIGO });
    semearVinculo({ companyId: PORTAL_EDITADA, userId: "user-dono" });
    const outras = Array.from({ length: 8 }, (_, i) => `portal-outra-${i + 1}`);
    for (const c of outras) semearVinculo({ companyId: c, userId: "user-dono" });

    // 1º salvar: SEM confirmação, o servidor recusa e conta quantas empresas estão em jogo.
    const aviso = await salvar(app, { ownerEmail: EMAIL_NOVO });
    expect(aviso.status).toBe(409);
    expect(aviso.body.error).toBe("owner_email_conta_compartilhada");
    expect(aviso.body.empresasDaConta).toBe(9);
    expect(aviso.body.outrasEmpresas).toBe(8);

    // 2º salvar: o contador confirmou na tela.
    const res = await salvar(app, { ownerEmail: EMAIL_NOVO, confirmarNovoAcesso: true });
    expect(res.status).toBe(200);

    // A EDITADA mudou de dono, e para uma conta NOVA.
    expect(donoDe(PORTAL_EDITADA).email).toBe(EMAIL_NOVO);
    expect(donoDe(PORTAL_EDITADA).userId).not.toBe("user-dono");

    // ⚠⚠ A ASSERÇÃO DO DEFEITO: as OITO continuam exatamente onde estavam.
    for (const c of outras) {
      expect(donoDe(c)).toEqual({ userId: "user-dono", email: EMAIL_ANTIGO });
    }
    expect(banco.users.get("user-dono").email).toBe(EMAIL_ANTIGO);
    expect(banco.vinculos.filter((v) => v.userId === "user-dono" && v.status === "ACTIVE")).toHaveLength(8);
  });
});

// ⚠⚠ O CLIENT LEGADO NAO PODE DERRUBAR A TROCA DO RESPONSAVEL — defeito de producao, 02/09/2026.
//
// Relato do dono, literal: *"EM PRODUCAO DEVE PODER ALTERAR TUDO NO CADASTRO, MENOS O CNPJ, MAS
// NAO CONSIGO ALTERAR O RESPONSAVEL DAS EMPRESAS"*.
//
// O que acontecia: depois de o contador CONFIRMAR o vinculo, a rota ainda executava, na MESMA
// transacao, `tx.client.update({ data: { email, login } })` na tabela LEGADA. Os dois campos sao
// `@unique`, e o e-mail de destino ja pertencia a outro `Client` — porque o provisionamento cria
// um `Client` por e-mail de dono. P2002, transacao inteira revertida, vinculo perdido.
//
// ⚠ Medido em producao antes do conserto: **22 dos 24** e-mails de responsavel da carteira JA
// existem como `Client`, e **20 das 34** empresas caem no `if` que dispara o update. Vincular a
// conta de alguem que ja e dono de outra empresa — o pedido do dono — batia SEMPRE.
describe("PATCH /firm/companies/:id — o Client legado nao derruba a troca do responsavel", () => {
  let app;
  const EMAIL_DESTINO = "ja.existe@empresa.com";
  const CLIENT_DO_DESTINO = "client-do-destino";

  beforeEach(() => {
    jest.clearAllMocks();
    resetBanco();
    ligarPrismaAoBanco();
    banco.clients.set(CLIENT_LEGACY, { id: CLIENT_LEGACY, email: EMAIL_ANTIGO, login: EMAIL_ANTIGO, name: "Dono", quantasCompanies: 1 });
    // O `Client` legado da OUTRA empresa, ja com o e-mail de destino — o estado real da carteira.
    banco.clients.set(CLIENT_DO_DESTINO, { id: CLIENT_DO_DESTINO, email: EMAIL_DESTINO, login: EMAIL_DESTINO, name: "Destino", quantasCompanies: 1 });
    app = montarApp();
  });

  function cenarioDoDono() {
    // A empresa editada tem o dono dela; o e-mail de destino ja e conta de OUTRA empresa.
    semearUsuario({ id: "user-dono", email: EMAIL_ANTIGO });
    semearVinculo({ companyId: PORTAL_EDITADA, userId: "user-dono" });
    semearUsuario({ id: "user-destino", email: EMAIL_DESTINO, name: "JULIA" });
    semearVinculo({ companyId: "portal-outra-1", userId: "user-destino" });
  }

  test("⚠⚠ CONFIRMADO, O VINCULO GRAVA — antes disto a transacao inteira voltava atras (P2002)", async () => {
    cenarioDoDono();

    // 1o salvar: o servidor pede confirmacao (este pedaco ja funcionava).
    const aviso = await salvar(app, { ownerEmail: EMAIL_DESTINO });
    expect(aviso.status).toBe(409);
    expect(aviso.body.error).toBe("owner_email_conta_existente");

    // 2o salvar: o contador confirmou na tela. ANTES: 500, e nada mudava.
    const res = await salvar(app, { ownerEmail: EMAIL_DESTINO, confirmarNovoAcesso: true });
    expect(res.status).toBe(200);
    expect(donoDe(PORTAL_EDITADA)).toEqual({ userId: "user-destino", email: EMAIL_DESTINO });
  });

  test("o `Client` legado do destino fica INTACTO — ele carrega notas fiscais", async () => {
    cenarioDoDono();
    await salvar(app, { ownerEmail: EMAIL_DESTINO, confirmarNovoAcesso: true });

    expect(banco.clients.get(CLIENT_DO_DESTINO)).toMatchObject({ email: EMAIL_DESTINO, login: EMAIL_DESTINO });
    // ⚠ E o da empresa editada NAO e renomeado: renomea-lo exigiria roubar o e-mail do outro.
    expect(banco.clients.get(CLIENT_LEGACY)).toMatchObject({ email: EMAIL_ANTIGO });
    expect(prismaMock.client.update).not.toHaveBeenCalled();
  });

  test("⚠ a EMPRESA nao se perde junto: o cadastro editado tambem e gravado", async () => {
    // A transacao abortada levava o `company.update` junto — o contador perdia a edicao inteira,
    // nao so a troca do responsavel.
    cenarioDoDono();
    const res = await salvar(app, { ownerEmail: EMAIL_DESTINO, confirmarNovoAcesso: true });

    expect(res.status).toBe(200);
    expect(prismaMock.company.update).toHaveBeenCalled();
  });

  test("PRESERVADO: sem colisao, o `Client` legado continua acompanhando o e-mail novo", async () => {
    // O caso comum nao mudou — e a prova de que o conserto e uma GUARDA, nao a remocao do update.
    semearUsuario({ id: "user-dono", email: EMAIL_ANTIGO });
    semearVinculo({ companyId: PORTAL_EDITADA, userId: "user-dono" });

    const res = await salvar(app, { ownerEmail: "ninguem.usa@empresa.com" });

    expect(res.status).toBe(200);
    expect(banco.clients.get(CLIENT_LEGACY)).toMatchObject({
      email: "ninguem.usa@empresa.com",
      login: "ninguem.usa@empresa.com",
    });
  });
});
