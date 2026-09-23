# Lançamentos, tarefas e consultas SERPRO — desenvolvimento

Implementação e publicação na main/produção autorizadas em 23/09/2026. O resultado do deploy deve ser verificado pelo status do commit publicado.

## Entrega

- Atualização de lançamento mantém a tabela no mesmo contexto; respostas antigas de outra empresa/filtro são descartadas. Falha de recarga preserva a lista com aviso.
- Exportação dos IDs selecionados passa por conferência e hash do lote. Download e confirmação usam o mesmo escopo. A confirmação é transacional e não marca registros fora da seleção. Exportação por período e importações existentes permanecem disponíveis.
- Tarefas podem ser criadas para várias empresas, com conclusão independente, identificação da empresa e acesso direto. Compartilhamento com a equipe é explícito. Conversão de tarefa pessoal com histórico ou recorrência já iniciada é recusada para preservar pendências anteriores.
- Configuração SERPRO distingue carga, falha e configuração desabilitada. Acesso direto carrega configurações; falha temporária não equivale a ausência de certificado.
- Guias oferece consulta de DAS/INSS pela competência fiscal, distinta do mês de vencimento exibido. Reutiliza as operações existentes sem forçar recálculo; consultar não confirma pagamento.
- Lançamentos identifica o extrato do Simples como consulta de receita e imposto.

## Validação

Revisão cruzada entre os três responsáveis, testes automatizados dos módulos e compilação web concluídos. No navegador local com dados fictícios: edição preservou tabela e seleção; conferência mostrou apenas um registro selecionado; duas tarefas empresariais mantiveram conclusão independente; acesso à empresa e menu/consulta simulada de DAS funcionaram.

O mock não disponibiliza download CSV real. API de exportação foi validada por testes automatizados. Não foram feitas consultas SERPRO pagas nem alterações fiscais em produção. O mock possui avisos laterais sintéticos independentes da lista de lançamentos; agosto vazio não representa falha de carga.

Alterações anteriores de edição de contatos WhatsApp permanecem separadas do escopo desta entrega.
