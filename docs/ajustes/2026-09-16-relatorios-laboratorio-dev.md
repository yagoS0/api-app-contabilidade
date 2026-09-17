# Relatórios e Laboratório — entrega de desenvolvimento

Implementação do plano de 14/09/2026. Somente escritório e desenvolvimento. Sem publicação em main/produção ou liberação no portal do cliente.

## Entradas e uso

- Empresa → Contabilidade → Relatórios: mesma análise antes disponível em Planejamento, sem outro motor de DRE. Planejamento mantém a entrada anterior e a Simulação tributária, inclusive seus cenários e IBS/CBS.
- Dashboard → Laboratório da Empresa: cenário fictício ou base de uma empresa da carteira.
- Prévia isolada: `http://127.0.0.1:5186/dev-planejamento.html`. Usa exclusivamente demonstração; a persistência dessa prévia fica no navegador, não no PostgreSQL de produção.
- Executar a prévia: `node apps/web/scripts/start-planejamento-dev.mjs`. `--build` valida o aplicativo em diretório separado. `DEV_FAKER_PATH` é um override opcional da ferramenta para checkouts com dependências compartilhadas; não afeta o build normal do produto.

## Disponível

1. Períodos de mês, 3/6/12 meses, ano e intervalo personalizado, comparados com duração equivalente ou ano anterior.
2. Visão geral, DRE comparativa, despesas dentro de Resultado, projeção financeira existente, carteira e tributário. Valores sem registros não são convertidos em zero.
3. Média, menor/maior mês observado, dispersão mensal e resumo de mudanças. Zero documental pode vir de `CompanyMonthlyCircular.semFaturamento`; fechamento contábil é identificado na cobertura.
4. Carteira: receita média por cliente, ticket por nota, acumulado histórico observado, concentração Top 1/3/5 e comparação, expansão/redução, novos e ausência de faturamento. Regra de recorrência versionada `3-de-4-v1`, taxa e receita dos recorrentes. Não se apresenta receita observada como MRR ou LTV estimado, nem ausência de nota como churn contratual.
5. Classificação gerencial por código completo da conta: fixo/variável e identificação de pró-labore. Revisão otimista impede sobrescrever edição concorrente. Permissão ACCOUNTANT para salvar; não altera o plano ou lançamentos.
6. Contribuição, equilíbrio, cobertura dos custos fixos e pró-labore/faturamento habilitados com classificação completa e sem inconsistências. Tributos/deduções entram uma vez; pró-labore da DRE não é descontado novamente.
7. Base declarada de pagamentos aos sócios, por competência: pró-labore pago, distribuição e outras retiradas. Fonte e confirmação obrigatórias, inclusive para zeros. Cada alteração cria versão, preservando a anterior. Totais somente se todos os meses do período estiverem confirmados. Resultado menos distribuição não significa saldo bancário ou autorização para distribuir.
8. Base de Fator R: consulta interna dos dados já existentes para a referência selecionada, com procedências. A razão entre folha e receita não decide anexo; reconhecimento da folha precisa ser conferido. Sem chamadas pagas ao SERPRO.
9. Impressão gerencial com resumo, DRE, evolução, estrutura de custos, carteira inteira dos períodos comparados, retiradas declaradas, guias e cobertura. O endpoint usa transação `RepeatableRead` para manter os blocos na mesma fotografia. Identificação da empresa vem do banco. Impressão específica da carteira inclui todos os registros do filtro, não apenas a página visível.
10. Laboratório: A × B, gráficos e diferenças, exemplo fictício sem alíquota presumida, preço, contratação, ganho/perda de cliente, custo fixo, pró-labore e metas de receita/clientes. Custo da contratação é total mensal informado. Custos fixos não somem ao perder cliente; custos variáveis exigem revisão explícita.
11. Importação da base da empresa aproveita a fotografia da DRE e sua classificação. Tributos embutidos permanecem identificados e não recebem segundo desconto. Outras receitas são preservadas. Base incompleta exige preenchimento das premissas faltantes.
12. Cenários são fotos pessoais append-only: nome, mês, premissas A/B, resultados recalculados no servidor, procedência declarada, versão da fórmula e autor. Empresa fictícia nunca cria `PortalClient`. Revogação do acesso à empresa também impede ler seus cenários. Modo apresentação habilitado somente para cenário fictício.

## Bases e limites mantidos

- Classificação gerencial, confirmação mensal e declarações de sócios são bases novas. Precisam ser preenchidas/conferidas para cada empresa; a demonstração não comprova cobertura real da carteira.
- Tributos pagos continuam identificados como status das guias da competência; isso não comprova a data efetiva do pagamento. Parcelamentos não entram na carga tributária corrente.
- O relatório impresso gerencial não inclui a projeção financeira nem o formulário de conferência do Fator R. São visões separadas na tela; não misturar hipóteses futuras e bases auxiliares com a fotografia dos resultados.
- Não implementados, conforme exclusão dos pontos vermelhos: saldo bancário/reserva, contas a receber/aging/inadimplência, capital de giro, prazos completos de liquidação, MRR contratual e produtividade por funcionário. Não há números presumidos para esses itens.
- Portal do cliente continua fora desta entrega. Futuramente terá resumo executivo na página inicial e detalhes em Relatórios, após revisão própria de autorização/liberação.

## Persistência e validação

Migrações aditivas:

- `20260916120000_relatorios_gerenciais_laboratorio`: classificação e cenários.
- `20260916123000_base_socios_gerencial`: declarações versionadas dos pagamentos.

As duas foram aplicadas em PostgreSQL 15 temporário, ligado apenas a `127.0.0.1:55446`, sem credenciais ou dados de produção. `prisma migrate diff` contra o schema final retornou **No difference detected**. Prisma Client foi gerado em diretório isolado; node_modules compartilhado não foi alterado.

Verificações com banco real local: gravação e reabertura, fotografias preservadas após edição dos inputs, isolamento de autor, revogação, revisão concorrente, cenário fictício sem criação de empresa, versões das declarações e somas Decimal.

Suítes focadas: 172 testes de interface/contratos/navegação e 102 de API/regras, todos aprovados. Incluem regressões do simulador tributário, acesso por empresa, falta de fonte, cálculo sem imposto duplicado e impressão acima de uma página de clientes.

Chrome headless: desktop e 390 px, sem erro JavaScript ou overflow horizontal; classificação, pagamentos declarados, impressão, salvar/reabrir e importação de empresa conferidos. A base fictícia importada reconciliou resultado de R$ 30.600,00 com a DRE. Build validado; persistem avisos anteriores de tamanho de bundle/imports estáticos e dinâmicos.

Antes de qualquer publicação futura, aplicar as migrações e gerar Prisma Client no ambiente de destino pelo processo normal do projeto. Nenhuma migração desta entrega foi aplicada em produção.

## Polimento e conferência — 16/09/2026

- Período em botão único: rascunho local, atalhos, comparação e aplicação explícita; cancelar/Escape preservam a consulta. Intervalo limitado a 24 meses. Painel centralizado e rolável no celular.
- Hierarquia dos indicadores, botões, abas e formulários revisada; metodologia de recorrência, disparidades e premissas recolhível, mantendo avisos de cobertura visíveis.
- Evolução com faturamento e resultado, negativos e lacunas preservados; tabela acessível em “Ver valores mensais”. Série identificada como últimos 12 meses, estatísticas referentes ao período selecionado.
- Meta de clientes corrigida: usa ticket sem arredondamento intermediário. Receita 100 / 6 clientes e meta 100,01 exige 7 clientes. Margens apresentadas em pontos percentuais, sem moeda.
- Validação: 175 testes frontend (174 no conjunto completo e mais uma regressão, com 9 testes afetados reexecutados), 103 de backend. Fluxo Chrome com classificação, declarações, impressão, salvar/reabrir, A/B e reconciliação de 30.600 com DRE fictícia; filtro e gráfico em desktop/390px sem erros JS ou overflow.
- Permanece apenas em desenvolvimento. Próxima etapa de homologação de dados reais depende de conferir classificação e cobertura por empresa; a prévia continua fictícia.
