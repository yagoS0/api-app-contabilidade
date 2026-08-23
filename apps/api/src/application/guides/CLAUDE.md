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

### ⚠ O GERARGUIA31 é o MESMO para INSS e para o DARF do LP — quem decide é o DOCUMENTO (21/08/2026)

`syncSerproInssForCompany` e `emitirDarfDctfweb` chamam o mesmo serviço SERPRO ("DCTFWeb /
GERAL_MENSAL"). Na empresa com folha ele devolve o DARF previdenciário; na empresa de **Lucro
Presumido** devolve o DARF de **PIS/COFINS/IRPJ/CSLL**. A captura de INSS gravava `tipo:"INSS"`
nos dois casos — **sem olhar a composição que ela mesma já havia parseado**, e que estava sendo
usada só para a circular.

Efeito: a MESMA dívida virava **duas guias** — a correta (`tipo:"OUTRA"`, escrita pela captura do
LP, com `composicao` de verdade) e uma cópia rotulada **INSS**, de valor e vencimento idênticos.
Foi o que o dono viu em SINCROSAT 2026-07: R$ 1.435,49 = COFINS 1.179,85 + PIS 255,64.

A guarda é **`tributosSeNaoForPrevidenciario`** (`serpro/parseArrecadacao.js`, pura): recusa o
rótulo INSS só quando **TODAS** as linhas da composição são 8109/2172/2089/2372 — o mesmo mapa que
o LP já usa. Composição vazia ou código desconhecido ⇒ **null**, comportamento antigo preservado.

⚠ **A recusa é pelo DOCUMENTO, nunca pelo cadastro.** Testar `regimeTributario` ou `hasProlabore`
seria mais curto e **apagaria guia real**: medido em produção, ALBATROZ (LUCRO_PRESUMIDO,
`hasProlabore=false`) tem DARF genuinamente previdenciário, e **23 das 70** guias legítimas estão em
empresas com `hasProlabore=false` — o cadastro está desatualizado e não serve de autoridade aqui.
Travado em `serpro/__tests__/darfDctfwebNaoEhSempreInss.test.js`, com os casos reais dos dois lados.

⚠ **Recusar não é declarar ausência**: não grava marcador VAZIO e **não escreve a circular**
(`inssTotal`/`inssStatus`/`acrescimos.INSS`) — era ela que passava a afirmar INSS de PIS/COFINS.

#### O resíduo: as 6 guias que o defeito já tinha escrito, e a decisão do dono (21/08/2026)

A guarda impede guia nova. As **6** que já estavam no banco (reconfirmadas pelo PDF em 22/08/2026 —
`scripts/diag-inss-fantasma-alvo.mjs`) são resíduo, em 2 empresas, ambas LUCRO_PRESUMIDO:

| competência | empresa | valor | situação |
|---|---|---|---|
| 2026-07 | SINCROSAT | 1.435,49 | a guia `OUTRA` correta já existe ao lado |
| 2026-05 | EDUCACAO E DIREITO | 645,15 | o contador já subiu o DARF **à mão** (`tipo:"PIS"`) |
| 2026-01 a 2026-04 | EDUCACAO E DIREITO | 54,52 / 36,34 / 740,89 / 134,61 | a guia errada é o **ÚNICO** registro do DARF |

**A decisão, perguntada e respondida diretamente:** *"Excluir só as duplicadas, rodar a captura nas
outras 4."* E, sobre os marcadores VAZIO de PIS: *"Deixar como está."*

⚠⚠ **A ORDEM NÃO É DETALHE DE EXECUÇÃO — É A DECISÃO.** Nas quatro de 2026-01 a 2026-04 a guia
errada é o único registro daquele DARF: apagar antes é **perder o documento**, não corrigir o
rótulo. Por isso **captura do Lucro Presumido primeiro** (`POST
/firm/companies/:id/serpro/lp/capture`, que grava a guia `tipo:"OUTRA"` com a composição de
verdade), **conferir**, e **só então** excluir. `scripts/excluir-guias-inss-fantasma.mjs` torna isso
estrutural, não uma lembrança: o alvo é lista fechada de ids, cada órfã declara o `sourceFileId` da
substituta (`serpro:dctfweb:lp:<cnpj>:<comp>`) e a guia é **pulada enquanto essa linha não existir**
— nem com `--executar`. Ensaio é o padrão; apagar exige a flag; e cada registro é despejado inteiro
(todas as colunas + PDF em base64) num JSON **antes** do DELETE.

⚠ **Os marcadores VAZIO de PIS (EDUCACAO 2026-01 e 2026-02) FICAM.** Não é esquecimento nem dívida:
é decisão explícita do dono. Marcar VAZIO foi declaração do contador, e ela não fica falsa porque a
guia errada ao lado sumiu — quem declarou ausência de PIS naquele mês continua respondendo por isso.
Script nenhum toca em `status:"VAZIO"`.

⚠⚠ **2026-05 NÃO ENTRA NA CAPTURA — só na exclusão.** Apurado em 22/08/2026: a terceira linha
daquele mês (`tipo:"PIS"`, 645,15) não veio de integração nenhuma — o contador **baixou o DARF do
e-CAC e subiu à mão** em 11/06/2026 13:24, 29 minutos antes de a captura de INSS gravar o fantasma.
Mesma composição (COFINS 530,26 + PIS 114,89), **outro número de documento**: duas emissões do mesmo
débito. Ela **já foi enviada ao cliente** e **já gerou a provisão** da competência
(`PROVISAO/PIS_COFINS/DARF_PIS`). Rodar a captura do LP ali criaria uma **segunda** provisão por
cima — a competência ficaria com o tributo em dobro. Órfã de verdade são **quatro**, não cinco.

⚠ **A circular NÃO é arrastada pela exclusão** e continua afirmando o que o defeito escreveu:
`inssTotal`/`inssStatus="EMITTED"` nas 6 competências, e `acrescimos.INSS` na SINCROSAT. Não há FK
de `CompanyMonthlyCircular` para `Guide` — apagar a guia não limpa nada disso. **Isto não foi objeto
da decisão do dono**; fica registrado como pendência conhecida, não como algo resolvido.

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

## LINHA DIGITÁVEL da guia — lida do documento, NUNCA montada (18/08/2026)

Pedido do dono: *"colocar código de barras e ou código pix na linha das guias"*, com a instrução
*"faça A e se não conseguir faça B"*. **A não existe** (medido no catálogo do Integra Contador: os 9
serviços do PGDASD não devolvem código de barras), então é **B: extrair do PDF que já guardamos**.

⚠⚠ **PIX NÃO EXISTE E NÃO ENTRA.** Nenhum serviço documentado devolve copia-e-cola, e nos PDFs reais
o QR é IMAGEM: medido no banco local, **7 documentos imprimem "Pague com o PIX" e 0 têm o texto**.
Não gerar QR, não deduzir chave. Isto não é lacuna a preencher — é resposta.

### As quatro colunas são uma MÁQUINA DE ESTADOS, não quatro campos soltos

| `linhaDigitavelLidaEm` | `linhaDigitavel` | `...Motivo` | `...ValorLidoCentavos` | significado |
|---|---|---|---|---|
| NULL | — | — | — | **NÃO TENTAMOS** (guia antiga, ou sem PDF) |
| data | preenchida | NULL | NULL | **TEMOS A LINHA** |
| data | NULL | preenchido | preenchido | **DIVERGÊNCIA** — mostra os dois valores |
| data | NULL | preenchido | NULL | **TENTAMOS E NÃO DEU** |

⚠ `linhaDigitavelLidaEm` é gravado em TODA tentativa, inclusive nas que recusam — é ele, sozinho,
que separa "não tentamos" de "tentamos e não deu". Sem ele os dois voltam ao mesmo balde.

⚠⚠ **`linhaDigitavelValorLidoCentavos` SÓ É PREENCHIDO NA RECUSA POR VALOR DIVERGENTE.** Ali os
cinco DVs FECHARAM e o número codificado é confiável: o documento diz aquilo. Em recusa de
DV/tamanho/produto a sequência já se provou corrompida, e imprimir um valor tirado dela seria
inventar pela porta dos fundos. Travado em `__tests__/lerLinhaDigitavelDoPdf.test.js`, e o banco
ainda garante `CHECK ("linhaDigitavel" IS NULL OR "linhaDigitavelMotivo" IS NULL)`.

⚠ **Motivo é texto livre no BANCO e lista FECHADA na TELA** (de propósito: o catálogo cresce, e um
CHECK obrigaria migration a cada motivo novo). Motivo não catalogado **não ganha frase inventada** —
vira texto neutro com o valor cru no `title`, para a auditoria recuperar.

### Onde a leitura foi ligada, e por quê

Em **`createOrUpdateGuideFromProcessing`** (o funil), logo depois do bloco de `pdfBytes`:
- é o **único funil por onde passa guia com PDF** — os três caminhos de upload e os três de captura
  SERPRO desembocam ali;
- o **PDF já está em memória**; ler na tela obrigaria a buscar o BYTEA e reparsear a cada listagem;
- a conferência usa **`data.valor`, o mesmo número gravado na operação** — o par (linha, valor) nasce
  coerente por construção, sem janela entre conferir e gravar.

⚠ **Só mexe nas colunas quando `pdfBytes` é tocado.** Confirmar pagamento, liberar ao cliente e
reenviar e-mail passam pelo funil SEM `pdfBytes`: se escrevessem, apagariam uma linha válida por
causa de um update que nada tem a ver com ela. Travado em `__tests__/linhaDigitavelNaGravacao.test.js`.

⚠ **A leitura NUNCA derruba o salvamento da guia.** PDF ilegível vira recusa nomeada (`pdf_ilegivel`).

⚠ **Guia sem valor gravado NÃO produz linha** (`sem_valor_na_guia_para_conferir`): `conferirContraDocumento`
pula a comparação quando o esperado é nulo, o que é correto para diagnóstico mas aqui produziria uma
linha "aprovada" que ninguém conferiu contra nada.

### Backfill

`scripts/reler-linha-digitavel.mjs` — **dry-run por padrão**, `--aplicar` para escrever. Lê o PDF já
guardado (`pdfBytes`, ou o base64 do `extracted.rawPayload`) e escreve **exclusivamente as quatro
colunas**. **Não roda sozinho** e não deve passar a rodar: sem cron, worker ou rota. Usa a MESMA
função do funil — reescrever a leitura ali faria backfill e captura discordarem sobre a mesma guia.

Medido no banco local (16 guias): **6 com linha, 1 divergente, 2 sem linha legível, 7 sem PDF**.
O divergente é real: `PGDASD-DAS-44742042202605001.pdf` traz **R$ 790,79** impressos e a guia está
gravada com **R$ 100,00**.
