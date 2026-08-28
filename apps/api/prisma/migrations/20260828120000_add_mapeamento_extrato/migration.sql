-- O MAPEAMENTO DE UM EXTRATO EM EXCEL — "nesta planilha, qual coluna é o quê".
--
-- ⚠⚠ NÃO APLICADA. Aplicar é ato do dono (`prisma:migrate:deploy` + `:status`).
--
-- ⚠ ADITIVA E INERTE: UMA tabela nova, uma FK. Nenhuma coluna existente é tocada, nenhum dado é
--   alterado, nenhum índice existente é mexido. Subir o código antes de aplicar não quebra nada —
--   o que não funciona é o import de Excel, e ele recusa NOMEANDO (P2021), não com 500.
--
-- ⚠ MIGRATION SEPARADA, pelo mesmo motivo escrito em `20260824160000_add_ofx_import`: editar uma
--   migration existente é janela de corrida, e um arquivo a mais custa zero.
--
-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- POR QUE ESTA TABELA EXISTE
-- ═════════════════════════════════════════════════════════════════════════════════════════════
--
-- Decisão do dono (27/08/2026), sobre extrato em Excel: *"o contador mapeia as colunas, e o
-- mapeamento fica salvo por empresa"*.
--
-- O OFX é auto-descritivo; a planilha do banco não é. Sem esta tabela, alguém teria de dizer qual
-- coluna é a data A CADA ENVIO — O(n) por envio, onde o problema é O(1) por FORMATO.
--
-- ⚠⚠ `confirmado` NASCE `false`, E É A TRAVA INTEIRA DA FASE. O sistema PROPÕE a partir dos
--   apelidos de cabeçalho que o import do escritório já usa (`excelImport.HEADER_ALIASES`); uma
--   PESSOA confirma. Sem a confirmação, planilha nenhuma vira lançamento — e o que está em jogo é
--   despesa lançada com a data no lugar do valor, ou com o sinal invertido, no razão do cliente.
--
-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠⚠ A CHAVE NÃO É "O BANCO" — é a ASSINATURA DO CABEÇALHO
-- ═════════════════════════════════════════════════════════════════════════════════════════════
--
-- O mapeamento é "por empresa + banco", e aí vem a pergunta que o FORMATO não responde: **qual
-- banco é este?** Uma planilha de extrato não tem código de banco como o OFX tem (`<BANKID>`); tem
-- um nome de arquivo que a pessoa renomeia, e um cabeçalho.
--
-- O que dá para OBSERVAR é o cabeçalho: dois extratos do mesmo banco têm o mesmo conjunto de
-- colunas; de bancos diferentes, não. Daí `assinatura` = as células de cabeçalho normalizadas e
-- **ORDENADAS**, unidas por `|`.
--
-- ⚠ ORDENADAS de propósito: o banco reordena colunas entre versões do arquivo, e uma chave sensível
--   à ordem faria o contador remapear a MESMA planilha. Os ÍNDICES continuam sendo lidos do arquivo
--   de cada envio — a chave identifica o FORMATO, nunca a posição.
--
-- ⚠⚠ E ELA NÃO É O NOME DO BANCO. É impressão digital, não afirmação: o rótulo legível ("Itaú") é o
--   contador que escreve, em `rotulo`, e viaja ao lado. Deduzir o nome do banco a partir do
--   cabeçalho seria inventar, e o nome aparece na tela dele.

CREATE TABLE "mapeamentos_extrato" (
    "id"             TEXT NOT NULL,
    "portalClientId" TEXT NOT NULL,

    -- As células de cabeçalho normalizadas e ORDENADAS, unidas por `|`. Ver o bloco acima.
    "assinatura"     TEXT NOT NULL,
    -- ⚠ NULO é legítimo: o mapeamento vale sem apelido, e exigir um faria alguém digitar qualquer
    --   coisa para passar da tela.
    "rotulo"         TEXT,

    -- ⚠ `{ data, valor, historico, sinal }` — o ÍNDICE de cada papel na linha, nunca o NOME da
    --   coluna: é por índice que a leitura acontece.
    "colunas"        JSONB NOT NULL,
    -- COLUNA_DE_SINAL | VALOR_NEGATIVO. ⚠ `COLUNAS_SEPARADAS` existe no vocabulário e NÃO é
    --   suportado — `validarMapeamento` o recusa NOMEANDO, em vez de escolher uma das duas colunas
    --   de valor e importar metade do extrato em silêncio.
    "sinal"          TEXT NOT NULL,

    -- ⚠ A linha de cabeçalho como veio. Sem ela o contador não tem como conferir DEPOIS o que
    --   confirmou.
    "cabecalhoVisto" JSONB,

    -- ⚠⚠ A TRAVA. Nasce `false`; só a rota em que uma pessoa clica o vira.
    "confirmado"     BOOLEAN NOT NULL DEFAULT false,
    "confirmadoEm"   TIMESTAMP(3),
    "confirmadoPor"  TEXT,

    "criadoEm"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm"   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mapeamentos_extrato_pkey" PRIMARY KEY ("id")
);

-- ⚠ UM mapeamento por (empresa, formato). É ele que faz o segundo envio daquele banco entrar
--   sozinho — e que impede dois mapeamentos discordando sobre a MESMA planilha.
CREATE UNIQUE INDEX "mapeamentos_extrato_portalClientId_assinatura_key"
    ON "mapeamentos_extrato"("portalClientId", "assinatura");
CREATE INDEX "mapeamentos_extrato_portalClientId_atualizadoEm_idx"
    ON "mapeamentos_extrato"("portalClientId", "atualizadoEm");

ALTER TABLE "mapeamentos_extrato"
    ADD CONSTRAINT "mapeamentos_extrato_portalClientId_fkey"
    FOREIGN KEY ("portalClientId") REFERENCES "PortalClient"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ⚠ NÃO há CHECK sobre `sinal` nem sobre as chaves de `colunas`, e é a mesma decisão de
--   `codigosServicoNacional`: o Postgres não valida conteúdo de JSONB sem função, e migration que
--   falha é P3009 com o servidor fora do ar. A forma é guardada por `validarMapeamento`, que roda
--   ANTES de qualquer linha virar lançamento — e é ele que tem teste.

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- E O REGISTRO DO ENVIO — `ofx_imports` passa a guardar OS DOIS FORMATOS
-- ═════════════════════════════════════════════════════════════════════════════════════════════
--
-- ⚠⚠ SIM, O NOME DA TABELA PASSA A MENTIR UM POUCO — e a alternativa é pior.
-- `lancamentos_declarados.ofxImportId` é o ÚNICO ponteiro para "qual envio criou esta linha".
-- Uma tabela nova exigiria uma SEGUNDA coluna de ponteiro no declarado, e `varrerInvariantes`
-- teria de conhecer as duas — dois caminhos para a mesma pergunta é como as quatro cópias do
-- filtro de envio de guia divergiram nesta base. Renomear coluna que já tem escritor é migration
-- destrutiva. Então o nome fica e o FORMATO vira dado, à vista.
--
-- ⚠ ADITIVA: `DEFAULT 'OFX'` — toda linha existente descreve o que de fato é. Nenhum backfill.
--   (Medido em produção: `ofx_imports` **não existe ainda** — a migration que a cria também não foi
--   aplicada. O default existe para o intervalo entre escrever e aplicar, e para o caso de a ordem
--   das duas mudar.)

ALTER TABLE "ofx_imports" ADD COLUMN "formato" TEXT NOT NULL DEFAULT 'OFX';
-- ⚠ Com QUAL mapeamento o arquivo foi lido. NULO no OFX, que é auto-descritivo.
--   Sem FK, pela MESMA razão de `accountingEntryId`: apagar um mapeamento não pode apagar nem
--   desvincular o registro do envio que ele leu — o id fica, e quem o denuncia é a leitura.
ALTER TABLE "ofx_imports" ADD COLUMN "mapeamentoExtratoId" TEXT;
