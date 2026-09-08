# Previsão de outubro e cards do painel

Relato: Lente, setembro selecionado, outubro em aproximadamente R$ 26.650, imposto e resultado vazios; mostrar também a porcentagem de imposto pago.

## Causas reproduzidas

O fluxo começava a projetar somente depois do recebimento da última nota. Notas parciais de setembro faziam outubro mostrar apenas o já emitido. A mediana de toda a sequência histórica ainda incluía meses antigos e o mês aberto.

Os cards condicionavam o valor absoluto do imposto à disponibilidade da alíquota contábil. Um imposto conhecido podia ficar oculto quando faltava receita contábil para calcular a divisão. O parser Decimal foi verificado e não era a causa.

## Correções

- Mediana dos três últimos meses completos de calendário. O mês aberto não treina a previsão.
- Complemento previsto igual ao maior entre zero e mediana menos notas já emitidas. Notas individuais permanecem; valores acima da mediana não são reduzidos. Meses encerrados não são preenchidos retroativamente.
- Evidência da previsão identifica meses-base, mediana, emitido e complemento em formato legível.
- Imposto conhecido aparece mesmo sem alíquota calculável. Resultado continua faturamento menos impostos da mesma competência. Imposto parcial fica identificado.
- Porcentagem paga aparece junto ao imposto, com legenda própria e valor pago. Não se confunde com imposto lançado, calculado ou previsto. Falta de dados não gera taxa fabricada.

## Limites da validação

A reprodução usa dados sintéticos: junho/julho/agosto em R$ 110/120/130 mil e setembro parcial em R$ 26.650. Outubro deve apresentar R$ 26.650 em notas mais R$ 93.350 de complemento previsto, total R$ 120 mil. Esses valores não são uma leitura do banco da Lente.

Não havia sessão autenticada no navegador disponível. A composição exata dos valores reais de setembro/outubro ainda depende de acesso à empresa. Nenhuma apuração, emissão, pagamento, chamada paga ou alteração em dados reais foi executada. Imposto sem lançamento conhecido permanece indisponível; não foi criada estimativa tributária sem fonte por este ajuste.
