# Painel por competência e acumulado automático

O resumo principal mostrava resultado do fluxo do mês seguinte, incluindo despesas e folha. O usuário definiu que esse resumo deve ser apenas faturamento menos impostos. Também rejeitou a exigência de cadastrar saldo inicial para cada empresa.

## Comportamento

- Receita, imposto e resultado do painel usam a mesma competência selecionada. Receita vem do total das notas; impostos vêm dos lançamentos da competência, incluindo o componente tributário de INSS já adotado pelo produto. Despesas operacionais e folha salarial não entram nesse resumo.
- Sem dados de imposto, o resultado fica indisponível com motivo explícito; não se presume imposto zero. A DRE conserva sua própria composição.
- O fluxo acumula automaticamente suas movimentações desde o primeiro mês disponível. O valor transportado inclui previsões e é identificado como Acumulado projetado; não representa saldo bancário anterior aos registros.
- Não há formulário de saldo inicial, nem configuração obrigatória por empresa. Valores manuais antigos deixam de alimentar o fluxo; seus registros e a migration permanecem preservados. As rotas públicas de escrita do saldo inicial são desativadas.
- Mudar a janela da tabela não reinicia o acumulado. Empresas sem histórico não recebem valor fabricado. Relatórios do contador acompanha o mesmo comportamento em leitura.

## Validação

Regressões cobrem a conta do painel sem despesas/folha, competência única, ausência de imposto, acumulado automático, histórico anterior à janela, isolamento entre empresas e rejeição do saldo manual legado. O ensaio PostgreSQL usa banco descartável e confirma que registros manuais antigos não influenciam a soma.

Esta correção não confirma a composição dos R$ 26.650 de previsão da Lente. Essa investigação depende do mês exibido e dos dados da empresa; o algoritmo de previsão de receitas não foi alterado neste ajuste.
