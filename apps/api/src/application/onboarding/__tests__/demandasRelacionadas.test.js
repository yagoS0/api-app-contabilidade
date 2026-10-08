jest.mock("../../../infrastructure/db/prisma.js", () => ({ prisma: {} }));
import { criarDemandaRelacionada } from "../DemandasRelacionadasService.js";
const user = { id: "contador", role: "contador" };
function setup() {
  const original = { id: "alex-irrf", origem: "PESSOA_FISICA", status: "CONCLUIDO_AVULSO", versao: 7, criadoPorId: user.id, responsavelNome: "Alex Exemplo", responsavelEmail: "alex@example.test", dados: { servicoSolicitado: "Resolver IRRF", responsavelCpf: "52998224725" } };
  const fichas = [original], eventos = []; let sequencia = 0;
  const db = { onboarding: {
    findUnique: jest.fn(async ({ where }) => structuredClone(fichas.find(f => f.id === where.id) || null)),
    updateMany: jest.fn(async ({ where }) => ({ count: fichas.some(f => f.id === where.id && f.versao === where.versao) ? 1 : 0 })),
    create: jest.fn(async ({ data }) => { const ficha = { ...data, id: 'demanda-' + ++sequencia, versao: 0 }; fichas.push(ficha); return structuredClone(ficha); }),
  }, onboardingEvento: {
    findFirst: jest.fn(async ({ where }) => eventos.find(e => e.onboardingId === where.onboardingId && e.dados[where.dados.path[0]] === where.dados.equals) || null),
    create: jest.fn(async ({ data }) => { eventos.push(data); return data; }),
  } };
  let lock = Promise.resolve();
  db.$transaction = async fn => { const prev = lock; let release; lock = new Promise(r => { release = r; }); await prev; try { return await fn(db); } finally { release(); } };
  return { db, fichas, original, eventos };
}
test("Alex mantém serviço pessoal e contato é reutilizado na empresa, inclusive após concluir", async () => {
  const t = setup(), antes = structuredClone(t.original);
  const pedido = { origem: "TRANSFERENCIA", versao: 7, chaveSolicitacao: "pedido-empresa-0001" };
  const resultados = await Promise.all([criarDemandaRelacionada("alex-irrf", pedido, user, t.db), criarDemandaRelacionada("alex-irrf", pedido, user, t.db)]);
  expect(resultados[0].id).toBe(resultados[1].id); expect(t.fichas).toHaveLength(2);
  expect(t.original).toEqual(antes);
  expect(resultados[0].dados).toEqual({ responsavelNome: "Alex Exemplo", responsavelEmail: "alex@example.test", responsavelTelefone: "" });
  expect(resultados[0].cnpj).toBeNull(); expect(resultados[0].status).toBe("RASCUNHO");
  expect(resultados[0].eventos.create.dados.onboardingId).toBe("alex-irrf");
  const outra = await criarDemandaRelacionada("alex-irrf", { ...pedido, chaveSolicitacao: "pedido-empresa-0002" }, user, t.db);
  expect(outra.id).not.toBe(resultados[0].id); expect(t.original.versao).toBe(7);
});
test("demanda exige escopo, versão atual e chave consistente", async () => {
  const t = setup(), pedido = { origem: "TRANSFERENCIA", versao: 7, chaveSolicitacao: "pedido-empresa-0001" };
  await expect(criarDemandaRelacionada("alex-irrf", pedido, { id: "outro", role: "assistente" }, t.db)).rejects.toMatchObject({ status: 404 });
  await expect(criarDemandaRelacionada("alex-irrf", { ...pedido, versao: 6 }, user, t.db)).rejects.toMatchObject({ code: "formulario_alterado" });
  await criarDemandaRelacionada("alex-irrf", pedido, user, t.db);
  await expect(criarDemandaRelacionada("alex-irrf", { ...pedido, origem: "ABERTURA" }, user, t.db)).rejects.toMatchObject({ code: "formulario_alterado" });
  expect(t.fichas).toHaveLength(2);
});


test("gestor preserva o responsável da ficha ao criar demanda relacionada", async () => {
  const t = setup(); t.original.criadoPorId = "assistente-original";
  const criada = await criarDemandaRelacionada("alex-irrf", { origem: "TRANSFERENCIA", versao: 7, chaveSolicitacao: "pedido-empresa-gestor" }, user, t.db);
  expect(criada.criadoPorId).toBe("assistente-original");
  const repetida = await criarDemandaRelacionada("alex-irrf", { origem: "TRANSFERENCIA", versao: 7, chaveSolicitacao: "pedido-empresa-gestor" }, { id: "assistente-original", role: "assistente" }, t.db);
  expect(repetida.id).toBe(criada.id);
});
