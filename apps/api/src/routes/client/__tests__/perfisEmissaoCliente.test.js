import fs from "node:fs";
import path from "node:path";

// Executa o registro real desta rota, sem carregar integrações alheias do router monolítico.
const fonte = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8").replace(/\r\n/g, "\n");
const inicio = fonte.indexOf('  router.get(\n    "/companies/:companyId/nfse/perfis",');
const bloco = fonte.slice(inicio, fonte.indexOf("\n  );", inicio) + 6);
function preparar(habilitado = true) {
  let handler;
  const access = jest.fn(() => "acesso-conferido");
  const router = { get: jest.fn((url, middleware, fn) => { expect(middleware).toBe("acesso-conferido"); handler = fn; }) };
  const prisma = { portalClient: { findUnique: jest.fn().mockResolvedValue({ id: "portal-autorizado" }) }, perfilEmissaoNfse: { findMany: jest.fn().mockResolvedValue([]) } };
  const resolver = jest.fn().mockResolvedValue("legado-autorizado");
  const log = { warn: jest.fn() };
  new Function("router", "requireClientCompanyAccess", "INTEGRACAO_PERFIL_EMISSAO_NFSE", "resolveLegacyCompanyId", "prisma", "log", bloco)(router, access, habilitado, resolver, prisma, log);
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
  return { prisma, resolver, res, access, executar: () => handler({ params: { companyId: "portal-autorizado" } }, res) };
}
it("flag desligada informa ausência de integração sem consultar perfis", async () => {
  const t = preparar(false); await t.executar();
  expect(t.access).toHaveBeenCalledWith();
  expect(t.res.json).toHaveBeenCalledWith({ habilitado: false, data: [], total: 0 });
  expect(t.resolver).not.toHaveBeenCalled();
  expect(t.prisma.perfilEmissaoNfse.findMany).not.toHaveBeenCalled();
});
it("lista somente perfis ativos da empresa autorizada e não expõe campos fiscais", async () => {
  const t = preparar(); const perfis = [{ id: "perfil-1", nome: "Consultoria", padrao: true }];
  t.prisma.perfilEmissaoNfse.findMany.mockResolvedValue(perfis); await t.executar();
  expect(t.resolver).toHaveBeenCalledWith("portal-autorizado");
  expect(t.prisma.portalClient.findUnique).toHaveBeenCalledWith({ where: { companyId: "legado-autorizado" }, select: { id: true } });
  expect(t.prisma.perfilEmissaoNfse.findMany).toHaveBeenCalledWith({ where: { portalClientId: "portal-autorizado", ativo: true }, orderBy: [{ padrao: "desc" }, { nome: "asc" }], select: { id: true, nome: true, padrao: true } });
  expect(t.res.json).toHaveBeenCalledWith({ habilitado: true, data: perfis, total: 1 });
});
it.each(["resolver", "portal", "perfis"])("falha em %s retorna 503, nunca ausência confirmada", async (etapa) => {
  const t = preparar(); const consulta = etapa === "resolver" ? t.resolver : etapa === "portal" ? t.prisma.portalClient.findUnique : t.prisma.perfilEmissaoNfse.findMany;
  consulta.mockRejectedValue(new Error("database unavailable")); await t.executar();
  expect(t.res.status).toHaveBeenCalledWith(503);
  expect(t.res.json).toHaveBeenCalledWith(expect.objectContaining({ error: "NFSE_PERFIS_INDISPONIVEIS" }));
  expect(t.res.json.mock.calls[0][0]).not.toHaveProperty("data");
});
it.each(["sem-legado", "sem-portal", "sem-perfis"])("%s confirmado retorna lista vazia habilitada", async (etapa) => {
  const t = preparar();
  if (etapa === "sem-legado") t.resolver.mockResolvedValue(null);
  if (etapa === "sem-portal") t.prisma.portalClient.findUnique.mockResolvedValue(null);
  await t.executar();
  expect(t.res.json).toHaveBeenCalledWith({ habilitado: true, data: [], total: 0 });
  expect(t.res.status).not.toHaveBeenCalled();
});
