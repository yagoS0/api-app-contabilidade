jest.mock("../../../infrastructure/db/prisma.js", () => ({ prisma: {} }));
import * as catalogo from "../CatalogoComercial.js";
import { criarRecursosComerciais, validarImportacaoRecursos } from "../RecursosComerciaisService.js";
import { CATALOGO_SINTETICO } from "./fixtures/catalogoSintetico.js";
const user = { id: "gestor-teste", role: "contador", accountType: "FIRM", status: "active" };
const ficha = { origem: "TRANSFERENCIA", dados: { modalidadeServico: "RECORRENTE", regimeAtual: "SIMPLES", qtdFuncionarios: 9, notasRecebidasMes: 0 } };

test("código público não exporta catálogo interno", () => {
  expect(Object.hasOwn(catalogo, "CATALOGO_INICIAL")).toBe(false);
});
test("preços sem configuração são recusados", () => {
  expect(() => catalogo.calcularOpcoes({ ficha })).toThrow("catálogo");
});
test("biblioteca inicial não inclui política de preço nem minuta privada", async () => {
  const db = { recursoComercial: { upsert: jest.fn(async () => ({})), findMany: async () => [] } };
  await criarRecursosComerciais({ db }).iniciarBiblioteca(user);
  const criados = db.recursoComercial.upsert.mock.calls.map(c => c[0].create);
  expect(criados.length).toBeGreaterThan(0);
  expect(criados.every(r => !["CATALOGO", "CONTRATO"].includes(r.tipo))).toBe(true);
  expect(criados.every(r => !r.aprovadoEm && !r.aprovadoPor)).toBe(true);
});
test("orçamento personalizado acompanha a última faixa configurada", () => {
  const r = catalogo.calcularOpcoes({ ficha, catalogo: CATALOGO_SINTETICO });
  expect(r.opcoes[0].mensalCentavos).toBeNull();
  expect(r.pendencias).toContain("Equipe com 9 ou mais funcionários exige orçamento personalizado.");
});
test("piso personalizado também acompanha a última faixa configurada", () => {
  const r = catalogo.calcularOpcoes({ ficha, catalogo: CATALOGO_SINTETICO, ajustes: { mensalCentavos: 111, justificativa: "Teste de ajuste" } });
  expect(r.pendencias).toContain("Mensalidade abaixo do piso personalizado.");
});

const payload = () => ({ formatVersion: 1, resources: [
  { tipo: "CATALOGO", chave: "honorarios", versao: 1, titulo: "Catálogo sintético", dados: structuredClone(CATALOGO_SINTETICO) },
  { tipo: "CONTRATO", chave: "modelo-teste", versao: 1, titulo: "Modelo fictício", texto: "Serviço de teste para {{nome}}", dados: { recorrente: false } },
] });
function banco(initial = [], ator = user) {
  let rows = structuredClone(initial);
  const api = { rows: () => rows, $transaction: jest.fn(async (fn) => {
    const local = structuredClone(rows);
    const tx = {
      user: { findUnique: jest.fn(async ({ where }) => ator?.id === where.id ? ator : null) },
      recursoComercial: {
        findUnique: async ({ where }) => local.find(r => ["tipo", "chave", "versao"].every(k => r[k] === where.tipo_chave_versao[k])) || null,
        create: async ({ data }) => { const r = { id: `teste-${local.length + 1}`, ...structuredClone(data) }; local.push(r); return r; },
      },
    };
    const r = await fn(tx);
    rows = local;
    return r;
  }) };
  return api;
}
test("prévia valida o ator real e não grava configuração", async () => {
  const db = banco(), service = criarRecursosComerciais({ db });
  const r = await service.importarRascunhos(payload(), user.id);
  expect(r).toMatchObject({ modo: "PREVIA", criados: 0, previstos: 2 });
  expect(db.rows()).toEqual([]);
  expect(JSON.stringify(r)).not.toContain("Serviço de teste");
  expect(JSON.stringify(r)).not.toContain("13711");
});
test("modo textual não habilita gravação por coerção", async () => {
  const db = banco();
  await expect(criarRecursosComerciais({ db }).importarRascunhos(payload(), user.id, { aplicar: "false" })).rejects.toMatchObject({ code: "modo_importacao_invalido" });
  expect(db.$transaction).not.toHaveBeenCalled();
});
test("importação repetida é idempotente e deixa novos recursos sem aprovação", async () => {
  const db = banco(), service = criarRecursosComerciais({ db });
  expect(await service.importarRascunhos(payload(), user.id, { aplicar: true })).toMatchObject({ criados: 2, existentes: 0 });
  const antes = structuredClone(db.rows());
  expect(await service.importarRascunhos(payload(), user.id, { aplicar: true })).toMatchObject({ criados: 0, existentes: 2 });
  expect(db.rows()).toEqual(antes);
  expect(db.rows().every(r => r.aprovadoEm === null && r.aprovadoPor === null)).toBe(true);
  expect(db.$transaction).toHaveBeenLastCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
});
test("divergência reverte o lote inteiro e preserva a versão aprovada", async () => {
  const existente = { ...payload().resources[1], id: "aprovado", aprovadoEm: new Date("2026-01-01"), aprovadoPor: "gestor-anterior" };
  const db = banco([existente]), service = criarRecursosComerciais({ db }), importacao = payload();
  importacao.resources[1].texto = "Outro conteúdo fictício";
  await expect(service.importarRascunhos(importacao, user.id, { aplicar: true })).rejects.toMatchObject({ code: "versao_divergente" });
  expect(db.rows()).toEqual([existente]);
});
test("versão já aprovada com conteúdo equivalente conserva sua aprovação", async () => {
  const existente = { ...payload().resources[1], id: "aprovado", aprovadoEm: new Date("2026-01-01"), aprovadoPor: "gestor-anterior" };
  const db = banco([existente]), service = criarRecursosComerciais({ db });
  const r = await service.importarRascunhos({ formatVersion: 1, resources: [payload().resources[1]] }, user.id, { aplicar: true });
  expect(r.recursos[0].estado).toBe("JA_EXISTIA_APROVADO");
  expect(db.rows()).toEqual([existente]);
});
test("nova versão cria rascunho sem sobrescrever a anterior", async () => {
  const db = banco(), service = criarRecursosComerciais({ db });
  await service.importarRascunhos(payload(), user.id, { aplicar: true });
  const nova = payload(); nova.resources = [{ ...nova.resources[1], versao: 2, texto: "Nova versão fictícia" }];
  await service.importarRascunhos(nova, user.id, { aplicar: true });
  expect(db.rows()).toHaveLength(3);
  expect(db.rows().find(r => r.tipo === "CONTRATO" && r.versao === 1).texto).toBe(payload().resources[1].texto);
});
test.each([null, { ...user, accountType: "CLIENT" }, { ...user, role: "user" }, { ...user, status: "pending" }])("ator ausente ou sem autorização não importa", async ator => {
  const db = banco([], ator);
  await expect(criarRecursosComerciais({ db }).importarRascunhos(payload(), user.id, { aplicar: true })).rejects.toMatchObject({ code: "forbidden" });
  expect(db.rows()).toEqual([]);
});
test.each([p => p.resources[0].aprovadoEm = "2026-01-01", p => p.resources[0].aprovadoPor = "admin", p => p.resources[0].versao = 0,
  p => p.resources[0].dados = [], p => p.resources[0].texto = {}, p => p.resources.push(p.resources[0]), p => p.formatVersion = 2,
  p => p.resources = [], p => p.resources[0].dados = { longo: "x".repeat(60001) }])("entrada inválida ou com aprovação não chega ao banco", async alterar => {
  const db = banco(), p = payload(); alterar(p);
  await expect(criarRecursosComerciais({ db }).importarRascunhos(p, user.id, { aplicar: true })).rejects.toBeTruthy();
  expect(db.$transaction).not.toHaveBeenCalled();
});
test("ordem das propriedades JSON não muda a identidade do recurso", async () => {
  const a = { tipo: "INSTITUCIONAL", chave: "teste", versao: 1, titulo: "Dados fictícios", texto: "", dados: { primeiro: 1, segundo: 2 } };
  const db = banco([{ ...a, id: "existente" }]);
  const r = await criarRecursosComerciais({ db }).importarRascunhos({ formatVersion: 1, resources: [{ ...a, dados: { segundo: 2, primeiro: 1 } }] }, user.id, { aplicar: true });
  expect(r).toMatchObject({ existentes: 1, criados: 0 });
});
test.each(["P2034", "P2002"])("concorrência %s reabre transação sem substituir versões", async code => {
  const db = banco(); db.$transaction.mockRejectedValueOnce(Object.assign(new Error("conflito sintético"), { code }));
  const r = await criarRecursosComerciais({ db }).importarRascunhos(payload(), user.id, { aplicar: true });
  expect(r.criados).toBe(2);
  expect(db.$transaction).toHaveBeenCalledTimes(2);
  expect(db.rows()).toHaveLength(2);
});
test("importação não recebe aprovação nem altera o payload original", () => {
  const p = payload(), antes = structuredClone(p);
  expect(validarImportacaoRecursos(p)).toHaveLength(2);
  expect(p).toEqual(antes);
});
