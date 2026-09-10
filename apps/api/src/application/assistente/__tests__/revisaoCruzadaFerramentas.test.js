// Revisão independente: serviços reais de união/validação, sem rede nem ato fiscal.
jest.mock("../../../infrastructure/db/prisma.js", () => ({ prisma: {} }));
import { executarFerramenta } from "../ferramentas/index.js";
import { preparacaoEmissaoFalsa } from "../__fixtures__/preparacaoEmissao.js";
import { TODAS_PERMISSOES_ASSISTENTE } from "../../whatsapp/permissoesAssistente.js";
import { validateNfsePayload } from "../../validators/nfsePayload.js";

const EMPRESA = { id: "pc-revisao", cnpj: "11222333000181", companyId: "legacy-revisao" };
const NOVA = { id: "si-8", companyId: EMPRESA.companyId, numeroNfse: "8", chaveAcesso: "1".repeat(50), rpsSerie: "00001", rpsNumero: "8", competencia: new Date("2026-08-01"), createdAt: new Date("2026-09-01"), status: "issued", valorServicos: 1200, tomadorNome: "Empresa exemplo", tomadorDoc: "12345678000190" };
const sessao = { ok: true, portalClientId: EMPRESA.id, userId: "u-revisao", papel: "CLIENT_ADMIN", permissoesAssistente: [...TODAS_PERMISSOES_ASSISTENTE] };
function contexto(prisma = {}) {
  return { sessao, conversa: { id: "cv-revisao" }, prisma, agora: new Date("2026-09-08T15:00:00Z"), janela: { aberta: true }, log: { error: jest.fn(), warn: jest.fn() }, servicos: {} };
}
function emissao() {
  const ctx = contexto();
  const criarPendencia = jest.fn(async ({ corpo }) => ({ texto: corpo, codigo: "A7K2" }));
  ctx.servicos = { ...preparacaoEmissaoFalsa, autorizarEmissaoDoCliente: async () => ({ ok: true }), listarPerfisEmissao: async () => [], criarPendencia };
  return { ctx, criarPendencia, dados: { tomadorDoc: "12345678000190", tomadorNome: "Empresa exemplo", descricao: "Consultoria", valor: 1200 } };
}

// Este banco de teste honra filtros, ordenação e cursor: não mascara uma leitura que filtra
// somente depois do limite, nem uma segunda página que volta ao início.
function casa(row, where = {}) {
  return Object.entries(where).every(([key, value]) => {
    if (key === "AND") return value.every((f) => casa(row, f));
    if (key === "OR") return value.some((f) => casa(row, f));
    if (value && typeof value === "object" && !(value instanceof Date)) return Object.entries(value).every(([op, v]) => {
      if (op === "in") return v.includes(row[key]);
      if (op === "notIn") return !v.includes(row[key]);
      if (op === "gte") return row[key] != null && row[key] >= v;
      if (op === "lt") return row[key] != null && row[key] < v;
      if (op === "contains") return String(row[key] || "").toLowerCase().includes(String(v).toLowerCase());
      return op === "mode";
    });
    return value === null ? row[key] == null : row[key] === value;
  });
}
function tabela(rows) {
  return { findMany: jest.fn(async ({ where, orderBy, cursor, skip = 0, take }) => {
    const sorted = rows.filter((row) => casa(row, where));
    for (const ordem of (Array.isArray(orderBy) ? orderBy : [orderBy]).filter(Boolean).reverse()) {
      const [campo, direcao] = Object.entries(ordem)[0];
      sorted.sort((a, b) => a[campo] === b[campo] ? 0 : (a[campo] > b[campo] ? 1 : -1) * (direcao === "desc" ? -1 : 1));
    }
    const inicio = (cursor ? sorted.findIndex((r) => r.id === cursor.id) : 0) + skip;
    return sorted.slice(inicio, take ? inicio + take : undefined);
  }) };
}
function banco(novas, projetadas = []) {
  return { portalClient: { findUnique: async () => EMPRESA }, serviceInvoice: tabela(novas), portalInvoice: tabela(projetadas) };
}
const loteDeNotas = (quantidade) => Array.from({ length: quantidade }, (_, i) => ({ ...NOVA, id: `si-${i}`, numeroNfse: String(i + 1), rpsNumero: String(i + 1), chaveAcesso: String(i + 1).padStart(50, "0"), createdAt: new Date(Date.UTC(2026, 8, 8) - i * 1000) }));
const projetar = (nota, extra = {}) => ({ id: `pi-${nota.id}`, clientId: EMPRESA.id, type: "NFSE", papel: "EMIT", emitenteDoc: EMPRESA.cnpj, numero: nota.numeroNfse, chaveAcesso: nota.chaveAcesso, competencia: nota.competencia, issueDate: nota.createdAt, createdAt: nota.createdAt, total: nota.valorServicos, ...extra });

it("a mesma nota com papel legado nulo e ServiceInvoice aparece uma vez", async () => {
  const projetada = { id: "pi-8", clientId: EMPRESA.id, type: "NFSE", papel: null, emitenteDoc: EMPRESA.cnpj, numero: "8", chaveAcesso: NOVA.chaveAcesso, competencia: NOVA.competencia, issueDate: NOVA.createdAt, createdAt: NOVA.createdAt, total: 1200 };
  const prisma = {
    portalClient: { findUnique: async () => EMPRESA },
    serviceInvoice: { findMany: async () => [NOVA] },
    portalInvoice: { findMany: async ({ where }) => where.papel === "EMIT" ? [] : [projetada] },
  };
  const r = await executarFerramenta("listar_notas", {}, contexto(prisma));
  expect(r.notas).toHaveLength(1);
  expect(r.notas[0].notaId).toBe("pi-8");
});

it("busca exata alcança emissão ainda não capturada além das 200 recentes", async () => {
  const notas = Array.from({ length: 201 }, (_, i) => ({ ...NOVA, id: `si-${i}`, numeroNfse: String(i + 1), chaveAcesso: String(i + 1).padStart(50, "0"), createdAt: new Date(Date.UTC(2026, 8, 8) - i * 1000) }));
  const prisma = {
    portalClient: { findUnique: async () => EMPRESA },
    portalInvoice: { findMany: async () => [] },
    serviceInvoice: { findMany: async ({ where, take }) => notas.filter(n => !where.numeroNfse || n.numeroNfse === where.numeroNfse).slice(0, take) },
  };
  const r = await executarFerramenta("listar_notas", { busca: "201" }, contexto(prisma));
  expect(r.notas.map(n => n.numero)).toContain("201");
});

it.each(["2026-13", "2026-00", "2026-02-30", "agosto", ""]) ("competência inválida %s não gera resumo e payload com períodos diferentes", async (competencia) => {
  const { ctx, criarPendencia, dados } = emissao();
  const r = await executarFerramenta("preparar_emissao", { ...dados, competencia }, ctx);
  expect(r.ok).toBe(false);
  expect(criarPendencia).not.toHaveBeenCalled();
});

it("alíquota explicitamente zero no resumo também permanece zero no payload", async () => {
  const { ctx, criarPendencia, dados } = emissao();
  const r = await executarFerramenta("preparar_emissao", { ...dados, competencia: "2026-08", aliquota: 0 }, ctx);
  expect(r.ok).toBe(true);
  expect(criarPendencia.mock.calls[0][0].payload.servico.aliquota).toBe(0);
});

it("a página seguinte continua alcançável quando as primeiras 200 emissões já estão capturadas", async () => {
  const novas = loteDeNotas(201);
  const prisma = banco(novas, novas.slice(0, 200).map((n) => projetar(n)));
  const penultima = await executarFerramenta("listar_notas", { pagina: 10 }, contexto(prisma));
  const ultima = await executarFerramenta("listar_notas", { pagina: 11 }, contexto(prisma));
  expect(penultima).toMatchObject({ quantidade: 20, temMais: true, proximaPagina: 11 });
  expect(ultima).toMatchObject({ quantidade: 1, temMais: false });
  expect(ultima.notas[0]).toMatchObject({ notaId: novas[200].id, numero: "201", confirmadaPeloAdn: false });
  expect(prisma.serviceInvoice.findMany.mock.calls.some(([q]) => q.cursor?.id === novas[199].id && q.skip === 1)).toBe(true);
});

it("primeira página preenchida pelo ADN não percorre todo o histórico já capturado", async () => {
  const novas = loteDeNotas(1000);
  const prisma = banco(novas, novas.map((n) => projetar(n)));
  const r = await executarFerramenta("listar_notas", {}, contexto(prisma));
  expect(r).toMatchObject({ quantidade: 20, temMais: true });
  expect(prisma.serviceInvoice.findMany).toHaveBeenCalledTimes(1);
});

it.each([
  [{ competencia: "2026-07" }, { competencia: new Date("2026-07-01") }],
  [{ busca: "Tomador antigo" }, { tomadorNome: "Tomador antigo" }],
  [{ busca: "99.887.766/0001-55" }, { tomadorDoc: "99887766000155" }],
])("filtra %j antes da janela de 200 emissões", async (input, alteracao) => {
  const novas = loteDeNotas(201);
  Object.assign(novas[200], alteracao);
  const prisma = banco(novas);
  const r = await executarFerramenta("listar_notas", input, contexto(prisma));
  expect(r.notas).toHaveLength(1);
  expect(r.notas[0].notaId).toBe(novas[200].id);
  expect(prisma.serviceInvoice.findMany).toHaveBeenCalledTimes(1);
});

it("projeção antiga além das 800 recentes ainda deduplica a busca exata", async () => {
  const nova = { ...NOVA, numeroNfse: "900", createdAt: new Date("2026-01-01") };
  const recentes = loteDeNotas(801).map((n) => projetar({ ...n, chaveAcesso: `outra-${n.id}` }));
  const prisma = banco([nova], [...recentes, projetar(nova)]);
  const r = await executarFerramenta("listar_notas", { busca: "900" }, contexto(prisma));
  expect(r.notas).toHaveLength(1);
  expect(r.notas[0]).toMatchObject({ notaId: `pi-${nova.id}`, confirmadaPeloAdn: true });
});

it.each([
  { papel: null, emitenteDoc: "99887766000155", tomadorDoc: EMPRESA.cnpj },
  { papel: "DEST", emitenteDoc: "99887766000155", tomadorDoc: EMPRESA.cnpj },
  { clientId: "pc-outra" },
])("outra origem %j não oculta a emissão da empresa pelo mesmo número", async (extra) => {
  const prisma = banco([NOVA], [projetar(NOVA, extra)]);
  const r = await executarFerramenta("listar_notas", { busca: "8" }, contexto(prisma));
  expect(r.notas).toHaveLength(1);
  expect(r.notas[0]).toMatchObject({ notaId: NOVA.id, confirmadaPeloAdn: false });
});

it.each([
  [{ aliquota: 0, pAliq: 5 }, 0],
  [{ aliquota: null, pAliq: 0, pIss: 5 }, 0],
  [{ aliquota: null, pAliq: null, pIss: 0 }, 0],
  [{}, null],
  [{ aliquota: 5 }, 5],
])("o validador compartilhado preserva zero e a precedência das fontes: %j", (aliquotas, esperado) => {
  const r = validateNfsePayload({ companyId: EMPRESA.id, tomador: { cnpjCpf: "12345678000190", nome: "Empresa exemplo" }, servico: { descricao: "Consultoria", valor: 1200, ...aliquotas } });
  expect(r.ok).toBe(true);
  expect(r.data.servico.aliquota).toBe(esperado);
});
