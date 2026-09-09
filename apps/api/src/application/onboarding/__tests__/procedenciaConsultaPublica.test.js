jest.mock("../../../infrastructure/db/prisma.js", () => ({ prisma: {} }));
import { consultarPublicaLead } from "../FiscalLeadService.js";
import { criarServicoComercial } from "../ComercialService.js";

const agora = new Date("2026-09-09T15:00:00Z");
const user = { id: "gestor-sintetico", role: "contador" };
const ficha = { id: "lead-sintetico", criadoPorId: user.id, status: "RASCUNHO", cnpj: "12345678000190" };
const SEM_PROVEDOR = "Dados públicos de CNPJ (provedor não informado)";
const fetchAnterior = globalThis.fetch;
beforeAll(() => { globalThis.fetch = jest.fn(async () => { throw new Error("REDE PROIBIDA NO TESTE"); }); });
afterAll(() => { globalThis.fetch = fetchAnterior; });

function contexto(fonte) {
  const consulta = jest.fn(async () => ({ ok: true, fonte, bruto: { cnpj: ficha.cnpj, razao_social: "Empresa sintética", descricao_situacao_cadastral: "ATIVA" } }));
  const db = {
    onboarding: { findUnique: jest.fn(async () => ficha) },
    onboardingAnalise: {
      findFirst: jest.fn(async () => null), updateMany: jest.fn(async () => ({ count: 0 })),
      create: jest.fn(async ({ data }) => ({ id: "analise-sintetica", createdAt: agora, ...data })),
      update: jest.fn(async ({ data }) => ({ id: "analise-sintetica", createdAt: agora, ...data })),
    },
    onboardingEvento: { create: jest.fn(async () => ({})) },
  };
  const servico = criarServicoComercial({ db, consultaPublica: consulta, agora: () => agora });
  return { db, consulta, servico };
}

test.each([
  ["BRASILAPI", "BrasilAPI"], ["MINHA_RECEITA", "Minha Receita"], [undefined, SEM_PROVEDOR], ["PROVEDOR_DESCONHECIDO", SEM_PROVEDOR],
])("lead registra a fonte efetiva %s no resultado persistido", async (fonte, esperada) => {
  const { db, consulta } = contexto(fonte);
  const r = await consultarPublicaLead(ficha.id, { db, consultar: consulta, agora });
  expect(r.fonte).toBe(esperada);
  expect(db.onboardingAnalise.create).toHaveBeenCalledWith({ data: expect.objectContaining({
    onboardingId: ficha.id, cnpj: ficha.cnpj, resultado: expect.objectContaining({ fonte: esperada, razaoSocial: "Empresa sintética" }),
  }) });
  expect(consulta).toHaveBeenCalledWith(ficha.cnpj);
});

test.each([
  ["BRASILAPI", "BrasilAPI / dados públicos CNPJ"], ["MINHA_RECEITA", "Minha Receita / dados públicos CNPJ"], [undefined, SEM_PROVEDOR], ["PROVEDOR_DESCONHECIDO", SEM_PROVEDOR],
])("análise do escritório registra a fonte efetiva %s", async (fonte, esperada) => {
  const { db, servico } = contexto(fonte);
  const r = await servico.analisar(ficha.id, user, "PUBLICA");
  expect(r.analise.resultado.fonte).toBe(esperada);
  expect(db.onboardingAnalise.update).toHaveBeenCalledWith({ where: { id: "analise-sintetica" }, data: expect.objectContaining({
    status: "CONCLUIDA", resultado: expect.objectContaining({ fonte: esperada, razaoSocial: "Empresa sintética" }),
  }) });
});

test("falha da última fonte consultada também conserva a procedência", async () => {
  const { db, consulta, servico } = contexto("MINHA_RECEITA");
  consulta.mockResolvedValue({ ok: false, fonte: "MINHA_RECEITA", mensagem: "Consulta indisponível." });
  const r = await servico.analisar(ficha.id, user, "PUBLICA");
  expect(r.analise).toMatchObject({ status: "FALHOU", resultado: { fonte: "Minha Receita / dados públicos CNPJ" } });
  expect(db.onboardingAnalise.update.mock.calls[0][0].data.resultado.fonte).toBe("Minha Receita / dados públicos CNPJ");
});

test.each(["lead", "escritorio"])("resultado reutilizado (%s) preserva a fonte histórica sem nova consulta", async (caminho) => {
  const { db, consulta, servico } = contexto("BRASILAPI");
  const resultado = { fonte: "Minha Receita", razaoSocial: "Empresa sintética" };
  db.onboardingAnalise.findFirst.mockResolvedValue({ id: "cache-sintetico", status: "CONCLUIDA", cnpj: ficha.cnpj, createdAt: agora, resultado });
  const r = caminho === "lead" ? await consultarPublicaLead(ficha.id, { db, consultar: consulta, agora }) : (await servico.analisar(ficha.id, user, "PUBLICA")).analise.resultado;
  expect(r).toEqual(resultado);
  expect(consulta).not.toHaveBeenCalled();
  expect(db.onboardingAnalise.update).not.toHaveBeenCalled();
});
