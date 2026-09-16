# Planejamento: aproveitar os registros da empresa — 16/09/2026

Pedido: preencher automaticamente o acompanhamento e aproveitar notas, lançamentos e informações já registradas, reduzindo digitação.

## Plano executado

1. Revisar as fontes e a classificação contábil existentes.
2. Consolidar os meses por empresa sem duplicar nota, lançamento e apuração.
3. Preencher automaticamente, preservando intervenção manual e cenários antigos.
4. Conferir testes, navegador, build e relatório; registrar limites.

## Comportamento

`HistoricoPlanejamentoService` lê do início do ano anterior até o mês corrente: apurações em estados calculada/fechada/transmitida/confirmada, notas da mesma população de faturamento da apuração (`whereFaturamentoEmit`) e lançamentos CONFIRMADO/EXPORTADO. Consultas mantêm escopo de empresa; plano próprio vence o global, reutilizando `carregarPlano`. Não escreve nem consulta API fiscal.

Receita mensal tem prioridade apuração → notas → lançamentos, sem adicionar fontes entre si. A classificação usa a conta completa pelo classificador existente, não nome/tipo de tela: receita menos devoluções/descontos, com sinais de débito/crédito. Pagamento em conta patrimonial não vira receita. Diferenças entre fontes, saldo negativo e contas não reconhecidas são sinalizados. Falhas de leitura produzem avisos e preservam as fontes disponíveis.

Com doze meses anteriores completos, receita anual usa a série consolidada; RBT12 ausente também pode ser preenchido. Folha anual ausente aproveita doze folhas mensais explicitamente informadas nas apurações. Não divide FS12 por doze para inventar distribuição. Mês sem registro permanece ausente; zero explicitamente registrado é preservado.

`preencherMensal` preenche realizado, histórico anterior e folha automaticamente, mesmo com a seção fechada. Plano inicial distribui receita anual em doze meses e é identificado como projeção. A seção também aparece quando há dados mensais e falta base anual. Sai o botão Importar apurações.

`automaticos`/`editados` por campo distinguem valores do sistema, edições, zero e apagamento manual. Atualização modifica somente campos automáticos; valores legados/salvos sem metadados são preservados. Ao salvar, formulário efetivo e série calculada são persistidos mesmo sem abrir a seção. Snapshots anteriores continuam imutáveis. Dados da empresa anterior não alimentam a atual.

Folha de despesa contábil aparece preenchida como sugestão e marcada para conferência: provisão não prova pagamento/encargos do Fator R. Até o contador conferir no cenário, essas parcelas não compõem FS12 da janela mensal. Editar o valor também registra conferência; não altera cadastro ou lançamento.

Mês corrente é parcial. O realizado é mostrado, mas a projeção mantém o maior entre plano e receita registrada; sem plano, não afirma projeção completa. Mês parcial não entra no desvio de meses concluídos, e sua folha não é tomada como base mensal completa. PDF e impressão identificam origem e mês parcial.

## Conferência e limites

- 455 testes web de planejamento e 92 da API aprovados, mais conferências focadas após revisão de avisos.
- Casos: prioridade e duplicação entre fontes, zero/ausência, devolução, rascunho, folha sem pagamento provado, escopo, fonte offline, janela anual completa, salvamento do preenchimento, edição/apagamento, cenário legado e mês parcial.
- Navegador mock: janeiro e histórico preenchidos sem importar; folha contábil visível antes da conferência; apagamento preservado; conferência habilita a janela. Dados fictícios.
- Build web aprovado, parser/no-undef. Relatório fictício gerado pelo motor; duas páginas renderizadas e inspecionadas com setembro parcial e origem dos dados.
- Sem migração, dependência nova, gravação contábil, transmissão fiscal ou publicação em produção.
- Automação depende dos registros disponíveis e do plano reconhecido. Não inventa meses, não considera rascunho confirmado, não infere créditos fiscais, margem do Real, segregações especiais ou remuneração individual a partir de agregados. Esses campos continuam exigindo dados adequados/análise do contador.
