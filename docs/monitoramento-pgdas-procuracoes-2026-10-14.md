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
