// A BIFURCAÇÃO V1/V2 DE `decorateParcelamento` — exercida pelo caminho de leitura real.
//
// ⚠ O BUG. `isV2 = parcelas.length === 0 && guides.length > 0`. O segundo termo fazia a VERSÃO do
// parcelamento depender de quantas GUIAS já tinham chegado. Um parcelamento V2 sem guia nenhuma
// caía no ramo V1, contava as linhas leves `tipo="PARCELA"` que o V2 nunca cria, e a tela recebia
// "0 de 0" com o risco de rescisão marcado como não avaliável.
//
// E "V2 sem guia nenhuma" é o caso NORMAL, não a exceção:
//   · DÉBITO AUTOMÁTICO — não existe guia, por definição (item 3 das restrições do dono);
//   · caminho SERPRO — `ingestParcelamentoFromGuide` aceita rodar SEM `guideId` e cria o
//     parcelamento antes de qualquer guia; o worker traz as guias depois.
//
// ⚠ O DISCRIMINADOR VERDADEIRO não tem nada a ver com guia: o V1 (`createParcelamento`) SEMPRE cria
// N linhas `tipo="PARCELA"` (ele recusa `numParcelas < 1`, logo N ≥ 1) e o V2 NUNCA cria nenhuma.
// A presença dessas linhas é o fato que separa as versões — e é só ela que decide agora.

jest.mock("../../../infrastructure/db/prisma.js", () => ({
  prisma: { parcelamento: { findFirst: jest.fn() } },
}));

import { prisma } from "../../../infrastructure/db/prisma.js";
import { getParcelamento } from "../ParcelamentoService.js";

const VENCIDA = "2026-01-20T12:00:00.000Z";
const A_VENCER = "2027-01-20T12:00:00.000Z";

function contratadas(n, { comGuia = {} } = {}) {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`,
    numeroParcela: i + 1,
    vencimento: new Date(A_VENCER),
    origemBaixa: null,
    guia: comGuia[i + 1] || null,
  }));
}

const BASE = {
  id: "parc1",
  portalClientId: "pc1",
  status: "ATIVO",
  numParcelas: 52,
  principalPerParcela: 300,
  totalValue: 15600,
};

afterEach(() => jest.clearAllMocks());

test("⚠ V2 SEM NENHUMA GUIA: 0 de 52, não 0 de 0", async () => {
  prisma.parcelamento.findFirst.mockResolvedValue({
    ...BASE,
    parcelas: [],                       // V2 não cria linhas de rastreio
    guides: [],                         // débito automático: nenhuma guia
    parcelasContratadas: contratadas(52),
  });

  const r = await getParcelamento({ portalClientId: "pc1", parcelamentoId: "parc1" });

  expect(r.parcelasTotal).toBe(52);     // ⚠ antes: 0
  expect(r.parcelasPagas).toBe(0);
  expect(r.parcelasSemEvidencia).toBe(52);
  expect(r.saldoRestante).toBe(15600);
});

test("V2 com guias: pagas contam, e o denominador continua sendo o CONTRATO", async () => {
  prisma.parcelamento.findFirst.mockResolvedValue({
    ...BASE,
    parcelas: [],
    guides: [{ id: "g1" }, { id: "g2" }, { id: "g3" }],
    parcelasContratadas: contratadas(52, {
      comGuia: {
        1: { id: "g1", vencimento: new Date(VENCIDA), paymentStatus: "PAID", baixada: true },
        2: { id: "g2", vencimento: new Date(VENCIDA), paymentStatus: "PAID", baixada: true },
        3: { id: "g3", vencimento: new Date(VENCIDA), paymentStatus: "OPEN", baixada: false },
      },
    }),
  });

  const r = await getParcelamento({ portalClientId: "pc1", parcelamentoId: "parc1" });

  expect(r.parcelasPagas).toBe(2);
  expect(r.parcelasTotal).toBe(52);     // ⚠ antes: 3 (o número de guias)
  expect(r.parcelasSemEvidencia).toBe(49);
  expect(r.principalPago).toBe(600);
  expect(r.risco.avaliavel).toBe(true);
  expect(r.risco.emAtraso).toBe(1);     // só a nº 3 venceu sem pagamento
});

test("V1 continua no ramo V1 — as linhas `tipo=\"PARCELA\"` é que decidem, não as guias", async () => {
  prisma.parcelamento.findFirst.mockResolvedValue({
    ...BASE,
    numParcelas: 3,
    totalValue: 900,
    parcelas: [
      { numeroParcela: 1, statusPagamento: "PAGO" },
      { numeroParcela: 2, statusPagamento: "PAGO" },
      { numeroParcela: 3, statusPagamento: "ABERTO" },
    ],
    guides: [],                          // ⚠ sem guia: ANTES isto empurrava o V1 para o ramo errado
    parcelasContratadas: contratadas(3),
  });

  const r = await getParcelamento({ portalClientId: "pc1", parcelamentoId: "parc1" });

  expect(r.parcelasPagas).toBe(2);       // do `statusPagamento` das linhas, como sempre foi
  expect(r.parcelasTotal).toBe(3);
  expect(r.parcelasSemEvidencia).toBe(0);
});

test("parcelamento inexistente segue devolvendo nulo", async () => {
  prisma.parcelamento.findFirst.mockResolvedValue(null);
  await expect(getParcelamento({ portalClientId: "pc1", parcelamentoId: "x" })).resolves.toBeNull();
});
