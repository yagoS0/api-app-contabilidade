jest.mock("../../../../infrastructure/db/prisma.js", () => ({
  prisma: {
    portalClient: { findUnique: jest.fn(async () => ({ cnpj: "12345678000199", companyId: "empresa" })) },
    company: { findUnique: jest.fn(async () => ({ regimeTributario: "LUCRO_PRESUMIDO" })) },
    guide: {
      upsert: jest.fn(async () => ({ id: "guia-lp" })),
      findUnique: jest.fn(async () => ({ extracted: {} })),
      update: jest.fn(async () => ({})),
    },
    companyMonthlyCircular: { upsert: jest.fn(async () => ({})) },
  },
}));
jest.mock("../../../accounting/GuideToProvisionService.js", () => ({ generateProvisionsFromGuide: jest.fn(async () => ({})) }));
jest.mock("../../circularAcrescimos.js", () => ({ gravarAcrescimoCircular: jest.fn(async () => ({})) }));
jest.mock("../../serpro/SerproDctfwebService.js", () => ({
  consultarDeclaracaoCompletaLp: jest.fn(),
  emitirDarfDctfweb: jest.fn(async () => ({ valor: 502.51, composicao: { itens: [] } })),
}));
jest.mock("../LucroPresumidoCalculoService.js", () => ({ reconciliarLp: jest.fn(async () => ({})) }));

const { prisma } = require("../../../../infrastructure/db/prisma.js");
const { generateProvisionsFromGuide } = require("../../../accounting/GuideToProvisionService.js");
const { consultarDeclaracaoCompletaLp, emitirDarfDctfweb } = require("../../serpro/SerproDctfwebService.js");
const { capturarLpDaCompetencia, provisionarLpDaDeclaracao } = require("../LucroPresumidoProvisaoService.js");

const opts = { portalClientId: "albatroz", competencia: "2026-07", cnpj: "12345678000199" };
const cpSegurados = { codigoReceita: "1099-01", descricao: "CP SEGURADOS", debitoApurado: 178.31 };
const cpEmpresa = { codigoReceita: "1138-01", descricao: "CONTRIB PREVIDENCIÁRIA EMPRESA/EMPREGADOR", debitoApurado: 324.20 };

beforeEach(() => jest.clearAllMocks());

it.each([[cpSegurados], [cpSegurados, cpEmpresa]])("não cria outra guia nem provisão quando a declaração só tem INSS: %j", async (...debitos) => {
  const result = await provisionarLpDaDeclaracao({ ...opts, debitos });
  expect(result).toMatchObject({ ok: true, skipped: "somente_previdenciario" });
  expect(prisma.guide.upsert).not.toHaveBeenCalled();
  expect(generateProvisionsFromGuide).not.toHaveBeenCalled();
});

it("consulta a Albatroz sem emitir uma segunda cópia do DARF previdenciário", async () => {
  consultarDeclaracaoCompletaLp.mockResolvedValue({ debitos: [cpSegurados, cpEmpresa], cabecalho: {} });
  const result = await capturarLpDaCompetencia(opts);
  expect(result.provisao.skipped).toBe("somente_previdenciario");
  expect(emitirDarfDctfweb).not.toHaveBeenCalled();
  expect(prisma.guide.upsert).not.toHaveBeenCalled();
});

it.each([
  [{ codigoReceita: "8109", tributo: "PIS", debitoApurado: 100 }],
  [{ codigoReceita: "3208-06", tributo: "IRRF", debitoApurado: 100 }],
  [{ codigoReceita: "9999", debitoApurado: 100 }],
  [cpSegurados, { codigoReceita: "8109", tributo: "PIS", debitoApurado: 100 }],
])("preserva outros tributos e documentos mistos sem dividir o DARF: %j", async (...debitos) => {
  const result = await provisionarLpDaDeclaracao({ ...opts, debitos });
  expect(result.guideId).toBe("guia-lp");
  expect(prisma.guide.upsert).toHaveBeenCalledTimes(1);
  expect(prisma.guide.upsert.mock.calls[0][0].create.extracted.composicao).toHaveLength(debitos.length);
  expect(generateProvisionsFromGuide).toHaveBeenCalledWith({ guideId: "guia-lp" });
});

it('reemitir DARF não informa sucesso quando a gravação da guia falha', async () => {
  const { reemitirDarfLp } = require('../LucroPresumidoProvisaoService.js');
  prisma.guide.update.mockRejectedValueOnce(new Error('banco indisponível'));
  await expect(reemitirDarfLp({ ...opts, guideId: 'guia-lp' })).rejects.toThrow('banco indisponível');
});

it('recaptura da declaração mantém evidência do recálculo explícito', async () => {
  const recalculoGuia = { guiaId: 'guia-lp', recalculadoEm: '2026-09-18T12:00:00.000Z' };
  prisma.guide.findUnique.mockResolvedValueOnce({ extracted: { recalculoGuia } });
  await provisionarLpDaDeclaracao({ ...opts, debitos: [{ codigoReceita: '8109', tributo: 'PIS', debitoApurado: 100 }] });
  expect(prisma.guide.upsert.mock.calls[0][0].update.extracted.recalculoGuia).toEqual(recalculoGuia);
});
