
## Acumulado automático — 08/09/2026

Decisão nova substitui saldo inicial manual. O GET de fluxo não consulta nem usa saldos_iniciais_fluxo. Migração e registros legados permanecem preservados; PUT/DELETE saldo-inicial estão desmontados do router cliente.

- `acumulado: { origem: HISTORICO, calculoInicio: AAAA-MM|null }` informa a primeira linha financeira disponível. `saldoInicial:null` permanece por compatibilidade.
- Cada `mes.saldo` mantém inicial/final/projetado. O acumulado começa em zero apenas no primeiro mês com movimento e transporta meses; antes desse mês ou sem qualquer linha, valores são null. É resultado gerencial acumulado incluindo previsões, nunca saldo bancário conciliado.
- Fontes admitidas e sua procedência não mudam: notas com convenção mês+1, guias no pagamento/vencimento/atraso, folha/despesa com crédito de caixa e séries de despesa com pelo menos três observações consecutivas. Saída avulsa só entra após contabilizada.
- Leitores de notas, folha e despesas incluem histórico completo; janela visual não limita o acumulado e a primeira nota não exclui despesas anteriores. Valores de cada linha são centavos, normalizados antes de totalização/transporte.
- Testes de serviço verificam legado ignorado, histórico antes da janela, mudança de janela, mês vazio e precisão. `verify-cashflow-balance-postgres.js` usa apenas PostgreSQL local descartável `_check`, com registro manual legado que não pode alterar o resultado automático; banco real não foi exercitado por esta alteração.

## Previsão da receita do mês aberto — 08/09/2026

A receita futura usa exatamente a mediana dos três meses CALENDÁRIO completos anteriores ao ciclo real do servidor. Se qualquer um estiver ausente ou zerado, não há padrão suficiente; mês corrente parcial não entra na base. Histórico mais antigo não dilui a mediana.

A projeção começa no caixa do mês seguinte ao ciclo atual e não altera meses de faturamento já encerrados. Para cada competência de faturamento aberta/futura, o complemento é max(0, mediana − notas já emitidas), em centavos; as linhas das notas permanecem. A base informa meses usados, mediana, competência, emitido e complemento. Exemplo sintético: jun110mil/jul120mil/ago130mil + set26.650 gera outubro com26.650 de notas +93.350 de complemento; notas acima da mediana não ganham complemento negativo nem são reduzidas.

A competência escolhida pelo usuário continua apenas navegação. Impostos não têm nova fórmula nesta alteração; consomem as entradas corrigidas pelo mesmo contrato anterior.
