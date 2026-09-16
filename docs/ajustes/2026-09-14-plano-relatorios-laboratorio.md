# Plano — Relatórios gerenciais e Laboratório da Empresa

Data: 14/09/2026. Etapa de planejamento, sem alteração de código ou publicação. Base: documento do usuário e inspeção do checkout de desenvolvimento.

## 1. Escopo e navegação

- Disponibilizar inicialmente somente ao escritório. Relatórios imprimíveis para entrega manual ao cliente.
- Relatórios: Visão geral | Resultado | Projeção | Clientes | Tributário. Sócios será habilitado quando o mapeamento tiver cobertura. Despesas fica dentro de Resultado. Projeção será chamada Caixa apenas quando houver suporte a movimentos e saldos conciliados.
- Aproveitar os componentes e serviços hoje em Planejamento, sem construir uma segunda implementação. Manter Simulação tributária e seus cenários, inclusive IBS/CBS. Preservar os caminhos atuais e redirecionar a análise para sua nova entrada sem perder empresa/período.
- No dashboard do escritório, entrada Laboratório da Empresa. Dois modos: partir de empresa existente ou criar empresa fictícia. Mesmo motor de indicadores, apresentação adequada à simulação.
- Futuro, não implementar nesta etapa: resumo executivo no início do portal do cliente e demais seções na aba Relatórios daquele portal. Serviços compartilhados; autorização e dados liberados ao cliente precisam de revisão antes de abrir as rotas.
- Um filtro de período: mês, 3/6/12 meses, acumulado no ano e personalizado; comparação anterior de mesma duração ou ano anterior. Filtro de empresa apenas fora do contexto de empresa fixa. Não mostrar filtros de unidade/centro de custo sem cadastro e dados.

## 2. O que significa disponibilidade

✅ Fonte e estrutura existem e podem alimentar o indicador. Não significa que todas as empresas tenham histórico completo ou que a função já esteja pronta.

🟡 Fonte parcial, agrupamento insuficiente ou definição a confirmar. Exibir somente com cobertura identificada.

🔴 Falta fonte ou controle estruturado; pode ser premissa explícita em empresa fictícia, nunca dado real presumido.

## 3. Matriz dos 45 itens

| Nº | Relatório/indicador | Base atual | Falta / fonte recomendada |
|---|---|---|---|
| 1 | DRE gerencial | ✅ Lançamentos, plano, competência, provisórios | Conferir plano por empresa e fechamento; EBITDA exige definição própria e ajustes completos |
| 2 | Fluxo realizado | 🟡 Saídas/guia paga; projeção existe | Créditos, liquidações, transferências e saldo por conta: extratos OFX/CSV/API bancária + conciliação |
| 3 | Faturamento/crescimento | ✅ Notas válidas e competência | Medir cobertura de captura e cancelamentos; comparar janelas equivalentes |
| 4 | Margem líquida | ✅ DRE | Usar receita líquida e resultado da mesma base |
| 5 | Margem bruta | ✅ DRE com custos mapeados | Conferir custos diretos; não inferir pelo fornecedor |
| 6 | Margem operacional | ✅ DRE | Tornar explícita a composição do resultado operacional |
| 7 | LTV | 🟡 Acumulado por tomador já disponível | Para estimado: contratos, duração/coortes, cancelamentos e margem de contribuição por cliente |
| 8 | Faturamento por cliente | ✅ CPF/CNPJ, notas e valores | Documentos ausentes/estrangeiros precisam de identificação confiável; não juntar por nome |
| 9 | Dependência de clientes | ✅ Participação no faturamento identificado | Faixas são política gerencial configurável, não classificação universal de risco |
| 10 | Top 1/3/5 | ✅ Ranking por tomador | Acrescentar Top 1/3 e comparação histórica; base identificada explícita |
| 11 | Faturamento médio por cliente | ✅ Total/clientes com faturamento | Definir denominador e manter mesmo período |
| 12 | Ticket por nota | ✅ Valor e quantidade de notas | Separar de média por cliente |
| 13 | Ticket por cliente | ✅ Mesmo dado do item 11 com igual denominador | Não criar card duplicado; só distinguir se houver definição operacional diferente |
| 14 | Crescimento por cliente | ✅ Série e comparação | Mostrar expansão/retração com composição e datas |
| 15 | Clientes recorrentes | ✅ Notas mensais | Versionar regra; proposta 3 de 4 meses, diferente da regra atual de 3 consecutivos em algum trecho do histórico |
| 16 | Taxa de recorrência | ✅ Derivável da regra definida | Mostrar janela, numerador e denominador |
| 17 | Novos no histórico | ✅ Primeira nota disponível | Não afirmar aquisição/início de contrato sem CRM |
| 18 | Clientes perdidos | 🟡 Ausência de faturamento observada | Para perda confirmada: status do contrato/CRM; histórico de notas permite só sinalizar inatividade |
| 19 | Churn | 🟡 Proxy de inatividade possível | Base ativa inicial, eventos de saída, reativação e contratos para churn contratual |
| 20 | Receita de clientes recorrentes | ✅ Classificação histórica | Não afirmar que todas as notas desses clientes sejam mensalidades; identificar como faturamento de clientes recorrentes |
| 21 | MRR | 🔴 Contratos recorrentes estruturados ausentes | Sistema de cobrança/CRM: vigência, mensalidade, descontos, suspensão e cancelamento |
| 22 | Receita perdida | 🟡 Redução documental disponível | Chamar redução observada; perda contratual depende do MRR/contratos |
| 23 | Maior faturamento | ✅ Série mensal e ranking | Diferenciar maior mês na janela e maior cliente |
| 24 | Menor faturamento | ✅ Série mensal e ranking | Menor positivo separado de mês com zero confirmado e mês sem dados |
| 25 | Faturamento médio mensal | ✅ Histórico | Definir meses da janela; ausência de captura não vira zero |
| 26 | Volatilidade | ✅ Série mensal com cobertura | Dispersão/amplitude com janela mínima; rótulos de estabilidade dependem de política explícita e sazonalidade |
| 27 | Ponto de equilíbrio | 🟡 Despesas existem sem separação completa | Contador classificar fixo/variável e taxas aplicáveis; não confundir com equilíbrio entre regimes do simulador atual |
| 28 | Margem de contribuição | 🟡 Lançamentos/impostos | Mapeamento fixo/variável, comissões e custos proporcionais; não substituir lucro bruto |
| 29 | Cobertura de custos fixos | 🟡 Receita disponível | Mesmo mapeamento do item 27 |
| 30 | Reserva de caixa | 🔴 Saldo conciliado completo ausente | Extratos com saldo/data e contas abrangidas; despesas médias sustentadas; política de reserva é premissa |
| 31 | Capital de giro | 🔴 Controles completos ausentes | Recebíveis, fornecedores, estoque se aplicável e saldos iniciais: ERP financeiro/contábil |
| 32 | Prazo de recebimento | 🔴 Baixas completas por título ausentes | Títulos, data-base e recebimentos parciais/total; ERP/cobrança + conciliação |
| 33 | Prazo de pagamento | 🟡 Algumas datas de pagamento | Títulos e data-base consistente; não confundir atraso após vencimento com prazo de financiamento |
| 34 | Inadimplência | 🔴 Carteira de recebíveis ausente | Vencimento, saldo em aberto, baixa, renegociação e estorno; ERP/cobrança |
| 35 | Aging | 🔴 Mesma dependência do item 34 | Faixas por dias vencidos na data de referência, com baixas parciais |
| 36 | Impostos/faturamento | 🟡 Guias e apurações existentes | Separar apurado, documentado e pago; excluir parcelas antigas, juros/multas conforme definição do indicador |
| 37 | Evolução da carga | 🟡 Mesmas fontes | Usar a mesma definição nos meses comparados; sem misturar competência e caixa |
| 38 | Fator R | 🟡 Motor, fontes de receita e folha existem | Conferir FS12 e RBT12 por atividade/regime; folha contábil agregada não comprova tudo que a regra exige |
| 39 | Pró-labore/faturamento | 🟡 Folha/lançamentos e cadastro | Separar pró-labore, encargos e pagamentos; folha por rubrica/eSocial ou ERP |
| 40 | Distribuição de lucros | 🟡 Possíveis lançamentos patrimoniais | Conferir contas, sócio, período do lucro e distribuição; ERP contábil, deliberação e pagamentos |
| 41 | Retirada total dos sócios | 🟡 Cadastro e lançamentos | Beneficiário e natureza: pró-labore, lucro, empréstimo, reembolso etc.; evitar duplicidade |
| 42 | Despesas operacionais/receita | ✅ DRE | Mostrar proporção, não afirmar eficiência universal |
| 43 | Despesas por categoria | ✅ Plano e lançamentos | Desdobramentos reais; não inventar Marketing/Software sem classificação |
| 44 | Crescimento despesas x receita | ✅ Série contábil/documental | Identificar bases e períodos; preferir receita contábil para explicar margem da DRE |
| 45 | Receita por funcionário | 🔴 Headcount médio confiável não identificado | ERP de folha/eSocial: admissões, desligamentos e ativos por mês; quantidade comercial cadastrada não substitui média |

## 4. Fontes existentes a aproveitar

- `DreService` e `dreGerencial`: sinais, subtotais, precedência do plano e qualidade.
- `AnaliseEmpresaService` e `ClientesAnaliseService`: consultas em lote; já existem na branch de desenvolvimento, ainda sem homologação de histórico real no PostgreSQL.
- `CompanyMonthlyCircular`: checklists, fechamento contábil e confirmação de mês sem faturamento. Próxima evolução deve usar esses estados para distinguir zero confirmado de ausência.
- `Guide`, `Parcelamento`, `Parcela`, documentos de arrecadação e apuração: origem fiscal sem nova consulta paga ao abrir relatórios.
- `LancamentoDeclarado`/`OfxImport`: existem pagamentos e origem; importação atual não é um financeiro bancário completo.
- `FolhaDerivadaService`, `FatorRService`, `DadosPlanejamentoService`: reaproveitar cálculo e procedência; não recalcular tributos com atalhos no BI.
- `SimulacaoPlanejamento`: preservada. O laboratório precisa de estrutura separada para cenário fictício sem empresa fiscal e sem corromper cenários tributários antigos.

## 5. Relatório para o cliente, operado pelo contador

Resumo de uma página, seguido das seções escolhidas. Número, comparação, explicação verificável e origem. Gráficos de série, composição e variação; tabelas de apoio acessíveis.

PDF: empresa/CNPJ, período e comparação, emissão, dados provisórios, política de indicadores, fontes e páginas numeradas. Opções únicas: Resumo executivo ou Relatório completo, com seções opcionais. Exportar todos os registros do recorte selecionado, não somente a página da tabela (limitação atual a corrigir). Valores do gráfico, tabela e PDF devem vir da mesma foto de cálculo. Não enviar automaticamente.

O que mudou?: motor determinístico identifica contribuições em reais de receitas, contas e clientes. Correlação não vira causa. Para explicar a mudança de margem, decompor numerador/denominador e diferenças de classificação, sem atribuir causalidade a uma despesa por simples coincidência.

Regras históricas versionadas para recorrência, concentração e volatilidade; configuração pelo contador em um único lugar. Não declarar saúde financeira global quando faltam caixa ou outras dimensões.

## 6. Laboratório

No dashboard: seletor Empresa existente / Empresa fictícia e lista de cenários. Fictícia é uma entidade de cenário, nunca PortalClient/Company apto a emitir nota, enviar guia ou disparar integração.

Empresa existente: copiar uma foto do período e procedências. Cada valor: importado, informado, estimado ou ausente. Alterações em cenário não alteram lançamentos, contratos, notas ou cadastro. Mudança do histórico real não atualiza silenciosamente uma simulação salva.

Entrada mínima: faturamento, despesas, clientes, pró-labore separado e hipótese tributária. Informar se despesas já incluem pró-labore/impostos. Só revelar campos adicionais quando necessários: custo variável/fixo para equilíbrio; caixa inicial e prazos para fluxo; distribuição da carteira para concentração. Não gerar tudo a partir de cinco campos insuficientes.

Modelos por segmento contêm valores fictícios editáveis e indicação educativa. Regime tributário sozinho não determina alíquota. Nunca assumir 6% como imposto de qualquer profissão. Alternativa: taxa explicitamente informada ou ligação ao simulador tributário com suas entradas completas e vigência.

Cenário base e A/B: contratação (custo total), preço, volume, despesa fixa, ganho/perda de cliente e pró-labore. Preço, quantidade e faturamento têm dependências para não contar o crescimento duas vezes. Perda de cliente não elimina custo fixo automaticamente. Distribuição altera disponibilidade estimada, não vira despesa da DRE.

Com custos fixos F, taxa variável v e hipótese tributária proporcional t: equilíbrio = F/(1-v-t), somente quando denominador positivo. Receita para meta de resultado L = (F+L)/(1-v-t). Se tributo for progressivo, usar o motor aplicável por faixa, não essa simplificação. Cliente-alvo é arredondado para cima e usa ticket definido; meta deve esclarecer resultado da empresa versus retirada líquida do sócio.

Salvar versão: escritório, criador, empresa opcional, tipo de cenário, período-base, nome, premissas, origens, regras/tabelas, resultados e data. Salvamento explícito; reabrir preserva a foto. Recalcular com novas regras cria revisão. Modo apresentação omite navegação e identifica simulação; por padrão usa fictícias. Usar dados reais para conteúdo exige anonimização efetiva também de notas, textos e exportação — ocultar nome não garante anonimato.

## 7. Ajustes conceituais do documento

- Margem bruta e margem de contribuição não são intercambiáveis; contribuição desconta custos/despesas variáveis.
- Se o lucro já incorpora pró-labore, não subtraí-lo novamente ao calcular lucro retido. Exemplo: lucro 120, distribuição 50 => retenção do resultado 70, não 34 por nova subtração de 36 de pró-labore. A movimentação patrimonial completa exige saldos e ajustes.
- Lucro retido não é saldo bancário nem autorização automática para distribuição.
- Não calcular MRR/LTV contratual/churn confirmado só por datas de notas.
- Faixas de dependência são parâmetros gerenciais; não são um diagnóstico padronizado.
- Índices por lucro/receita zero ou negativos precisam de tratamento próprio, sem percentuais enganosos.

## 8. Sequência e critérios de aceite

1. Auditar dados reais somente leitura: 3–5 empresas de serviços com perfis distintos, janela de até 24 meses, captura/fechamento/classificação, folha e documentos. Priorizar empresa com histórico completo, incompleto e concentração alta. Entregar matriz de cobertura por empresa; não abrir novas chamadas SERPRO.
2. Consolidar Relatórios e PDF completo; preservar simulador tributário. Complementar 6 meses, Top 1/3/5, recorrência definida, médias/extremos e O que mudou. Conferir totais com lançamentos/notas/guias e cenários de estorno/cancelamento.
3. Laboratório fictício: entradas progressivas, modelos educativos, A/B, metas e apresentação. Testes de dependências e contagem dupla.
4. Laboratório baseado em empresa: foto versionada, procedência e alterações isoladas. Nenhuma escrita no financeiro real.
5. Fontes faltantes: mapeamento fixo/variável; pró-labore/sócios; títulos/baixas/saldos; contratos. Cada fonte desbloqueia somente seus indicadores.
6. Futuro explícito: resumo no painel do cliente e relatórios completos em aba própria, após homologação e revisão de acesso. Não implementar agora.

Aceite transversal: isolamento de empresas, datas/competências consistentes, dinheiro em centavos/Decimal, ausência diferente de zero, captura cancelada/duplicada, período parcial, campos originais preservados, PDF completo e legível, telas simples em desktop/mobile. Sem publicação nesta etapa de plano.

## Fontes oficiais para as definições sensíveis

- [CPC 03 — fluxos de caixa](https://www.cpc.org.br/CPC/Documentos-emitidos/Pronunciamentos/Pronunciamento?Id=34): referência para separar disponibilidades e movimentações de caixa de resultados/projeções.
- [Perguntas e Respostas do Simples Nacional](https://www8.receita.fazenda.gov.br/simplesnacional/arquivos/manual/perguntaosn.pdf): aplicar Fator R somente quando cabível e com as bases próprias da regra.
- [Consulta RFB sobre folha no Fator R](https://normas.receita.fazenda.gov.br/sijut2consulta/consulta/normas.receita.fazenda.gov.br/sijut2consulta/link.action?idAto=142447&visao=original): atenção à diferença entre folha contábil e regime de caixa da base pertinente.
