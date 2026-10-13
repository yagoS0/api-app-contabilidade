jest.mock("../../../../../infrastructure/db/prisma.js", () => ({ prisma: {} }));
import { recuperarCalculo, contextoOrigemCalculo } from "../RecuperacaoCalculo.js";
import { criarVinculoCalculo, hashCalculo } from "../CalculoConfirmado.js";
const contexto = { versao: 1, hash: "a".repeat(64), contribuinteCnpj: "12345678000190", regimeApuracao: "COMPETENCIA" };
const formulario = { atividades: [{ idAtividade: 1, valorInterno: 100 }], folhaMensal12: [{ pa: 202609, valor: 800 }], regimeApuracao: "COMPETENCIA" };
function fixture(comOrigem = true) {
  let vinculo = criarVinculoCalculo({ portalClientId: "p1", competencia: "2026-10", formulario, receitasBrutasAnteriores: [], folhasSalario: [], contribuinteCnpj: contexto.contribuinteCnpj, contratanteCnpj: "87654321000190" });
  if (comOrigem) {
    const { calculoId, ...dados } = vinculo;
    dados.contextoOrigem = contexto;
    vinculo = { ...dados, calculoId: `fech:v1:test:${hashCalculo(dados)}` };
  }
  return { estado: "calculada", idempotencyKey: vinculo.calculoId, atividadesEscolhidas: formulario.atividades, folhaMensal12: formulario.folhaMensal12, dasSimuladoSerpro: "6.00", rbt12: "100.00", simulacaoSerpro: { _portalCalculo: vinculo } };
}
const atuais = { portalClientId: "p1", competencia: "2026-10", cnpj: contexto.contribuinteCnpj, regimeApuracao: "COMPETENCIA", contextoOrigem: contexto };
test("recupera resultado e formulário confirmado sem substituir pela sugestão atual", () => {
  const snapshot = fixture();
  const r = recuperarCalculo(snapshot, { ...atuais, atividades: [{ idAtividade: 999 }] });
  expect(r.calculoRecuperavel).toEqual({ calculoId: snapshot.idempotencyKey, dasValor: 6, rbt12: 100, formulario, estado: "calculada" });
  r.calculoRecuperavel.formulario.atividades[0].valorInterno = 999;
  expect(snapshot.atividadesEscolhidas[0].valorInterno).toBe(100);
});
test("legado íntegro conserva resultado visual sem token fiscal", () => {
  const r = recuperarCalculo(fixture(false), atuais);
  expect(r.calculoRecuperavel).toBeNull();
  expect(r.calculoSalvo).toMatchObject({ dasValor: 6, formulario });
  expect(r.calculoSalvo).not.toHaveProperty("calculoId");
  expect(r.calculoRecuperacaoMotivo).toMatch(/Não pode fechar ou transmitir/);
});
test.each(["transmitindo", "erro_transmissao", "transmitida", "aberta"])("não recupera estado %s", estado => {
  expect(recuperarCalculo({ ...fixture(), estado }, atuais).calculoRecuperavel).toBeNull();
});
test.each([null, undefined, "", NaN, Infinity, -1])("não promove DAS inválido %s", dasSimuladoSerpro => {
  expect(recuperarCalculo({ ...fixture(), dasSimuladoSerpro }, atuais).calculoRecuperavel).toBeNull();
});
test.each([
  { cnpj: "00000000000000" }, { regimeApuracao: "CAIXA" }, { contextoOrigem: null },
  { contextoOrigem: { ...contexto, hash: "b".repeat(64) } }, { competencia: "2026-09" }, { portalClientId: "p2" },
])("não recupera dados fiscais divergentes %#", alteracao => {
  expect(recuperarCalculo(fixture(), { ...atuais, ...alteracao }).calculoRecuperavel).toBeNull();
});
test("vínculo adulterado não oferece nem resultado validado readonly", () => {
  const snapshot = fixture();
  snapshot.simulacaoSerpro._portalCalculo.contextoOrigem = { ...contexto, hash: "b".repeat(64) };
  expect(recuperarCalculo(snapshot, atuais)).not.toHaveProperty("calculoSalvo");
});
function banco() {
  const notas = [{ id: "n1", competencia: new Date("2026-10-01"), total: "100.00", itens: [{ id: "i1", valor: "100.00", tipoReceita: "SERVICO", flagExportacao: false }] }];
  const cadastro = { regime: "SIMPLES_NACIONAL", regimeApuracao: "COMPETENCIA", cnaesSecundarios: ["2", "1"] };
  const db = {
    portalClient: { findUnique: jest.fn(async () => ({ cnpj: contexto.contribuinteCnpj, companyId: "c1" })) },
    cadastroFiscal: { findUnique: jest.fn(async () => cadastro) },
    company: { findUnique: jest.fn(async () => ({ cnpj: contexto.contribuinteCnpj, regimeTributario: "SIMPLES_NACIONAL", cnaesSecundarios: [] })) },
    portalInvoice: { findMany: jest.fn(async () => notas) },
    rbtExtratoCache: { findUnique: jest.fn(async () => ({ rbt12: "100.00", detalhePorMes: [], origem: "PARCIAL_LOCAL" })) },
    accountingEntry: { findMany: jest.fn(async () => []) },
  };
  db.$transaction = jest.fn(async fn => fn(db));
  return { db, notas, cadastro };
}
test("fingerprint estável, somente leitura e isolado por empresa/competência", async () => {
  const { db, notas } = banco();
  const input = { portalClientId: "p1", competencia: "2026-10" };
  const a = await contextoOrigemCalculo(input, db);
  expect(await contextoOrigemCalculo(input, db)).toEqual(a);
  expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "RepeatableRead" });
  expect(db.portalInvoice.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { clientId: "p1", papel: "EMIT", statusEfetivo: "autorizada", competencia: { gte: new Date("2025-10-01"), lt: new Date("2026-11-01") } } }));
  notas[0].itens[0].tipoReceita = "OUTRA_CLASSIFICACAO";
  expect((await contextoOrigemCalculo(input, db)).hash).not.toBe(a.hash);
});
test("mudança de data, receita histórica, cadastro ou folha invalida contexto", async () => {
  for (const change of [
    ({ notas }) => { notas[0].competencia = new Date("2026-09-01"); },
    ({ cadastro }) => { cadastro.regime = "LUCRO_PRESUMIDO"; },
    ({ db }) => db.rbtExtratoCache.findUnique.mockResolvedValue({ rbt12: "200", detalhePorMes: [], origem: "PARCIAL_LOCAL" }),
    ({ db }) => db.accountingEntry.findMany.mockResolvedValue([{ id: "folha1", competencia: "2026-09", lines: [{ tipo: "D", valor: "500", conta: "salary" }] }]),
  ]) {
    const b = banco(); const args = { portalClientId: "p1", competencia: "2026-10" };
    const before = await contextoOrigemCalculo(args, b.db); change(b);
    expect((await contextoOrigemCalculo(args, b.db)).hash).not.toBe(before.hash);
  }
});
test("falha de banco não produz origem fictícia", async () => {
  const { db } = banco(); db.rbtExtratoCache.findUnique.mockRejectedValue(new Error("offline"));
  await expect(contextoOrigemCalculo({ portalClientId: "p1", competencia: "2026-10" }, db)).rejects.toThrow("offline");
});
