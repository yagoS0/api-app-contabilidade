# Análise da empresa no Planejamento — desenvolvimento

Implementação local na branch `codex/planejamento-bi-dev-20260910`. Não publicada na main ou na Railway. Nenhum dado de produção copiado ou alterado.

## Testar

Executar `node apps/web/scripts/start-planejamento-dev.mjs` na raiz do repositório. Abrir `http://127.0.0.1:5186/dev-planejamento.html`. A página de desenvolvimento usa exclusivamente a API mock e é protegida por `import.meta.env.DEV`; não integra o entrypoint do build normal.

Casos disponíveis: empresa com histórico fictício e empresa sem dados. Conferir Mês, 3 meses, Acumulado no ano, 12 meses, intervalo personalizado e comparação anual. A seleção de período persiste entre as seções. Trocar entre análise e simulação mantém o formulário tributário montado. Escolher outra empresa descarta respostas antigas.

## Entrega

### Clientes — relatório de serviços

Seção Clientes no mesmo filtro de período da análise. Gráficos de distribuição entre maiores clientes, evolução em 12 meses e composição da variação (novos no histórico, sem faturamento na base anterior, expansão, redução e ausência). Cards de média por cliente, concentração, novos observados, recorrência e ausência no período; ranking pesquisável com ordenação e detalhe das notas. Acumulado é observado até a referência, não LTV estimado. Impressão/PDF local inclui filtros, cobertura e página exibida do ranking.

A API consulta somente cabeçalhos das notas autorizadas daquela empresa, até o fim do período; sem nova captura. A regra compartilhada em `packages/shared/src/analise/clientes.js` também alimenta o mock. Limite de 20 mil notas gera recusa explícita, nunca total truncado. CPF/CNPJ é normalizado por formato; não há validação cadastral fiscal nem junção por nomes semelhantes. Documentos ausentes/inutilizáveis ficam fora dos indicadores por cliente e têm contagem e valor separados. Clientes estrangeiros sem CPF/CNPJ não têm identidade consolidada nesta versão.

O histórico reflete o que foi capturado, não comprova início ou término do contrato. Disparidade considera totais mensais versus mediana dos seis meses anteriores, exige três meses com faturamento observado e usa referência encerrada. Ausência de nota não afirma cancelamento. A visualização do documento fiscal completo a partir da nota ainda depende da ligação à tela de notas; o detalhe atual lista número, competência e valor.

Validação Clientes: testes de regra, isolamento da consulta, limite explícito, homônimos/documentos mascarados, duplicidade, falta de identificação, acumulado, comparação e reconciliação da variação. Testes de UI cobrem gráficos, detalhe, falha/retentativa e resposta tardia de outra empresa. Chrome headless percorreu seção, detalhe, impressão e estado sem dados, sem erros de JavaScript ou transbordamento em 390 px. Build local e 90 testes de páginas do Planejamento mais 10 de integração da aba aprovados.

- Visão geral, DRE comparativa, margens, despesas por categorias/contas, guias, parcelamentos e projeção existente.
- Consulta API em lote por empresa e intervalo; mesma regra pura da DRE e precedência do plano da empresa. Sem chamadas a provedores externos.
- Margens acumuladas pela razão dos totais; diferença em pontos percentuais. Ausência, base zero e reversão de prejuízo não fabricam crescimento percentual.
- Cobertura mensal por fonte, identificação de período parcial/rascunhos e contas pendentes. Presença de documentos não é certificado de completude.
- Insights determinísticos de receita, despesas, margem, carga das guias e atrasos. Alertas de evolução exigem períodos sem lacunas identificadas.
- Detalhamento paginado de lançamentos por conta. Quando há guia vinculada, o acesso leva à seção de guias da empresa; a abertura direta do documento específico ainda não foi integrada.
- Projeção reutiliza o serviço e a tabela atuais. Não é DFC e não representa saldo bancário.

## Limites antes de produção

- API real ainda precisa de validação com PostgreSQL e histórico representativo. A cobertura apresentada é da janela consultada; não mede automaticamente todo o histórico anterior a ela.
- Não há nova integração com bancos, recebíveis, estoque, orçamento ou dívidas não fiscais.
- Carga usa os totais das guias processadas, excluindo parcelamentos. Não soma também componentes de DARF. Não comprova cobertura de todos os tributos; casos de documentos distintos sobrepostos precisam de conferência.
- Pagas da competência são guias daquela competência com status atual PAID, não uma soma de pagamentos realizados entre duas datas.
- Nenhum relatório será enviado ao cliente automaticamente. O painel do cliente não foi modificado.

## Validação

Build completo aprovado com `node apps/web/scripts/start-planejamento-dev.mjs --build`. O script resolve o pacote shared deste checkout para evitar a junction desatualizada de outro diretório. 12 testes adicionais de Relatórios também passaram: 108 testes aprovados no total das suítes executadas. Permanecem avisos de tamanho de bundle e imports mistos de componentes existentes.

9 testes novos de backend aprovados (regra, Decimal, limites, ausência, margens, leitura em lote e escopo). 87 testes de interface do Planejamento aprovados, incluindo regressão do salvamento e falha do PDF. Navegação em Chrome headless pelas cinco seções, troca para simulação e empresa sem dados; sem erros de JavaScript e sem transbordamento da página em 390 px. Capturas desktop/mobile armazenadas no diretório de trabalho externo ao repositório.
