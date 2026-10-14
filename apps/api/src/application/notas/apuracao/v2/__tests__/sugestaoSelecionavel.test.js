jest.mock("../../../../../infrastructure/db/prisma.js", () => ({ prisma: { portalInvoice: { findMany: jest.fn() } } }));
jest.mock("../PerfilFiscalService.js", () => ({ ...jest.requireActual("../PerfilFiscalService.js"), resolverPerfilFiscal: jest.fn() }));
import { prisma } from "../../../../../infrastructure/db/prisma.js";
import { resolverPerfilFiscal } from "../PerfilFiscalService.js";
import { sugerirAnexosDaCompetencia } from "../SugestaoAnexoService.js";
beforeEach(() => { jest.clearAllMocks(); prisma.portalInvoice.findMany.mockResolvedValue([{ id: "n1", total: 100, itens: [{ id: "i1", valor: 100, tipoReceita: null }] }]); });
it("sugere tipo único ativo sem gravar ou classificar nota", async () => { resolverPerfilFiscal.mockResolvedValue({ candidatos: [{ ativo: true, tipoReceita: "SERVICO_FATOR_R", sujeitoFatorR: true }] }); const out = await sugerirAnexosDaCompetencia({ portalClientId: "pc1", competencia: "2026-09" }); expect(out.notas[0]).toMatchObject({ tipoReceitaSugerido: "SERVICO_FATOR_R", precisaRevisao: true }); });
it("não escolhe automaticamente entre atividades distintas", async () => { resolverPerfilFiscal.mockResolvedValue({ candidatos: [{ ativo: true, tipoReceita: "SERVICO_ANEXO_III" }, { ativo: true, tipoReceita: "SERVICO_ANEXO_IV" }] }); const out = await sugerirAnexosDaCompetencia({ portalClientId: "pc1", competencia: "2026-09" }); expect(out.notas[0].tipoReceitaSugerido).toBeNull(); });
