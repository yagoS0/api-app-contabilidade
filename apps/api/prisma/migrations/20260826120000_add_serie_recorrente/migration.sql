-- A SÉRIE RECORRENTE — "esta despesa (ou receita) volta, e com que valor".
--
-- ⚠⚠ NÃO APLICADA. Aplicar é ato do dono (`prisma:migrate:deploy` + `:status`).
--
-- ⚠ ADITIVA E INERTE: UMA tabela nova, uma FK, dois índices. Nenhuma coluna existente é tocada,
--   nenhum dado é alterado, nenhum índice existente é mexido. Subir o código antes de aplicar não
--   quebra nada — o que não funciona é a marcação (o detector é PURO e continua respondendo).
--
-- ⚠ MIGRATION SEPARADA, pela mesma razão da `20260824160000`: editar migration é uma janela de
--   corrida, e a convenção desta casa é explícita — *"nunca editar arquivos de migration já
--   aplicados"*.
--
-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- POR QUE ESTA TABELA EXISTE — e o que ela NÃO é
-- ═════════════════════════════════════════════════════════════════════════════════════════════
--
-- > Dono, 25/08/2026: *"deve haver uma forma de o contador indicar se aquilo é recorrente ou não,
-- > e parte do software entender se é mesmo, ou não."*
--
-- ⚠⚠ ELA NÃO GUARDA A OBSERVAÇÃO — GUARDA A DECISÃO.
--
-- Quem observa é `application/fluxo/lib/recorrencia.js`, que é PURO: ele lê as notas e os débitos
-- de extrato que já existem, e devolve uma leitura. Nada do que ele devolve é gravado. O que entra
-- aqui é a marcação do CONTADOR — e é ela que põe a linha no fluxo de caixa.
--
-- ⚠ O piso de 3 observações é baixo (decisão do dono), e o que segura o desenho **não é o número,
--   é a marcação**: um trimestre coincidente vira "recorrência" com 3 observações, e por isso o
--   detector SUGERE e a linha só entra depois que alguém confirma.
--
-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- AS DECISÕES QUE ESTÃO NAS COLUNAS
-- ═════════════════════════════════════════════════════════════════════════════════════════════
--
-- ⚠⚠ `chave` E O `UNIQUE` — a chave é a CONTRAPARTE, não a conta.
--
--   É como o dono formulou os dois exemplos: *"a Claude"*, *"o mesmo cliente"*. Um desenho anterior
--   chaveava por CONTA e lia o `AccountingEntry` — porque era a única fonte com histórico, e era
--   pobre. Com o razão fora de escopo (decisão do dono, 25/08/2026), a fonte virou a NOTA, e as
--   duas pontas saem da mesma tabela: `tomadorDoc` na receita, `emitenteDoc` na despesa.
--
--   ⚠ Os dois campos são ANULÁVEIS. Sem documento (o débito de extrato), quem identifica é a
--     descrição CANONIZADA — e por isso `chave` é obrigatória e `contraparteDoc` não é.
--
-- ⚠⚠ `periodicidade` EXISTE POR CAUSA DA TAXA ANUAL DO CONSELHO.
--
--   Um desenho que conte MESES quebra nela: uma taxa anual nunca teria 3 meses consecutivos e sairia
--   do fluxo na segunda ausência. O vocabulário é o que o projeto JÁ TEM
--   (`PERIODICIDADES` de `application/obrigacoes/gerarOcorrencias.js`), não um segundo.
--
-- ⚠⚠ `origem` (DETECTADA | DECLARADA) — as duas NUNCA se parecem na tela.
--
--   A detectada mostra a EVIDÊNCIA (n, janela, mediana, faixa); a declarada mostra QUEM afirmou e
--   QUANDO. Uma afirmação não pode ter o peso visual de doze observações. E quando as duas existem,
--   **o observado vence** (decisão do dono) — a declaração vira linha de conferência.
--
-- ⚠⚠ `baseDaObservacao` NÃO É ENFEITE. Sem ela, *"por que esta linha está no fluxo?"* não tem
--   resposta em seis meses. É `Json?` e não colunas porque a forma da evidência vai mudar quando o
--   detector melhorar, e cada mudança viraria uma migration.
--
-- ⚠ `saidaSugeridaEm` guarda que o detector SUGERIU a saída e ninguém respondeu. O sistema **não
--   desmarca sozinho**, pela mesma razão que não marca sozinho.
--
-- ⚠ SEM CHECK de vocabulário, de propósito. `lado`, `origem`, `estado` e `periodicidade` são listas
--   fechadas no CÓDIGO. Um CHECK aqui exigiria uma migration a cada valor novo, e o precedente
--   desta casa (a coluna `codigosServicoNacional`) é explícito: migration que falha é P3009 e
--   servidor que não sobe.
--
-- ⚠ NENHUMA COLUNA NOVA em `AccountingEntry`, `PortalInvoice` ou `LancamentoDeclarado`.
-- ⚠ SEM FK PARA CONTA — `codigoCompleto` não é identidade; guarda-se texto e resolve-se pelo plano.

CREATE TABLE "series_recorrentes" (
    "id" TEXT NOT NULL,
    "portalClientId" TEXT NOT NULL,
    "lado" TEXT NOT NULL,
    "contraparteDoc" TEXT,
    "chave" TEXT NOT NULL,
    "rotulo" TEXT NOT NULL,
    "periodicidade" TEXT NOT NULL,
    "origem" TEXT NOT NULL,
    "estado" TEXT NOT NULL,
    "valorDeclarado" DECIMAL(18,2),
    "baseDaObservacao" JSONB,
    "declaradoPor" TEXT,
    "declaradoEm" TIMESTAMP(3),
    "confirmadoPor" TEXT,
    "confirmadoEm" TIMESTAMP(3),
    "saidaSugeridaEm" TIMESTAMP(3),
    "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadaEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "series_recorrentes_pkey" PRIMARY KEY ("id")
);

-- ⚠⚠ UMA SÉRIE POR (EMPRESA, LADO, CHAVE). O `lado` entra porque o MESMO documento pode ser
--   tomador numa ponta e emitente na outra: uma empresa que compra e vende para o mesmo CNPJ tem
--   duas séries, e elas não podem colidir.
CREATE UNIQUE INDEX "series_recorrentes_portalClientId_lado_chave_key"
    ON "series_recorrentes"("portalClientId", "lado", "chave");

-- ⚠ O índice que a tela usa: "o que está pendente de confirmação nesta empresa?"
CREATE INDEX "series_recorrentes_portalClientId_estado_idx"
    ON "series_recorrentes"("portalClientId", "estado");

-- ⚠ `onDelete: Cascade` como as irmãs (`ofx_imports`, `lancamentos_declarados`): a série não
--   sobrevive à empresa, e uma linha órfã apontaria para um `portalClientId` que não existe mais.
ALTER TABLE "series_recorrentes"
    ADD CONSTRAINT "series_recorrentes_portalClientId_fkey"
    FOREIGN KEY ("portalClientId") REFERENCES "PortalClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
