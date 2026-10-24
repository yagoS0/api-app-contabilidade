import request from "supertest";
import express from "express";

jest.mock("../../../infrastructure/db/prisma.js", () => {
  const models = {};
  const raiz = {};
  const proxy = new Proxy(raiz, {
    get(alvo, prop) {
      if (typeof prop === "symbol") return alvo[prop];
      if (prop === "$transaction") return alvo.$transaction;
      if (prop === "$queryRaw") { if (!alvo[prop]) alvo[prop] = jest.fn(async () => []); return alvo[prop]; }
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
  return {
    ...real,
    computeGuideComplianceMap: jest.fn(async () => new Map()),
  };
});

import { createClientPortalRouter } from "../../client/index.js";
import { createFirmPortalRouter } from "../index.js";
import { prisma as prismaMock } from "../../../infrastructure/db/prisma.js";

const PORTAL_ID = "portal-1";
const COMPANY_LEGACY_ID = "company-legacy-1";
const CNPJ = "11222333000181";

const USUARIO_LOGADO = { id: "user-firm-1", role: "admin", accountType: "FIRM", email: "admin@escritorio.com" };

function montarApp(user = USUARIO_LOGADO) {
  const app = express();
  app.use(express.json());
  app.locals.ensureAuthorized = async (req) => {
    req.auth = { user: { ...user } };
    return true;
  };
  const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  app.use("/firm", createFirmPortalRouter({ ensureAuthorized: app.locals.ensureAuthorized, log }));
  app.use("/client", createClientPortalRouter({ ensureAuthorized: app.locals.ensureAuthorized, log }));
  return app;
}

function payload(companyExtra = {}) {
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
      ...companyExtra,
    },
  };
}

const TITULAR = { nome: 'Ana Teste', cpf: '52998224725' };
const SOCIO = { id: 'partner-test-1', name: 'Bia Teste', cpf: '11144477735' };
let banco;
function prepararBanco({ titular = null, partners = [] } = {}) {
  banco = { portal: { id: PORTAL_ID, companyId: COMPANY_LEGACY_ID, cnpj: CNPJ, razao: 'Antes' }, company: { id: COMPANY_LEGACY_ID, titular, partners, atividades: [] } };
  prismaMock.$transaction.mockImplementation(async fn => {
    const antes = structuredClone(banco);
    try { return await fn(prismaMock); } catch (err) { banco = antes; throw err; }
  });
  prismaMock.portalClient.findUnique.mockImplementation(async () => structuredClone(banco.portal));
  prismaMock.portalClient.update.mockImplementation(async ({ data }) => { Object.assign(banco.portal, data); return structuredClone(banco.portal); });
  prismaMock.company.findUnique.mockImplementation(async () => structuredClone(banco.company));
  prismaMock.company.update.mockImplementation(async ({ data }) => { Object.assign(banco.company, Object.fromEntries(Object.entries(data).filter(([,v]) => v !== undefined))); return structuredClone(banco.company); });
  prismaMock.partner.deleteMany.mockImplementation(async () => { banco.company.partners = []; return { count: 1 }; });
  prismaMock.partner.createMany.mockImplementation(async ({ data }) => { banco.company.partners = structuredClone(data); return { count: data.length }; });
  prismaMock.partner.findFirst.mockImplementation(async ({ where }) => banco.company.partners.find(p => p.id === where.id && where.companyId === COMPANY_LEGACY_ID) || null);
  prismaMock.partner.create.mockImplementation(async ({ data }) => { const p={id:'new-test',...data}; banco.company.partners.push(p); return p; });
  prismaMock.partner.update.mockImplementation(async ({ where,data }) => { const p=banco.company.partners.find(p=>p.id===where.id); Object.assign(p,data); return p; });
  prismaMock.partner.delete.mockImplementation(async ({ where }) => { const p=banco.company.partners.find(p=>p.id===where.id); banco.company.partners=banco.company.partners.filter(p=>p.id!==where.id); return p; });
  prismaMock.companyClientUser.findFirst.mockResolvedValue(null);
  prismaMock.guide.findMany.mockResolvedValue([]);
}
const clone = value => JSON.parse(JSON.stringify(value));
beforeEach(() => { jest.clearAllMocks(); });
test.each([
  ['titular com sócios persistidos omitidos', { partners: [SOCIO] }, { titular: TITULAR }],
  ['sócios com titular persistido omitido', { titular: TITULAR }, { socios: [{ nome: SOCIO.name, cpf: SOCIO.cpf }] }],
])('recusa estado resultante incompatível: %s, sem efeitos parciais no dublê transacional', async (_nome, inicial, patch) => {
  prepararBanco(inicial); const antes = clone(banco);
  const res = await request(montarApp()).patch(`/firm/companies/${PORTAL_ID}`).send({ ...payload(patch), ownerName: 'Não pode alterar responsável' });
  expect(res.status).toBe(400); expect(res.body.error).toBe('company_titular_invalid');
  expect(banco).toEqual(antes);
  expect(prismaMock.company.update).not.toHaveBeenCalled();
  expect(prismaMock.partner.deleteMany).not.toHaveBeenCalled();
  expect(prismaMock.partner.createMany).not.toHaveBeenCalled();
  expect(prismaMock.user.update).not.toHaveBeenCalled();
});
test.each([{ titular: TITULAR }, { partners: [SOCIO] }])('omissão de ambos conserva pessoas: %j', async inicial => {
  prepararBanco(inicial); const pessoas = clone({ titular: banco.company.titular, partners: banco.company.partners });
  const res = await request(montarApp()).patch(`/firm/companies/${PORTAL_ID}`).send(payload());
  expect(res.status).toBe(200); expect({ titular: banco.company.titular, partners: banco.company.partners }).toEqual(pessoas);
  expect(prismaMock.partner.deleteMany).not.toHaveBeenCalled();
});
test('resolução explícita socios vazio permite titular sem limpeza implícita', async () => {
  prepararBanco({ partners: [SOCIO] });
  const res = await request(montarApp()).patch(`/firm/companies/${PORTAL_ID}`).send(payload({ titular: TITULAR, socios: [] }));
  expect(res.status).toBe(200); expect(banco.company.titular).toEqual(TITULAR); expect(banco.company.partners).toEqual([]);expect(banco.company.quantidadeSocios).toBe(0);
  expect(prismaMock.partner.deleteMany).toHaveBeenCalledTimes(1);
});
test('client POST não acrescenta sócio a titular persistido',async()=>{
  prepararBanco({titular:TITULAR});const antes=clone(banco);
  const r=await request(montarApp()).post(`/client/companies/${PORTAL_ID}/partners`).send({name:'Bia'});
  expect(r.status).toBe(400);expect(r.body.error).toBe('company_titular_invalid');expect(banco).toEqual(antes);expect(prismaMock.partner.create).not.toHaveBeenCalled();
});
test('client POST sem titular mantém cadastro de sócio permitido',async()=>{
  prepararBanco();const r=await request(montarApp()).post(`/client/companies/${PORTAL_ID}/partners`).send({name:'Bia'});
  expect(r.status).toBe(201);expect(banco.company.partners).toHaveLength(1);expect(prismaMock.$queryRaw).toHaveBeenCalled();
});
test('client PATCH recusa conflito legado sem alterar pessoa; DELETE explícito pode resolver',async()=>{
  prepararBanco({titular:TITULAR,partners:[SOCIO]});const antes=clone(banco);
  let r=await request(montarApp()).patch(`/client/companies/${PORTAL_ID}/partners/${SOCIO.id}`).send({name:'Não alterar'});
  expect(r.status).toBe(400);expect(banco).toEqual(antes);
  r=await request(montarApp()).delete(`/client/companies/${PORTAL_ID}/partners/${SOCIO.id}`);
  expect(r.status).toBe(200);expect(banco.company.titular).toEqual(TITULAR);expect(banco.company.partners).toEqual([]);
});
test.each(['patch','delete'])('client %s não alcança pessoa ausente/fora da empresa',async metodo=>{
  prepararBanco({partners:[SOCIO]});const antes=clone(banco);
  const r=await request(montarApp())[metodo](`/client/companies/${PORTAL_ID}/partners/other-company-person`).send({name:'Não alterar'});
  expect(r.status).toBe(404);expect(banco).toEqual(antes);
});
test('alteração sem campos de pessoas não converte nem apaga conflito legado',async()=>{
  prepararBanco({titular:TITULAR,partners:[SOCIO]});const antes=clone(banco.company);
  const r=await request(montarApp()).patch(`/firm/companies/${PORTAL_ID}`).send(payload());
  expect(r.status).toBe(200);expect(banco.company.titular).toEqual(antes.titular);expect(banco.company.partners).toEqual(antes.partners);
});

test('cliente financeiro continua sem permissão de alterar sócios, antes da transação',async()=>{
 prepararBanco();prismaMock.companyClientUser.findUnique.mockResolvedValue({role:'FINANCEIRO',status:'ACTIVE'});const antes=clone(banco);
 const app=montarApp({id:'user-financeiro-test',role:'user',accountType:'CLIENT'});
 for(const metodo of ['post','patch','delete']){
  const suffix=metodo==='post'?'':'/partner-test-1';const r=await request(app)[metodo](`/client/companies/${PORTAL_ID}/partners${suffix}`).send({name:'Não autorizado'});
  expect(r.status).toBe(403);expect(r.body.error).toBe('insufficient_role');
 }
 expect(prismaMock.$transaction).not.toHaveBeenCalled();expect(banco).toEqual(antes);
});
