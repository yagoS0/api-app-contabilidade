-- CARGA TRIBUTÁRIA APROXIMADA DA EMPRESA NÃO OPTANTE — os três percentuais da Lei 12.741/2012.
--
-- ⚠⚠ NÃO APLICADA. Aplicar é ato do dono (`prisma:migrate:deploy` + `:status`).
--
-- PEDIDO DO DONO (18/08/2026): *"precisamos emitir para simples nacional também, as alíquotas
-- efetivas do presumido não precisam ser calculadas a não ser o ISS que varia de município, mas
-- deve ser configurado do lado do contador, no portal do contador."*
--
-- Traduzido: empresa do Lucro Presumido hoje NÃO EMITE — `buildDpsXml` recusa com
-- `MISSING_TOT_TRIB_NAO_SIMPLES`. Estes percentuais são **DIGITADOS PELO CONTADOR**, nunca
-- calculados aqui: não há de-para CNAE→presunção neste repositório, e errar entre 8% e 32%
-- inverteria a comparação. O número vai IMPRESSO ao tomador (Lei da Transparência) — ele é uma
-- AFIRMAÇÃO, não um preenchimento técnico.
--
-- ⚠ NOME DA TABELA CONFERIDO CONTRA AS MIGRATIONS, NUNCA CONTRA O `schema.prisma` (que nomeia
--   MODELS): `"Company"` aparece em `CREATE TABLE "Company"` na `20251204195725_init` e em
--   `ALTER TABLE "Company"` na `20260814120000_add_nfse_emissao_fase1` e na
--   `20260816120000_add_codigos_servico_nacional`. Nenhuma FK é criada aqui — o P3009 que derrubou
--   a produção (`REFERENCES "portal_clients"`) não tem como acontecer nesta migration.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- ⚠⚠ O `schema.prisma` FOI EDITADO JUNTO — e por que AQUI isso é o oposto da decisão da `Guide`
-- ─────────────────────────────────────────────────────────────────────────────────────────────
--
-- O precedente imediatamente anterior (`20260818200000_add_linha_digitavel_guia`) decidiu **não**
-- editar o `schema.prisma`, porque a `"Guide"` é lida sem `select` em várias rotas e um campo no
-- model que não existe no banco derrubaria toda consulta de guia até a migration ser aplicada.
--
-- A `"Company"` é lida sem `select` em MAIS lugares ainda (`NfseService.issue:1243`,
-- `NfseService.emitirEvento:1023`, `AdnSyncService:173`, `resolverCompanyLegacy` em
-- `routes/firm/index.js:535`) — o mesmo risco, e maior. **Mesmo assim o schema vai junto, porque
-- aqui não existe meio-termo:**
--
--   • a leitura da empresa no portal do contador passa por `legacyCompanySelect`, que é um `select`
--     EXPLÍCITO. Um `select` que nomeia campo inexistente no model é erro do Prisma na hora, não
--     um campo que "volta vazio";
--   • a escrita passa por `tx.company.update({ data: { … } })`, com a mesma exigência;
--   • ou seja: sem o campo no model, o cadastro que este pedido cria **não funciona de jeito
--     nenhum** — não há a variante "código pronto esperando a migration" que a `Guide` teve.
--
-- É a mesma escolha da `20260816120000_add_codigos_servico_nacional`, na MESMA tabela e na MESMA
-- funcionalidade (emissão de NFS-e), que também editou os dois de uma vez.
--
-- ⚠ CONSEQUÊNCIA, EM UMA LINHA: **esta migration tem de ser aplicada ANTES de este código subir.**
-- Se o código for para produção sem ela, o Prisma responde P2022 ("column does not exist") em toda
-- leitura de empresa — e isso é a carteira inteira, não só a emissão.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- POR QUE TRÊS COLUNAS, E NÃO UMA
-- ─────────────────────────────────────────────────────────────────────────────────────────────
--
-- Porque o XML tem três, e elas são independentes. A NFS-e real versionada em
-- `docs/leiaute-nfse/nfse-nacional-substituicao.xml` (empresa com `opSimpNac=1`, não optante)
-- declara, dentro de `infDPS/valores/trib`:
--
--     <totTrib><pTotTrib>
--       <pTotTribFed>11.33</pTotTribFed>
--       <pTotTribEst>0.00</pTotTribEst>
--       <pTotTribMun>0.00</pTotTribMun>
--     </pTotTrib></totTrib>
--
-- ⚠ E é ela que prova o ponto que decide o desenho: **`0.00` DECLARADO é legítimo** (serviço não
-- tem ICMS; o estadual é zero de verdade). Logo, zero não pode ser o que o sistema escreve quando
-- ninguém informou nada — senão "declarei zero" e "esqueci de informar" viram o mesmo XML. A
-- diferença tem de estar NO DADO, e é por isso que estas colunas são NULLABLE e que a emissão
-- exige as TRÊS preenchidas: NULL = não configurado (recusa com motivo), 0.00 = o contador
-- afirmou zero.
--
-- ⚠ `pTotTribMun` **NÃO é a alíquota de ISS** do município, e a mesma amostra prova: nela o ISS
-- aplicado é `pAliqAplic = 5.00` (em `infNFSe/valores`) enquanto `pTotTribMun = 0.00`. Números
-- diferentes, no mesmo documento, para a mesma nota. Um é o que o município cobra; o outro é a
-- parcela municipal da carga aproximada da Lei 12.741. Podem coincidir e não são a mesma coisa.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- POR QUE `DECIMAL(5,2)`
-- ─────────────────────────────────────────────────────────────────────────────────────────────
--
-- É PERCENTUAL, com duas casas — a forma que o XML leva (`.toFixed(2)`). `DECIMAL` e não `DOUBLE`
-- porque o valor é declarado, conferido e impresso: ponto flutuante transformaria 11.33 digitado
-- em 11.329999999999998 na comparação. `(5,2)` comporta 0.00–999.99, e o CHECK abaixo fecha em
-- 0–100. A tabela já usa `Decimal` com essa intenção (`capitalSocial Decimal @db.Decimal(18,2)`).
--
-- ADITIVA, NULLABLE, SEM BACKFILL E SEM DEFAULT. `DEFAULT 0` seria exatamente o defeito que este
-- pedido conserta: toda empresa da carteira nasceria afirmando carga tributária zero.

ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "pTotTribFed" DECIMAL(5,2);
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "pTotTribEst" DECIMAL(5,2);
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "pTotTribMun" DECIMAL(5,2);

-- Guarda no BANCO, não só no código: é percentual. Fora de 0–100 não é "um número grande", é outra
-- unidade — tipicamente o valor em reais no lugar da alíquota. É a mesma checagem que
-- `validateNfsePayload` já faz no payload da emissão, e o mesmo motivo pelo qual
-- `"codigoMunicipioIbge"` ganhou `chk_company_codigo_municipio_ibge` na `20260814120000`.
--
-- ⚠ Sem subquery e sem função STABLE: são comparações escalares simples. A migration que FALHA é o
-- pior desfecho possível aqui (P3009 recusa todas as seguintes e o servidor não sobe, porque o
-- start é `prisma:generate && migrate:deploy && node server.js`).
ALTER TABLE "Company" DROP CONSTRAINT IF EXISTS "chk_company_p_tot_trib_fed";
ALTER TABLE "Company" ADD CONSTRAINT "chk_company_p_tot_trib_fed"
  CHECK ("pTotTribFed" IS NULL OR ("pTotTribFed" >= 0 AND "pTotTribFed" <= 100));

ALTER TABLE "Company" DROP CONSTRAINT IF EXISTS "chk_company_p_tot_trib_est";
ALTER TABLE "Company" ADD CONSTRAINT "chk_company_p_tot_trib_est"
  CHECK ("pTotTribEst" IS NULL OR ("pTotTribEst" >= 0 AND "pTotTribEst" <= 100));

ALTER TABLE "Company" DROP CONSTRAINT IF EXISTS "chk_company_p_tot_trib_mun";
ALTER TABLE "Company" ADD CONSTRAINT "chk_company_p_tot_trib_mun"
  CHECK ("pTotTribMun" IS NULL OR ("pTotTribMun" >= 0 AND "pTotTribMun" <= 100));
