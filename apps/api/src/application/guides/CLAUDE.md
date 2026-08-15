# CLAUDE.md — Guias (apps/api/src/application/guides)

Domínio das guias de imposto (DAS/Simples, INSS, DARF, etc): contrato, compliance,
status de pagamento/e-mail, lock de captura e envio.

## Modelo Guide (resumo)

- `tipo`: INSS|FGTS|PIS|COFINS|ISS|**SIMPLES**|DARF|IRPJ|CSLL|OUTRA (canônico em `guideContract.js`).
  A guia do Simples é `tipo="SIMPLES"` (a coluna/seção de UI chama "DAS").
- `status`: PENDING|PROCESSING|PROCESSED|NEEDS_REVIEW|ERROR|**VAZIO**.
  **VAZIO (Q17)** = marcador "não há guia neste mês" (sem PDF) — ausência confirmada.
- `emailStatus`: PENDING|SENDING|SENT|ERROR — **e NULL**. `paymentStatus`: OPEN|PAID|OVERDUE.
  ⚠ **NULL é estado real, não ausência de dado.** A coluna é `String?` **sem `@default`**: guia que
  passa por `GuideService` nasce `"PENDING"`, mas a **DARF consolidada do LP** é criada direto por
  `LucroPresumidoProvisaoService` e nasce NULL. E **`IN` do SQL nunca casa com NULL** — foi assim
  que o envio em lote passou a pular essa guia em silêncio, oferecendo-a na matriz e respondendo
  `ok: true, sent: 0`. Quem precisa perguntar "ainda pode ser enviada?" usa
  **`whereGuiaPendenteDeEnvio()`** (`guideContract.js`), nunca um `in` escrito à mão — nem uma lista
  `OR` escrita à mão, que dá no mesmo: `listPendingGuidesReport` tinha a **quarta** cópia, e por
  causa dela a página "Pendências de e-mail" (a única que mostra o motivo da falha) nunca listou a
  DARF do Lucro Presumido.
  ⚠ **`ERROR` é estado PARADO, não transitório.** `emailNextRetryAt` é gravado e **ninguém o
  drena** — o laço automático saiu na Q55. Quem pergunta "a última tentativa falhou?" usa
  **`envioDeEmailFalhou(guide)`**, a MESMA leitura no chip do dashboard e na matriz do lote (duas
  cópias fariam as telas discordarem sobre a mesma guia, como já aconteceu com `parcelamentoId`).
  O ciclo de vida ganhou o estado **`falhou`** em `resolveNode` (`guideCompliance.js`, agora
  **exportado** — o teste importa a função real em vez de manter réplica): vermelho, com
  `emailLastError` junto, **sem mexer em `ok`** (a guia existe; o que falhou foi o envio) e **sem
  ser terminal** (senão o card condensaria em "✓ Guias concluídas" na empresa que não recebeu).
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

⚠ **O `where` também aponta para o `guideContract`.** `isGuiaDeParcelamento` não roda dentro do
banco, então quem filtrava escrevia `parcelamentoId: { not: null }` na mão — e era assim que a regra
ganhava uma cópia por consumidor. Hoje `WHERE_GUIA_DE_PARCELAMENTO` / `WHERE_GUIA_SEM_PARCELAMENTO`
saem do mesmo arquivo (usados pelas duas queries de `guideCompliance`).

### O rótulo só existe se a relação vier junto

`parcelamentoId` é coluna ESCALAR da guia: chega sempre, mesmo sem `include`. Modalidade e número do
parcelamento não — vêm da relação. Sem ela a UI sabia que era parcela e não sabia de qual acordo,
caía no `tipo` e imprimia **"SIMPLES"**, o nome do DAS do mês.

**`SELECT_PARCELAMENTO_DA_GUIA`** (`guideContract.js`) é o que se carrega junto de toda guia que vai
para a tela: `listGuidesByCompany`, `listPendingGuidesReport` e `updateGuidePaymentStatus` (esta
última porque a guia atualizada **substitui a linha da listagem** — sem a relação, confirmar o
pagamento de uma parcela rebaixava o rótulo dela no clique).

⚠ **Modalidade nula é caso REAL, não defeito de carga.** `ParcelamentoService.createParcelamento`
(V1, o modal manual) nunca grava `tipo` nem `numeroParcelamento`; só o V2 grava. Por isso o front
degrada para o rótulo genérico **"Parcelamento"** em vez de completar com o `tipo` da guia.

`toGuideResponse` expõe `quantidadeParcelas` além de `numeroParcela`: "parcela 3" sem o total não
diz se o acordo está no começo ou acabando.

O nó `parcDas` tem o mesmo ciclo dos outros (`missing → gerada → enviada`), alimentado pela GUIA da
parcela. **`vazio`/`semFaturamento` não valem ali**: ausência de parcela contratada não se declara, e
mês sem receita não suspende parcelamento. Rótulo na UI: **"Parcelamento"** (uma parcela de INSS
parcelado também cai nesse nó).

## ⚠ `envios_guia` GANHOU O PRIMEIRO ESCRITOR DE PRODUÇÃO — e o que isso muda no compliance

Até 15/08/2026 nenhuma função de escrita de `EnvioGuiaService` tinha chamador fora dos testes, então
`foiEnviadaComLegado` fazia **toda** guia valer pelo `emailStatus` antigo. Quem escreve agora é o
**envio de guia por WhatsApp** (`application/whatsapp/EnvioGuiaWhatsappService.js`) — e só para as
guias que ele toca.

⚠ **`scripts/backfill-envio-guia.mjs` CONTINUA PROIBIDO.** Ele converte TODOS os estados de uma vez
(`PENDING`/`SENDING` → `pendente`, `ERROR` → `falhou`) e, como a tolerância se desliga na primeira
linha que existir para a guia, congelaria em `enviada: false` **para sempre** toda guia que estivesse
pendente naquele instante. O envio por WhatsApp é o oposto: conversão **por guia tocada** e **só do
que é `SENT`**.

**A guarda:** `linhaLegadoDoEmail(guide)` (pura) + `materializarEnvioDeEmailLegado(guide)`. Antes de
registrar a linha de WhatsApp, a guia que o `emailStatus: SENT` já prova entregue ganha a sua linha
`EMAIL/enviado`. Sem isso, guia entregue por e-mail cujo WhatsApp falhasse depois viraria **não
enviada** — card do dashboard reaberto para sempre. `destino` fica nulo de propósito: para um e-mail
anterior a esta tabela ninguém sabe para onde foi.

**Invariante provada, não afirmada:** tocar uma guia por WhatsApp **nunca rebaixa** a resposta do
`guideCompliance`. `__tests__/complianceAposEnvioWhatsapp.test.js` roda o `computeGuideComplianceMap`
de verdade sobre as 10 combinações de (`emailStatus` × desfecho do WhatsApp), e reproduz **cru** o
caso que prenderia a guia antes de mostrá-lo corrigido. Experimento executado: fazendo
`linhaLegadoDoEmail` devolver sempre `null`, ficam **5 vermelhos**; restaurada, tudo verde.

⚠ **`marcarEnviando` virou RESERVA ATÔMICA** (`updateMany` condicional em `status: "pendente"`,
devolvendo `{ reservado }`) — não era um `update` que dava para deixar simples: `registrarEnvio` é
check-then-act, e duas requisições simultâneas (duplo clique, lote correndo junto do individual)
passariam as duas pela verificação de "já enviado" antes de qualquer uma escrever. Mesmo idioma da
reserva das baixas.

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
