-- EMISSÃO DE NFS-e EM LOTE — o trabalho PERSISTIDO que sustenta a série de atos fiscais.
--
-- ⚠⚠ NÃO APLICADA. Aplicar é ato do dono (`prisma:migrate:deploy` + `:status`).
--
-- ⚠⚠ ESTAS TABELAS EXISTEM PORQUE CADA LINHA DO LOTE VIRA UMA NOTA FISCAL IRREVERSÍVEL, e o caminho
-- da emissão está apontado para o sistema nacional de PRODUÇÃO. A funcionalidade nasce DESLIGADA
-- (`INTEGRACAO_NFSE_LOTE`), com o SERVIDOR recusando operar — não é a tela que esconde o botão.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- POR QUE PERSISTIDO E NÃO SÍNCRONO — medido em 20/08/2026, não estimado
-- ─────────────────────────────────────────────────────────────────────────────────────────────
--
--   • piso local por nota: ~48 ms (janela de numeração 29 ms + assinatura XMLDSig 5,7 ms + gzip
--     0,1 ms + handshake mTLS 13 ms contra localhost, com 0 ms de rede);
--   • TETO por nota: 15 000 ms — o `timeout` do axios em `NfseService.js`. É 313× o piso;
--   • `buildAxiosClient` cria um `https.Agent` NOVO a cada chamada ⇒ handshake mTLS completo por
--     nota, sem reuso de conexão entre as notas de um mesmo lote;
--   • `server.requestTimeout` do Node 20 é 300 000 ms e o `server.js` NÃO o sobrescreve.
--
-- Um lote de 50 no teto levaria 750 s, e o RUNTIME mata a requisição aos 300 s — no meio, com notas
-- fiscais reais já emitidas e a resposta descartada. Não é "a conexão pode cair": é determinístico
-- para qualquer lote cuja média passe de 6 s/nota.
--
-- ⚠ E a razão mais forte não depende disso. As `ServiceInvoice` JÁ são duráveis (a reserva de
-- numeração grava antes do envio), então as NOTAS não se perdem num POST interrompido. O que não
-- sobrevive é o LOTE: quais linhas são dele, qual virou qual nota, QUAL É A LINHA INDETERMINADA,
-- quais números foram queimados, e a identidade que faz a segunda subida da mesma planilha ser
-- reconhecida em vez de reprocessada.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- ⚠ NOMES DE TABELA CONFERIDOS CONTRA AS MIGRATIONS EXISTENTES, NUNCA CONTRA O `schema.prisma`
-- ─────────────────────────────────────────────────────────────────────────────────────────────
--
--   `lotes_emissao_nfse`         tabela NOVA. `@@map` dos models novos, no mesmo estilo
--   `lotes_emissao_nfse_linhas`  snake_case/plural de `tomadores_emitidos`, `contatos_whatsapp`,
--                                `envios_guia`, `atos_parcelamento`.
--   `"Company"`                  model SEM `@@map`. Confirmado em migrations JÁ APLICADAS:
--                                `CREATE TABLE "Company"` na `20251204195725_init`, e
--                                `ALTER TABLE "Company"` na `20260814120000_add_nfse_emissao_fase1`.
--
-- ⚠ Foi um `REFERENCES "portal_clients"` (nome tirado do model, não da migration) que derrubou a
--   produção com P3009. `npm test`, `npm run build` e `prisma validate` NÃO executam SQL de
--   migration e não pegariam um nome errado aqui.
--
-- ⚠ NÃO HÁ FK PARA `ServiceInvoice`: `serviceInvoiceId` é coluna simples, de propósito. A nota é um
--   ATO FISCAL CONSUMADO no sistema nacional; um `ON DELETE CASCADE` faria o histórico do lote
--   sumir junto de uma linha apagada, e um `RESTRICT` faria a existência do lote impedir manutenção
--   na tabela de notas. É a mesma escolha registrada no ledger (`portalClientId` sem FK).
--
-- ⚠ `ON DELETE CASCADE` de `lote → Company` e de `linha → lote`: o lote é DA empresa e não existe
--   fora dela; a linha não existe fora do lote. Mesma regra de `ServiceInvoice` e `TomadorEmitido`.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- ADITIVA. Não remove coluna, não remove tabela, não altera tabela existente, não faz backfill.
-- Não há o que backfillar: nenhuma emissão em lote jamais aconteceu (a funcionalidade não existia,
-- e nasce desligada). O histórico começa vazio.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

CREATE TABLE "lotes_emissao_nfse" (
    "id" TEXT NOT NULL,
    -- O id da Company LEGADA — o mesmo escopo de ServiceInvoice/TomadorEmitido, nunca o PortalClient.
    "companyId" TEXT NOT NULL,
    -- ⚠ SHA-256 sobre as linhas PRONTA já classificadas, na ordem — não sobre os bytes do arquivo.
    "impressaoDigital" TEXT NOT NULL,
    -- emitindo | concluido | parado_indeterminado | erro
    "status" TEXT NOT NULL DEFAULT 'emitindo',
    "totalLinhas" INTEGER NOT NULL,
    "emitidas" INTEGER NOT NULL DEFAULT 0,
    "recusadas" INTEGER NOT NULL DEFAULT 0,
    "naoTentadas" INTEGER NOT NULL DEFAULT 0,
    -- ⚠⚠ A linha cujo desfecho NÃO se sabe. Coluna própria: depois de um reinício não há mais nada
    -- que diga "nesta aqui você não encosta". A retomada seleciona `numeroLinha > este valor`.
    "linhaIndeterminada" INTEGER,
    "paradoEm" TIMESTAMP(3),
    "paradoMotivo" TEXT,
    "criadoPor" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lotes_emissao_nfse_pkey" PRIMARY KEY ("id")
);

-- ⚠ A TRAVA DA IDEMPOTÊNCIA: a mesma planilha, na mesma empresa, é o MESMO lote.
CREATE UNIQUE INDEX "lotes_emissao_nfse_companyId_impressaoDigital_key"
    ON "lotes_emissao_nfse"("companyId", "impressaoDigital");

CREATE INDEX "lotes_emissao_nfse_companyId_criadoEm_idx"
    ON "lotes_emissao_nfse"("companyId", "criadoEm");

CREATE TABLE "lotes_emissao_nfse_linhas" (
    "id" TEXT NOT NULL,
    "loteId" TEXT NOT NULL,
    -- ⚠ O número da linha DO EXCEL, nunca índice de array.
    "numeroLinha" INTEGER NOT NULL,
    -- ⚠ O payload congelado: é o que permite RETOMAR sem o arquivo (os ajustes não persistem).
    "dados" JSONB NOT NULL,
    "tomadorDoc" TEXT NOT NULL,
    "tomadorNome" TEXT NOT NULL,
    "valorServicos" DECIMAL(18,2) NOT NULL,
    "competencia" TIMESTAMP(3),
    -- nao_tentada | enviando | emitida | recusada_receita | recusada_nossa | indeterminada
    -- ⚠ `enviando` é gravado ANTES do POST: é a janela entre a reserva commitar e a resposta voltar.
    "desfecho" TEXT NOT NULL DEFAULT 'nao_tentada',
    "serviceInvoiceId" TEXT,
    -- ⚠ Gravados na RESERVA, antes do envio. Nulos na recusa NOSSA (que acontece antes de reservar).
    "rpsSerie" TEXT,
    "rpsNumero" TEXT,
    -- NOSSA | TRANSPORTE | RECEITA — o mesmo vocabulário de `desfechoEmissao.js`.
    "camada" TEXT,
    "codigo" TEXT,
    "mensagem" TEXT,
    "correcao" TEXT,
    "tentadaEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lotes_emissao_nfse_linhas_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "lotes_emissao_nfse_linhas_loteId_numeroLinha_key"
    ON "lotes_emissao_nfse_linhas"("loteId", "numeroLinha");

CREATE INDEX "lotes_emissao_nfse_linhas_loteId_desfecho_idx"
    ON "lotes_emissao_nfse_linhas"("loteId", "desfecho");

ALTER TABLE "lotes_emissao_nfse"
    ADD CONSTRAINT "lotes_emissao_nfse_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "lotes_emissao_nfse_linhas"
    ADD CONSTRAINT "lotes_emissao_nfse_linhas_loteId_fkey"
    FOREIGN KEY ("loteId") REFERENCES "lotes_emissao_nfse"("id") ON DELETE CASCADE ON UPDATE CASCADE;
