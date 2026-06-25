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
