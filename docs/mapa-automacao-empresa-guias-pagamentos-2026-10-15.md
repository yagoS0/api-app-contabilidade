# Mapa da automação por empresa e da jornada das guias

Data: 15/10/2026.

Complemento após revisão independente de três agentes: [Plano de implementação da Central de Operações](plano-executavel-central-operacoes-2026-10-15.md). Ele define rotas, telas, dados, consultas, erros, concorrência e entregas e prevalece sobre propostas preliminares deste mapa. Operações fica ao lado do Calendário apenas na navegação; sua rotina é independente e usa os status da tabela Empresas. Não reutilizar tarefas/obrigações do Calendário. Ativação de consultas fica exclusivamente dentro de cada empresa.

A Altan já possui serviços para conciliação do PGDAS-D, procurações, documentos, envio de guias, acompanhamento de pagamento e reservas contra repetição. A evolução deve conectar essas bases por uma política comum de execução, acrescentando revisão de documentos e distinção entre pagamento informado e confirmado. Não é necessário substituir as telas, o fechamento ou os serviços fiscais existentes.

Este mapa compara a especificação fornecida pelo usuário, “Altan — especificação de automação por empresa e jornada da guia até o pagamento”, com o código local. Base inspecionada: `4b2e1cc9`, comparada com `origin/main` em `4c39f3eb`; as diferenças encontradas nessa comparação são de lançamentos/exportação contábil e não implementam as lacunas descritas abaixo. É uma análise estática, não uma certificação do ambiente de produção. “Existente” significa localizado no código; a matriz de aceitação ainda precisa de execução isolada.

## Regras já acordadas que permanecem

- Mostrar **Apurado** quando houver comprovação da declaração, inclusive se transmitida por outro sistema. A origem permanece no histórico, sem alterar o fechamento interno.
- Uma guia manual isolada não comprova transmissão da declaração.
- Na conciliação automática do PGDAS-D, consultar somente empresas com procuração válida confirmada para o serviço. Ausência, vencimento ou necessidade de revalidação geram pendência visível.
- Verificar primeiro os documentos locais. Apuração comprovada com extrato/recibo e DAS disponíveis encerra a necessidade dessa busca documental. Não repetir consultas por abrir telas ou atualizar o painel.
- Buscar somente o documento faltante. Considerar DAS enviado manualmente quando válido e aplicável; tratar a dispensa de DAS nas declarações zeradas conforme a regra existente.
- Documentos completos não demonstram que nunca haverá retificação: uma futura conferência de retificação será uma operação distinta, com motivo, frequência e autorização próprios, sem rebaixar a rotina documental para consulta repetitiva.
- Manter separadas apuração, entrega documental, contabilização e fechamento. Não criar lançamentos ou fechar competência como efeito da conciliação documental.

## Mapa dos serviços e lacunas

Os caminhos abaixo são relativos à raiz do repositório. As propostas são aditivas; não representam funcionalidades já implantadas.

| Frente | O que existe e pode ser reaproveitado | Lacuna para a especificação | Evolução proposta |
| --- | --- | --- | --- |
| Seleção de rotinas por empresa | `CompanyRotinasService.js` e `CompanyRotina`: habilitação por empresa/rotina; ausência de registro não habilita automaticamente. Horários em `SerproRuntimeSettings`. | Não é uma política por competência e etapa com modos automático/manual/externo/não aplicável, revisão e origem efetiva. | Resolver política efetiva sobre a configuração existente, com exceções por competência e histórico. Preservar o significado atual de habilitado/desabilitado na migração. |
| Procurações | `SerproProcurationService.js`: consulta e armazenamento; reaproveitamento condicionado à identidade, escopo, vigência e idade do registro. `pgdasDocumentos.js` aplica a elegibilidade PGDAS-D. | Não constitui autorização universal para todos os conectores ou uma pausa geral de empresa. | Reutilizar o serviço; registrar motivo de bloqueio e validade por capacidade. Separar revalidar procuração de consultar documentos fiscais. |
| Conciliação PGDAS-D | `pgdasDocumentos.js`, `SerproPgdasDeclaracaoService.js` e `CaptureSerproGuidesService.js`: verificação local e caminho `somenteDocumentos`. | A lógica específica ainda não representa a jornada completa de qualquer tributo/guia. | Usá-la como primeiro adaptador da política comum, mantendo a busca apenas das lacunas. |
| Apuração feita em outro sistema | Projeção da carteira em `FluxoCarteiraService.js` e `packages/shared/src/accounting/fluxoCarteira.js`; evidência de transmissão separada do fechamento. | Modo externo configurável por empresa/competência para toda a jornada ainda precisa de contrato. | Manter o rótulo **Apurado**. Modo externo impede executar cálculo/transmissão internos, mas permite documentos validados e acompanhamento autorizado. |
| Pendências e painel | `alertasMonitoramento.js`, serviços da carteira e filtros documentais/procuração. | Explicar também política efetiva, pausa, resultado incerto, revisão da guia e conferência de pagamento. | Acrescentar motivos e próximos passos às projeções locais existentes, sem consultas fiscais no carregamento. |
| Histórico de declaração | `PgdasHistoricoService.js`: versões em `AppSetting`, números oficiais e evidências documentais. | Histórico de declaração não é histórico universal de revisões de guia. | Preservar o histórico PGDAS-D e vinculá-lo à futura identidade documental. |
| Guias e recálculo | `Guide`, ingestão existente, hash único e `RegistroRecalculoGuia.js`. O registro de recálculo guarda informação em `extracted.recalculoGuia`. | Não foi localizado um modelo geral de guia lógica com revisões imutáveis, substituições, complementares e vínculo de pagamento por revisão. O registro de recálculo atual não é uma cadeia completa de versões. | Introduzir revisões sem trocar IDs públicos ou retirar `Guide` dos consumidores atuais; guardar arquivo/hash, valor, vencimento, origem, validação e relação entre revisões. |
| Capacidade de recalcular | `lib/recalculoDaGuia.js` reconhece DAS e DARF do lucro presumido por origem; exclui parcelas. `RecalcularGuiaWhatsappService.js` encaminha casos sem suporte ao contador. | Falta catálogo unificado por tributo, ente, conector e operação; não há base para prometer recálculo automático genérico de ISS. | Reutilizar a lista restritiva e o encaminhamento manual; ampliar somente com capacidade comprovada. |
| Calendário | `calendarioAvisosGuia.js` calcula dias úteis antes/depois e preserva o PDF original. | O vencimento ajustado também é usado no texto e na escolha da data de pagamento. A nova especificação exige separar vencimento efetivo, prazo legal e momento do lembrete. | Guardar a proveniência das datas; mover a regra atual para política explícita de avisos. Não aplicar regra fiscal genérica a todos os documentos. |
| Envio de guias | `EnvioGuiaService.js`, `EnvioGuia`, `EnvioGuiaTentativa`: registro por guia/canal/destino, tentativas e estados do provedor. | Identidade da intenção ainda precisa atravessar revisões e executores, distinguindo novo envio legítimo de repetição. | Reutilizar transporte e tentativas, acrescentando referência à revisão e ao efeito de negócio. |
| Saída e callbacks WhatsApp | `SaidaWhatsappService.js`: persistência antes da rede, rechecagens, estado indeterminado e proteção contra regressão de callbacks. `IntencaoEnvioAtendimentoService.js` deduplica requisições identificadas. | A intenção de atendimento admite caminho legado sem `clientRequestId`; não equivale a uma outbox geral da jornada. | Preservar trilhas existentes e padronizar uma identidade de efeito para entradas novas e legadas. Não repetir automaticamente resultado incerto. |
| Atendimento contextual | Tokens vinculam empresa, guia, competência, contato e hash. Serviços de identidade e `AtendimentoResponsavelWhatsappService.js` tratam vínculo e suspensão por atendimento humano. | O fluxo ativo de pagamento usa chave de canal/telefone; tokens protegem a vinculação, mas falta comprovar concorrência de várias guias/empresas e a suspensão em todos os emissores. | Reutilizar identidade e posse humana; vincular jornada/intenção/revisão explicitamente e testar ambiguidades sem inferir empresa só pelo telefone. |
| Avisos de pagamento | `AvisoPagamentoService.js`: verifica entrega, documento, destinatário e pagamento; reserva por chave; revalida antes do transporte; não repete reserva incerta. | Cadência atual é antes/depois do vencimento, sem política geral por tipo/revisão e cancelamento unificado das intenções antigas. | Preservar as guardas, planejar apenas o aviso ainda pertinente e invalidar os antigos quando a revisão mudar. |
| Pagamento informado | `ConfirmarPagamentoWhatsappService.js` registra data, origem cliente e comprovante opcional. | Hoje grava `paymentStatus: PAID` e `paymentConfirmedAt` a partir da informação do cliente. Isso diverge da separação exigida entre informado e confirmado. | Acrescentar estado de conferência e evidências; suspender cobrança ao receber informação, mas reservar confirmação para prova/revisão apropriada. Migrar consumidores de `PAID` de forma controlada. |
| Guarda de consumo SERPRO | `SerproCallGuard.js` reserva sob transação/lock, bloqueia assinatura em andamento/incerta e mantém trilha. `SerproHttpClient.js` consulta cache antes da reserva. | Limites são de quantidade de tentativas; não são orçamento monetário por contrato/produto. Não há política comum de pausa por empresa na última autorização antes da rede. | Estender a guarda existente. Não permitir que a liberação administrativa de quota ignore pausa de empresa. |
| Orçamento monetário | `ConsultaCnpjOrcamento`, `ConsultaCnpjReserva` e `tomador/consultaCnpjRepository.js` já usam valores inteiros em micros e reservas. | Escopo é consulta cadastral; não cobre todo Integra Contador nem substitui o registro de chamadas SERPRO. | Reutilizar o padrão de valores exatos e reserva, com contrato/produto/tarifa explícitos. Tarifa desconhecida deve bloquear o planejamento pago, nunca virar zero. |
| Agendamento e execução | `scheduledRoutineService.js`: reserva única por rotina/horário, posse, lease e heartbeat. `runRoutineLoop.js` mantém o agendador existente. | Reserva do horário não é posse única do efeito por empresa/competência/etapa entre legado e futuro workflow. | Adaptar o agendador existente para a mesma chave de efeito; não criar segundo agendamento concorrente. |
| Workflow e tarefas | `CarteiraTarefa`, `ManualTask`, obrigações/ocorrências e projeções da carteira fornecem tarefas e acompanhamento. | Não foram localizados os modelos gerais `WorkflowInstance`, `WorkflowStep`, `WorkflowAttempt`, `WorkflowApproval`, `WorkflowEvent` na base inspecionada. Tarefas humanas não substituem execução durável. | Criar apenas a camada faltante de execução/aprovação/eventos, usando tarefas para intervenção humana e transportes existentes para efeitos. |

Os serviços fiscais citados ficam em `apps/api/src/application/fiscal/serpro/`; os de guias em `apps/api/src/application/guides/`; os de comunicação em `apps/api/src/application/whatsapp/`. O schema fica em `apps/api/prisma/schema.prisma`.

## Identidade dos efeitos e pontos de controle

| Efeito | Identidade/controle atual | Contrato que falta consolidar |
| --- | --- | --- |
| Executar horário fiscal | `fiscal_schedule:${routine}:${dueAt}` em `AppSetting`, com owner e lease. | Horário dispara planejamento; efeito por empresa/competência/etapa tem dono único compartilhado com legado. |
| Consultar SERPRO | Assinatura de rota/payload; `SerproChamada` mantém reserva e resultado. | Incluir contexto obrigatório, política efetiva, contrato/produto e revisão da autorização; assinatura HTTP continua útil, mas não substitui identidade de negócio. |
| Recuperar documento PGDAS-D | Estado documental local por empresa/competência e consulta específica. | Efeito distingue declaração/recibo/DAS e evidência exigida; documento já disponível satisfaz a etapa sem transporte. |
| Enviar guia | Unicidade de `EnvioGuia` por guia/canal/destino. | Guia lógica + revisão + finalidade + destinatário/canal; mudança de executor ou template não cria novo efeito equivalente. |
| Emitir aviso | `aviso_pagamento:` com hash de empresa, guia, competência, fase, vencimento e destino. | Revisão e política de cadência explícitas; cancelamento de intenção obsoleta; pagamento e suspensão humana rechecados no despacho. |
| Recalcular no WhatsApp | `recalculo_whatsapp:` com hash de empresa, guia, hash documental e vencimento. | Compartilhar identidade com botão do escritório e workflow; revisar pagamento anterior antes de abrir nova cobrança. |
| Receber resposta de pagamento | `pagamento_resposta:${mensagem.id}` e token contextual. | Evento de informação/comprovante separado de confirmação; revisão antiga deve gerar conciliação, não descarte ou segunda cobrança automática. |
| Enviar mensagem de atendimento | `userId + clientRequestId`, payload e destino; legado pode não fornecer chave. | Cobertura dos caminhos legados e ligação com intenção de negócio sem duplicar transportes. |

A política deve ser aplicada no planejamento, na reserva e no despacho. Hoje o `SerproHttpClient` reserva antes da autenticação e depois inicia a requisição; inserir somente uma checagem no começo não resolve uma pausa ocorrida nesse intervalo. A implementação precisa de transição atômica de autorização para despacho, ordenada com a alteração de política, sem manter transação aberta durante HTTP. Efeitos já autorizados para despacho permanecem rastreados; os ainda não autorizados são bloqueados.

## Sequência de evolução

### 1. Política comum usando a operação atual

Criar resolução de política por empresa, competência e etapa, com origem, revisão e motivo. Migrar as seleções atuais sem ligar rotinas novas. Acrescentar pausas independentes de consultas pagas, mensagens automáticas e automação completa, distinguindo resposta humana de mensagem automática. Exibir impacto antes de salvar e registrar quem alterou.

Começar pelo adaptador de conciliação PGDAS-D. Reutilizar procurações, cache, documentos locais, guarda de consumo e agendamento. Integrar entradas manuais e legadas à mesma decisão; permitir leitura local durante pausa de consultas. Criar teste de concorrência pausa/despacho antes de ativar efeitos novos.

Interface: controles no contexto da empresa, compatíveis com a navegação existente. `apps/web/src/features/companies/CLAUDE.md` determina preservar as colunas atuais e não reintroduzir botão separado de rotinas na carteira. O novo controle deve se encaixar nas configurações da empresa, sem substituir as ações existentes.

### 2. Identidade e revisões das guias

Vincular registros atuais a uma identidade lógica, preservando `Guide` e seus contratos. Revisões guardam evidências imutáveis. Diferenciar substituição, complementar e parcela. Classificar documentos ambíguos para revisão humana antes de ativar envio. Reutilizar ingestão e armazenamento existentes.

Separar vencimento documentado, prazo legal e agenda de lembretes. Reaproveitar capacidades de recálculo existentes; ISS sem capacidade confirmada gera tarefa manual única. Nova revisão invalida intenções antigas e aprovações afetadas.

### 3. Informação de pagamento e conferência

Introduzir “Pagamento informado”, “Comprovante em conferência” e confirmação com origem/evidência. Reutilizar conversa, arquivo recebido e tarefas; atribuir responsável e prazo. Ao receber informação, suspender cobranças enquanto se confere. Pagamento de versão anterior exige conciliação com a obrigação atual.

Inventariar todos os consumidores de `PAID`, `paymentConfirmedAt`, `clienteConfirmouEm` e baixa antes da migração. Não reclassificar automaticamente registros antigos: manter a origem e sinalizar o que precisa de conferência. Esta é uma mudança de comportamento deliberada, não um ajuste visual isolado.

### 4. Intenções de comunicação e continuidade

Unificar a identidade do efeito sobre `EnvioGuia`, tentativas e saída rastreada. Aplicar política, identidade vigente, posse humana, revisão e pagamento antes de cada despacho. Definir cadência por tipo; após pausa, planejar somente o aviso atual pertinente. Reconciliar resultados incertos antes de qualquer repetição.

### 5. Workflow durável e migração gradual

Acrescentar instância, etapa, tentativa, aprovação e eventos onde faltam. Começar em modo de observação, calculando decisões com dados locais e sem efeitos externos. Transferir a execução de uma etapa por vez; legado e workflow compartilham a mesma chave e exclusão. Não usar `ManualTask` como fila de replay. Reversão preserva efeitos e reservas já registrados, inclusive incertos.

### 6. Aceitação isolada e liberação progressiva

Validar em PostgreSQL isolado com 50 empresas sintéticas e transportes simulados, conforme a especificação. Incluir concorrência real de reservas, alteração de política, resultados incertos, retificação e callbacks fora de ordem. Só ampliar ativação após demonstrar que cada efeito tem um executor e que a jornada atual continua compatível.

## Cobertura dos critérios da especificação

Nenhum critério abaixo é declarado aprovado por este levantamento. Há testes locais existentes de documentos PGDAS-D, histórico, modo somente documentos, alertas, agendamento e elegibilidade de envio; serão reutilizados e complementados. A presença de teste não comprova o contrato integrado novo.

| Critérios | Base encontrada | Verificação ou implementação pendente |
| --- | --- | --- |
| A01–A02 | Seleção empresa/rotina. | Política padrão, exceções por competência, origem e restauração. |
| A03–A06 | Guarda SERPRO e reserva de horário. | Pausa em operação composta, todos os caminhos e disputa legado/workflow. |
| A07–A08 | Cache/documentos locais, somente documentos, apuração externa na projeção. | Integração à política efetiva sem executar apuração interna. |
| A09–A10 | Ingestão, estado de processamento e hash. | Validação contextual, ambiguidade e não duplicação de revisão/tarefa/intenção. |
| A11–A13 | Calendário, capacidade restrita e encaminhamento manual. | Proveniência de vencimento, ISS manual único e ativação de revisão validada. |
| A14–A15 | Callbacks sem regressão e rechecagem de pagamento no aviso. | Vinculação à revisão e concorrência pagamento/despacho. |
| A16–A18 | Informação/comprovante com origem e referência à guia. | Separar confirmação, conciliar revisão antiga e impedir reabertura automática de obrigação paga. |
| A19 | Avisos atuais restritos a fases/dias; agendador sem replay indiscriminado. | Retomada segundo política configurável, sem acúmulo de mensagens. |
| A20 | Tokens contextuais e identidade de comunicação. | Várias guias/empresas simultâneas e respostas ambíguas. |
| A21–A22 | Reservas incertas, tentativas e callbacks monotônicos. | Prova integrada de ausência de repetição de efeitos, tarefas e revisões. |
| A23 | Suspensão no atendimento responsável. | Garantir a mesma suspensão em todos os emissores automáticos. |
| A24 | Quotas SERPRO e orçamento monetário cadastral separado. | Tarifa por contrato/produto, reserva exata e conciliação comum. |
| A25–A27 | Guardas de acesso/contexto e identidades locais de operações. | Revogação após agendamento, aprovação por revisão e unicidade entre executores/templates. |
| A28 | Projeções locais da carteira e alertas. | Assegurar zero efeitos externos também nos novos endpoints de progresso/política. |
| A29–A31 | Datas e regras de recálculo existentes; exclusão de parcelas no recálculo mensal. | Limites de fuso, documento recalculado vencido e identidades complementares independentes. |
| A32 | Componentes e navegação atuais. | Verificação visual e acessibilidade dos controles novos em celular, tablet e desktop. |

## Central de Operações e confirmação das apurações

### Página ao lado da Agenda

Adicionar **Operações** ao lado da Agenda, preservando os destinos e funcionalidades atuais. Usar como referência visual o bloco “Central de Operações” fornecido pelo usuário: competência, situação operacional e quatro indicadores — rotinas concluídas, aguardando aprovação, pendências de clientes e falhas de integração. Os números da imagem são demonstrativos; a tela usará dados persistidos e exibirá a última atualização.

O indicador “Operando” depende da saúde do executor e das pausas efetivas, não apenas da existência de tarefas. Cada contador abre os itens correspondentes no mesmo escopo de competência e acesso. Rotinas concluídas contam etapas concluídas; aprovações contam apurações aguardando ação; pendências de clientes e falhas contam itens abertos deduplicados. Não somar essas categorias como se fossem empresas distintas.

Abaixo do bloco, mostrar **Tarefas do dia**, em ordem cronológica pelo horário previsto no fuso de São Paulo. Cada linha apresenta horário, empresa, competência, etapa, responsável, situação e próxima ação. Itens sem horário ficam identificados ao final; atrasadas de dias anteriores aparecem em seção própria, ordenadas pelo prazo original, para não desaparecerem da operação diária. Separar horário de execução de vencimento legal. Programar essas tarefas no fluxo operacional independente, a partir dos status da tabela Empresas e de horários operacionais explicitamente salvos. Não importar agenda, obrigações ou tarefas do Calendário. A primeira entrega mostra apenas o andamento por empresa; a programação diária permanece pendente.

### Central de Apuração como ponto de conferência

Reaproveitar `apps/web/src/features/apuracao/pages/renderApuracaoPage.jsx`, `useApuracao.js` e os componentes de revisão da apuração individual. A listagem atual serve à apuração em lote de empresas fechadas; seleção atual e estado fiscal “confirmada” não são, por si só, aprovação humana da nova jornada. Introduzir aprovação operacional separada, sem renomear ou reaproveitar indevidamente estados fiscais/fechamento.

A Central de Operações abre essa conferência como tarefa do Fluxo. Cálculo, consulta SERPRO do imposto e obtenção de documentos pertencem ao Fluxo, usando os serviços existentes e suas autorizações; abrir a Central ou clicar em **Confirmar** não dispara consulta fiscal. O contador intervém na conferência e na liberação; a execução posterior prossegue automaticamente quando elegível.

| Coluna | Conteúdo |
| --- | --- |
| Empresa | Nome, identificação e competência inequívoca. |
| Anexo | Anexo ou distribuição por anexos da competência e comparação com o mês anterior. Indicar “Mesmo anexo”, “Alterado” ou “Sem base anterior”. Se houver mudança, mostrar a causa sustentada pelos dados, como alteração de classificação, atividade ou fator R quando aplicável; causa não demonstrada vira “Motivo a revisar”. Nunca inventar justificativa. |
| Faturamento | Valor atual, anterior e diferença, com acesso à composição já existente. |
| Imposto | Valor atual e origem — cálculo interno, retorno oficial ou declaração já comprovada — e diferença frente ao mês anterior quando comparável. Ausência de valor aparece como indisponível, nunca zero. Distinguir imposto apurado do total de guia com acréscimos. |
| Ações | **Confirmar** e **Revisar**; após confirmação, mostrar **Confirmada — aguardando liberação**. |

Confirmar registra usuário, data e a versão exata dos dados conferidos. Não transmite, envia guia, fecha competência nem inicia a etapa seguinte. Revisar abre a revisão existente no contexto da empresa/competência e permite registrar a pendência. Concluir a edição não confirma automaticamente.

O botão **Liberar confirmadas (N)** libera todas as confirmações válidas da competência exibida dentro do escopo de acesso do operador, inclusive as ocultas por filtros visuais; o resumo explicita essa abrangência antes da ação. Empresas não confirmadas, em revisão ou alteradas não entram. A liberação cria uma autorização de continuação, com chave única, e não equivale a marcar a apuração como transmitida ou o documento como enviado.

No servidor, revalidar versão, acesso, política, bloqueios e procuração aplicável no momento da liberação e novamente antes de cada efeito. Informar por empresa o que foi liberado e o que continua bloqueado, permitindo liberação parcial sem esconder falhas. Repetir o clique ou retomar um lote não repete efeitos. Mudança material de faturamento, classificação/anexo, imposto ou evidência oficial invalida a aprovação afetada e exige nova confirmação; atualizações de progresso não invalidam a conferência.

Para declarações já comprovadas, manter **Apurado** e continuar apenas nas etapas faltantes. A nova liberação não autoriza retransmitir o que já foi entregue nem gerar novamente extrato/DAS disponíveis. Se os dados oficiais divergirem do que foi conferido, abrir revisão em vez de prosseguir para envio.

### Pró-labore manual e obtenção da guia previdenciária

O Fluxo deve prever INSS para empresas com pró-labore aplicável à competência, sem assumir que a folha ou sua transmissão são feitas pela Altan. Cadastro atual é uma indicação; a aplicabilidade mensal precisa permitir início, suspensão ou ausência justificada, com histórico. Outras origens de obrigação previdenciária não devem ser descartadas só porque o cadastro não indica pró-labore.

1. Criar ou reutilizar uma tarefa mensal **Preparar e transmitir folha/pró-labore**, com responsável, prazo e origem do processamento externo. Não calcular ou transmitir folha automaticamente nesta entrega.
2. O responsável registra a conclusão externa e anexa a evidência disponível ou a própria guia. Concluir essa tarefa não comprova, por si só, a transmissão de outra declaração nem sua disponibilidade para consulta.
3. Verificar primeiro a guia local: empresa, competência, documento processado, composição, valor, vencimento e arquivo. Se suficiente, reutilizar sem consulta.
4. Se faltar documento, e houver procuração/permissão válida para a operação e política liberada, aproveitar `syncSerproInssForCompany` em `SerproDctfwebService.js`. Revisar seus efeitos atuais de persistência antes de conectá-lo ao novo Fluxo; não presumir que seja uma consulta puramente documental.
5. Sem procuração, retorno conclusivo ou capacidade apropriada, manter **Aguardando guia de INSS** e permitir upload validado. Uma resposta sem documento não dispara novas tentativas em cada atualização da tela; nova consulta exige mudança de evidência, ação explícita autorizada ou política de intervalo/limite registrada.
6. Vincular a guia validada à jornada existente de liberação, envio e acompanhamento de pagamento. O mesmo documento não gera dois envios por ter vindo de upload e consulta.

O serviço atual já examina a composição do DARF para evitar tratar todo retorno DCTFWeb como INSS; preservar essa proteção e os testes `darfDctfwebNaoEhSempreInss.test.js`. Não classificar apenas pelo nome do serviço ou pelo indicador de pró-labore. Documentos mistos exigem tratamento pela composição, preservando a identidade única da guia e evitando cobrança duplicada.

### Complementos propostos para a operação

- **Dependências explícitas:** mostrar “aguardando conferência”, “aguardando liberação”, “aguardando processamento externo”, “sem procuração válida” e “aguardando documento” como motivos distintos. Cada bloqueio tem responsável e próxima ação.
- **Conclusão parcial:** INSS pendente não desfaz PGDAS-D confirmado. A política decide se documentos são enviados separadamente quando prontos ou aguardam um conjunto; a liberação da apuração não deve escolher silenciosamente essa regra.
- **Comparação confiável:** usar a última versão válida da competência anterior, mostrar sua origem e suportar múltiplos anexos. Mesmo anexo não significa mesmo imposto; variações de faturamento e base precisam continuar visíveis.
- **Rastreabilidade:** registrar quem confirmou, quem liberou, o conteúdo aprovado, os bloqueios e o resultado de cada etapa, com acesso pelo painel.
- **Critérios adicionais de aceitação:** confirmar não produz efeito externo; liberar inclui apenas confirmações atuais; edição simultânea invalida confirmação; duplo clique não duplica lote; guia manual válida satisfaz INSS sem consulta; pró-labore externo incompleto mantém tarefa; retorno fiscal divergente interrompe envio; filtros não ocultam a abrangência do lote; tarefas respeitam fuso e ordenação.

### Ordem ajustada das próximas entregas

Primeiro implementar a política comum e o registro de aprovação/liberação. Em seguida, entregar a página Operações e reaproveitar a Central de Apuração como conferência, lendo apenas dados locais. Conectar a continuação do Fluxo e a tarefa manual de pró-labore aos serviços existentes somente após as guardas e os testes de efeitos únicos. A evolução de revisões de guias, pagamento informado e comunicação segue as etapas já descritas acima.

## Resultado desta etapa

O próximo incremento recomendado é a política efetiva por empresa/competência com adaptador PGDAS-D, confirmação individual e liberação das confirmadas. Essa base sustenta a nova Central de Operações ao lado da Agenda e a integração do pró-labore manual, expandindo documentos, comunicação e pagamentos sem duplicar agendas ou serviços fiscais.

Este levantamento acrescenta somente documentação. Não altera aplicação, configuração, dados de empresas, agendamentos ou produção; não executa consultas fiscais, recálculos ou mensagens. Quantidades atuais de empresas pendentes e situação real dos documentos não foram reauditadas nesta etapa.
