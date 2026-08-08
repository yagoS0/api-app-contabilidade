-- F2.1 — A PARCELA VIRA ENTIDADE.
--
-- Até aqui uma parcela ERA uma `Guide` com `parcelamentoId` (unique `(parcelamentoId,
-- numeroParcela)`), e o módulo inteiro derivava estado disso: contadores, risco de rescisão, fila
-- de pendentes de baixa, fila de conferência e recálculo de atraso varriam `Guide`. A consequência
-- é que **parcela sem guia não existia** — e parcelamento em DÉBITO AUTOMÁTICO não tem guia nenhuma,
-- por definição. Ele aparecia como "0 de 0", com o alerta de rescisão marcado "não avaliável".
--
-- ⚠ ESTA MIGRATION NÃO ESCREVE UMA ÚNICA LINHA EM `"Guide"` NEM EM `"accounting_entries"`.
-- Essa é a garantia de que nenhum vínculo contábil se perde, e ela é ESTRUTURAL, não uma promessa:
-- procure por UPDATE/DELETE nessas duas tabelas neste arquivo — não há. `Guide."lancamentoId"` e
-- `accounting_entries."sourceGuideId"` continuam exatamente como estavam; a conciliação já feita
-- não é tocada. Tudo abaixo é INSERT em uma tabela NOVA, mais um UPDATE na própria tabela nova.
-- O ponteiro vai no sentido novo→velho (`parcelas."guiaId"`), nunca o contrário.
--
-- ⚠ E ELA NÃO DUPLICA O ESTADO DE PAGAMENTO. Não há coluna `baixada` nem `paymentStatus` aqui.
-- Enquanto a baixa for por guia (`gerarPagamentoParcelaFromGuide` exige `guideId` na assinatura, na
-- guarda de idempotência via `sourceGuideId` e no efeito colateral em `guide.baixada`/`lancamentoId`),
-- quem responde "esta prestação foi quitada?" continua sendo a GUIA. Uma cópia divergiria no
-- primeiro estorno. Aqui mora o CONTRATO (quais prestações existem, quando vencem); lá mora o FATO.

CREATE TABLE "parcelas" (
    "id" TEXT NOT NULL,
    "parcelamentoId" TEXT NOT NULL,
    "portalClientId" TEXT NOT NULL,
    "numeroParcela" INTEGER,
    "competencia" TEXT,
    "anoMesParcela" TEXT,
    "vencimento" TIMESTAMP(3),
    "valorPrevisto" DECIMAL(18,2),
    "guiaId" TEXT,
    "origemBaixa" TEXT,
    "baixadaEm" TIMESTAMP(3),
    "origem" TEXT NOT NULL DEFAULT 'CONTRATO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "parcelas_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "parcelas_guiaId_key" ON "parcelas"("guiaId");
CREATE INDEX "parcelas_parcelamentoId_idx" ON "parcelas"("parcelamentoId");
CREATE INDEX "parcelas_portalClientId_parcelamentoId_idx" ON "parcelas"("portalClientId", "parcelamentoId");
-- ⚠ NULLs são DISTINTOS em UNIQUE no Postgres: as linhas SEM número (guia vinculada a parcelamento
-- sem `numeroParcela`, caso que `normalizeParcelaDTO` admite) não colidem entre si. O que as separa
-- é o unique de `guiaId` acima — uma linha por guia.
CREATE UNIQUE INDEX "parcelas_parcelamentoId_numeroParcela_key" ON "parcelas"("parcelamentoId", "numeroParcela");

ALTER TABLE "parcelas" ADD CONSTRAINT "parcelas_parcelamentoId_fkey"
  FOREIGN KEY ("parcelamentoId") REFERENCES "parcelamentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- ⚠ ON DELETE SET NULL, nunca CASCADE: apagar uma guia não pode apagar a prestação CONTRATADA.
-- A guia é o documento; a parcela é a obrigação. Some o documento, a obrigação continua devida.
ALTER TABLE "parcelas" ADD CONSTRAINT "parcelas_guiaId_fkey"
  FOREIGN KEY ("guiaId") REFERENCES "Guide"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
-- BACKFILL — 1) O CRONOGRAMA CONTRATADO
-- ============================================================================
-- Uma linha por prestação de 1 a `numParcelas`. O calendário é o MESMO que `createParcelamento` já
-- calcula para as linhas leves `tipo="PARCELA"` do V1 (`addMonths` + `buildDateOfMonth`): mês da
-- `competenciaInicial` avançado de (n-1) meses, no `diaPagamento`, CLAMPADO ao último dia do mês
-- (dia 31 em fevereiro). Não é dado fiscal inventado — é a conta que o próprio sistema já faz sobre
-- campos que o contador preencheu.
--
-- ⚠ `competenciaInicial = '1970-01'` é SENTINELA, não data. `ingestParcelamentoFromGuide` grava
-- `compLabel || "1970-01"` quando a parcela chega sem `anoMesParcela`. Derivar vencimentos de 1970
-- a partir dela imprimiria uma sentinela como se fosse data de vencimento — e, pior, marcaria o
-- acordo inteiro como vencido. Nesses casos o calendário fica NULO: ausência de data é o que se
-- sabe. (`avaliarRiscoRescisao` já descarta parcela sem vencimento — não é caso novo para ele.)
INSERT INTO "parcelas" (
  "id","parcelamentoId","portalClientId","numeroParcela",
  "competencia","anoMesParcela","vencimento","valorPrevisto","origem","createdAt","updatedAt"
)
SELECT
  gen_random_uuid()::text,
  p."id",
  p."portalClientId",
  n,
  cal."competencia",
  cal."anomes",
  cal."vencimento",
  COALESCE(p."valorParcelaReferencia", p."principalPerParcela"),
  'CONTRATO',
  NOW(), NOW()
FROM "parcelamentos" p
CROSS JOIN LATERAL generate_series(1, GREATEST(COALESCE(p."numParcelas", 1), 1)) AS n
CROSS JOIN LATERAL (
  SELECT CASE
    WHEN p."competenciaInicial" ~ '^[0-9]{4}-[0-9]{2}$' AND p."competenciaInicial" <> '1970-01'
    THEN (to_date(p."competenciaInicial" || '-01', 'YYYY-MM-DD') + ((n - 1) * INTERVAL '1 month'))::date
  END AS "mes"
) m
CROSS JOIN LATERAL (
  SELECT
    to_char(m."mes", 'YYYY-MM') AS "competencia",
    to_char(m."mes", 'YYYYMM')  AS "anomes",
    -- ⚠ MEIO-DIA, não meia-noite: `buildDateOfMonth` (o gêmeo em JS, em `parcelaSync.js`) grava
    -- `Date.UTC(y, m, d, 12)`. Duas convenções de hora para a MESMA data de vencimento fariam a
    -- linha criada por esta migration e a criada pelo código divergirem na comparação
    -- "venceu antes de agora?" — 12h de diferença decidem o dia do vencimento.
    LEAST(
      m."mes" + (GREATEST(LEAST(COALESCE(p."diaPagamento", 1), 31), 1) - 1),
      (m."mes" + INTERVAL '1 month')::date - 1
    )::timestamp + INTERVAL '12 hours' AS "vencimento"
) cal;

-- ============================================================================
-- BACKFILL — 2) AS GUIAS QUE O CRONOGRAMA NÃO COBRE
-- ============================================================================
-- ⚠ ESTE PASSO É O QUE IMPEDE PERDA DE VÍNCULO. O cronograma vai de 1 a `numParcelas`, mas existe
-- guia com número FORA desse intervalo (parcelamento reduzido depois da adesão, `numParcelas`
-- desatualizado) e existe guia com `numeroParcela` NULO. Sem estas duas inserções, essas guias
-- ficariam sem parcela — e como as derivações passam a ler `parcelas`, uma baixa já conciliada
-- sumiria da contagem. A asserção no fim deste arquivo é o que garante que nenhuma escapou.

-- 2a) Guia NUMERADA fora do cronograma → linha própria com o número dela.
--     `Guide` tem unique `(parcelamentoId, numeroParcela)`, então não há duas guias no mesmo número.
INSERT INTO "parcelas" (
  "id","parcelamentoId","portalClientId","numeroParcela",
  "competencia","anoMesParcela","vencimento","valorPrevisto","guiaId","origem","createdAt","updatedAt"
)
SELECT
  gen_random_uuid()::text,
  g."parcelamentoId",
  COALESCE(g."portalClientId", p."portalClientId"),
  g."numeroParcela",
  g."competencia",
  g."anoMesParcela",
  g."vencimento",
  g."valor",
  g."id",
  'GUIA',
  NOW(), NOW()
FROM "Guide" g
JOIN "parcelamentos" p ON p."id" = g."parcelamentoId"
WHERE g."parcelamentoId" IS NOT NULL
  AND g."numeroParcela" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "parcelas" pa
     WHERE pa."parcelamentoId" = g."parcelamentoId"
       AND pa."numeroParcela" = g."numeroParcela"
  );

-- 2b) Guia SEM número → linha própria, sem número, chaveada pela guia.
--     Uma linha por guia (não uma linha para todas): `NOT EXISTS` sobre `numeroParcela IS NULL`
--     casaria a 2ª guia com a linha criada pela 1ª e a descartaria em silêncio.
INSERT INTO "parcelas" (
  "id","parcelamentoId","portalClientId","numeroParcela",
  "competencia","anoMesParcela","vencimento","valorPrevisto","guiaId","origem","createdAt","updatedAt"
)
SELECT
  gen_random_uuid()::text,
  g."parcelamentoId",
  COALESCE(g."portalClientId", p."portalClientId"),
  NULL,
  g."competencia",
  g."anoMesParcela",
  g."vencimento",
  g."valor",
  g."id",
  'GUIA',
  NOW(), NOW()
FROM "Guide" g
JOIN "parcelamentos" p ON p."id" = g."parcelamentoId"
WHERE g."parcelamentoId" IS NOT NULL
  AND g."numeroParcela" IS NULL;

-- ============================================================================
-- BACKFILL — 3) O VÍNCULO GUIA → PARCELA
-- ============================================================================
-- Casa cada guia numerada com a prestação de mesmo número. É aqui que a conciliação já feita
-- (`Guide."lancamentoId"` e as BAIXAs com `sourceGuideId`) fica alcançável a partir da parcela:
-- parcela → guia → lançamento. Nenhuma das duas pontas foi reescrita; só ganhou uma porta de entrada.
UPDATE "parcelas" pa
   SET "guiaId" = g."id",
       "origem" = 'GUIA',
       "updatedAt" = NOW()
  FROM "Guide" g
 WHERE g."parcelamentoId" = pa."parcelamentoId"
   AND g."numeroParcela" IS NOT NULL
   AND g."numeroParcela" = pa."numeroParcela"
   AND pa."guiaId" IS NULL;

-- ============================================================================
-- A ASSERÇÃO — "nenhum vínculo se perdeu" precisa ser EXECUTADO, não afirmado
-- ============================================================================
-- ⚠ Se UMA guia de parcelamento ficar sem linha em `parcelas`, esta migration ABORTA e a transação
-- inteira volta atrás. É de propósito: as derivações passam a ler `parcelas`, então guia órfã aqui
-- é baixa conciliada que some da contagem do contador — silenciosamente, que é o pior modo. Falhar
-- alto no deploy é preferível a subir com um número errado na tela.
DO $$
DECLARE
  orfas   bigint;
  dupes   bigint;
BEGIN
  SELECT count(*) INTO orfas
    FROM "Guide" g
   WHERE g."parcelamentoId" IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM "parcelas" pa WHERE pa."guiaId" = g."id");
  IF orfas > 0 THEN
    RAISE EXCEPTION
      'F2.1 abortada: % guia(s) com parcelamentoId ficaram sem linha em "parcelas". Nenhum vinculo pode ficar inalcancavel.',
      orfas;
  END IF;

  -- Cinto: o unique de `guiaId` já impediria, mas uma contagem explícita documenta a intenção.
  SELECT count(*) INTO dupes
    FROM (SELECT "guiaId" FROM "parcelas" WHERE "guiaId" IS NOT NULL GROUP BY "guiaId" HAVING count(*) > 1) d;
  IF dupes > 0 THEN
    RAISE EXCEPTION 'F2.1 abortada: % guia(s) apontadas por mais de uma parcela.', dupes;
  END IF;
END $$;
