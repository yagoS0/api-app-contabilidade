# NFS-e mensais recorrentes

Implementação de desenvolvimento em 06/10/2026, na branch `codex/adequacao-nfse-rtc`. Nenhuma implantação ou ativação de produção foi realizada.

## Uso

No escritório, preencha a nota e avance até **Conferir**. Marque **Emitir esta nota automaticamente todos os meses**, escolha o dia mensal e a primeira emissão e clique em **Conferir e autorizar recorrência**. A confirmação mostra tomador, documento, valor, descrição e início. O formulário do portal do cliente tem a mesma opção, sujeita às permissões de emissão já existentes.

Salvar agenda a emissão; não emite uma nota avulsa naquele clique. O botão **Emitir nota** continua sendo emissão avulsa independente. A lista **Notas recorrentes** mostra próxima data, ambiente, últimas 12 execuções, pausas e problemas. Permite pausar e retomar, informando nova primeira data. Para alterar tomador, descrição ou valor, pause a configuração antiga e crie outra com os dados corrigidos.

O portal mock demonstra cadastro e gestão em memória, sem transmissão. A tela informa quando a execução automática está desligada. Recarregar o mock perde os agendamentos de demonstração; a API real persiste no PostgreSQL.

## Calendário e dados fiscais

- Dia de 1 a 31. Quando o dia não existe no mês, usa o último dia, preservando o dia original nos meses seguintes (31/01 → 28/02 → 31/03).
- Calendário `America/Sao_Paulo`, independente do fuso do processo. O worker verifica a cada minuto; não há promessa de horário exato. Se a primeira data for hoje, a agenda pode executar na próxima verificação quando o worker estiver habilitado.
- A competência é a data programada daquele mês. Tomador, valor, descrição e demais dados do formulário permanecem iguais. Identificadores, número de DPS, chave e `retryInvoiceId` da origem não são armazenados no modelo.
- Cadastro fiscal e perfil são consultados pelo emissor normal em cada tentativa; não se congela o cadastro tributário inteiro nem se copia certificado. Todos os bloqueios fiscais existentes permanecem aplicados.
- Se o servidor voltar ainda no mesmo mês, pode executar a data vencida daquele mês. Competências de meses anteriores pausam para revisão: não existe emissão automática acumulada de meses atrasados.

## Persistência e execução

Migration `20261006090000_nfse_recorrente`, aplicada apenas em `127.0.0.1:5433/contabilidade_dev` nesta entrega.

`NfseRecorrencia` guarda empresa legada, usuário autorizador, ambiente, dia, próxima data, estado, versão e modelo. `NfseRecorrenciaExecucao` guarda competência, data prevista, resultado, modelo da tentativa e vínculo ao `ServiceInvoice`. A unicidade `(recorrenciaId, competencia)` e a reserva transacional por versão impedem dois workers de executar o mesmo mês. A solicitação de criação usa UUID idempotente para um duplo clique/repetição de rede não cadastrar duas agendas.

Antes de cada emissão são relidas as permissões atuais do usuário e da empresa. Antes do POST fiscal, o emissor chama `antesDeEnviar`: revalida autorização/pausa e persiste o ID da nota na execução. Pausar não desfaz uma transmissão já iniciada.

Somente resultado `issued` conclui como **Emitida**. Rejeição, timeout, exceção ou resposta pendente pausam a agenda para revisão. Não há retry automático. Retomar só permite uma competência posterior à última tentativa; consultar e eventualmente corrigir a nota anterior usa o fluxo já existente do emissor.

Se o processo cair entre a reserva e a conclusão, a execução permanece **EXECUTANDO** e bloqueia as próximas tentativas. A tela informa “em andamento ou interrompida”. Quando houve transmissão, o vínculo gravado antes do POST permite localizar a DPS em `ServiceInvoice`. A reconciliação administrativa de execução interrompida ainda exige inspeção do registro e do resultado fiscal; não há botão que apague a reserva ou reenfileire a mesma competência. Nunca remover a reserva para tentar novamente sem essa conferência.

## API e operação

Rotas autenticadas, sem fallback por API key, sob `/nfse/recorrencias`:

- `GET ?companyId=...`: lista agendas e últimas execuções.
- `POST`: `companyId`, `requestId` UUID v4, `dia`, `inicio` (`AAAA-MM-DD`), `modelo`, `confirmada: true`.
- `POST /:id/pausar`: `companyId`.
- `POST /:id/retomar`: `companyId`, `inicio`, `confirmada: true`.

Todas resolvem `PortalClient` → `Company`, verificam acesso à empresa e o portão de emissão. Operações de pausa/retomada filtram simultaneamente agenda e empresa.

Publicação em main/produção autorizada pelo usuário em 06/10/2026. Sem override, a API disponibiliza o worker apenas com `NODE_ENV=production` e `NFSE_ENV=producao`. Desenvolvimento e homologação permanecem desligados; nesses ambientes, um ensaio controlado pode usar `NFSE_RECORRENCIA_WORKER_ENABLED=1`. O override `0` interrompe o worker em qualquer ambiente. Cada agenda continua exigindo confirmação individual na tela, usuário atualmente autorizado e validação do emissor. O deploy não cria agendas nem notas de teste em produção.

A agenda fica vinculada ao `NFSE_ENV` em que foi autorizada; mudar o ambiente exige revisão e nova autorização pela retomada. Certificado e endpoint são os mesmos do emissor existente. A conferência local não equivale a homologação fiscal externa.

## Verificação

Testes de calendário, serviço, rotas e interface cobrem dias inválidos, ano bissexto, virada de ano, competência, dados fixos, dupla solicitação, reserva anterior ao envio, disputa de workers, autorização revogada, isolamento por empresa, pausa e resultados incertos.

Teste de integração reproduzível, da raiz do repositório: `node scripts/testar-recorrencia-local.mjs`. O script exige o banco local acima e `NFSE_ENV=homolog`; injeta emissor sintético, disputa 12 workers, verifica o mês seguinte e timeout, e remove somente seus próprios registros de teste. Não chama o provedor fiscal.

Não houve transmissão fiscal nem validação externa em homologação nesta implementação. O teste local valida agendamento e integração interna; não substitui o ensaio com o ambiente nacional antes da ativação operacional.
