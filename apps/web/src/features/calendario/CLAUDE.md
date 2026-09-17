# Calendário — janelas e exclusões recorrentes (08/09/2026)

## Edição de recorrência da tarefa pessoal (17/09/2026)

- `acaoTarefaAgenda` aceita `EDITAR_SERIE` com `cicloChave` e `alteracoes` (dados do formulário). O alcance é esta e próximas; `EDITAR` continua individual. Versões ficam no JSON `TarefaAgenda.config.versoes`, com chave própria `vN|ciclo`. A configuração-base e o título-base ficam históricos; listas usam a última versão e o editor usa a configuração da ocorrência.
- O corte considera a data original e a data movida para não restaurar uma origem já arrastada. Conclusões, cancelamentos e exceções existentes recebem snapshots, incluindo cada dia de uma janela horária. Um snapshot substitui a geração nova na mesma data. Escritas seguem o lock transacional por tarefa e o proprietário autenticado.
- `converterTarefaEmObrigacao(id, { cicloChave, regra })` cria a regra para empresas autorizadas e corta as próximas ocorrências pessoais em uma única transação. Carteira vazia não converte. Se houver conclusão, cancelamento ou edição individual futura que não possa ser transportada para várias empresas, responde 409 e conserva tudo; escolher uma ocorrência após esse histórico permite converter. O mock segue o mesmo contrato. Não exige migration nova.

## Agenda semanal (10/09/2026)

As decisões abaixo substituem a interface anterior descrita neste arquivo. `renderCalendarioGrid.jsx` passa a exportar `CalendarioAgenda`: semana padrão, dia/mês e lista integrada, criação por data/horário e uma única camada de modal. A lista filtra tarefas/obrigações e concentra a exclusão da série. O calendário exclui somente a ocorrência selecionada, incluindo concluídas, conservando os registros de auditoria. Não oferecer exclusão futura pelo calendário.

- `ModalAtividade` tem dados de agenda e etapa fiscal opcional. Empresa só é escolhida no escopo de uma obrigação; tarefa geral pertence ao usuário. Dentro da empresa, a tarefa usa a `Obrigacao` do tipo TAREFA e conserva o vínculo.
- `agendaConfig` guarda período, horários, prioridade e recorrência. Cores indicam prioridade escolhida, sem mudança automática por atraso. Somente obrigações têm ícone. Horários aparecem à direita em semana/dia.
- `packages/shared/src/agenda.js` expande datas civis; frequências diária/semanal usam data como ciclo, mensal/trimestral/anual usam mês âncora. Regras antigas continuam usando `agendaVersoes` e `janelaTrabalho`.
- `TarefaAgenda` guarda séries sem empresa, privadas por `userId`; estados de ocorrência preservam conclusão, cancelamento e alteração individual. Edições concorrentes usam lock por série. Não recalcular a configuração integral de uma tarefa com histórico.
- Obrigações novas são criadas por grupo em transação. `sincronizarAgendaConfigurada` mantém janelas independentes do vencimento fiscal, tombstones, concluídas e janelas personalizadas. `OcorrenciaObrigacao.agendaConfig` guarda título/horários/prioridade individuais.
- As rotas `/firm/agenda` validam carteira/proprietário antes de gravar. Exclusão em lote é transacional, bloqueia séries em ordem estável e não apaga registros. Ocultar guia no calendário cria máscara por usuário; nunca remove o documento financeiro.
- Migration aditiva `20260910210000_agenda_workspace`; executar migrations e gerar Prisma antes de iniciar a API. O ensaio PostgreSQL existente também cobre a nova criação por grupo e tarefas concorrentes. Preview local usa somente dados fictícios.

### Histórico anterior

- `CalendarioGrid` abre `CalendarioObrigacoesModal` internamente; não navega mais à central para criar/editar. `initialContext.obrigacoesModal` permite recuperar links antigos: `{ companyId, dataInicio, dataFim, criar, ocorrenciaId }`.
- Formulário, exclusão e regras substituem o modal da lista; não empilhar traps de foco. O estado do calendário continua montado, e `onChanged` recarrega os dados.
- Ao criar uma janela fora do período de origem, ampliar a lista após salvar; não mostrar cards vazios. A lista começa com até três ocorrências por série e permite expandir.
- Mensal do dia 10 ao 15: `janelaTrabalho: { modo: "DIAS_DO_CICLO", diaInicio: 10, diaFim: 15, deslocamentoFim: 0 }`. Datas inclusivas, corridas; dias inexistentes usam último dia do mês. Deslocamento do fim 1 significa mês seguinte explicitamente.
- Prazo fiscal e janela de trabalho são independentes. `diasPreparacao` continua sendo o modo legado relativo ao vencimento.
- Etapa 2: `updateOcorrencia(id, { alcance: "ESTA_E_PROXIMAS", janelaTrabalho, regra })` versiona janela e configuração da recorrência. `regra` contém periodicidade MENSAL/TRIMESTRAL/ANUAL, mesReferencia, diaVencimento, ajusteDiaUtil, defasagemMeses e diasPreparacao. Snapshot completo normalizado no servidor; base da série não é reescrita. `janelaTrabalho: null` seleciona preparação relativa ao vencimento. Datas individuais continuam pelo PATCH legado.
- `excluirOcorrencia(id, { alcance: "ESTA" | "ESTA_E_PROXIMAS" })` chama DELETE na ocorrência. Backend conserva concluídas e tombstones; calendário/lista/lembretes/verificadores devem ignorar `canceladaEm`.
- Backend: versões append-only de janela e regra em `Obrigacao.agendaVersoes`, com mês âncora `aPartirDe`, autor e data. A última edição aplicável vence, inclusive se houver versão futura mais antiga. Corte `encerradaAPartirDe` impede criar meses ainda não materializados.
- `cicloChave` é mês âncora antes do dia útil/defasagem; legados sem chave são reconhecidos pela competência + defasagem. Ocorrências concluídas/personalizadas antigas não são recalculadas. Não apagar registros antigos para atribuir identidade.
- Worker e edições de agenda usam advisory lock transacional por série. Alterar exclusão sem seguir o mesmo protocolo pode ressuscitar uma ocorrência.
- Migração `20260908190000_calendar_series_exceptions` é aditiva. Schema validado sem banco e testes locais não substituem ensaio PostgreSQL antes de publicação. Não executar geração Prisma sobre node_modules compartilhado durante trabalho paralelo.

Validação desta frente: 72 testes API em seis suites; 143 testes de obrigações web em 11 suites; 24 testes direcionados de modal, grade e mock em três suites (contagens sobrepostas). Nenhuma publicação/banco real alterado.

## Etapa 2 — frequência e prazo versionados (08/09/2026)

- A última regra aplicável por ordem de edição vence. Versões anteriores que tinham somente janela continuam compatíveis; sua frequência vem da regra-base ou do último snapshot de regra aplicável.
- `foraDaRecorrencia` identifica uma pendente que saiu da frequência. Não equivale a cancelamento. Nova versão pode reativar o mesmo ID; nunca reativa `canceladaEm`, nem muda concluídas/personalizadas. Listas/calendário/verificadores ignoram retiradas. Corte de exclusão futura continua durável.
- Aplicar migration aditiva `20260908210000_calendar_frequency_versions` e gerar Prisma antes da API. Não usa remoção de linhas nem altera linhas antigas na migração.
- O mês âncora da ocorrência determina o início da edição, inclusive quando ajuste de dia útil move o prazo para outro mês. A API de listagem expõe `cicloChave` para não inferir a identidade pela nova defasagem.
- O mês escolhido pode deixar de fazer parte da frequência nova. O formulário explica que a ocorrência sairá da agenda. O calendário apresenta as datas resultantes; prévia do formulário considera fins de semana e identifica feriados como responsabilidade do servidor.
- Limites deliberados: não converte recorrente em avulsa; não muda conclusão automática, nome, categoria ou descrição nesse alcance. Conflito com data fiscal de outra ocorrência preservada retorna 409 e desfaz a transação. A geração continua limitada a até 12 novas previsões em horizonte de 24 meses; ocorrências já materializadas posteriores também recebem a regra aplicável. Não existe editor visual da linha do tempo de versões.
- Verificação local: 79 testes de obrigações API e 153 testes web de obrigações/mock passaram. Ensaio PostgreSQL `apps/api/scripts/verify-calendar-series-postgres.js` ampliado com troca mensal/trimestral/mensal concorrente, prazo e preservação de IDs/exceções; execução de banco fica para o gate CI. Nenhum banco ou provedor real foi acessado nesta etapa.

- Inativar é pausa reversível: sincronização retorna sem apagar ocorrências. Reativação conserva IDs, cancelamentos, retiradas por frequência e janelas individuais. Calendário, listagem padrão e verificador filtram série ativa. Regressão local API: 80 testes passaram; ensaio PostgreSQL também cobre pausa/reativação e ausência no calendário.

## Controles e cartões do calendário — 17/09/2026
Tipo e Recorrência ficam visíveis também na edição. Alteração individual de data/horário segue EDITAR; mudança da frequência pessoal usa EDITAR_SERIE (esta e próximas), sem reescrever configuração histórica. SEMESTRAL percorre seis meses com datas civis e limite de repetição, inclusive em obrigações. Tarefa vinculada a uma empresa conserva esse escopo ao virar obrigação; o formulário não promete expandir para outras empresas.

AtividadeAgenda separa abertura/gestos e checkbox. Tarefa individual conclui ou reabre sem abrir modal; obrigação mostra vazio/parcial/concluído e abre o acompanhamento por empresa. Não concluir todas em lote pelo checkbox. Bloqueio local evita cliques duplicados. Cartões simultâneos consideram altura visual mínima e aproveitam colunas livres; título e progresso não reservam coluna vazia. Foco não desloca o cartão de horário.

Validação desta etapa: 212 testes API/obrigações e 113 web/mock; build aprovado; navegador em demonstração confirmou checkbox, edição e repetição semanal. Sem publicação nesta etapa; transações reais continuam sujeitas ao gate PostgreSQL antes de produção.

## Escala e horário atual — 17/09/2026 (dev)

`lib/escalaAgenda.js` centraliza 96 pixels por hora, seis horas visíveis e rolagem inicial às 8h. Posições, colisões, prévia e CSS usam essa escala; os gestos medem a célula real. As 24 horas continuam disponíveis por rolagem. A largura da régua (56/40px) é independente da escala vertical.

`LinhaHorarioAtual` usa o fuso America/Sao_Paulo e atualiza no próximo minuto e ao retornar à janela, sem reposicionar a rolagem. Só aparece na grade de horários quando o período contém hoje; o destaque percorre a coluna de hoje. Não intercepta eventos de ponteiro nem anuncia cada minuto em aria-live. Títulos e horário secundário dos cartões com hora ficam maiores; o mês mantém apresentação compacta sem horário secundário.

O ponteiro do arraste deve ser capturado no botão de origem quando o evento parte do título/ícone. Capturar no contêiner externo retargeta o clique e impede abrir as empresas da obrigação no navegador, mesmo com fireEvent.click passando em JSDOM. A regressão `useGestosAgendaClique` cobre esse destino e a supressão de clique após arraste.
