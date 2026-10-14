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
