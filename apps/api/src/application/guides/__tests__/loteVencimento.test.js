import { montarRelatorioVencimento, periodoVencimento, assinaturaGuias } from "../loteVencimento.js";

const company = { id: "empresa", razao: "Empresa", company: { regimeTributario: "SIMPLES" } };
const guia = (id, competencia, vencimento, extra = {}) => ({ id, portalClientId: "empresa", tipo: "SIMPLES", competencia,
  vencimento, status: "PROCESSED", paymentStatus: "OPEN", valor: 100, ...extra });
const relatorio = (guides = [], parcelas = []) => montarRelatorioVencimento({ mesVencimento: "2026-09", companies: [company], guides, parcelas, enviada: (g) => g.emailStatus === "SENT" });

test("setembro reúne DAS de agosto e duas parcelas de setembro; exclui parcela paga de agosto", () => {
  const r = relatorio([guia("das", "2026-08", "2026-09-20"),
    guia("p1", "2026-09", "2026-09-30", { parcelamentoId: "acordo1" }),
    guia("p2", "2026-09", "2026-09-30", { parcelamentoId: "acordo2" }),
    guia("paga", "2026-08", "2026-08-31", { paymentStatus: "PAID" })]);
  expect(r.simples).toHaveLength(1);
  expect(r.simples[0].pendingGuideIds).toEqual(["das", "p1", "p2"]);
  expect(r.simples[0].documentos.map((d) => d.competencia)).toEqual(["2026-08", "2026-09", "2026-09"]);
  expect(r.pendenciasAnteriores).toHaveLength(0);
});

test("sem vencimento e débitos antigos ficam fora do lote; pagas e enviadas não são selecionadas", () => {
  const r = relatorio([guia("sem", "2026-08", null), guia("antiga", "2026-07", "2026-08-20"),
    guia("paga", "2026-08", "2026-09-20", { paymentStatus: "PAID" }),
    guia("enviada", "2026-08", "2026-09-20", { emailStatus: "SENT" })]);
  expect(r.simples[0].pendingGuideIds).toEqual([]);
  expect(r.conferirVencimento.map((x) => x.guideId)).toEqual(["sem"]);
  expect(r.pendenciasAnteriores.map((x) => x.guideId)).toEqual(["antiga"]);
});

test("parcela sem guia cria linha incompleta mesmo sem nenhum outro documento", () => {
  const p = { id: "p", portalClientId: "empresa", numeroParcela: 9, vencimento: "2026-09-30", parcelamento: { formaPagamento: "GUIA_MENSAL" } };
  expect(relatorio([], [p]).simples[0]).toMatchObject({ situacao: "incompleto", pendingGuideIds: [], faltantes: [{ parcelaId: "p" }] });
  expect(relatorio([], [{ ...p, parcelamento: { formaPagamento: "DEBITO_AUTOMATICO" } }]).simples).toEqual([]);
  expect(relatorio([], [{ ...p, baixadaEm: "2026-09-10" }]).simples).toEqual([]);
});

test("vencimento real prevalece sobre calendário contratado", () => {
  const p = { id: "p", portalClientId: "empresa", vencimento: "2026-09-30", guia: { status: "PROCESSED", vencimento: "2026-10-05" } };
  expect(relatorio([], [p]).simples).toEqual([]);
});

test("mês civil inclui primeiro dia e exclui primeiro dia seguinte; valida mês", () => {
  expect(periodoVencimento("2026-12")).toEqual({ gte: new Date("2026-12-01Z"), lt: new Date("2027-01-01Z") });
  expect(() => periodoVencimento("2026-13")).toThrow();
  const r = relatorio([guia("inicio", "2026-08", "2026-09-01T00:00:00.000Z"), guia("fora", "2026-09", "2026-10-01T00:00:00.000Z")]);
  expect(r.simples[0].pendingGuideIds).toEqual(["inicio"]);
});

test("conferência detecta alteração de valor, pagamento, PDF e identidade sem depender da ordem", () => {
  const a = guia("a", "2026-08", "2026-09-20");
  const b = guia("b", "2026-09", "2026-09-30");
  expect(assinaturaGuias([a, b])).toBe(assinaturaGuias([b, a]));
  for (const change of [{ valor: 999 }, { paymentStatus: "PAID" }, { hash: "novo-pdf" }, { id: "outra" }]) {
    expect(assinaturaGuias([{ ...a, ...change }, b])).not.toBe(assinaturaGuias([a, b]));
  }
});
