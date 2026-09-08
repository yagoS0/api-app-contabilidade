# Relatórios — 08/09/2026

Pedido atual reintroduz o fluxo do portal cliente no escritório, dentro de Relatórios e SOMENTE LEITURA. A decisão de agosto de remover a antiga aba Fluxo não impede este pedido novo.

`RelatoriosTab` abre `FluxoLeitura`; a rota GET firm usa o mesmo `responderFluxoDeCaixa` do cliente, com middleware próprio de acesso. `janelaInicio` segue a referência escolhida; não usar essa referência como `cicloAtual` (hoje não muda ao navegar). Não há handlers operacionais nem mutações nas células.

Dois meses diários, mês completo no DOM com rolagem e totais no rodapé. `tabelaFluxoLeitura.js` e `vocabularioFluxo.js` espelham a agregação do cliente em `apps/portal-cliente-web/src/features/painel/lib/tabelaDoFluxo.js`. Manter paridade; teste importa as duas regras. Resultado é acumulado DENTRO do mês e reinicia no seguinte; previsto, ausência e zero permanecem distintos. Fontes sem dia entram no resultado e são explicadas.

Resumo de lançamentos anterior preservado no export explícito `RelatorioLancamentosTab`, sem entrada na aba atual. Seus testes permanecem separados dos testes do fluxo.

Mock usa fixture do cliente copiado em `api/mock/fluxoRelatoriosFixture.js`; não representa identidade de lançamentos entre os dois mocks independentes. O ambiente real compartilha o serviço.

## Saldo projetado — 08/09/2026

Relatórios espelha Resultado mensal e Saldo projetado do cliente, sem ações de escrita. mes.saldo vem do backend; nunca reiniciar esse saldo por mês nem calculá-lo apenas com meses visíveis. Sem saldoInicial o acumulado fica indisponível. Paridade de tabelaFluxoLeitura com tabelaDoFluxo inclui saldo diário e final.
