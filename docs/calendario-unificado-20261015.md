# Calendário de tarefas por empresa

O calendário principal deixa de gerar cartões a partir de obrigações, guias, marcos e fluxo automático. Uma tarefa possui título, descrição, janela, horário, prioridade, repetição, vencimento opcional, empresas explicitamente selecionadas e subtarefas. Cada ocorrência tem progresso próprio; suas aparições nos dias de trabalho e de vencimento compartilham a mesma identidade.

## Interface

O editor de criação e edição mede 440 px no desktop, adaptado ao celular. Horário e data precedem título e descrição; empresas e subtarefas ficam no rodapé. Um clique no pequeno calendário seleciona um único dia; o segundo, opcional, estende o período. O seletor navega entre meses e funciona por teclado. Horário aceita sem hora, às ou até. Repetição pode terminar em uma data ou após N ocorrências.

Vencimento mensal mantém o dia nominal: 31 vira 28/29 em fevereiro, 30 nos meses curtos e volta a 31 nos demais. Os avisos na véspera e no dia do prazo ficam vermelhos apenas enquanto houver pendências. Uma tarefa já presente nesse dia recebe destaque sem outro cartão duplicado. A lista mostra atraso sem replicar cartões indefinidamente nos dias seguintes.

O painel lateral mostra checklist e andamento por empresa; concluir todas as subtarefas risca o nome. Reabrir reabre o andamento. Tarefas sem empresas são pessoais; também podem conter checklist. Erros de gravação preservam o formulário ou revertem somente o checkbox que falhou.

## Contrato

- `GET /firm/agenda/unificada?inicio=AAAA-MM-DD&fim=AAAA-MM-DD&companyId=...`
- `POST /firm/agenda/unificada`: `{ titulo, descricao, config, empresasIds, subtarefas }`
- `POST /firm/agenda/unificada/:id/acao`: `{ acao, cicloChave, companyId?, subtarefaId?, concluida?, alteracoes? }`

`config` contém `dataInicio`, `dataFim`, `recorrencia`, `horarioModo`, `horaInicio`, `horaLimite`, `prioridade`, `repetirAte`, `repetirQuantidade`, `diaVencimento` e `dataVencimento`. Subtarefas têm `{id,titulo}` estáveis. As ações são `CONCLUIR`, `REABRIR`, `SUBTAREFA`, `EDITAR`, `EDITAR_SERIE`, `EXCLUIR` e `EXCLUIR_SERIE`. `EDITAR_SERIE` vale desta ocorrência em diante, conservando snapshots de trabalho já tocado. Exclusões preservam tombstones/histórico.

O domínio é compartilhado por API e demonstração em `packages/shared/src/tarefasCalendario.js`. A API valida proprietário/carteira completa, inclusive vínculos históricos, e serializa alterações com advisory lock transacional. Seleções não têm o antigo teto de 100 empresas.

## Transição e implantação

A migration `20261015120000_calendario_unificado` cria a entidade canônica e a tabela de snapshots. Arquiva por desativação as obrigações fiscais e suas regras; documentos fiscais, guias e ocorrências antigas não são apagados. Regras fiscais antigas não continuam gerando cartões. Tarefas pessoais de representação equivalente são copiadas com ID `legado:<id>`.

Tarefas manuais com histórico por dia, versões, exceções ou ajustes de dia útil permanecem preservadas em “Tarefas anteriores”. O adaptador exclui registros já migrados, obrigações fiscais e etapas automáticas; novas criações sempre abrem o editor novo. Não reinterpretar silenciosamente essas séries antigas nem perder suas conclusões.

Executar migration e gerar Prisma antes de iniciar a nova API. A interface e API precisam ser publicadas juntas. Não executar rollback apagando as tabelas novas com dados de usuários; os snapshots permitem recuperar as flags antigas com um procedimento controlado. Esta implementação local não executa mudanças em produção.

## Verificação

Testes de domínio/serviço cobrem data nominal 31, fevereiro bissexto, virada de ano, recorrência, empresas, checklist pessoal, permissões, edição com histórico e identidade dos alertas. Testes de React e integração cobrem o editor, seleção de intervalo, painel, falhas de gravação e calendário principal sem fontes fiscais.

`apps/web/scripts/verify-calendario-unificado.mjs` verifica o fluxo em navegador local no modo mock, com rede externa bloqueada, e registra capturas desktop/celular em `test-evidence/calendario-unificado`.

Validação local concluída: 166 testes distintos do calendário cobertos entre a execução completa e reexecuções dirigidas após correções; 48 testes da API/domínio e regressões; 26 cenários visuais em desktop/celular e quatro verificações adicionais de alinhamento nas visões dia/semana. O build de produção do frontend foi validado. A verificação de lint ficou limitada por incompatibilidade preexistente entre a configuração ESLint e a versão instalada.

`scripts/verify-calendario-migration.mjs` foi executado em PostgreSQL 16 descartável: confirmou migração e rollback transacionais, preservação de guias/pagamentos/histórico, quatro gravações simultâneas sem perda de progresso e vencimento 31 → 28 → 31. O cluster temporário foi desligado. Evidência local em `test-evidence/calendario-unificado/migration-results.log`; nenhum banco existente foi alterado.
