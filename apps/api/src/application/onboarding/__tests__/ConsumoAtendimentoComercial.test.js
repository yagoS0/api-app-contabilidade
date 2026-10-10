import { obterConsumoAtendimentoComercial } from "../ConsumoAtendimentoComercial.js";

const grupoIa = (status, custo, reserva = 0) => ({ status, modelo: "gpt", _count: { _all: 1 }, _sum: { custoEstimadoCentavos: custo, reservaCentavos: reserva, inputTokens: 100, outputTokens: 20 } });
const grupoFiscal = (status, chamadas) => ({ status, idServico: "SITFIS", _count: { _all: chamadas } });
const banco = () => ({ coletaComercialWhatsapp: { findMany: jest.fn().mockResolvedValue([]) }, chamadaIa: { groupBy: jest.fn().mockResolvedValue([grupoIa("ok", "0.004321"), grupoIa("erro", 0, 2)]) },
  serproChamada: { groupBy: jest.fn().mockResolvedValue([grupoFiscal("ok", 2), grupoFiscal("incerta", 1), grupoFiscal("abortada_auth", 1), grupoFiscal("recusada_teto", 3)]) } });

test("mantém custo fracionário separado da reserva e não inventa faturamento fiscal", async () => {
  const db = banco();
  const out = await obterConsumoAtendimentoComercial({ db, onboardingId: "lead", conversaId: "conversa", desde: "2026-10-10T10:00:00Z", ate: "2026-10-10T11:00:00Z" });
  expect(out.gpt.custoUsd).toBeCloseTo(0.00004321, 10);
  expect(out.gpt.reservaUsd).toBe(0.02);
  expect(out.serpro).toMatchObject({ custoConfirmado: null, concluidas: 2, pendentes: 1, abortadas: 1, erros: 0 });
  expect(db.serproChamada.groupBy.mock.calls[0][0].where).toEqual({ acaoId: "lead" });
  expect(db.chamadaIa.groupBy.mock.calls[0][0].where).toEqual({ conversaId: "conversa", finalidade: "comercial_whatsapp", createdAt: { gte: new Date("2026-10-10T10:00:00Z"), lt: new Date("2026-10-10T11:00:00Z") } });
});

test("sem vínculo ou início confiável não atribui gasto de outros atendimentos", async () => {
  const db = banco();
  const out = await obterConsumoAtendimentoComercial({ db, onboardingId: "lead", conversaId: "conversa" });
  expect(db.chamadaIa.groupBy).not.toHaveBeenCalled();
  expect(out.gpt).toMatchObject({ disponivel: false, custoUsd: null });
});

test("inclui interpretação inicial anterior à criação da ficha por mensagem da coleta", async () => {
  const db = banco(); db.coletaComercialWhatsapp.findMany.mockResolvedValue([{ mensagemId: "primeira" }]);
  await obterConsumoAtendimentoComercial({ db, onboardingId: "lead", conversaId: "c", desde: "2026-10-10T12:00:00Z" });
  expect(db.coletaComercialWhatsapp.findMany.mock.calls[0][0].where).toEqual({ atendimentoLead: { onboardingId: "lead" } });
  expect(db.chamadaIa.groupBy.mock.calls[0][0].where).toEqual({ conversaId: "c", finalidade: "comercial_whatsapp", OR: [
    { createdAt: { gte: new Date("2026-10-10T12:00:00Z") } }, { mensagemId: { in: ["primeira"] } },
  ] });
});

test("falha de medição não retorna zero", async () => {
  const db = banco(); db.serproChamada.groupBy.mockRejectedValue(new Error("offline"));
  await expect(obterConsumoAtendimentoComercial({ db, onboardingId: "lead" })).rejects.toThrow("offline");
});

test("recusa escopo ausente e data inválida", async () => {
  const db = banco();
  await expect(obterConsumoAtendimentoComercial({ db })).rejects.toThrow("onboarding_necessario");
  await expect(obterConsumoAtendimentoComercial({ db, onboardingId: "lead", desde: "invalid" })).rejects.toThrow("periodo_consumo");
  expect(db.serproChamada.groupBy).not.toHaveBeenCalled();
});
