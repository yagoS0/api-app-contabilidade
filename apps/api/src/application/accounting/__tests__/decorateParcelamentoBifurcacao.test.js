// `decorateParcelamento` — UMA derivação só, exercida pelo caminho de leitura real.
//
// ⚠ O BUG ORIGINAL. `isV2 = parcelas.length === 0 && guides.length > 0`. O segundo termo fazia a
// VERSÃO do parcelamento depender de quantas GUIAS já tinham chegado. Um parcelamento V2 sem guia
// nenhuma caía no ramo V1, contava as linhas leves `tipo="PARCELA"` que o V2 nunca cria, e a tela
// recebia "0 de 0" com o risco de rescisão marcado como não avaliável.
//
// E "V2 sem guia nenhuma" é o caso NORMAL, não a exceção:
//   · DÉBITO AUTOMÁTICO — não existe guia, por definição;
//   · parcelamento MIGRADO de outra contabilidade — as prestações já pagas nunca tiveram guia aqui;
//   · caminho SERPRO — `ingestParcelamentoFromGuide` roda SEM `guideId` e cria o parcelamento antes
//     de qualquer guia; o worker traz as guias depois.
//
// ⚠ F2.3 — A BIFURCAÇÃO INTEIRA MORREU, e é isso que estes testes travam agora. Ela fazia a MESMA
// ROTA devolver semânticas diferentes com os mesmos nomes de campo: no ramo V1, `parcelasPagas` era
// o `statusPagamento` das linhas leves e `parcelasSemEvidencia` era zerado à força; no V2, os três
// números vinham de `quadroDasParcelas`. Hoje vêm de `quadroDasParcelas` sempre — o denominador é o
// CONTRATO (`parcelas`, materializadas por `sincronizarParcelas` nos dois caminhos) e o numerador é
// a EVIDÊNCIA (guia quitada, ou `origemBaixa`).

jest.mock("../../../infrastructure/db/prisma.js", () => ({
  prisma: { parcelamento: { findMany: jest.fn() } },
}));

import { prisma } from "../../../infrastructure/db/prisma.js";
import { listParcelamentos } from "../ParcelamentoService.js";

const VENCIDA = "2026-01-20T12:00:00.000Z";
const A_VENCER = "2027-01-20T12:00:00.000Z";

function contratadas(n, { comGuia = {}, historicas = 0 } = {}) {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`,
    numeroParcela: i + 1,
    vencimento: new Date(A_VENCER),
    origemBaixa: i + 1 <= historicas ? "HISTORICO" : null,
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

async function decorar(row) {
  prisma.parcelamento.findMany.mockResolvedValue([row]);
  const [r] = await listParcelamentos({ portalClientId: "pc1" });
  return r;
}

afterEach(() => jest.clearAllMocks());

test("⚠ SEM NENHUMA GUIA: 0 de 52, não 0 de 0", async () => {
  const r = await decorar({
    ...BASE,
    parcelas: [],                       // o V2 não cria linhas de rastreio
    guides: [],                         // débito automático: nenhuma guia
    parcelasContratadas: contratadas(52),
  });

  expect(r.parcelasTotal).toBe(52);     // ⚠ antes: 0
  expect(r.parcelasPagas).toBe(0);
  expect(r.parcelasSemEvidencia).toBe(52);
  expect(r.saldoRestante).toBe(15600);
});

test("com guias: pagas contam, e o denominador continua sendo o CONTRATO", async () => {
  const r = await decorar({
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

  expect(r.parcelasPagas).toBe(2);
  expect(r.parcelasTotal).toBe(52);     // ⚠ antes: 3 (o número de guias)
  expect(r.parcelasSemEvidencia).toBe(49);
  expect(r.principalPago).toBe(600);
  expect(r.risco.avaliavel).toBe(true);
  expect(r.risco.emAtraso).toBe(1);     // só a nº 3 venceu sem pagamento
});

// ⚠ O QUE SUBSTITUIU O TESTE "V1 continua no ramo V1". A presença das linhas leves `tipo="PARCELA"`
// não decide mais NADA na contagem — ela era o discriminador da bifurcação removida. Um parcelamento
// com linhas de rastreio conta exatamente como qualquer outro: pelo contrato e pela evidência.
test("as linhas leves `tipo=\"PARCELA\"` não decidem mais a contagem", async () => {
  const r = await decorar({
    ...BASE,
    numParcelas: 3,
    totalValue: 900,
    // Linhas leves do V1, com o `statusPagamento` que o ramo antigo lia. Elas continuam servidas à
    // tela (campo `parcelas`), mas não alimentam mais numerador nem denominador.
    parcelas: [
      { numeroParcela: 1, statusPagamento: "PAGO" },
      { numeroParcela: 2, statusPagamento: "PAGO" },
      { numeroParcela: 3, statusPagamento: "ABERTO" },
    ],
    guides: [],
    parcelasContratadas: contratadas(3, {
      comGuia: { 1: { id: "g1", vencimento: new Date(VENCIDA), paymentStatus: "PAID", baixada: true } },
    }),
  });

  expect(r.parcelasTotal).toBe(3);
  expect(r.parcelasPagas).toBe(1);       // a evidência (1 guia paga), não o `statusPagamento` (2)
  expect(r.parcelasSemEvidencia).toBe(2);
});

// ⚠ F2.3 — `HISTORICO` É QUITAÇÃO, e chega até aqui sem que `decorateParcelamento` saiba o que é:
// `parcelaRowQuitada` só pergunta se há `origemBaixa`. Contrato migrado com 12 prestações já pagas
// aparece como "12 de 60", não como "0 de 60" nem como 12 em atraso.
test("parcelas HISTORICO contam como pagas e como evidência", async () => {
  const r = await decorar({
    ...BASE,
    numParcelas: 60,
    totalValue: 18000,
    parcelas: [],
    guides: [],
    parcelasContratadas: contratadas(60, { historicas: 12 }),
  });

  expect(r.parcelasTotal).toBe(60);
  expect(r.parcelasPagas).toBe(12);
  expect(r.parcelasSemEvidencia).toBe(48);
  expect(r.principalPago).toBe(3600);
});

test("lista vazia segue devolvendo vazio", async () => {
  prisma.parcelamento.findMany.mockResolvedValue([]);
  await expect(listParcelamentos({ portalClientId: "pc1" })).resolves.toEqual([]);
});
