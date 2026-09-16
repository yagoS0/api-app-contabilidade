# DRE de competências fechadas

O usuário determinou que a DRE seja exibida apenas nos meses com fechamento contábil concluído, para todas as empresas.

- API verifica `fechadoContabilEm` da própria empresa; competência omitida escolhe a última fechada, enquanto competência explícita aberta é recusada antes da leitura dos lançamentos.
- A resposta contém a lista de competências disponíveis e a data de fechamento. Sem fechamentos há estado vazio específico, sem resultados monetários fabricados.
- Portal oferece seletor próprio da DRE e atualização dos fechamentos. Cards e Fluxo conservam sua competência. Seleção anterior não atravessa a troca de empresa.
- O fechamento é a revisão explícita do período: o status legado Rascunho sozinho deixa de produzir aviso de DRE provisória nesse relatório fechado. Classificação pendente e valores inválidos continuam sinalizados. A regra pura e o status persistido dos lançamentos permanecem intactos.
- Reabrir um período o retira da lista nas consultas seguintes e impede consulta direta.

Diagnóstico somente leitura em produção em 16/09/2026: 38 empresas; 29 com fechamentos, total de 66 competências fechadas. Lente possui maio, abril, fevereiro e janeiro/2026 fechados; a seleção inicial será maio. Setembro/2026 foi recusado pela nova regra. Nenhum dado contábil foi modificado.

Validação: testes do serviço e regra pura (59), interface DRE (19) e contrato mock (15). Ensaio PostgreSQL existente atualizado para cobrir ausência de fechamento, liberação e reabertura; sua execução faz parte do CI. Não tratar fechamento como reconciliação automática de duplicidades ou fonte fiscal nova.
