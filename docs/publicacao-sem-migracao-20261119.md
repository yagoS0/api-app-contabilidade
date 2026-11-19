# Publicação da API sem migração automática

Base: `b762c467137cb6cc1b29d816074d662dcdd87c1f`. Este incremento separa execução de schema e inicialização; não autoriza publicação nem consulta produtiva. IDs Railway informados (`0ce578b6-c050-4721-9a6f-8bad99114728` API; `f892294c-2e89-478a-b555-3a353be70b8d` frontend) não são SHAs e precisam ser associados aos serviços/deployments no preflight.

## Contrato de execução

- Boot da imagem: `npm run start:prod -w @contabilidade/api`. Gera o cliente Prisma e inicia `src/server.js`, sem executar DDL.
- Migração explícita já existente: `npm run prisma:migrate:deploy -w @contabilidade/api`. Somente em etapa supervisionada, com autorização específica, alvo e SHA fixados; nunca como prestart, restart ou pre-deploy automático.
- Dockerfile e Railway continuam com o comando e healthcheck existentes. Não houve alteração do dashboard, Auto Deploy ou ambiente.
- O boot legado ainda executa seeds/backfill e inicia workers. Esta correção **não torna o boot somente leitura**. Não iniciar a API apontando ao banco produtivo para testar.
- `/healthz` comprova liveness; `/readyz` consulta conectividade e PDF reader. Nenhum comprova que tabelas, triggers ou migrations FS12 estão corretas.

## Compatibilidade FS12

| Migração versionada | Dependências do runtime |
| --- | --- |
| `20261116000000_add_apuracao_fs12_revisoes` | `ApuracaoFs12Revisao`, confirmação manual e histórico |
| `20261117000000_add_apuracao_fs12_calculos` | `ApuracaoFs12Calculo` e `ApuracaoFs12CalculoFato`, vínculo imutável e fatos |

Os adaptadores pressupõem essas tabelas. SQL inclui checks/triggers que `db push` não substitui. Ausência pode permitir healthcheck verde e falhar nas operações FS12. Nenhum schema/migration foi alterado. O status produtivo continua desconhecido; não chamar migrações de aplicadas ou pendentes por inferência. O futuro coordenador do PR302 está fora deste release. Guardas dos PAs11/12/2026 e2027, Fator R, payload e recuperação documental permanecem intactos.

## Consulta produtiva somente leitura — preparada, NÃO executada

1. Após acesso e autorização, identificar projeto/ambiente/banco e SHAs reais publicados; confirmar Auto Deploy desativado. Comparar todas as migrations do release com a versão implantada, não apenas FS12.
2. Em sessão privada e isolada, carregar a conexão por mecanismo de segredos, usando papel com CONNECT/USAGE e SELECT na tabela `_prisma_migrations`, sem DDL ou escrita. Não usar start:prod, não colar URL em argumentos/logs e não publicar valores de variáveis.
3. No checkout do SHA aprovado, executar exclusivamente `npm run prisma:migrate:status -w @contabilidade/api`. Preservar retorno e saída sanitizada (host/URL removidos). Saída não zero pode indicar pendência, falha ou divergência; investigar antes de autorizar migração. Se houver recusa de permissão, não ampliar acesso automaticamente.
4. Complementar, quando autorizado, por SELECT de `migration_name`, `checksum`, `started_at`, `finished_at`, `rolled_back_at`, `applied_steps_count` em `_prisma_migrations`, sem a coluna logs, comparando checksums SHA256 dos arquivos versionados. Não executar `resolve`, `deploy`, `reset`, `db push`, seeds ou reparos nesta consulta. Status não prova ausência de drift manual; divergência exige avaliação separada.

## Backup, publicação e rollback

1. **Backup antes de autorizar migração/deploy:** snapshot/dump consistente do banco alvo, documentos/storage e configuração necessária à recuperação, cifrados e em custódia privada; manifestos e hashes, retenção e recuperação de chaves verificadas. Testar restauração em banco isolado compatível. O backup de materiais locais não substitui backup produtivo. Sem cópias ou transferências nesta entrega.
2. **Preflight:** CI do SHA definitivo, revisão humana, status/schema compatíveis, imagem anterior/digest e comandos registrados, healthchecks, volumes, variáveis e workers/rotinas efetivamente ativos inventariados. Não presumir automações desligadas por Auto Deploy estar desligado. Sem ampliar flags/autorizações. Resultado incerto não permite replay.
3. **Migração, se necessária:** autorização própria para lista exata, backup comprovado e janela; executor único usa o comando explícito. Conferir status após execução. Em falha, interromper; não fazer retry cego, reset ou mascarar histórico.
4. **Publicação:** autorização separada para API/frontend e SHA/digest; publicar API compatível antes da interface, manter Auto Deploy desligado. Smoke sem efeito fiscal: healthcheck, login/ACL e GET local, isolamento de empresa, apresentação de declaração localizada/origem e estado incerto. Recuperação DAS/extrato é validada antes em transporte falso; consulta real é paga e exige autorização própria, procuração e controle de custo. Nenhuma transmissão como smoke.
5. **Rollback:** retornar apenas à imagem previamente comprovada compatível com o schema atual e sem migração no boot. Imagem antiga com `start:prod` acoplado não é rollback seguro sem preparar/revisar um comando separado. Preservar auditorias, documentos, revisões e reservas; não remover tabelas nem restaurar dump sobre produção automaticamente. Falha de dados exige decisão específica de recuperação, considerando escritas posteriores.

## Evidências e limites

O teste `apps/api/scripts/start-prod-sem-migracao.test.mjs` verifica scripts/lifecycle e o contrato Docker/Railway. Na CI, `ALTAN_TEST_DOCKER=1` exige construir o Dockerfile real, iniciar/reiniciar a imagem com `--network none` e banco inexistente, obter `200 ok` em `/healthz`. Assim o boot não pode depender de `migrate deploy`; nenhuma conexão fiscal é possível. Docker ausente local é limitação explícita, não resultado aprovado.

FS12 é validada em PostgreSQL16 descartável com as migrations versionadas e testes B31/B32, vínculo, concorrência, rollback e bloqueios de transporte. Resultados finais e SHA ficam no PR e no registro de governança. Não homologam SERPRO real.

Controlador `2026-11-19T18-13-48-835Z-84d1ab9e`: planejamento concluído, `escalated` por alteração de configuração/governança. Principal conduz este incremento autorizado e submete o diff a revisões independentes; sem declarar `ready_for_human`.

Impacto operacional: separação explícita da implantação de schema, sem mudança de regra fiscal/contábil, contratos HTTP ou autorizações. Preserva R01/R02/R19/R20 e seções36/37 da referência operacional. **GO técnico desta correção não significa GO para produção:** faltam evidências de ambiente, backup/restauração, status produtivo e autorizações de migração/publicação.
