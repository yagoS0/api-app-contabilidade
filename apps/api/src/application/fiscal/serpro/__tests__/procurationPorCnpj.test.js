jest.mock("../../../../infrastructure/db/prisma.js", () => { const prisma = { portalClient: { findUnique: jest.fn(), create: jest.fn() }, appSetting: { findUnique: jest.fn(), upsert: jest.fn(), update: jest.fn() }, $executeRaw: jest.fn(async () => 1) }; prisma.$transaction = jest.fn(fn => fn(prisma)); return { prisma }; });
jest.mock("../SerproRuntimeSettings.js", () => ({ getResolvedSerproCredentials: jest.fn(async () => ({ certificate: { document: "12345678000199" } })) }));
jest.mock("../SerproHttpClient.js", () => ({ SerproHttpClient: jest.fn() }));
import { prisma } from "../../../../infrastructure/db/prisma.js";
import { SerproProcurationService, summarizeProcurationResponse, projetarProcuracaoSalva } from "../SerproProcurationService.js";

it("consulta procuração pelo CNPJ sem criar ou exigir PortalClient", async () => {
  const post = jest.fn(async () => ({ dados: JSON.stringify([{ dtexpiracao: "31/12/2026", sistemas: ["SITFIS"] }]) }));
  const r = await new SerproProcurationService({ client: { post } }).checkCnpjProcuration({ cnpj: "11.222.333/0001-81" });
  expect(r).toMatchObject({ cnpj: "11222333000181", procuradorCnpj: "12345678000199", status: "ATIVA", systems: ["SITFIS"] });
  const body = post.mock.calls[0][1];
  expect(body.contribuinte.numero).toBe("11222333000181");
  expect(JSON.parse(body.pedidoDados.dados)).toMatchObject({ outorgante: "11222333000181", outorgado: "12345678000199" });
  expect(prisma.portalClient.findUnique).not.toHaveBeenCalled(); expect(prisma.portalClient.create).not.toHaveBeenCalled(); expect(prisma.appSetting.upsert).not.toHaveBeenCalled();
});
it("lê formato oficial aaaammdd e reúne apenas sistemas de procurações vigentes", () => {
  const r = summarizeProcurationResponse({ status: 200, dados: JSON.stringify([
    { dtexpiracao: "20991231", sistemas: ["Situação Fiscal do Contribuinte"] },
    { dtexpiracao: "20001231", sistemas: ["PGDASD"] },
  ]) });
  expect(r.status).toBe("ATIVA"); expect(r.systems).toEqual(["Situação Fiscal do Contribuinte"]);
});
it.each(["REVOGADA", "INATIVA", "CANCELADA"])("%s prevalece sobre validade futura em array e objeto", (status) => {
  expect(summarizeProcurationResponse({ status, validade: "2099-12-31", sistemas: ["SITFIS"] }).status).toBe("AUSENTE");
  expect(summarizeProcurationResponse({ dados: JSON.stringify([{ status, dtexpiracao: "20991231", sistemas: ["SITFIS"] }]) }).status).toBe("AUSENTE");
});
it("validade isolada em objeto não canônico não autoriza", () => {
  expect(summarizeProcurationResponse({ validade: "2099-12-31", sistemas: ["SITFIS"] }).status).toBe("AUSENTE");
});

const empresa = { id: "empresa", cnpj: "11222333000181" };
function cache(status = "ATIVA") {
  return { value: { cnpj: empresa.cnpj, procuradorCnpj: "12345678000199", status, systems: ["00146"], validUntil: "2099-12-31", checkedAt: new Date().toISOString() } };
}
it.each(["ATIVA", "AUSENTE"])("reutiliza %s recente sem chamada fiscal", async status => {
  prisma.portalClient.findUnique.mockResolvedValue(empresa);
  prisma.appSetting.findUnique.mockResolvedValue(cache(status));
  const post = jest.fn();
  const r = await new SerproProcurationService({ client: { post } }).checkCompanyProcuration({ portalClientId: empresa.id, reutilizar: true });
  expect(r.reutilizado).toBe(true); expect(post).not.toHaveBeenCalled();
});
it.each(["expirada", "procurador", "cnpj", "antiga"])("cache %s não autoriza consulta", async caso => {
  const salvo = cache();
  if (caso === "expirada") salvo.value.validUntil = "2000-01-01";
  if (caso === "procurador") salvo.value.procuradorCnpj = "99999999000100";
  if (caso === "cnpj") salvo.value.cnpj = "99999999000100";
  if (caso === "antiga") salvo.value.checkedAt = "2000-01-01";
  prisma.portalClient.findUnique.mockResolvedValue(empresa);
  prisma.appSetting.findUnique.mockResolvedValue(salvo);
  const post = jest.fn(async () => ({ status: 200, dados: "[]" }));
  await new SerproProcurationService({ client: { post } }).checkCompanyProcuration({ portalClientId: empresa.id, reutilizar: true });
  expect(post).toHaveBeenCalledTimes(1);
});
it("resposta inconclusiva não sobrescreve a última procuração", async () => {
  prisma.appSetting.upsert.mockClear();
  prisma.portalClient.findUnique.mockResolvedValue(empresa);
  const post = jest.fn(async () => ({ status: 503 }));
  await expect(new SerproProcurationService({ client: { post } }).checkCompanyProcuration({ portalClientId: empresa.id })).rejects.toMatchObject({ code: "SERPRO_PROCURACAO_INCONCLUSIVA" });
  expect(prisma.appSetting.upsert.mock.calls.some(([args]) => args.where.key.startsWith('serpro_procuration_status:'))).toBe(false);
});
it("registra ausência explícita oficial sem confundir null com falha", async () => {
  prisma.appSetting.upsert.mockClear();
  prisma.portalClient.findUnique.mockResolvedValue(empresa);
  const post = jest.fn(async () => ({ status: 200, dados: null, mensagens: [{codigo:"[Aviso-PROCURACOES-40400]"}] }));
  const r = await new SerproProcurationService({client:{post}}).checkCompanyProcuration({portalClientId:empresa.id});
  expect(r.status).toBe("AUSENTE");
  expect(prisma.appSetting.upsert).toHaveBeenCalledWith(expect.objectContaining({update:{value:expect.objectContaining({status:"AUSENTE",cnpj:empresa.cnpj})}}));
});
it.each([
  {status:200,dados:null},
  {status:503,dados:null,mensagens:[{codigo:"[Aviso-PROCURACOES-40400]"}]},
  {status:200,dados:null,mensagens:[{codigo:"[Aviso-PROCURACOES-40400]"},{codigo:"[Erro-PROCURACOES-50001]"}]},
  {status:200,dados:"malformado",mensagens:[{codigo:"[Aviso-PROCURACOES-40400]"}]},
])("retorno ambíguo preserva situação anterior: %j", async response => {
  prisma.appSetting.upsert.mockClear();
  await expect(new SerproProcurationService({client:{post:async()=>response}}).checkCompanyProcuration({portalClientId:empresa.id})).rejects.toMatchObject({code:"SERPRO_PROCURACAO_INCONCLUSIVA"});
  expect(prisma.appSetting.upsert.mock.calls.some(([args]) => args.where.key.startsWith('serpro_procuration_status:'))).toBe(false);
});

function persistencia() {
  const rows = new Map(); let fila = Promise.resolve();
  const db = { portalClient: { findUnique: async () => empresa }, $executeRaw: jest.fn(async () => 1), appSetting: {
    findUnique: async ({ where }) => rows.get(where.key),
    upsert: async ({ where, create, update }) => { const row = rows.has(where.key) ? { ...rows.get(where.key), ...update } : create; rows.set(where.key, row); return row; },
    update: async ({ where, data }) => { const row = { ...rows.get(where.key), ...data }; rows.set(where.key, row); return row; },
  } };
  db.$transaction = fn => { const atual = fila.then(() => fn(db)); fila = atual.catch(() => {}); return atual; };
  const service = new SerproProcurationService({ db, client: { post: jest.fn() }, getCredentials: async () => ({ certificate: { document: '12345678000199' } }) });
  const valido = () => ({ status: 'ATIVA', cnpj: empresa.cnpj, procuradorCnpj: '12345678000199', checkedAt: new Date().toISOString(), validUntil: '2099-12-31', systems: ['00146'], rawPayload: {} });
  service.checkCnpjProcuration = jest.fn(async () => valido());
  const run = () => service.checkCompanyProcuration({ portalClientId: empresa.id });
  const evidencia = () => rows.get('serpro_procuration_status:empresa')?.value;
  const tentativa = () => rows.get('serpro_procuration_attempt:empresa')?.value;
  const dto = () => projetarProcuracaoSalva(evidencia(), tentativa(), { cnpj: empresa.cnpj, procuradorCnpj: '12345678000199' });
  return { rows, service, run, evidencia, tentativa, dto, valido };
}

test('falha preserva resultado válido e DTO distingue última tentativa sanitizada; sucesso posterior limpa erro', async () => {
  const f = persistencia(); await f.run(); const salva = structuredClone(f.evidencia());
  f.service.checkCnpjProcuration.mockRejectedValueOnce(Object.assign(Error('segredo e payload privado'), { code: 'SEGREDO_PRIVADO' }));
  await expect(f.run()).rejects.toThrow('segredo');
  expect(f.evidencia()).toEqual(salva);
  expect(f.dto()).toMatchObject({ procurationStatus: 'ATIVA', ultimaTentativa: { status: 'ERRO', codigo: 'FALHA_VERIFICACAO', vinculoConfirmado: true } });
  expect(JSON.stringify(f.tentativa())).not.toMatch(/segredo|payload|SEGREDO_PRIVADO/);
  await f.run(); expect(f.dto().ultimaTentativa.status).toBe('SUCESSO');
  expect(projetarProcuracaoSalva(f.evidencia(), f.tentativa(), { cnpj: '00000000000000', procuradorCnpj: '12345678000199' })).toMatchObject({ vinculoConfirmado: false, ultimaTentativa: { vinculoConfirmado: false } });
});

test('lock transacional usa execução sem desserializar retorno PostgreSQL void', async () => {
  const f = persistencia(); await f.run();
  expect(f.service.db.$executeRaw).toHaveBeenCalledTimes(2);
  for (const [sql, key] of f.service.db.$executeRaw.mock.calls) {
    expect(sql.join('?')).toBe('SELECT pg_advisory_xact_lock(hashtext(?))');
    expect(key).toBe('serpro_procuration_attempt:empresa');
  }
});

test.each(['falha', 'sucesso'])('conclusão antiga %s não sobrepõe resultado e tentativa novos', async fim => {
  const f = persistencia(); let concluir, iniciou;
  const entrada = new Promise(resolve => { iniciou = resolve; });
  f.service.checkCnpjProcuration.mockImplementationOnce(() => { iniciou(); return new Promise((resolve, reject) => { concluir = () => fim === 'falha' ? reject(Error('antigo')) : resolve({ ...f.valido(), systems: ['ANTIGO'] }); }); });
  const antiga = f.run(); const capturada = antiga.catch(e => e); await entrada;
  await f.run(); const atual = structuredClone(f.evidencia()); const tentativa = structuredClone(f.tentativa());
  concluir(); await capturada;
  expect(f.evidencia()).toEqual(atual); expect(f.tentativa()).toEqual(tentativa);
});
