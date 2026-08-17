-- OS CAMPOS FISCAIS DA NOTA SAEM DE DENTRO DO XML E VIRAM COLUNA CONSULTÁVEL.
--
-- ⚠ NÃO APLICADA. Escrita e conferida offline; aplicar é decisão de quem opera.
--
-- Puramente ADITIVA: treze colunas novas, todas NULLABLE, e um índice. Nenhum UPDATE, nenhum DROP,
-- nenhum DEFAULT carimbado em linha existente, nenhuma mudança de tipo, nenhuma unicidade nova.
-- Toda linha que existe hoje continua bit a bit como está.
--
-- ⚠ O NOME DA TABELA FOI CONFERIDO CONTRA AS MIGRATIONS EXISTENTES, NÃO CONTRA O `schema.prisma`
-- (que nomeia MODELS): `grep -rhoE 'REFERENCES "[A-Za-z_]+"' apps/api/prisma/migrations/` devolve
-- `REFERENCES "PortalInvoice"` — a tabela é `"PortalInvoice"`, sem `@@map`, ao contrário de
-- `portal_clients`. Foi um `REFERENCES "portal_clients"` escrito de memória que derrubou a
-- produção, e `npm test` / `npm run build` / `prisma validate` NÃO executam SQL de migration.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- O PEDIDO, E A MEDIÇÃO QUE O PRECEDE
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- O dono (17/08/2026): "precisamos trazer os XMLs das notas (…) nos ajuda em uma auditoria
-- pré-apuração para entender se a nota está correta ou não, baseado na atividade e baseado na data
-- de emissão".
--
-- ⚠ NÃO HAVIA NADA A "TRAZER". Medido em produção antes de escrever qualquer linha
-- (`scripts/diag-cobertura-xml-notas.mjs`, só leitura):
--     EMIT (emitidas)   14.946 notas · 100% com xmlRaw · 0 sem
--     DEST (recebidas)   1.846 notas ·  98% com xmlRaw · 40 sem
-- O XML já estava todo lá. O trabalho é extrair para coluna o que só existia dentro do texto.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 1) O CÓDIGO DE SERVIÇO E A DESCRIÇÃO — a pergunta "a nota saiu na atividade certa?"
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Caminhos (NT SE/CGNFS-e nº 008 v1.02 §2.4.5, transcrita em `nfse/danfse/danfseLeiaute.js`):
--     cTribNac  ← NFSe/infNFSe/DPS/infDPS/serv/cServ/cTribNac      (campo `cTrib` do leiaute)
--     cTribMun  ← NFSe/infNFSe/cTribMun ‖ .../serv/cServ/cTribMun  (campo `cTrib`)
--     xTribNac  ← NFSe/infNFSe/xTribNac ‖ .../serv/cServ/xTribNac  (campo `xTrib`)
--     xTribMun  ← NFSe/infNFSe/xTribMun ‖ .../serv/cServ/xTribMun  (campo `xTrib`)
--     xDescServ ← NFSe/infNFSe/DPS/infDPS/serv/cServ/xDescServ     (campo `xDescServ`)
--
-- ⚠ LIDOS POR CAMINHO, NUNCA POR NOME DE TAG. O XML da NFS-e tem `CNPJ` em quatro grupos, `cMun`
-- em cinco e `vBC` em DOIS — `getTextByLocalNames` devolve o primeiro do documento inteiro. Num
-- metadado isso é um campo torto; aqui seria a auditoria acusando a nota errada.
--
-- ⚠ ISTO NÃO SUBSTITUI `nota_itens.codigoServico`, que a captura já grava
-- (`AdnXmlMetadata.parseXmlMetadata` → `notas/ingestaoNfse.js`) — e que É lido por varredura de
-- nome. Aquele caminho fica intocado; o backfill COMPARA os dois e relata a divergência em vez de
-- eleger um vencedor em silêncio.
ALTER TABLE "PortalInvoice" ADD COLUMN "cTribNac" TEXT;
ALTER TABLE "PortalInvoice" ADD COLUMN "cTribMun" TEXT;
ALTER TABLE "PortalInvoice" ADD COLUMN "xTribNac" TEXT;
ALTER TABLE "PortalInvoice" ADD COLUMN "xTribMun" TEXT;
ALTER TABLE "PortalInvoice" ADD COLUMN "xDescServ" TEXT;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 2) O MUNICÍPIO DA PRESTAÇÃO — decide de quem é o ISSQN
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- `NFSe/infNFSe/DPS/infDPS/serv/locPrest/cLocPrestacao` (código IBGE, 7 dígitos).
--
-- ⚠ A NT §2.4.5 nomeia o GRUPO `serv/locPrest/` e, dentro dele, a tag `cPaisPrestacao`; o
-- `cLocPrestacao` ela não nomeia, porque o DANFSe imprime o NOME (`infNFSe/xLocPrestacao`), não o
-- código. O caminho não está sendo inventado — ele está (a) na amostra versionada
-- `docs/leiaute-nfse/nfse-nacional-substituicao.xml`, (b) escrito nesse mesmo lugar por
-- `NfseService.buildDpsXml`, e (c) documentado em `docs/nfse-preenchimento.md` §2.
--
-- Por que é campo de auditoria: LC 116/2003, art. 3º — o local da prestação decide para qual
-- prefeitura o ISS é devido, e ele NÃO se deduz do endereço do tomador.
ALTER TABLE "PortalInvoice" ADD COLUMN "cLocPrestacao" TEXT;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 3) O ISSQN — base, alíquota e imposto apurado
-- ─────────────────────────────────────────────────────────────────────────────────────────────
--     issqnBaseCalculo ← NFSe/infNFSe/valores/vBC          (campo `vBC` do leiaute)
--     issqnAliquota    ← NFSe/infNFSe/valores/pAliqAplic   (campo `pAliqAplic`)
--     issqnValor       ← NFSe/infNFSe/valores/vISSQN       (campo `vISSQN`)
--
-- ⚠ OS NOMES SÃO EXPLÍCITOS DE PROPÓSITO. A tag da base é `vBC`, e `vBC` existe em DOIS grupos:
-- `infNFSe/valores` (ISSQN) e `IBSCBS/valores` (base após exclusões do IBS/CBS — campo
-- `bcAposExclusoes`). Uma coluna chamada `vBC` carregaria a ambiguidade dentro do próprio nome.
--
-- ⚠ `NUMERIC(7,4)` NA ALÍQUOTA, NÃO `(5,2)`. A NT declara o campo como `1-2V2` (dois inteiros, duas
-- decimais); guardar com duas casas ARREDONDARIA em silêncio uma alíquota municipal com mais
-- precisão. Casa a mais nunca perde dado; casa a menos perde, e sem avisar.
--
-- ⚠ Valor ausente fica NULO, jamais `0.00`: zero em `issqnValor` AFIRMA "ISS apurado de R$ 0,00".
ALTER TABLE "PortalInvoice" ADD COLUMN "issqnBaseCalculo" DECIMAL(18,2);
ALTER TABLE "PortalInvoice" ADD COLUMN "issqnAliquota" DECIMAL(7,4);
ALTER TABLE "PortalInvoice" ADD COLUMN "issqnValor" DECIMAL(18,2);

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 4) A SÉRIE E O NÚMERO DA DPS — ⚠ COLUNAS NOVAS, E NÃO A COLUNA `serie` QUE JÁ EXISTE
-- ─────────────────────────────────────────────────────────────────────────────────────────────
--     dpsSerie  ← NFSe/infNFSe/DPS/infDPS/serie   (campo `serie` do leiaute, max 5)
--     dpsNumero ← NFSe/infNFSe/DPS/infDPS/nDPS    (campo `nDPS`,  max 15)
--
-- ⚠ POR QUE NÃO GRAVAR NA COLUNA `serie`, que é a opção mais barata: `PortalInvoice.serie` já
-- existe e é escrita **só** por `notas/dfe/DfeSyncService.js`, para NF-e (registrado em
-- `nfse/nfseUltimaNota.js`: "para NFS-e nunca é escrita"). Série de NF-e e série de DPS são
-- contadores de documentos diferentes, emitidos por sistemas diferentes, com faixas diferentes
-- (a DPS tem a faixa 00001–49999 da RN E0010; a NF-e não tem essa regra). Colocar os dois na mesma
-- célula é exatamente a classe de defeito que este projeto já pagou em "TRÊS NÚMEROS DE DAS, TRÊS
-- COLUNAS" (`apps/api/CLAUDE.md`): a coluna passa a guardar ora um, ora o outro, sem nada na linha
-- que os distinga, e a tela tem de inventar um estado para não mentir. Um filtro `serie = '00900'`
-- passaria a misturar NF-e e NFS-e de propósitos distintos.
--
-- ⚠ E `dpsNumero` NÃO é `numero`: `numero` guarda o `nNFSe`, o número da NFS-e (contador do
-- município/SEFIN). São dois contadores, e confundi-los é o erro que `nfseUltimaNota.js` existe
-- para impedir.
--
-- ⚠ TEXT, não BIGINT: o `nNFSe` da coluna irmã (`numero`) já é TEXT, nada faz aritmética com este
-- valor (quem decide numeração continua lendo o `xmlRaw` via `nfseUltimaNota`), e uma coluna BigInt
-- que caia num `res.json()` estoura na serialização.
ALTER TABLE "PortalInvoice" ADD COLUMN "dpsSerie" TEXT;
ALTER TABLE "PortalInvoice" ADD COLUMN "dpsNumero" TEXT;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 5) ⚠ O CARIMBO E O MOTIVO — sem eles, "coluna nula" seria DUAS coisas
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- `cTribNac IS NULL` significaria, ao mesmo tempo, "o XML desta nota não traz o campo" e "o
-- extrator nunca passou por esta linha". É o quarto estado perigoso já nomeado na migration
-- `20260810160000_add_nfse_ciclo_vida`: "não temos o evento" se parece com "não houve evento" e
-- significa o oposto.
--
-- `camposFiscaisMotivo` guarda POR QUE não deu, com vocabulário fechado (`camposFiscaisNfse.MOTIVO`:
-- XML_AUSENTE · XML_ILEGIVEL · NAO_E_NFSE · NENHUM_CAMPO · CAMPO_ILEGIVEL:<campo> ·
-- CTRIBNAC_FORA_DA_FORMA). Ausência é resposta; palpite não é.
ALTER TABLE "PortalInvoice" ADD COLUMN "camposFiscaisExtraidosEm" TIMESTAMP(3);
ALTER TABLE "PortalInvoice" ADD COLUMN "camposFiscaisMotivo" TEXT;

-- A pergunta que a auditoria faz: "quais notas DESTA empresa saíram no código de serviço X?".
-- ⚠ `clientId` vem primeiro porque multi-tenancy não é opcional nem no índice.
CREATE INDEX "PortalInvoice_clientId_cTribNac_idx" ON "PortalInvoice"("clientId", "cTribNac");

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- O QUE ESTA MIGRATION DELIBERADAMENTE **NÃO** FAZ
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- · NÃO faz backfill. Ele é script separado (`scripts/backfill-campos-fiscais-nota.mjs`), dry-run
--   por padrão, `--aplicar` explícito, idempotente, sem uma única chamada externa.
-- · NÃO toca `status`, `statusEfetivo` nem `total`. Há aviso explícito no schema sobre
--   `statusEfetivo`: gravar um terceiro valor ali é mudança de DINHEIRO disfarçada de rótulo.
-- · NÃO toca a coluna `serie`, nem `numero`, nem `nota_itens.codigoServico`. As colunas novas
--   convivem com as antigas; nenhuma leitura existente muda de resposta.
-- · NÃO cria CHECK de forma (6 dígitos em `cTribNac`, 7 em `cLocPrestacao`). Estas colunas guardam
--   o que o DOCUMENTO DE TERCEIRO diz; um CHECK faria o dado do emitente ter de obedecer à nossa
--   regra, e uma nota fora da forma é justamente o que a auditoria quer ENXERGAR, não recusar. O
--   desvio é marcado em `camposFiscaisMotivo` (`CTRIBNAC_FORA_DA_FORMA`).
-- · NÃO cria NOT NULL nem DEFAULT em nada — 16.792 linhas seriam reescritas, e a extração de
--   algumas delas legitimamente não rende valor.
