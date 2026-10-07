# Calendário — janelas e exclusões recorrentes (08/09/2026)

## Antecipação para dias úteis — 29/09/2026 (desenvolvimento)

`agendaConfig.ajusteDiaUtil` / `TarefaAgenda.config.ajusteDiaUtil` aceita `MANTER` (padrão compatível) ou `ANTECIPAR`. O formulário recorrente oferece “Em dias não úteis”. A política da atividade é independente do ajuste de vencimento fiscal. Sábado/domingo e feriados cadastrados usam o helper compartilhado `diaUtil.js`; tarefas pessoais não herdam feriados municipais de empresas. Não inventar calendário de feriados.

Datas antecipadas conservam chaves e âncora nominal, inclusive ao cruzar mês/ano. `dataInicioOriginal`/`dataFimOriginal` permitem editar a série sem deslocar seu dia-base. Cada dia de uma janela com horário mantém identidade e conclusão próprias, mesmo quando vários dias convergem na sexta-feira. Datas explicitamente movidas são preservadas.

Ocorrências empresariais carregam `agendaConfig.diasAgendados` calculados no servidor. Agrupamento por regra considera esses dias para separar empresas com feriados municipais diferentes. Edição somente de horário/nome conserva metadados; mudança efetiva de datas os remove. Concluídas, canceladas e janelas personalizadas permanecem preservadas na sincronização.

Para tarefas empresariais com agenda configurada, `dataVencimento` no banco conserva o prazo nominal (restrição única existente). O prazo mostrado e a situação usam `dataFim` operacional. Movimentar essas tarefas altera a janela sem substituir a âncora interna, evitando conflito de tarefas diárias antecipadas para o mesmo dia. Obrigações mantêm vencimento fiscal independente. Sem migração nesta alteração.

Testes de motor, serviços, interface e mock; compilação e conferência no navegador com dados fictícios. Detalhes em `docs/calendario-dias-uteis-20260929.md`. Ainda não publicado.

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

## Tarefas vinculadas a empresas — 23/09/2026
Nova tarefa geral permite seleção opcional de empresas. Sem seleção continua privada. Vínculo cria uma Obrigacao TAREFA por empresa, transacionalmente, e exige ciência contextual de visibilidade à equipe autorizada; não é obrigação fiscal. A API valida todos os IDs antes da gravação. Cada empresa tem conclusão independente. Tarefa pessoal existente só pode ser substituída se não houver estados/versões/corte e a data inicial original for mantida. Caso contrário, oferecer criar nova tarefa empresarial e conservar histórico. Sem migration. Editor e agenda identificam empresa e permitem Abrir empresa sem concluir. Isso substitui a restrição anterior de seletor somente para obrigações.

Conversão de série pessoal recorrente com início passado é recusada mesmo sem estados: as pendências implícitas intermediárias não seriam materializadas pelo sincronizador empresarial. Criar nova tarefa empresarial preserva a pessoal. Avulsa antiga conserva seu intervalo completo.

## Tarefas agrupadas por empresa — 06/10/2026

Novos lotes de tarefas empresariais recebem um grupoTarefaId gerado no servidor, dentro de Obrigacao.agendaConfig. Calendário e lista agrupam esse lote, com detalhe e conclusão por empresa, seguindo o painel das obrigações. Criações distintas, mesmo com título igual, não se misturam. Datas/horários individuais continuam separando cartões, como nas obrigações. Edição do cartão agrupado altera as ocorrências do período; não oferece conclusão coletiva nem conversão/edição de série sobre apenas a primeira empresa. Exclusão da série por grupo é transacional e limitada à carteira visível. Sem migration; tarefas antigas sem identificador permanecem individuais, pois o lote original não pode ser inferido com segurança.

## Editor compacto — 06/10/2026
Clique simples usa a hora inteira da célula (8h → 8h–9h); arraste continua selecionando quartos de hora. ModalAtividade usa o mesmo Modal acessível, com fundo transparente, posição limitada à janela, título/descrição e seções expansíveis para data, duração, empresas e repetição. MiniCalendarioAgenda muda a data civil via editarJanela; preserva duração e fim da janela. O rascunho aparece na grade antes de salvar. Carteira em agenda usa a largura disponível e mede a altura restante da janela; a visão de empresas conserva o layout anterior. Não altera API ou dados existentes.

## Intervalo no calendário e rolagem — 06/10/2026
MiniCalendarioAgenda seleciona início e fim em dois cliques no mesmo calendário, destaca o intervalo e permite atravessar meses, inverter a ordem ou escolher um único dia. De/Até indicam a extremidade ativa e continuam editáveis por teclado, sem abrir um segundo calendário nativo. A digitação do início preserva a duração via editarJanela; a seleção visual define um novo intervalo. O resumo mostra ambas as datas.

useProtegerCamposDaRolagem, montado em App e Modal com contagem de usuários, retira o foco de inputs number/date/time/month/week/datetime-local antes do incremento nativo por wheel. Não cancela a rolagem do painel nem afeta campos de texto. Validação: 86 testes direcionados aprovados e build web concluído; seleção visual conferida em demonstração sem dados reais.


## Organização de obrigações — 06/10/2026
A lista permite pausar obrigações e consultar/retomar as pausadas pelo filtro existente. Pausar conserva IDs, vínculos e ocorrências; não cancela nem apaga conclusões. A propagação preserva sobrescritas locais. Modelos não reaparecem quando sua regra está pausada. Editar metadados de uma regra sem agendaConfig preserva o calendário fiscal legado quando nenhuma data, horário, repetição, prioridade ou ajuste da janela foi alterado.

## EFD/MIT e guia de ISS — 06/10/2026
EFD e MIT são executados juntos no Lucro Presumido: uma tarefa Enviar EFD e MIT usa a evidência de transmissão existente. Não oferecer uma segunda tarefa Concluir obrigações do período para esse regime, nem captura geral de guias. Obrigações fiscais específicas pendentes continuam participando do status; envio de guias continua acompanhando os documentos e recibos. Chaves/verificadores legados permanecem reconhecidos para preservar histórico. Modelos novos seguem a mesma organização, sem criar ISS ou prazos automaticamente.

No cadastro autorizado do escritório, a guia de ISS tem janela mensal de 1 a 5 e vencimento no dia 5. Alteração explícita de janela exige conferir ocorrências concluídas, que o sincronizador preserva. Ao adotar agendaConfig em séries legadas sem cicloChave, a reconciliação usa a mesma identidade mensal para atualizar e retirar ciclos, evitando ocultar uma ocorrência recém-atualizada.

## Alcance da exclusão — 06/10/2026

A confirmação oferece ESTA (padrão), ESTA_E_PROXIMAS e ESTA_E_ANTERIORES; ambos os intervalos incluem a ocorrência selecionada. O cliente envia o alcance ao servidor. Tarefas pessoais guardam cortes em config.exclusoes e conservam estados/conclusões. A âncora nominal (incluindo o dia @ da janela) determina a ordem mesmo com feriados ou movimentações. Obrigações usam encerradaAPartirDe e excluidaAteCiclo, respeitados pelos dois sincronizadores. Cancelamentos são lógicos. Em grupos, o alcance se aplica apenas às empresas selecionadas e autorizadas na mesma transação. Blocos empresariais de uma janela continuam representando uma única ocorrência, como na edição.
