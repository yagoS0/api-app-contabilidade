-- O PORTÃO DA EMISSÃO PELO CLIENTE — o contador liga, empresa por empresa.
--
-- Decisão do dono (18/08/2026): *"o acesso a emissão deve ser liberado para o cliente pelo portal
-- do contador"*. Hoje `POST /nfse/issue` e `POST /nfse/:chave/eventos` autorizam por
-- `ensureLegacyCompanyAccess`, que é checagem de **VÍNCULO**, não de permissão: qualquer membro
-- ATIVO do lado do cliente — inclusive o papel de menor peso — alcança os dois atos fiscais.
--
-- ⚠ E ISSO NÃO É TEÓRICO. Medido em produção em 18/08/2026: `NFSE_BASE_URL` aponta para
-- `https://sefin.nfse.gov.br/SefinNacional`, `NFSE_ENV=producao`, e há **1 `ServiceInvoice`
-- `issued` com chave** (série 00001 nº 1, de 17/08/2026). O caminho está LIGADO e apontado para o
-- sistema nacional de PRODUÇÃO.
--
-- ⚠ NÃO APLICADA. Escrita e parada; `prisma migrate deploy` é ato do dono.
--
-- ⚠ NENHUMA FK É CRIADA AQUI — logo o risco que já derrubou a produção não existe nesta migration.
-- Ainda assim, para quem for editá-la: nome de tabela se confere no que JÁ EXISTE nas migrations,
-- com `grep -rhoE 'REFERENCES "[A-Za-z_]+"' apps/api/prisma/migrations/ | sort -u`, NUNCA no
-- `schema.prisma`, que fala em nomes de MODEL. Foi `REFERENCES "portal_clients"` — quando a tabela
-- é `"PortalClient"` — que fez o Prisma marcar a migration como falha, recusar todas as seguintes
-- com P3009 e impedir o servidor de subir.
-- Conferido para ESTA migration: `PortalClient` **não tem `@@map`**, e o nome `"PortalClient"`
-- (capitalizado, entre aspas) aparece em migrations já aplicadas tanto como alvo de `ALTER TABLE`
-- (`20260405180000_portal_guide_notification_email`, `20260406120000_portal_client_has_prolabore`,
-- `20260602121300_add_portal_client_status`) quanto como destino de FK
-- (`REFERENCES "PortalClient"("id")`, em 20+ migrations). É esse nome que vai abaixo.

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 1) A CHAVE DA EMPRESA — ADITIVA, E NASCE FECHADA
-- ─────────────────────────────────────────────────────────────────────────────────────────────
--
-- ⚠ `DEFAULT false` é a parte que protege o passado. Toda empresa já cadastrada acorda com a
-- emissão pelo cliente FECHADA no instante em que esta migration roda — ninguém ganha um poder
-- fiscal por efeito colateral de deploy. Ato fiscal não se libera por omissão.
--
-- `NOT NULL` porque nulo e `false` significariam a mesma coisa aqui ("este cliente não emite"), e
-- um booleano não-nulo dispensa a checagem de nulo em todo leitor — a mesma forma de
-- `"hasProlabore"`, `"temFolha"` e `"empresaZerada"`, que já vivem nesta tabela.
ALTER TABLE "PortalClient"
  ADD COLUMN "emissaoClienteLiberada" BOOLEAN NOT NULL DEFAULT false;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 2) QUEM LIBEROU, E QUANDO
-- ─────────────────────────────────────────────────────────────────────────────────────────────
--
-- Sem estas duas colunas, "quem autorizou este cliente a emitir nota em nome da empresa?" não tem
-- resposta — e essa é exatamente a pergunta que se faz depois de uma nota indevida.
--
-- ⚠ `"emissaoClienteLiberadaPor"` guarda o **userId**, TEXT solto, sem FK — o mesmo padrão de
-- `"company_monthly_circulars"."fechadoContabilPor"` e de `Guide."liberadaPor"`. FK para `"User"`
-- faria a exclusão de um usuário do escritório esbarrar no rastro de auditoria que o rastro existe
-- para preservar. O nome legível é resolvido na leitura (`user.findMany` em lote), não copiado
-- aqui: nome copiado envelhece.
--
-- ⚠ AMBAS NULÁVEIS, e desligar volta as duas a NULO (ver `PATCH .../emissao-cliente`). Elas
-- respondem "quem autorizou", não "quem mexeu por último": guardar nelas o instante do
-- DESLIGAMENTO daria dois significados a uma coluna só, que é o erro documentado em "TRÊS NÚMEROS
-- DE DAS, TRÊS COLUNAS". Quem desligou fica no log da aplicação.
ALTER TABLE "PortalClient"
  ADD COLUMN "emissaoClienteLiberadaEm" TIMESTAMP(3),
  ADD COLUMN "emissaoClienteLiberadaPor" TEXT;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 3) NENHUM BACKFILL — de propósito
-- ─────────────────────────────────────────────────────────────────────────────────────────────
--
-- Não há UPDATE aqui, e a ausência é a decisão: qualquer backfill teria de eleger empresas para
-- nascer LIBERADAS, e não existe dado no banco que prove que o contador quis liberar alguma. A
-- única fonte dessa autorização é o clique dele na tela — que é o que a coluna registra.
--
-- Não há CHECK: um `BOOLEAN NOT NULL` já não admite valor fora do domínio, e as duas colunas de
-- auditoria são livres por natureza (userId e timestamp).
