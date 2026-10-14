# Procurações e conciliação PGDAS-D

## Escopo da primeira etapa

Reaproveitar a consulta de procurações, a circular mensal e os documentos oficiais já existentes. A entrega recuperada da Receita aparece separada do estado da apuração interna. Não criar snapshots de cálculo para simular trabalho interno. Não transmitir declarações durante conciliação.

## Implementação

- Procurações automáticas reutilizam a última verificação por até 24 horas, respeitando validade e vínculo entre CNPJ contribuinte e procurador. Registros antigos sem vínculo precisam de nova verificação. A consulta manual existente continua atualizando explicitamente.
- Resposta de procuração inválida/inconclusiva lança erro e preserva a última evidência. PGDAS-D verifica o poder 00146/PGDAS-D antes das consultas automáticas. Procuração ativa para outro serviço não basta.
- Antes da procuração, a rotina examina os documentos locais da competência. DAS exige PDF; extrato completo exige número da declaração, PDF da declaração e recibo. Declaração zerada completa, sem número de DAS, dispensa captura de guia.
- O fechamento já chama a sincronização de extrato e DAS após transmissão. Esses documentos satisfazem a mesma checagem da rotina: nada é consultado novamente quando já estiver completo. Falhas parciais deixam apenas as capturas faltantes pendentes.
- SUCCESS sem recibo não encerra recuperação. Resposta sem PDF é INCOMPLETE, preservando o identificador oficial quando retornado. Erro de consulta nunca significa ausência de entrega.
- A lista de apuração recebe evidência da circular e mostra a entrega oficial ao lado do estado interno. A tela individual já usa essa evidência e permite abrir documentos salvos.
- Agendas e empresas explicitamente habilitadas continuam obrigatórias. Nenhuma rotina é ativada por esta mudança. Retorno negativo válido aguarda consulta explícita; erro técnico não é retorno negativo.

## Compatibilidade

Sem migração. Procurações permanecem em AppSetting, documentos na circular/armazenamento existente. Fluxos de transmissão, retificação, guias e geração de lançamentos pela importação existente são preservados. Esta etapa não introduz um novo importador contábil. Reconsulta/retificação explícita continua podendo atualizar documentos; pagamento não é inferido da existência de guia ou declaração.

## Operação

Depois da publicação, executar as rotinas DAS/extrato já configuradas para as competências autorizadas. Competências anteriores podem ser processadas explicitamente pelo mecanismo existente, sem habilitar varredura histórica indiscriminada. Documentos completos são reaproveitados; os faltantes são recuperados pelo fluxo existente. A primeira consulta de procurações legadas precisa confirmar o vínculo.

Não executado contra produção nesta implementação. Não houve consulta fiscal paga, transmissão ou envio a clientes nos testes. Não há monitoramento periódico de retificações habilitado automaticamente: atualização permanece explícita nesta etapa, respeitando a agenda fiscal vigente.

## Validação

Testar cache vigente/expirado/troca de procurador; escopo insuficiente; erro técnico; documentos completos dispensando procuração; recibo/PDF ausente; declaração zerada; competência distinta; preservação da entrega após falha. Verificar lista e tela individual, seleção em lote e fechamento/transmissão existentes, além de build e layout desktop/celular.

Validação local concluída: 454 testes de regressão SERPRO/fechamento, 34 testes dirigidos de procuração/documentos/agenda e 25 testes de interface/estados aprovados (há sobreposição entre as suítes de API). Build web aprovado. Capturas da lista em 1440 e 390 pixels, sem transbordamento da página e com rolagem local da tabela, verificadas visualmente em output/pgdas-monitoramento. Fixtures temporárias removidas. A verificação usa dados fictícios e não certifica configuração ou dados de produção.


## Publicação e recuperação assistida

Preparação sobre main atual (PR 187), preservando revisão visual posterior. A rota existente de sincronização aceita somenteDocumentos=true: consulta procuração e escopo, recupera declaração/recibo e atualiza a circular oficial, sem emitir DAS, alterar pagamento, gerar lançamentos ou marcar mês sem faturamento. Importação comum e fechamento mantêm os efeitos anteriores. A trava de mês fechado continua vigente. Essa opção é usada na recuperação assistida em produção; não ativa outras rotinas.

Levantamento inicial somente leitura em 14/10/2026: competência 09/2026, 26 empresas do Simples com extrato habilitado, duas com documentação completa. A recuperação considera apenas empresas habilitadas e meses abertos; as duas completas são reutilizadas.


## Continuação: marcador e conciliação na tela

Consultas mostra a última verificação de procuração, validade e filtros Ativas, Regularizar, Revalidar e Não verificadas. Informação vencida, mais antiga que 24 horas ou vinculada a outro contribuinte/procurador não aparece como autorização atual. O marcador é evidência salva; o serviço continua validando a autorização antes da conciliação.

Testar procuração atualiza a linha com o retorno oficial, incluindo ausência confirmada. Filtrar limpa a seleção, e Rodar usa somente empresas visíveis. Conciliar PGDAS-D — somente documentos usa a rota protegida com somenteDocumentos=true; mantém a importação de extrato antiga para quem precisa de seus efeitos contábeis. Retorno incompleto não aparece como conciliação concluída. Se consulta de procuração e conciliação forem selecionadas juntas, a procuração é verificada primeiro.

Validação: 25 testes de interface/contrato, compilação web e sintaxe da API aprovados. Inspeção em 1440 e 390 pixels sem transbordamento da página. Nenhuma consulta fiscal de teste.

## Continuação: alertas locais na Apuração

A listagem inclui alertas calculados dos registros salvos de procuração e entrega, apenas para as empresas autorizadas na consulta. Não chama o SERPRO, não agenda tarefas e não altera apuração, seleção ou documentos. O painel recolhível separa procurações vencidas/ausentes/a verificar, entrega pendente de comprovação, consulta inconclusiva e documentos incompletos. Resolver a evidência remove o alerta na próxima atualização, sem duplicação.

Pendência de comprovação não significa declaração atrasada. Só é sugerida para competências encerradas do Simples, respeitando abertura/opção quando cadastradas. Não há inferência de prazo legal. Entrega oficial confirmada, inclusive externa, prevalece sobre falha de consulta posterior. Falha no carregamento opcional dos alertas mantém a apuração disponível e mostra indisponibilidade.

Sem migração, notificações externas ou nova rotina. As proteções existentes de reaproveitamento de DAS/extrato completos permanecem. Validação: 36 testes dirigidos de API e 42 de interface aprovados, build web concluído e inspeção em 1440/390 pixels sem transbordamento global. Nenhuma consulta fiscal foi executada para validar estes alertas.


## Continuação: relatório de pendências e DAS de outras origens

Painel de alertas mostra a quantidade de empresas afetadas pela categoria selecionada e exporta CSV da competência e empresas exibidas. Inclui CNPJ, orientação, declaração oficial conhecida e estado interno sem confundir comprovação com atraso. Download local, sem chamada de API/SERPRO ou efeito na seleção/lote. Campos são escapados contra fórmulas, aspas e separadores; CNPJ conserva zeros iniciais.

Rotina DAS, captura normal e reaproveitamento do extrato também reconhecem guias processadas enviadas por upload, da mesma empresa/competência, com PDF não vazio. Parcelamentos, registros sem arquivo e guias em revisão continuam excluídos; sourceFileId nulo é permitido. Recálculo explícito permanece buscando nova versão. Conciliação somente documental não repete extrato completo por falta de DAS, pois não captura guias nesse modo.

Validação: 34 testes dirigidos API e 46 de interface aprovados; build web; inspeção 390/1440 sem transbordamento global; download real do CSV com filtro. A nova consulta local ao banco, somente leitura, reconheceu os três uploads já conferidos em produção. Nenhuma chamada fiscal ou envio externo foi executado.

Próximas frentes do projeto amplo: histórico auditável de retificações e integrações de outras declarações exigem etapas próprias, com validação de endpoints, autorizações e critérios de exigibilidade. A prioridade escolhida pelo usuário nesta continuação é painel/relatórios de pendências por empresa e competência; não habilitar varredura histórica ou notificações externas por inferência.


## Continuação: histórico e conferência de retificações

Histórico PGDAS-D na apuração da empresa lê registros locais por empresa e competência. Mostra a declaração atual e versões preservadas, valores, datas de consulta e PDFs antigos. Números distintos sinalizam diferença a conferir; não identificam automaticamente origem interna/externa, ordem fiscal ou necessidade de retransmissão. Não reconstruímos versões anteriores que já foram perdidas. Registros legados aparecem como preexistentes.

A sincronização preserva a evidência anterior antes de substituí-la e grava novos registros por conteúdo em AppSetting, no prefixo pgdas_historico. Upsert com chave determinística e update vazio impede sobrescrever a versão registrada em repetição/concorrência. Os arquivos novos têm chave exclusiva. Falha de persistência impede substituir os PDFs anteriores e retorna erro; uma evidência recuperada pode constar no histórico sem ser o registro atual se a atualização posterior falhar. Até 500 versões mais recentes são apresentadas, com aviso quando limitado.

Conferir retificação na Receita é ação explícita que usa a rota existente com somenteDocumentos=true e atualizar=true. Valida procuração e poderes, preserva bloqueio de mês fechado e guardas de orçamento/cooldown/resultado incerto. Não agenda reconsultas, transmite, gera DAS ou altera lançamentos. Abrir/reler histórico e PDFs não chama o SERPRO. Nova declaração sem PDF não herda arquivos da declaração anterior. Nenhuma migração ou varredura fiscal histórica é habilitada.

Validação dirigida cobre isolamento de empresa/competência, PDFs ausentes, repetição de conteúdo, versões distintas, falha ao preservar histórico, resposta incompleta, modo documental, abertura sem consultas e resposta tardia. Layout 390/1440 conferido, incluindo recusa de procuração simulada com histórico preservado. Nenhuma consulta fiscal real usada nos testes.


Reforços solicitados pelo usuário: entrega comprovada na Receita sem número de transmissão interno aparece separadamente da apuração interna, inclusive quando aberta. Diferença entre número interno e número recuperado pede conferência dos recibos, sem inferir qual é mais recente ou quem transmitiu. Empresas já apuradas com extrato, recibo e DAS completos continuam sendo ignoradas pela rotina antes da consulta de procuração; abrir o histórico também não consulta. Apenas a ação explícita de conferência busca eventual mudança posterior.

Validacao final desta etapa: 38 testes dirigidos de API e 45 de interface aprovados; suite ampliada fiscal/fechamento com 808 testes aprovada (sobreposta aos dirigidos); build web concluido e layout desktop/celular verificado.


## Apurada por fora no painel

A carteira usa o número de declaração PGDAS-D salvo para a empresa/competência, sem transmissão interna registrada, para apresentar “Apurada por fora”. A projeção resolve as etapas de apuração/transmissão e o filtro Não apurados; mantém obrigações adicionais, guias, contabilização e importação independentes. Nenhum snapshot, fechamento ou lançamento é alterado e a leitura não consulta o SERPRO. Guia manual isolada não comprova entrega. Transmissão interna registrada não é reclassificada como externa.

O mesmo rótulo aparece na lista de Apuração com o estado interno separado. A prévia do lote da carteira exclui as entregas externas comprovadas. Testes: 38 de API e 81 de interface, incluindo escopo empresa/competência, prova ausente, origem interna, preservação contábil e seleção. Componentes conferidos em 1440 e 390 px, sem overflow global.


## Continuidade automática e rótulo Apurado

Por solicitação posterior, o rótulo visível das entregas externas comprovadas passa a ser apenas “Apurado”. A origem oficial e o estado interno seguem separados nos dados/histórico. A rotina mensal continua usando a competência anterior no fuso America/Sao_Paulo e as empresas/agendas habilitadas. Documentos completos dispensam inclusive procuração; faltantes exigem procuração vigente e poder PGDAS-D. Ausência confirmada de declaração aguarda conferência explícita, sem consultas repetidas.

O worker agora passa somenteDocumentos tanto na captura de DAS quanto na sincronização do extrato. Neste modo, capturar DAS salva a guia sem atualizar a circular, gerar lançamentos ou excluir guias; a sincronização documental preserva snapshots e fechamento. A captura explícita legada mantém seu comportamento. Agendas de envio existentes permanecem independentes.

Auditoria de produção: integração e worker habilitados, DAS/extrato mensais dia 9 às 14h de São Paulo, 26 empresas habilitadas em cada rotina. Não foi executado lote fiscal para testar. Validação local: 103 testes API e 42 testes web aprovados.
