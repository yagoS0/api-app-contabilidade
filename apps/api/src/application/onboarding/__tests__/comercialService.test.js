jest.mock("../../../infrastructure/db/prisma.js", () => ({ prisma: {} }));
import { criarServicoComercial, exigirEscopo, procuracaoHabilitaSitfis } from "../ComercialService.js";
import crypto from "node:crypto";

const user = { id: "gestor", role: "contador" };
const now = new Date("2026-09-08T12:00:00Z");
function setup() {
  const ficha = { id: "lead", criadoPorId: "dono", status: "RASCUNHO", origem: "TRANSFERENCIA", cnpj: "11222333000181", dados: { responsavelNome: "Maria" }, versao: 1 };
  const db = {
    atendimentoLead: { updateMany: jest.fn(async () => ({ count: 0 })) },
    onboarding: { findUnique: jest.fn(async () => ficha), update: jest.fn(async ({ data }) => ({ ...ficha, ...data })), updateMany: jest.fn(async () => ({ count: 1 })) },
    onboardingAnalise: { findFirst: jest.fn(async () => null), updateMany: jest.fn(async () => ({ count: 0 })), create: jest.fn(async ({ data }) => ({ id: "analise", createdAt: now, ...data })), update: jest.fn(async ({ data }) => ({ id: "analise", createdAt: now, ...data })) },
    onboardingLink: { findFirst: jest.fn(async () => ({ id: "link", expiresAt: new Date("2026-09-09"), onboarding: ficha })), updateMany: jest.fn(async () => ({ count: 1 })), create: jest.fn(async ({ data }) => ({ id: "link", ...data })), update: jest.fn(async () => ({})) },
    onboardingEvento: { create: jest.fn(async () => ({})) },
    onboardingEtapa: { createMany: jest.fn(async () => ({ count: 1 })) },
  };
  db.$transaction = jest.fn(async (fn) => fn(db));
  const procura = jest.fn(async () => ({ status: "ATIVA", validUntil: "2026-10-01", systems: ["SITFIS"], procuradorCnpj: "12345678000199", checkedAt: now.toISOString() }));
  const consultaPublica = jest.fn(async () => ({ ok: true, bruto: { razao_social: "Empresa", descricao_situacao_cadastral: "ATIVA" } }));
  const sitfis = jest.fn(async () => ({ ok: true, protocolo: "p", relatorioPdfBuffer: Buffer.from("%PDF-teste") }));
  const cifrar = jest.fn(async () => "cifrado");
  const servico = criarServicoComercial({ db, procura, consultaPublica, sitfis, cifrar, agora: () => now });
  return { ficha, db, procura, consultaPublica, sitfis, cifrar, servico };
}
it("staff não lê ou altera lead de outro criador", async () => {
  const t = setup(); await expect(exigirEscopo("lead", { id: "outro", role: "user" }, t.db)).rejects.toMatchObject({ status: 404 });
  await expect(t.servico.analisar("lead", { id: "outro", role: "user" }, "PUBLICA")).rejects.toMatchObject({ status: 404 });
  expect(t.consultaPublica).not.toHaveBeenCalled();
});
it.each([
  { status: "AUSENTE", validUntil: "2027-01-01", systems: ["SITFIS"] },
  { status: "ATIVA", validUntil: "2020-01-01", systems: ["SITFIS"] },
  { status: "ATIVA", validUntil: null, systems: ["SITFIS"] },
  { status: "ATIVA", validUntil: "2027-01-01", systems: ["PGDASD"] },
])("SITFIS não roda sem procuração vigente e sistema explicitamente autorizado: %j", async (p) => {
  const t = setup(); t.procura.mockResolvedValue(p);
  expect(procuracaoHabilitaSitfis(p, now)).toBe(false);
  const r = await t.servico.analisar("lead", user, "SITFIS");
  expect(r.analise.status).toBe("BLOQUEADA"); expect(t.sitfis).not.toHaveBeenCalled();
});
it("consulta real usa CNPJ da ficha e cifra o documento sem criar empresa", async () => {
  const t = setup(); const r = await t.servico.analisar("lead", user, "SITFIS");
  expect(t.procura).toHaveBeenCalledWith(t.ficha.cnpj);
  expect(t.sitfis).toHaveBeenCalledWith(expect.objectContaining({ contribuinteCnpj: t.ficha.cnpj, contratanteCnpj: "12345678000199" }));
  expect(t.cifrar).toHaveBeenCalledWith(Buffer.from("%PDF-teste").toString("base64"));
  expect(r.analise).not.toHaveProperty("documentoCifrado");
  expect(r.analise.resultado.relatorioDisponivel).toBe(true);
});
it("consulta pública não chama SERPRO nem afirma regularidade fiscal", async () => {
  const t = setup(); const r = await t.servico.analisar("lead", user, "PUBLICA");
  expect(t.procura).not.toHaveBeenCalled(); expect(t.sitfis).not.toHaveBeenCalled();
  expect(r.analise.resultado.mensagem).toMatch(/Não equivalem/);
});
it("reutiliza SITFIS concluído dentro de quatro horas sem cobrança nova", async () => {
  const t = setup(); t.db.onboardingAnalise.findFirst.mockResolvedValue({ id: "anterior", status: "CONCLUIDA", cnpj: t.ficha.cnpj, createdAt: now, resultado: {} });
  expect((await t.servico.analisar("lead", user, "SITFIS")).reutilizada).toBe(true);
  expect(t.procura).not.toHaveBeenCalled();
});
it("gera token aleatório, persiste somente hash e revoga links anteriores", async () => {
  const t = setup(); const r = await t.servico.emitirLink("lead", user, 7);
  expect(r.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(t.db.onboardingLink.create.mock.calls[0][0].data.tokenHash).toBe(crypto.createHash("sha256").update(r.token).digest("hex"));
  expect(t.db.onboardingLink.create.mock.calls[0][0].data).not.toHaveProperty("token");
  expect(t.db.onboardingLink.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { onboardingId: "lead", revokedAt: null } }));
});
it("leitura pública só devolve dados declarados e versão, nunca análise/identidade interna", async () => {
  const t = setup(); const r = await t.servico.publico("a".repeat(43));
  expect(Object.keys(r.onboarding).sort()).toEqual(["dados", "origem", "status", "ultimoPasso", "versao"]);
  expect(t.db.onboardingLink.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ revokedAt: null, submittedAt: null, expiresAt: { gt: now } }) }));
});
it("link expirado/revogado/consumido não carrega formulário", async () => {
  const t = setup(); t.db.onboardingLink.findFirst.mockResolvedValue(null);
  await expect(t.servico.publico("a".repeat(43))).rejects.toMatchObject({ status: 404 });
});
it("rascunho público exige versão e falha no conflito sem finalizar", async () => {
  const t = setup(); t.db.onboarding.updateMany.mockResolvedValue({ count: 0 });
  await expect(t.servico.publico("a".repeat(43), { versao: 0, dados: {}, finalizar: true })).rejects.toMatchObject({ status: 409 });
  expect(t.db.onboardingLink.update).not.toHaveBeenCalled();
});
it("finalização consome link e materializa checklist na mesma transação", async () => {
  const t = setup(); await t.servico.publico("a".repeat(43), { versao: 1, dados: { responsavelNome: "Maria" }, finalizar: true });
  expect(t.db.$transaction).toHaveBeenCalled();
  expect(t.db.onboardingLink.update).toHaveBeenCalledWith({ where: { id: "link" }, data: { submittedAt: now } });
  expect(t.db.onboardingEtapa.createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }));
});
it("público não pode enviar status, análise nem versão de empresa por fora de dados", async () => {
  const t = setup(); await expect(t.servico.publico("a".repeat(43), { versao: 1, dados: {}, status: "CONVERTIDO" })).rejects.toMatchObject({ status: 400 });
});
it("SITFIS aceita o nome oficial de autorização 00002", () => {
  expect(procuracaoHabilitaSitfis({ status: "ATIVA", validUntil: "2099-01-01", systems: ["Situação Fiscal do Contribuinte"] }, now)).toBe(true);
});
it("duas finalizações concorrentes da mesma versão consomem somente uma vez", async () => {
  const t = setup(); let versao = 1;
  t.db.onboarding.updateMany.mockImplementation(async ({ where }) => {
    if (where.versao !== versao) return { count: 0 };
    versao++; return { count: 1 };
  });
  const respostas = await Promise.allSettled([1, 2].map(() => t.servico.publico("a".repeat(43), { versao: 1, dados: {}, finalizar: true })));
  expect(respostas.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(t.db.onboardingLink.update).toHaveBeenCalledTimes(1);
});
it("geração trava a ficha antes de revogar/criar links, inclusive ficha sem links", async () => {
  const t = setup(); const ordem = [];
  t.db.onboarding.updateMany.mockImplementation(async () => { ordem.push("trava-ficha"); return { count: 1 }; });
  t.db.onboardingLink.updateMany.mockImplementation(async () => { ordem.push("revoga"); return { count: 0 }; });
  t.db.onboardingLink.create.mockImplementation(async ({ data }) => { ordem.push("cria"); return { id: "novo", ...data }; });
  await t.servico.emitirLink("lead", user);
  expect(ordem).toEqual(["trava-ficha", "revoga", "cria"]);
});
it("duas gerações concorrentes terminam com apenas o último link ativo", async () => {
  const t = setup(); const links = []; let cadeia = Promise.resolve();
  // Simula o lock de linha que PostgreSQL mantém do UPDATE até o commit.
  t.db.$transaction.mockImplementation(async (fn) => {
    let liberar;
    const tx = { ...t.db, onboarding: { ...t.db.onboarding, updateMany: async () => {
      const anterior = cadeia;
      cadeia = new Promise((resolve) => { liberar = resolve; });
      await anterior;
      return { count: 1 };
    } } };
    try { return await fn(tx); } finally { liberar?.(); }
  });
  t.db.onboardingLink.updateMany.mockImplementation(async () => { links.forEach((l) => { l.revokedAt = now; }); return { count: links.length }; });
  t.db.onboardingLink.create.mockImplementation(async ({ data }) => { const l = { id: String(links.length + 1), revokedAt: null, ...data }; links.push(l); return l; });
  const r = await Promise.all([t.servico.emitirLink("lead", user), t.servico.emitirLink("lead", user)]);
  expect(r).toHaveLength(2); expect(links.filter((l) => !l.revokedAt)).toHaveLength(1);
});
