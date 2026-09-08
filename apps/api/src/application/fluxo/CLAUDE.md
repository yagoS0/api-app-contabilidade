
## Acumulado automático — 08/09/2026

Decisão nova substitui saldo inicial manual. O GET de fluxo não consulta nem usa saldos_iniciais_fluxo. Migração e registros legados permanecem preservados; PUT/DELETE saldo-inicial estão desmontados do router cliente.

- `acumulado: { origem: HISTORICO, calculoInicio: AAAA-MM|null }` informa a primeira linha financeira disponível. `saldoInicial:null` permanece por compatibilidade.
- Cada `mes.saldo` mantém inicial/final/projetado. O acumulado começa em zero apenas no primeiro mês com movimento e transporta meses; antes desse mês ou sem qualquer linha, valores são null. É resultado gerencial acumulado incluindo previsões, nunca saldo bancário conciliado.
- Fontes admitidas e sua procedência não mudam: notas com convenção mês+1, guias no pagamento/vencimento/atraso, folha/despesa com crédito de caixa e séries de despesa com pelo menos três observações consecutivas. Saída avulsa só entra após contabilizada.
- Leitores de notas, folha e despesas incluem histórico completo; janela visual não limita o acumulado e a primeira nota não exclui despesas anteriores. Valores de cada linha são centavos, normalizados antes de totalização/transporte.
- Testes de serviço verificam legado ignorado, histórico antes da janela, mudança de janela, mês vazio e precisão. `verify-cashflow-balance-postgres.js` usa apenas PostgreSQL local descartável `_check`, com registro manual legado que não pode alterar o resultado automático; banco real não foi exercitado por esta alteração.
