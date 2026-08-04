# CLAUDE.md — Guias (apps/api/src/application/guides)

Domínio das guias de imposto (DAS/Simples, INSS, DARF, etc): contrato, compliance,
status de pagamento/e-mail, lock de captura e envio.

## Modelo Guide (resumo)

- `tipo`: INSS|FGTS|PIS|COFINS|ISS|**SIMPLES**|DARF|IRPJ|CSLL|OUTRA (canônico em `guideContract.js`).
  A guia do Simples é `tipo="SIMPLES"` (a coluna/seção de UI chama "DAS").
- `status`: PENDING|PROCESSING|PROCESSED|NEEDS_REVIEW|ERROR|**VAZIO**.
  **VAZIO (Q17)** = marcador "não há guia neste mês" (sem PDF) — ausência confirmada.
- `emailStatus`: PENDING|SENDING|SENT|ERROR. `paymentStatus`: OPEN|PAID|OVERDUE.
- `valorOriginal` = valor da 1ª captura (imutável em recálculo).
- **Confirmar pagamento** (`POST /firm/guides/:id/confirm-payment` → `markGuidePaidManual`): seta
  `paymentStatus=PAID`. **Q23:** se a guia é de **parcelamento** (`parcelamentoId`), também gera o
  lançamento de **BAIXA** via `gerarPagamentoParcelaFromGuide` (juros LIDO da composição, data = hoje,
  `baixada/dataBaixa/lancamentoId`); idempotente; **bloqueia (409 MES_FECHADO)** se o mês contábil
  do pagamento estiver fechado. Guia normal não gera lançamento.

## Guia consolidada do Lucro Presumido (C5)

A captura do LP (`application/fiscal/lp/LucroPresumidoProvisaoService.js`) grava **UMA DARF
consolidada** por competência com `tipo:"OUTRA"` — **o DARF do LP não pode ser split** (decisão do
dono, confirmada em estudo próprio). O que separa os tributos é a **composição**, em
`guide.extracted.composicao[]`: `{ codigo, tributo, total, denominacao }`, onde `tributo` ∈
PIS|COFINS|IRPJ|CSLL vem do texto do extrato (`tributoDaDescricao`) com o código de receita como
fallback (**8109=PIS, 2172=COFINS, 2089=IRPJ, 2372=CSLL**).

Consequências práticas (duas armadilhas já corrigidas):
- **Rótulo na tela:** a UI (`renderCompanyGuidesTable.tipoGuiaLabel`) mostra os impostos contidos
  ("PIS · COFINS") em vez de "OUTRA" — mas só funciona porque `toGuideResponse` **expõe a
  composição** (`extracted: { composicao }`). Não remover esse campo do contrato.
- **Compliance:** `computeGuideComplianceMap` precisa aceitar `tipo:"OUTRA"` e **explodir a
  composição** (igual faz com DARF), senão as tags IRPJ/CSLL/PIS-COFINS do card ficam vermelhas
  mesmo com a guia capturada. PIS e COFINS caem no mesmo grupo `PIS_COFINS`.

## ⚠ Parcela de parcelamento é `tipo:"SIMPLES"` — o que a separa do DAS é `parcelamentoId`

`CaptureSerproParcelaService` grava a parcela como `tipo:"SIMPLES"`, exatamente como o DAS do mês;
`ParcelamentoV2Service` carimba `parcelamentoId`. Quem filtra só por `tipo` mostra a parcela como se
fosse o DAS — e a empresa parece em dia com um DAS que nunca foi gerado.

A decisão vive em **`isGuiaDeParcelamento` / `colunaMatrizDaGuia`** (`guideContract.js`), consumida
pelo compliance E pelo `batch-report`. Grep por `parcelamentoId` antes de mexer em qualquer query de
`Guide` que filtre por `tipo`.

O nó `parcDas` tem o mesmo ciclo dos outros (`missing → gerada → enviada`), alimentado pela GUIA da
parcela. **`vazio`/`semFaturamento` não valem ali**: ausência de parcela contratada não se declara, e
mês sem receita não suspende parcelamento. Rótulo na UI: **"Parcelamento"** (uma parcela de INSS
parcelado também cai nesse nó).

## Compliance (guideCompliance.js)

`computeGuideComplianceMap(rows, competencia)` retorna por empresa, por tributo, um nó
`{ required, ok, state }` onde **state** ∈ `present` (guia PROCESSED) | `vazio` (marcador
VAZIO) | `missing` (falta) | `na` (não exigido). `ok = present || vazio`. O front pinta:
verde=present, **amarelo=vazio**, vermelho=missing. `getReferenceCompetencia()` = mês anterior.

## "Vazio" (Q17)

Endpoints em `routes/firm/index.js`: `POST /firm/guides/vazio` (cria/garante Guide
`status="VAZIO"` por empresa+tipo+competência; bloqueia se já houver guia PROCESSED) e
`DELETE /firm/guides/vazio` (desfaz). Guias esperadas + estado por empresa:
`GET /firm/companies/:id/guides/expected?competencia=`.
> PIS/COFINS é grupo: o marcador VAZIO usa `tipo="PIS"` (representa o grupo PIS_COFINS).

## Regras

- `status="VAZIO"` **não** é guia com PDF: excluir de envio em lote, recálculo e pagamento
  (filtros já usam `status="PROCESSED"`). Grep por `status === "PROCESSED"` ao mexer.
- Lock de captura: `GuideLockService` (`tryAcquireGuideLock`/`releaseGuideLock`).
- Envio de e-mail é manual em prod (BatchEmail); ver `apps/api/CLAUDE.md`.
- Isolamento multi-tenant: sempre `portalClientId`.
