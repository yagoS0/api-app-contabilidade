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

//
// ⚠ 2026-08-12 — `principalPerParcela` DEIXOU DE SER LIDO COMO PRINCIPAL, e é isto que a segunda
// metade destes testes trava. A coluna guarda coisas DIFERENTES conforme quem escreveu (o V1 grava
// o principal por prestação; o V2 grava `round2(parc.valorTotal)`, o valor CHEIO), e `principalPago`
// a multiplicava pelas prestações quitadas como se fosse sempre a primeira. Hoje o principal vem de
// `principalTotal / numParcelas` e é **`null` quando o cabeçalho não o declara** — as asserções
// abaixo afirmam a semântica nova, não uma tolerância maior.
//
// ⚠ `saldoRestante` SAIU. Ele misturava o consolidado (`totalValue`) com um principal inflado; no
// lugar dele há DOIS nomes, um por pergunta: `saldoContratual` (o cabeçalho) e `saldoPassivo` (o
// razão).

jest.mock("../../../infrastructure/db/prisma.js", () => ({
  prisma: {
    parcelamento: { findMany: jest.fn() },
    // ⚠ A SEGUNDA QUERY É PARTE DO CONTRATO DE LEITURA AGORA: o saldo do passivo sai das LINHAS de
    // papel `PARC` dos lançamentos do contrato, numa consulta só para a lista inteira. Mock que não
    // a conhecesse derrubaria a rota com `TypeError` — o pior tipo de vermelho, o que não fala do
    // que quebrou.
    accountingEntryLine: { findMany: jest.fn(async () => []) },
  },
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
  // ⚠ A ARMADILHA, DE PROPÓSITO: `principalPerParcela` (300) e `principalTotal/numParcelas`
  // (10.400 / 52 = 200) DISCORDAM. É a forma real de um contrato do V2, onde a coluna legada guarda
  // o valor CHEIO da prestação. Uma fixture em que os dois coincidissem passaria com o defeito de
  // volta.
  principalPerParcela: 300,
  principalTotal: 10400,
  totalValue: 15600,
};

async function decorar(row, { linhasParc = [] } = {}) {
  prisma.parcelamento.findMany.mockResolvedValue([row]);
  prisma.accountingEntryLine.findMany.mockResolvedValue(
    linhasParc.map((l) => ({ ...l, entry: { parcelamentoId: row.id } })),
  );
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
  // Nada pago ⇒ o principal do contrato inteiro ainda falta. ⚠ E o número sai de `principalTotal`,
  // não de `totalValue`: o consolidado inclui juros, que a amortização do passivo não abate.
  expect(r.saldoContratual).toBe(10400);
  expect(r.principalPago).toBe(0);
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
  // ⚠ 400, NÃO 600. Antes eram `2 × principalPerParcela` (2 × 300); agora são
  // `2 × principalTotal/numParcelas` (2 × 200). A diferença é exatamente o juros embutido na
  // prestação, que a coluna legada carrega junto e que NÃO amortiza o passivo.
  expect(r.principalPorParcela).toBe(200);
  expect(r.principalPago).toBe(400);
  expect(r.saldoContratual).toBe(10000);
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
    principalTotal: 900,
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
    principalTotal: 18000,
    totalValue: 18000,
    parcelas: [],
    guides: [],
    parcelasContratadas: contratadas(60, { historicas: 12 }),
  });

  expect(r.parcelasTotal).toBe(60);
  expect(r.parcelasPagas).toBe(12);
  expect(r.parcelasSemEvidencia).toBe(48);
  expect(r.principalPago).toBe(3600);   // 12 × (18.000 / 60)
});

test("lista vazia segue devolvendo vazio", async () => {
  prisma.parcelamento.findMany.mockResolvedValue([]);
  await expect(listParcelamentos({ portalClientId: "pc1" })).resolves.toEqual([]);
  // ⚠ Lista vazia NÃO consulta as linhas do passivo: uma query com `in: []` custaria uma ida ao
  // banco para devolver nada, em toda empresa sem parcelamento — que é a maioria da carteira.
  expect(prisma.accountingEntryLine.findMany).not.toHaveBeenCalled();
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ AUSÊNCIA NUNCA É RESPOSTA — o que virou `null`, e por quê.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

test("sem `principalTotal`, o principal é `null` — NUNCA zero, e NUNCA `principalPerParcela`", async () => {
  const r = await decorar({
    ...BASE,
    // A forma exata da SINTROPIA nº 1 em produção: a coluna legada existe e tem valor, e o
    // cabeçalho não declara quanto do acordo é principal.
    principalTotal: null,
    parcelas: [],
    guides: [],
    parcelasContratadas: contratadas(52, { historicas: 4 }),
  });

  expect(r.parcelasPagas).toBe(4);
  expect(r.principalPorParcela).toBeNull();
  expect(r.principalPago).toBeNull();     // ⚠ antes: 4 × 300 = 1200, com 300 sendo o valor CHEIO
  expect(r.saldoContratual).toBeNull();
  // E o nome antigo não voltou por acidente — `|| 0` sobre ele é como o zero fabricado renascia.
  expect(r).not.toHaveProperty("saldoRestante");
});

test("`principalTotal` zerado também é ausência de resposta", async () => {
  const r = await decorar({ ...BASE, principalTotal: 0, parcelas: [], guides: [], parcelasContratadas: contratadas(52) });
  expect(r.principalPorParcela).toBeNull();
  expect(r.principalPago).toBeNull();
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ O SALDO DO PASSIVO É OUTRA PERGUNTA, E TEM OUTRA FONTE: o RAZÃO.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

test("`saldoPassivo` sai das linhas de papel PARC — provisão soma, baixa subtrai, estorno devolve", async () => {
  const r = await decorar(
    { ...BASE, parcelas: [], guides: [], parcelasContratadas: contratadas(52) },
    {
      linhasParc: [
        { tipo: "C", valor: 13370.04 }, // provisão da adesão reconhece o passivo
        { tipo: "D", valor: 300.82 },   // baixa de uma prestação amortiza
        { tipo: "D", valor: 300.82 },   // e outra
        { tipo: "C", valor: 300.82 },   // espelho do estorno devolve uma delas
      ],
    },
  );
  expect(r.saldoPassivo).toBe(13069.22);
});

test("sem nenhuma linha PARC (o V1), `saldoPassivo` é `null` — não zero", async () => {
  const r = await decorar({ ...BASE, parcelas: [], guides: [], parcelasContratadas: contratadas(52) });
  // ⚠ O V1 (`createParcelamento`) grava a abertura sem `tipoLinha` em perna nenhuma: dali não se
  // sabe qual linha é o passivo. Zero afirmaria um acordo quitado.
  expect(r.saldoPassivo).toBeNull();
});
